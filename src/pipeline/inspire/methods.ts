import "dotenv/config";
import * as turf from "@turf/turf";
import stats from "stats-lite";
import NodeGeocoder from "node-geocoder";
import { Logger } from "pino";
import {
  getPendingPolygonsInSearchArea,
  getPolygonsByIdInSearchArea,
  pendingPolygonExists,
} from "../../queries/query";

const precisionDecimalPlaces = 10;
const offsetMeanThreshold = 1e-4; // up to ~13 meters offset. TODO: do we need this threshold if std is so low anyway?
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
  /** Old polygon merged exactly with at least 1 old polygon, which we have identified */
  Merged,
  /** Old polygon merged with at least 1 old polygon, but we can't match *some* of the new boundary
   *  to an old polygon */
  MergedIncomplete,
  /** Old polygon was segmented into multiple new polygons, which we have identified */
  Segmented,
  /** Old polygon segmented but we can't find (all of) the other segments */
  SegmentedIncomplete,
  /** There was a combination of old boundaries merging and some segmentation into new boundaries */
  MergedAndSegmented,
  /** The polygon moved and matches with its associated title's property address */
  Moved,
  /** Didn't meet any of the above matching criteria */
  Fail,
}

const options = {
  provider: "mapbox",
  apiKey: process.env.MAPBOX_GEOCODER_TOKEN,
  formatter: null,
};

const geocoder = NodeGeocoder(options);

/**
 * Query the existing land_ownership_polygon table for freehold or unknown tenure (i.e. potentially
 * INSPIRE) polygons that:
 * - have the given poly_ids AND/OR
 * - intersect with the given search area polygon
 * @return array of polygons
 */
export const getExistingPolygons = async (
  poly_ids?: number[],
  searchArea?: turf.Polygon | turf.MultiPolygon
) => {
  const searchAreaString = searchArea ? JSON.stringify(searchArea) : undefined;
  return await getPolygonsByIdInSearchArea(poly_ids, searchAreaString, false);
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
): number => {
  // TODO: Add analytics to find where bottlenecks are in analysis script
  // use https://github.com/xaviergonz/js-angusj-clipper instead of turf to improve speed?
  const poly1 = turf.polygon([poly1coords]);
  const poly2 = turf.polygon([poly2coords]);

  const areaPoly1 = turf.area(poly1);
  const areaPoly2 = turf.area(poly2);

  const intersection = turf.intersect(poly1, poly2);

  if (intersection) {
    const areaIntersection = turf.area(intersection);

    // Take fraction of the largest polygon, thinking about the case of 1 polygon containing another
    return (areaIntersection * 100) / Math.max(areaPoly1, areaPoly2);
  } else {
    return 0;
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
 * TODO: split some of this function into smaller functions. It's too long and hard to understand.
 *
 * @param inspireId the INSPIRE ID for the new (and old) polygon
 * @param suggestedLatLongOffset an offset to try, if we are unable to calculate one for this case
 *        e.g. the offset of a nearby polygon in the INSPIRE dataset
 * @param titleAddress address of matching title (if it exists)
 * @returns the type of match, percentage interesect (after any offsetting), offset statistics, and
 *        the IDs of other polygons relating to the match (e.g. if a segment/merge)
 */
export const comparePolygons = async (
  logger: Logger,
  inspireId: number,
  oldCoords: number[][], // TODO: remove this param and look this up within this method?
  newCoords: number[][],
  suggestedLatLongOffset: number[] = [0, 0],
  titleAddress: string | undefined = undefined
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
  const percentageIntersect = calculateIntersect(oldCoords, newCoords);

  // TODO: should there be an absolute threshold too? (e.g. for very, very big polygons)
  if (percentageIntersect > percentageIntersectThreshold) {
    return {
      match: Match.HighOverlap,
      percentageIntersect,
      offsetStats,
    };
  }

  if (percentageIntersect === 0) {
    logger.debug(
      {
        inspireId,
        oldLatLong: oldCoords[0],
        newLatLong: newCoords[0],
        percentageIntersect,
      },
      "polygon moved to a new location"
    );

    if (titleAddress) {
      logger.info(`Title address is ${titleAddress}`);
      // Try geocoding the matching title address
      const results = await geocoder.geocode(`${titleAddress}, UK`);

      if (results.length > 0) {
        // Check against each of the geocoded results and find closest match
        const points = results.map((result) =>
          turf.point([result.latitude, result.longitude])
        );
        const newPoly = turf.polygon([newCoords]);
        const metersFromAddress = Math.min(
          ...points.map(
            (point) =>
              turf.distance(point, turf.center(newPoly), {
                units: "kilometers",
              }) * 1000
          )
        );

        // If new polygon lies within 50m of a geocoded location, accept it as a moved boundary
        if (metersFromAddress < 50) {
          logger.info(
            `${inspireId} moved and its center is ${metersFromAddress} m from its associated title address, so accept match`
          );
          return {
            match: Match.Moved,
            percentageIntersect,
            offsetStats,
          };
        } else {
          logger.info(
            `${inspireId} moved and its center is ${metersFromAddress} m from its associated title address, so match failed`
          );
        }
      }
    }
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
      .map((polygon: any) => polygon.poly_id)
      .filter((id) => id !== inspireId)
  );

  const newPolyWithBuffer = turf.buffer(newPoly, 0.005, {
    units: "kilometers",
  });
  const newAdjacentPolys = await getPendingPolygonsInSearchArea(
    JSON.stringify(newPolyWithBuffer)
  );
  const newAdjacentPolyIds = new Set<number>(
    newAdjacentPolys
      .map((polygon: any) => polygon.poly_id)
      .filter((id) => id !== inspireId)
  );

  // Let's now take a look at:
  // - boundaryGained. This is the new area (if any) that is in the new poly but not in the old poly.
  //   If there were old polygons within this area which are no longer present, a boundary merge has
  //   occured so we will add the old INSPIRE IDs to oldMergedIds
  // - boundaryLost. This is the old area (if any) that was in the old poly but no longer in the new one.
  //   If there are new polygons within this area, a boundary segmentation has occured so we will
  //   add the new INSPIRE IDs to newSegmentIds
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
          const matchedPolys: any = (
            await getExistingPolygons(undefined, shrunkPolygonGained.geometry)
          ).filter((poly: any) => poly.poly_id !== inspireId);

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
            const polyNoLongerExists = !(await pendingPolygonExists(
              matchedPoly.poly_id
            ));
            if (polyNoLongerExists) {
              oldMergedIds.add(matchedPoly.poly_id);
              if (polygonContains(newPoly, matchedPolyFeature)) {
                logger.debug(`merge match with ${matchedPoly.poly_id}`);
                return;
              } else {
                logger.debug(
                  {
                    inspireId,
                    matchedId: matchedPoly.poly_id,
                    latLong: newCoords[0],
                    percentageIntersect,
                  },
                  "Old matched poly is not completely contained within the new poly"
                );
              }
            } else {
              // This old poly still exists and isn't adjacent, so something more strange has happened
              // e.g. the old poly has been relocated
              logger.info(
                {
                  inspireId,
                  matchedId: matchedPoly.poly_id,
                  latLong: newCoords[0],
                  percentageIntersect,
                },
                "merged poly has moved"
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
    await Promise.all(
      turf.flatten(remainder).features.map(async (remainderPolygon) => {
        const remainderPolygonArea = turf.area(remainderPolygon);
        if (remainderPolygonArea < zeroAreaThreshold) {
          // If area is smaller than threshold, ignore this polygon (probably just an artifact)
          // Remove it from the remainder that we are yet to analyse
          remainder = turf.difference(remainder, remainderPolygon);
          return;
        }

        // Search through the nearby polygons to see if one lies within this remainder. Shrink
        // remainder by a buffer equal to 1/10 of sqrt(area), but at least 50cm, to filter out very
        // long, thin boundaries that are probably artifacts - the buffer method will return
        // undefined if the boundary shrinks to zero, so we can just discard it.
        const bufferMeters = Math.max(
          0.5,
          Math.sqrt(remainderPolygonArea) / 10
        );
        const shrunkRemainder = turf.buffer(
          remainderPolygon,
          -bufferMeters / 1000,
          {
            units: "kilometers",
          }
        );
        if (!shrunkRemainder) {
          remainder = turf.difference(remainder, remainderPolygon);
          return;
        }

        const matchedPolys: any[] = await getPendingPolygonsInSearchArea(
          JSON.stringify(shrunkRemainder)
        );

        if (matchedPolys.length > 0) {
          // Take first match
          const matchedPoly = matchedPolys[0];

          if (oldAdjacentPolyIds.has(matchedPoly.poly_id)) {
            // If the match was already an adjacent poly, we can assume boundary has just shifted
            remainder = turf.difference(remainder, matchedPoly.geom);
            return;
          }

          // If this poly is new, class this as a segmented polygon. And if it is not completely
          // contained within boundaryLost, something more complicated has occured so retun as a
          // failed match
          const polyAlreadyExisted =
            (await getExistingPolygons([matchedPoly.poly_id])).length > 0;
          if (!polyAlreadyExisted) {
            newSegmentIds.add(matchedPoly.poly_id);

            // Check whether this segment is fully within the old polygon
            if (polygonContains(oldPoly, matchedPoly.geom)) {
              remainder = turf.difference(remainder, matchedPoly.geom);
              return;
            } else {
              // Something complicated has happened e.g. neighbouring properties have both segmented and
              // then merged along different boundaries
              logger.info(
                {
                  inspireId,
                  matchedInspireId: matchedPoly.poly_id,
                  latLong: newCoords[0],
                  percentageIntersect,
                },
                "matched polygon is not fully contained within the old poly"
              );
            }
          } else {
            // This poly is not new and wasn't adjacent, so something more strange has happened
            // e.g. an old poly has been relocated
            logger.info(
              {
                inspireId,
                matchedInspireId: matchedPoly.poly_id,
                latLong: newCoords[0],
                percentageIntersect,
              },
              "new segment poly has moved"
            );
          }
          failedMatch = true;
        } else {
          logger.debug(
            "Part of the old boundary is no longer registered as an INSPIRE polygon"
          );
          incompleteSegmentation = true;
        }
      })
    );

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

  if (oldMergedIds.size === 0 && newSegmentIds.size === 0) {
    // This is just a boundary shift i.e. the boundary changed shape without merging/segmenting, and
    // land was maybe taken from/given to a neighbouring property.
    logger.debug(
      {
        inspireId,
        latLong: newCoords[0],
        percentageIntersect,
      },
      "boundaries shifted"
    );
    return {
      match: Match.BoundariesShifted,
      percentageIntersect,
      offsetStats,
    };
  }

  if (
    (incompleteMerge && incompleteSegmentation) ||
    (incompleteMerge && newSegmentIds.size) ||
    (oldMergedIds.size && incompleteSegmentation) ||
    (oldMergedIds.size && newSegmentIds.size)
  ) {
    logger.info(
      {
        inspireId,
        oldMergedIds: Array.from(oldMergedIds),
        newSegmentIds: Array.from(newSegmentIds),
        latLong: newCoords[0],
        percentageIntersect,
      },
      "merge and segment"
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
    logger.debug(
      {
        inspireId,
        oldMergedIds: Array.from(oldMergedIds),
        latLong: newCoords[0],
        percentageIntersect,
      },
      "incomplete merge"
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
    logger.debug(
      {
        inspireId,
        newSegmentIds: Array.from(newSegmentIds),
        latLong: newCoords[0],
        percentageIntersect,
      },
      "incomplete segmentation"
    );
    return {
      match: Match.SegmentedIncomplete,
      percentageIntersect,
      offsetStats,
      oldMergedIds: Array.from(oldMergedIds),
      newSegmentIds: Array.from(newSegmentIds),
    };
  }

  if (oldMergedIds.size) {
    logger.debug(
      {
        inspireId,
        oldMergedIds: Array.from(oldMergedIds),
        latLong: newCoords[0],
        percentageIntersect,
      },
      "complete merge"
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
    logger.debug(
      {
        inspireId,
        newSegmentIds: Array.from(newSegmentIds),
        latLong: newCoords[0],
        percentageIntersect,
      },
      "complete segmentation"
    );

    return {
      match: Match.Segmented,
      percentageIntersect,
      offsetStats,
      oldMergedIds: Array.from(oldMergedIds),
      newSegmentIds: Array.from(newSegmentIds),
    };
  }

  logger.error(
    {
      inspireId,
      oldMergedIds,
      newSegmentIds,
      latLong: newCoords[0],
    },
    "We shouldn't hit this"
  );
  return {
    match: Match.Fail,
    percentageIntersect,
    offsetStats,
    oldMergedIds: Array.from(oldMergedIds),
    newSegmentIds: Array.from(newSegmentIds),
  };
};
