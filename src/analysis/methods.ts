import "dotenv/config";
import axios from "axios";
import * as turf from "@turf/turf";
import stats from "stats-lite";

const precisionDecimalPlaces = 10;
const offsetMeanThreshold = 6e-5; // up to ~8 meters offset. TODO: do we need this threshold if std is so low anyway?
const offsetStdThreshold = 5e-8; // 95% of vertices offset by the same distance within 2stds = a few centimeters
const percentageIntersectThreshold = 99.5;

export enum Match {
  /** Same vertices (to above precision decimal places) */
  Exact,
  /** Same vertices but a different presentation order */
  // TODO: maybe remove this if it never happens after a few months of running the script
  SameVertices,
  /** Same vertices, each offset by the same lat and long (within distance and std thresholds) */
  ExactOffset,
  /** Different vertices but with an overlap that meets the percentage intersect threshold */
  HighOverlap,
  /** Different vertices and doesn't meet the overlap threshold */
  Fail,
}

/** Query the live boundary service for polygons with the given poly_ids and return JSON */
export const getExistingPolygons = async (poly_ids: number[]) => {
  try {
    // Use POST request so that the length of the list of poly_ids is not limited
    const response = await axios.post(
      `${process.env.BOUNDARY_SERVICE_URL}/polygons`,
      {
        poly_ids,
        secret: process.env.BOUNDARY_SERVICE_SECRET,
      }
    );
    return response.data.polygons;
  } catch (err) {
    console.error(`Error fetching polygons ${poly_ids}`, err.response?.data);
    if (err.response && err.response.status === 404) {
      return [];
    } else {
      return null;
    }
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

const calculatePercentageIntersect = (
  poly1coords: number[][],
  poly2coords: number[][]
): number => {
  // TODO: use https://github.com/xaviergonz/js-angusj-clipper instead of turf to improve speed?
  // Add analytics to find where bottlenecks are
  const poly1 = turf.polygon([poly1coords]);
  const poly2 = turf.polygon([poly2coords]);
  const intersection = turf.intersect(poly1, poly2);

  if (intersection) {
    const areaIntersection = turf.area(intersection);
    const areaPoly1 = turf.area(poly1);
    const areaPoly2 = turf.area(poly2);

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
 * Compare 2 sets of polygon coordinates to determine whether they are describing the same boundary.
 *
 * @param suggestedLatLongOffset an offset to try, if we are unable to calculate one for this case
 *        e.g. the offset of a nearby polygon in the INSPIRE dataset
 * @returns the type of match, offset statistics, and percentage interesect (after any offsetting)
 */
export const comparePolygons = (
  poly1coords: number[][],
  poly2coords: number[][],
  suggestedLatLongOffset: number[] = [0, 0]
): {
  match: Match;
  offsetStats?: OffsetStats;
  percentageIntersect: number;
} => {
  if (areExactMatch(poly1coords, poly2coords)) {
    return { match: Match.Exact, percentageIntersect: 100 };
  }

  for (const vertex of new Set([...poly1coords, ...poly2coords])) {
    if (
      // Remove last coords of each, since they are the same as first in a polygon GeoJSON
      poly1coords
        .slice(0, -1)
        .filter((coords) => areEqualCoords(coords, vertex)).length !==
      poly2coords
        .slice(0, -1)
        .filter((coords) => areEqualCoords(coords, vertex)).length
    ) {
      // The polygons contain a different set of vertices, so now let's now check if the polygon is
      // just offset in 1 direction
      const offsetStats = compareOffset(poly1coords, poly2coords);

      if (offsetStats.offsetMatch) {
        return {
          match: Match.ExactOffset,
          offsetStats,
          percentageIntersect: 100, // No point calculating if offset test passed
        };
      } else if (!offsetStats.sameNumberVertices) {
        // We couldn't calculate an offset, but try offsetting by the suggested offset
        poly1coords = poly1coords.map((coords) => [
          coords[0] + suggestedLatLongOffset[0],
          coords[1] + suggestedLatLongOffset[1],
        ]);
      }

      const percentageIntersect = calculatePercentageIntersect(
        poly1coords,
        poly2coords
      );

      return {
        match:
          percentageIntersect > percentageIntersectThreshold
            ? Match.HighOverlap
            : Match.Fail,
        percentageIntersect,
        offsetStats,
      };
    }
  }

  // Set of vertices are the same
  return { match: Match.SameVertices, percentageIntersect: 100 };
};
