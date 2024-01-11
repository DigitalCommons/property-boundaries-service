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
  /** Old boundary was segmented into multiple new boundaries, which we have identified */
  Segmented,
  /** Old boundary segmented but we can't find (all of) the other segments */
  SegmentedIncomplete,
  /** Old boundary merged with another old boundary (which we have identified) */
  // Merged,
  /** Old boundary expanded, but we can't find an exact match of multipled merged boundaries */
  // MergedIncomplete,
  /** Didn't meet any of the above matching criteria */
  Fail,
}

/** Query the live boundary service for polygons with the given poly_ids and return JSON */
export const getExistingPolygons = async (poly_ids: number[]) => {
  try {
    // Use POST request so that the length of the list of poly_ids is not limited
    const response = await axios.post(
      `${process.env.BOUNDARY_SERVICE_URL}/polygonsDevSearch`,
      {
        poly_ids,
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
export const comparePolygons = (
  inspireId: number,
  oldCoords: number[][], // TODO: remove this param and look this up within this method
  newCoords: number[][],
  suggestedLatLongOffset: number[] = [0, 0],
  nearbyPolygons: turf.Feature<turf.Polygon>[] = []
): {
  match: Match;
  percentageIntersect: number;
  offsetStats?: OffsetStats;
  otherPolygonIds?: number[];
} => {
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

  // TODO: check for boundary changes with adjacent polygons
  // - buffer old polygon by 1m
  // - explode

  // TODO: move this to separate segmented function
  if (oldPolyLarger) {
    const oldPoly = turf.polygon([oldCoords]);
    const newPoly = turf.polygon([newCoords]);

    if (polygonContains(oldPoly, newPoly)) {
      // Old poly contains new poly - let's now check if it has been segmented and try to find the
      // other segments
      console.log("aaaaa", inspireId);

      const segmentIds: number[] = [inspireId];

      // The boundary within the segmented polygon which has not yet been matched to a new INSPIRE ID
      let remainder = turf.difference(oldPoly, newPoly);
      let segmentNotFound = false;

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
          console.log("bbbbbb remainder polygon area", remainderPolygonArea);

          // console.log(
          //   "area of remainder polygon:",
          //   turf.area(remainderPolygon)
          // );

          // Search through the nearby polygons to see if one lies within this remainder Shrink
          // remainder by a buffer to avoid picking a point right on the edge Set the buffer to 1/10
          // of sqrt(area) (but at least 50cm), to filter out very long, thin boundaries that are
          // probably artifacts - the buffer method will return undefined if the boundary shrinks to
          // zero, so we can just discard it
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
            // console.log("shrunk to zero");
            remainder = turf.difference(remainder, remainderPolygon);
            return;
          }
          const pointsInRemainder = turf.explode(shrunkRemainder); // a point for every vertex

          // Perform spacial join and tag with INSPIRE ID if these points are within any other polygon
          const taggedPoint = turf.tag(
            pointsInRemainder,
            turf.featureCollection(nearbyPolygons),
            "INSPIREID",
            "matchedInspireId"
          );

          // Take first match (if any)
          const matchedInspireId = taggedPoint.features.find(
            (feature) => feature.properties.matchedInspireId
          )?.properties?.matchedInspireId;
          console.log("ddddd matched", inspireId, matchedInspireId);

          if (matchedInspireId) {
            // There was a match.
            segmentIds.push(matchedInspireId);

            // Check whether this polygon is a segment fully within the old polygon
            const matchedPoly = nearbyPolygons.find(
              (feature) => feature.properties.INSPIREID === matchedInspireId
            );
            if (polygonContains(oldPoly, matchedPoly)) {
              remainder = turf.difference(remainder, matchedPoly);
              // console.log(
              //   "eeeee remainder area",
              //   remainder ? turf.area(remainder) : 0
              // );
              return;
            } else {
              console.log(
                "matched polygon is not fully contained within the old poly"
              );
              // TODO: handle case where boundary between two adjacent properties moves
            }
          } else {
            console.log(
              "Part of the old boundary is no longer registered as an INSPIRE polygon"
            );
            // console.log(
            //   "unmatched",
            //   taggedPoint.features[0].geometry.coordinates,
            //   ", remainder polygon coords:"
            // );
            // console.dir(shrunkRemainder.geometry.coordinates, {
            //   maxArrayLength: null,
            // });
          }

          // We couldn't find a match in the remainder, or something more complicated has happened
          // e.g. neighbouring properties have both segmented and then merged along different
          // boundaries.
          segmentNotFound = true;
        });

        if (segmentNotFound) {
          console.log(
            inspireId,
            "partially segmented into",
            segmentIds,
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
            otherPolygonIds: segmentIds, // just return what we have so far
          };
        }
      }

      console.log(
        inspireId,
        "fully segmented into",
        segmentIds,
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
        otherPolygonIds: segmentIds,
      };
    } else {
      console.log(
        "polygon not contained in larger old poly",
        inspireId,
        "new",
        newCoords[0][1],
        ",",
        newCoords[0][0],
        "old",
        oldCoords[0][1],
        ",",
        oldCoords[0][0],
        "% intersect:",
        percentageIntersect
      );
    }
  } else {
    // TODO:
    // - check if polygons have merged to create this new polygon
    //     - analyse in a similar way to above
  }

  return {
    match: Match.Fail,
    percentageIntersect,
    offsetStats,
  };
};
