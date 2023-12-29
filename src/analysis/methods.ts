import "dotenv/config";
import axios from "axios";
import * as turf from "@turf/turf";
import stats from "stats-lite";

export enum Match {
  Exact,
  SameVertices, // Same set of vertices but not the exact same presentation order
  DifferentVertices,
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
    console.error(err);

    if (err.response && err.response.status !== 404) {
      console.error(`Error fetching polygon ${poly_ids}`, err.response?.data);
    } else {
      console.error(`Error fetching polygon ${poly_ids}`, err.message);
    }
    return null;
  }
};

/**
 * We round to 10 d.p. since data from each data source has different precision.
 */
const areEqualCoords = (coords1: number[], coords2: number[]) =>
  coords1[0].toFixed(10) === coords2[0].toFixed(10) &&
  coords1[1].toFixed(10) === coords2[1].toFixed(10);

/** We will sort by this coefficient so long and lat don't interfere with each other and we can
 * have a unique
 */
const coefficientForSorting = (coords: number[]) =>
  Math.round(coords[0] * 1000) * 10 + Math.round(coords[1] * 10000) / 100000;

const areExactMatch = (
  poly1coords: number[][],
  poly2coords: number[][]
): boolean => {
  if (poly1coords.length !== poly2coords.length) return false;

  // // Remove last coords of each, since they are the same as first in poly1coords polygon GeoJSON
  // const adjustedPoly1 = poly1coords.slice(0, -1);
  // const adjustedPoly2 = poly2coords.slice(0, -1);

  // const minCoefficient1 = Math.min(...adjustedPoly1.map(coefficientForSorting));
  // const minCoefficient2 = Math.min(...adjustedPoly2.map(coefficientForSorting));
  // if (minCoefficient1 !== minCoefficient2) return false;

  // Rotate elements so smallest coefficient in each is first, since order may be different but
  // doesn't matter

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

    return (areaIntersection * 100) / Math.max(areaPoly1, areaPoly2);
  } else {
    return 0;
  }
};

export type OffsetStats = {
  latMean: number;
  latStd: number;
  longMean: number;
  longStd: number;
};

const calculateOffsetStats = (
  poly1coords: number[][],
  poly2coords: number[][]
): OffsetStats | undefined => {
  // If different number of vertices, just return undefined
  if (poly1coords.length !== poly2coords.length) {
    return;
  }

  const latOffsets: number[] = [];
  const longOffsets: number[] = [];
  poly2coords
    .slice(0, -1)
    .forEach((coords, i) => [
      latOffsets.push(coords[0] - poly1coords[i][0]),
      longOffsets.push(coords[1] - poly1coords[i][1]),
    ]);

  return {
    latMean: stats.mean(latOffsets),
    latStd: stats.stdev(latOffsets),
    longMean: stats.mean(longOffsets),
    longStd: stats.stdev(longOffsets),
  };
};

/**
 * Compare 2 sets of polygon coordinates. Return the type of match and percentage interesect.
 */
export const comparePolygons = (
  poly1coords: number[][],
  poly2coords: number[][]
): {
  match: Match;
  percentageIntersect: number;
  offsetStats?: OffsetStats;
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
      // The polygons contain a different set of vertices, so now let's find their percentage
      // intersect and offset statistics (to check whether polygon has just shifted in 1 direction)
      const percentageIntersect = calculatePercentageIntersect(
        poly1coords,
        poly2coords
      );

      const offsetStats = calculateOffsetStats(poly1coords, poly2coords);

      return {
        match: Match.DifferentVertices,
        percentageIntersect,
        offsetStats,
      };
    }
  }

  // Set of vertices are the same
  return { match: Match.SameVertices, percentageIntersect: 100 };
};
