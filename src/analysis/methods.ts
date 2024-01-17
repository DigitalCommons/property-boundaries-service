import "dotenv/config";
import axios from "axios";
import * as turf from "@turf/turf";
import stats from "stats-lite";

const precisionDecimalPlaces = 10;
const offsetMeanThreshold = 6e-5; // up to ~8 meters offset. TODO: do we need this threshold if std is so low anyway?
const offsetStdThreshold = 5e-8; // 95% of vertices offset by the same distance within 2stds = a few centimeters
const percentageIntersectThreshold = 98; // Threshold at which we assume polygons with this intersect are the same
const zeroAreaThreshold = 2; // Polygons less than 2 m2 are ignored as artifacts when calculating segment/merge

export enum Match {
  /** Old and new polys have same vertices (to above precision decimal places) */
  Exact,
  /** Same vertices but a different presentation order */
  // TODO: maybe remove this if it never happens after a few months of running the script
  SameVertices,
  /** Same vertices, each offset by the same lat and long (within distance and std thresholds) */
  ExactOffset,
  /** Different vertices but with an overlap that meets the percentage intersect threshold */
  HighOverlap,
  /** Polygon is in same place but its boundaries have sligtly shifted with adjacent polys */
  BoundariesShifted,
  /** Old polygon merged with other old polygons(s), which we have identified */
  Merged,
  /** Old polygon expanded, but we can't match some of the new boundary to an old polygon */
  MergedIncomplete,
  /** Old polygon was segmented into multiple new polygons, which we have identified */
  Segmented,
  /** Old polygon segmented but we can't find (all of) the other segments */
  SegmentedIncomplete,
  /** There was a combination of old boundaries merging and some segmentation into new boundaries */
  MergedAndSegmented,
  /** Didn't meet any of the above matching criteria */
  Fail,
}

/**
 * Query the live boundary service for freehold (i.e. INSPIRE) polygons that
 * - have the given poly_ids
 * AND/OR
 * - intersect with the given search area polygon
 * @return array of GeoJSON polygon features
 */
export const getExistingPolygons = async (
  poly_ids?: number[],
  searchArea?: turf.Polygon | turf.MultiPolygon
) => {
  try {
    // Use POST request so that the length of the list of poly_ids is not limited
    const response = await axios.post(
      `${process.env.BOUNDARY_SERVICE_URL}/polygonsDevSearch`,
      {
        poly_ids,
        searchArea: JSON.stringify(searchArea),
        secret: process.env.BOUNDARY_SERVICE_SECRET,
      }
    );
    return response.data;
  } catch (err) {
    console.error(`Error fetching polygons ${poly_ids}`, err.response?.data);
    return null;
  }
};

/**
 * We round since data from each data source has different precision.
 */
const areEqualCoords = (coords1: number[], coords2: number[]) => {
  return (
    coords1[0].toFixed(precisionDecimalPlaces) ===
      coords2[0].toFixed(precisionDecimalPlaces) &&
    coords1[1].toFixed(precisionDecimalPlaces) ===
      coords2[1].toFixed(precisionDecimalPlaces)
  );
};

const areExactMatch = (
  poly1coords: number[][],
  poly2coords: number[][]
): boolean => {
  if (poly1coords.length !== poly2coords.length) return false;

  for (let i = 0; i < poly1coords.length; ++i) {
    if (!areEqualCoords(poly1coords[i], poly2coords[i])) return false;
  }
  return true;
};

const haveSameVertices = (
  poly1coords: number[][],
  poly2coords: number[][]
): boolean => {
  for (const vertex of new Set([...poly1coords, ...poly2coords])) {
    // Loop through each unique vertex and check both polygons have the same number of this vertex
    if (
      // Remove last coords of polygon, since they are a repeat of the first in a GeoJSON polygon
      poly1coords
        .slice(0, -1)
        .filter((coords) => areEqualCoords(coords, vertex)).length !==
      poly2coords
        .slice(0, -1)
        .filter((coords) => areEqualCoords(coords, vertex)).length
    ) {
      return false;
    }
  }
  return true;
};

const calculateIntersect = (
  poly1coords: number[][],
  poly2coords: number[][]
): { percentageIntersect: number; poly1larger: boolean } => {
  // TODO: Add analytics to find where bottlenecks are in analysis script
  // use https://github.com/xaviergonz/js-angusj-clipper instead of turf to improve speed?
  const poly1 = turf.polygon([poly1coords]);
  const poly2 = turf.polygon([poly2coords]);

  const areaPoly1 = turf.area(poly1);
  const areaPoly2 = turf.area(poly2);
  const poly1larger = areaPoly1 > areaPoly2;

  const intersection = turf.intersect(poly1, poly2);

  if (intersection) {
    const areaIntersection = turf.area(intersection);

    // Take fraction of the largest polygon, thinking about the case of 1 polygon containing another
    return {
      percentageIntersect:
        (areaIntersection * 100) / Math.max(areaPoly1, areaPoly2),
      poly1larger,
    };
  } else {
    return {
      percentageIntersect: 0,
      poly1larger,
    };
  }
};

export type OffsetStats = {
  offsetMatch: boolean;
  sameNumberVertices: boolean;
  latMean?: number;
  latStd?: number;
  longMean?: number;
  longStd?: number;
};

/** Return whether the polygons match (with a small fixed vertices offset), and offset stats */
const compareOffset = (
  poly1coords: number[][],
  poly2coords: number[][]
): OffsetStats => {
  // If different number of vertices, return
  if (poly1coords.length !== poly2coords.length) {
    return { offsetMatch: false, sameNumberVertices: false };
  }

  const latOffsets: number[] = [];
  const longOffsets: number[] = [];
  poly2coords
    .slice(0, -1)
    .forEach((coords, i) => [
      latOffsets.push(coords[0] - poly1coords[i][0]),
      longOffsets.push(coords[1] - poly1coords[i][1]),
    ]);

  const latMean = stats.mean(latOffsets);
  const latStd = stats.stdev(latOffsets);
  const longMean = stats.mean(longOffsets);
  const longStd = stats.stdev(longOffsets);

  const offsetMatch =
    latMean < offsetMeanThreshold &&
    longMean < offsetMeanThreshold &&
    latStd < offsetStdThreshold &&
    longStd < offsetStdThreshold;

  return {
    offsetMatch,
    sameNumberVertices: true,
    latMean,
    latStd,
    longMean,
    longStd,
  };
};

/**
 * Use this instead of turf.booleanContains to allow some tolerance e.g. if subPoly has edges that
 * go slightly outside of the containing polygon
 */
const polygonContains = (
  poly: turf.Feature<turf.Polygon>,
  subPoly: turf.Feature<turf.Polygon>
): boolean => {
  const intersect = turf.intersect(poly, subPoly);
  if (!intersect) return false;

  const percentageIntersect = (turf.area(intersect) * 100) / turf.area(subPoly);
  return percentageIntersect > percentageIntersectThreshold;
};

/**
 * Compare 2 sets of polygon coordinates to determine whether they are describing the same boundary.
 *
 * @param inspireId the INSPIRE ID for the new (and old) polygon
 * @param suggestedLatLongOffset an offset to try, if we are unable to calculate one for this case
 *        e.g. the offset of a nearby polygon in the INSPIRE dataset
 * @param nearbyPolygons that we search over when analysing cases of boundary segmentation/merger
 * @returns the type of match, percentage interesect (after any offsetting), offset statistics, and
 *        the IDs of other polygons relating to the match (e.g. if a segment/merge)
 */
export const comparePolygons = async (
  inspireId: number,
  oldCoords: number[][], // TODO: remove this param and look this up within this method
  newCoords: number[][],
  suggestedLatLongOffset: number[] = [0, 0],
  nearbyPolygons: turf.Feature<turf.Polygon>[] = []
): Promise<{
  match: Match;
  percentageIntersect: number;
  offsetStats?: OffsetStats;
  newSegmentIds?: number[];
  oldMergedIds?: number[];
}> => {
  if (areExactMatch(oldCoords, newCoords)) {
    return { match: Match.Exact, percentageIntersect: 100 };
  }

  if (haveSameVertices(oldCoords, newCoords)) {
    return { match: Match.SameVertices, percentageIntersect: 100 };
  }

  // Let's now check if one polygon is just offset from the other, but with exact same shape & size
  const offsetStats = compareOffset(oldCoords, newCoords);

  if (offsetStats.offsetMatch) {
    return {
      match: Match.ExactOffset,
      offsetStats,
      percentageIntersect: 100, // No point calculating if offset test passed
    };
  }

  // They're not an exact offset match, but let's try offsetting by the suggested offset and find
  // their percentage intersect
  oldCoords = oldCoords.map((coords) => [
    coords[0] + suggestedLatLongOffset[0],
    coords[1] + suggestedLatLongOffset[1],
  ]);
  const { percentageIntersect, poly1larger: oldPolyLarger } =
    calculateIntersect(oldCoords, newCoords);

  // TODO: should there be an absolute threshold too? (e.g. for very, very big polygons)
  if (percentageIntersect > percentageIntersectThreshold) {
    return {
      match: Match.HighOverlap,
      percentageIntersect,
      offsetStats,
    };
  }

  if (percentageIntersect == 0) {
    console.log(
      "polygon moved to a new location",
      inspireId,
      "new",
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "old",
      oldCoords[0][1],
      ",",
      oldCoords[0][0]
    );

    // TODO: Geocode title?
    return {
      match: Match.Fail,
      percentageIntersect,
      offsetStats,
    };
  }

  // TODO: move all this to separate segment/merge function?

  const oldPoly = turf.polygon([oldCoords]);
  const newPoly = turf.polygon([newCoords]);

  // Get polyons that are adjacent to this polygon in our old and new data
  const oldPolyWithBuffer = turf.buffer(oldPoly, 0.005, {
    units: "kilometers",
  });
  // search existing polygons that intersect with this buffered poly
  const oldAdjacentPolys = await getExistingPolygons(
    undefined,
    oldPolyWithBuffer.geometry
  );
  const oldAdjacentPolyIds = new Set<number>(
    oldAdjacentPolys
      .map((polygon) => polygon.poly_id)
      .filter((id) => id !== inspireId)
  );

  const newPolyWithBuffer = turf.buffer(newPoly, 0.005, {
    units: "kilometers",
  });
  const bufferVertices = turf.explode(newPolyWithBuffer);
  // Perform spacial join and tag with INSPIRE ID if these vertices are within any other polygon
  const taggedVertices = turf.tag(
    bufferVertices,
    turf.featureCollection(nearbyPolygons),
    "INSPIREID",
    "matchedInspireId"
  );
  const newAdjacentPolyIds = new Set<number>(
    taggedVertices.features
      .map((feature) => feature.properties.matchedInspireId)
      .filter((id) => id && id !== inspireId)
  );

  // TODO: could we remove this step and get the same result?
  if (
    oldAdjacentPolyIds.size === newAdjacentPolyIds.size &&
    [...oldAdjacentPolyIds].every((id) => newAdjacentPolyIds.has(id))
  ) {
    // All the adjacent polygons are still the same, so boundaries have just shifted
    console.log(
      inspireId,
      "boundaries shifted",
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "% intersect:",
      percentageIntersect
    );
    return {
      match: Match.BoundariesShifted,
      percentageIntersect,
      offsetStats,
    };
  }

  // Let's now take a look at:
  // - boundaryGained, i.e. the new area (if any) that is in the new poly but not in the old poly
  //   If there were old polygons within this area which are no longer present, a boundary merge has
  //   occured so we will add the old INSPIRE ID to oldMergedIds
  // - boundaryLost, i.e. the old area (if any) that was in the old poly but no longer in the new one
  //   If there are new polygons within this area, a boundary segmentation has occured so we will
  //   add the new INSPIRE ID to newSegmentIds
  const boundaryGained = turf.difference(newPoly, oldPoly);
  const boundaryLost = turf.difference(oldPoly, newPoly);

  const oldMergedIds: Set<number> = new Set();
  const newSegmentIds: Set<number> = new Set();

  // First let's analyse boundaryGained to find merged polygons
  let incompleteMerge = false;
  let remainder = boundaryGained;

  if (boundaryGained) {
    await Promise.all(
      turf.flatten(boundaryGained).features.map(
        // Remainder might be a multipolygon so consider each separate polygon
        async (polygonGained) => {
          const polygonGainedArea = turf.area(polygonGained);
          if (polygonGainedArea < zeroAreaThreshold) {
            // If area is smaller than threshold, ignore this polygon (probably just an artifact)
            remainder = turf.difference(remainder, polygonGained);
            return;
          }

          // Search through the old polygons to see which ones were within this remainder but don't exist
          // anymore. Shrink by a buffer to account for precision differences, so that we don't include
          // neighbouring polygons by mistake. Set the buffer to 1/10 of sqrt(area) (but at least 1m), to
          // filter out very long, thin boundaries that are probably artifacts from when we calculated the
          // difference - the buffer method will return undefined if the boundary shrinks to zero, so we
          // can just discard it
          const bufferMeters = Math.max(1, Math.sqrt(polygonGainedArea) / 10);
          const shrunkPolygonGained = turf.buffer(
            polygonGained,
            -bufferMeters / 1000,
            {
              units: "kilometers",
            }
          );
          if (!shrunkPolygonGained) {
            // The remainder has shrunk to zero, so assume it was just an artifact
            return;
          }

          // Match against old polygons in the existing database
          const matchedPolys = (
            await getExistingPolygons(undefined, shrunkPolygonGained.geometry)
          ).filter((poly) => poly.poly_id !== inspireId);

          for (const matchedPoly of matchedPolys) {
            const matchedPolyFeature = turf.polygon(
              matchedPoly.geom.coordinates
            );
            remainder = turf.difference(remainder, matchedPolyFeature);

            // If this old polygon is now adjacent to the new polygon, the boundaries must have
            // shifted a bit and it wasn't part of the merge
            if (newAdjacentPolyIds.has(matchedPoly.poly_id)) {
              return;
            }

            // If this old polygon doens't exist anymore, class this as a merged polygon. And if it
            // was not completely contained within the new polygon's boundaries, something more
            // complicated has occured so retun as a failed match
            const polyNoLongerExists = !nearbyPolygons.find(
              (newPoly) => newPoly.properties.INSPIREID === matchedPoly.poly_id
            );
            if (polyNoLongerExists) {
              oldMergedIds.add(matchedPoly.poly_id);
              if (polygonContains(newPoly, matchedPolyFeature)) {
                console.log("merge match with", matchedPoly.poly_id);
                return;
              } else {
                console.log(
                  inspireId,
                  `Old poly ${matchedPoly.poly_id} is not completely contained within the new poly`,
                  newCoords[0][1],
                  ",",
                  newCoords[0][0],
                  "% intersect:",
                  percentageIntersect
                );
              }
            } else {
              // This old poly still exists and isn't adjacent, so something more strange has happened
              // e.g. the old poly has been relocated
              console.log(
                inspireId,
                "merged poly has moved",
                matchedPoly.poly_id,
                newCoords[0][1],
                ",",
                newCoords[0][0],
                "% intersect:",
                percentageIntersect
              );
            }
            return {
              match: Match.Fail,
              percentageIntersect,
              offsetStats,
              oldMergedIds: Array.from(oldMergedIds),
              newSegmentIds: Array.from(newSegmentIds),
            };
          }
        }
      )
    );

    if (remainder && turf.area(remainder) > zeroAreaThreshold) {
      // We didn't manage to match the whole boundary gained to old polygons
      incompleteMerge = true;
    }
  }

  // Next let's analyse boundaryLost by recursively filling in the remaining boundary, until we have
  // looked at the whole area, and the remainder is down to zero
  remainder = boundaryLost;
  let incompleteSegmentation = false;
  let failedMatch = false;

  while (remainder && turf.area(remainder) > zeroAreaThreshold) {
    // Remainder might be a multipolygon so consider each separate polygon
    turf.flattenEach(remainder, (remainderPolygon) => {
      const remainderPolygonArea = turf.area(remainderPolygon);
      if (remainderPolygonArea < zeroAreaThreshold) {
        // If area is smaller than threshold, ignore this polygon (probably just an artifact)
        // Remove it from the remainder that we are yet to analyse
        remainder = turf.difference(remainder, remainderPolygon);
        return;
      }

      // Search through the nearby polygons to see if one lies within this remainder. Shrink
      // remainder by a buffer then pick these vertices as search points. Set the buffer to 1/10 of
      // sqrt(area) (but at least 50cm), to filter out very long, thin boundaries that are probably
      // artifacts - the buffer method will return undefined if the boundary shrinks to zero, so we
      // can just discard it.
      const bufferMeters = Math.max(0.5, Math.sqrt(remainderPolygonArea) / 10);
      const shrunkRemainder = turf.buffer(
        remainderPolygon,
        -bufferMeters / 1000,
        {
          units: "kilometers",
        }
      );
      if (!shrunkRemainder) {
        // console.log("shrunk to zero");
        remainder = turf.difference(remainder, remainderPolygon);
        return;
      }
      const pointsInRemainder = turf.explode(shrunkRemainder); // a point for every vertex

      // Perform spacial join and tag with INSPIRE ID if these points are within any other polygon
      const taggedPoints = turf.tag(
        pointsInRemainder,
        turf.featureCollection(nearbyPolygons),
        "INSPIREID",
        "matchedInspireId"
      );

      // Take first match (if any)
      const matchedInspireId = taggedPoints.features.find(
        (feature) => feature.properties.matchedInspireId
      )?.properties?.matchedInspireId;

      if (matchedInspireId) {
        // There was a match
        const matchedPoly = nearbyPolygons.find(
          (feature) => feature.properties.INSPIREID === matchedInspireId
        );

        if (oldAdjacentPolyIds.has(matchedInspireId)) {
          // If the match already an adjacent poly, we can assume boundary has just shifted
          remainder = turf.difference(remainder, matchedPoly);
          return;
        }

        // Otherwise, this is a new segment
        newSegmentIds.add(matchedInspireId);

        // Check whether this segment is fully within the old polygon
        if (polygonContains(oldPoly, matchedPoly)) {
          remainder = turf.difference(remainder, matchedPoly);
          return;
        } else {
          // Something complicated has happened e.g. neighbouring properties have both segmented and
          // then merged along different boundaries
          console.log(
            inspireId,
            "matched polygon is not fully contained within the old poly",
            matchedPoly.properties.INSPIREID,
            newCoords[0][1],
            ",",
            newCoords[0][0],
            "% intersect:",
            percentageIntersect
          );
          failedMatch = true;
        }
      } else {
        console.log(
          "Part of the old boundary is no longer registered as an INSPIRE polygon"
        );
        incompleteSegmentation = true;
      }
    });

    if (failedMatch) {
      return {
        match: Match.Fail,
        percentageIntersect,
        offsetStats,
        oldMergedIds: Array.from(oldMergedIds),
        newSegmentIds: Array.from(newSegmentIds),
      };
    }
    if (incompleteSegmentation) {
      break;
    }
  }

  if (
    (incompleteMerge && incompleteSegmentation) ||
    (incompleteMerge && newSegmentIds.size) ||
    (oldMergedIds.size && incompleteSegmentation) ||
    (oldMergedIds.size && newSegmentIds.size)
  ) {
    console.log(
      inspireId,
      "merge and segment",
      Array.from(oldMergedIds),
      Array.from(newSegmentIds),
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "% intersect:",
      percentageIntersect
    );
    return {
      match: Match.MergedAndSegmented,
      percentageIntersect,
      offsetStats,
      oldMergedIds: Array.from(oldMergedIds),
      newSegmentIds: Array.from(newSegmentIds),
    };
  }

  if (incompleteMerge) {
    console.log(
      inspireId,
      "incompletely merged with",
      Array.from(oldMergedIds),
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "% intersect:",
      percentageIntersect
    );
    return {
      match: Match.MergedIncomplete,
      percentageIntersect,
      offsetStats,
      oldMergedIds: Array.from(oldMergedIds),
      newSegmentIds: Array.from(newSegmentIds),
    };
  }

  if (incompleteSegmentation) {
    console.log(
      inspireId,
      "incompletely segmented into",
      Array.from(newSegmentIds),
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "% intersect:",
      percentageIntersect
    );
    return {
      match: Match.SegmentedIncomplete,
      percentageIntersect,
      offsetStats,
      oldMergedIds: Array.from(oldMergedIds),
      newSegmentIds: Array.from(newSegmentIds),
    };
  }

  if (oldMergedIds.size === 0 && newSegmentIds.size === 0) {
    // This is just a boundary shift that we didn't detect earlier e.g. if boundary shifted with one
    // neighbour, and another neighbouring boundary changed ID
    console.log(
      inspireId,
      "boundaries shifted (discovered later)",
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "% intersect:",
      percentageIntersect
    );
    return {
      match: Match.BoundariesShifted,
      percentageIntersect,
      offsetStats,
    };
  }

  if (oldMergedIds.size) {
    console.log(
      inspireId,
      "completely merged with",
      Array.from(oldMergedIds),
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "% intersect:",
      percentageIntersect
    );
    return {
      match: Match.Merged,
      percentageIntersect,
      offsetStats,
      oldMergedIds: Array.from(oldMergedIds),
      newSegmentIds: Array.from(newSegmentIds),
    };
  }

  if (newSegmentIds.size) {
    console.log(
      inspireId,
      "fully segmented into",
      Array.from(newSegmentIds),
      newCoords[0][1],
      ",",
      newCoords[0][0],
      "% intersect:",
      percentageIntersect
    );

    return {
      match: Match.Segmented,
      percentageIntersect,
      offsetStats,
      oldMergedIds: Array.from(oldMergedIds),
      newSegmentIds: Array.from(newSegmentIds),
    };
  }

  console.error(
    "We shouldn't hit this",
    inspireId,
    oldMergedIds,
    newSegmentIds,
    newCoords[0][1],
    ",",
    newCoords[0][0]
  );
  return {
    match: Match.Fail,
    percentageIntersect,
    offsetStats,
    oldMergedIds: Array.from(oldMergedIds),
    newSegmentIds: Array.from(newSegmentIds),
  };
};
