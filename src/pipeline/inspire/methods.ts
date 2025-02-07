import "dotenv/config";
import * as turf from "@turf/turf";
import stats from "stats-lite";
import NodeGeocoder from "node-geocoder";
import {
  getPendingPolygonsInSearchArea,
  getPolygonsByIdInSearchArea,
  pendingPolygonExists,
} from "../../queries/query";
import { logger } from "../logger";
import { Feature, Polygon, MultiPolygon } from "geojson";
import { Match } from "./match";

export const precisionDP = 6; // round coords to this many decimal places, since the distance is negligible and it avoids issues with turf
const offsetMeanThreshold = 1e-4; // up to ~13 meters offset. TODO: do we need this threshold if std is so low anyway?
const offsetStdThreshold = 5e-8; // 95% of vertices offset by the same distance within 2stds = a few centimeters
const percentageIntersectThreshold = 95; // Threshold at which we assume polygons with this intersect are the same
const absoluteDifferenceThresholdM2 = 100; // Symmetric difference of polygons must be lower than this threshold for us to consider them the same
const zeroAreaThreshold = 2; // Polygons less than 2 m2 are ignored as artifacts when calculating segment/merge

const geocoderOptions: NodeGeocoder.Options = {
  provider: "mapbox",
  apiKey: process.env.MAPBOX_GEOCODER_TOKEN,
  formatter: null,
};
let geocoder: NodeGeocoder.Geocoder;

/**
 * Query the existing land_ownership_polygon table for freehold or unknown tenure (i.e. potentially
 * INSPIRE) polygons that:
 * - have the given poly_ids AND/OR
 * - intersect with the given search area polygon
 * @return array of polygons
 */
export const getExistingInspirePolygons = async (
  poly_ids?: number[],
  searchArea?: Polygon | MultiPolygon
) => {
  const searchAreaString = searchArea ? JSON.stringify(searchArea) : undefined;
  return await getPolygonsByIdInSearchArea(poly_ids, searchAreaString, false);
};

/**
 * Check equality of each coordinate lng-lat value within a small epsilon (precisionDP)
 */
const areEqualCoords = (coords1: number[], coords2: number[]) => {
  const epsilon = Math.pow(10, -precisionDP);
  return (
    Math.abs(coords1[0] - coords2[0]) < epsilon &&
    Math.abs(coords1[1] - coords2[1]) < epsilon
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

const calculateOverlap = (
  poly1coords: number[][],
  poly2coords: number[][]
): {
  absoluteDifferenceM2: number;
  percentageIntersect: number;
} => {
  // TODO: Add analytics to find where bottlenecks are in analysis script
  // use https://github.com/xaviergonz/js-angusj-clipper instead of turf to improve speed?

  // Truncate each coord to 6 d.p. since higher precision can cause issues with turf calculations
  const poly1 = turf.truncate(turf.polygon([poly1coords]));
  const poly2 = turf.truncate(turf.polygon([poly2coords]));

  const areaPoly1 = turf.area(poly1);
  const areaPoly2 = turf.area(poly2);

  const intersection = turf.intersect(turf.featureCollection([poly1, poly2]));

  if (intersection) {
    const areaIntersection = turf.area(intersection);
    const areaUnion = turf.area(
      turf.union(turf.featureCollection([poly1, poly2]))
    );

    // Take fraction of the largest polygon, thinking about the case of 1 polygon containing another
    return {
      absoluteDifferenceM2: areaUnion - areaIntersection,
      percentageIntersect: (areaIntersection * 100) / areaUnion,
    };
  } else {
    return {
      absoluteDifferenceM2: areaPoly1 + areaPoly2,
      percentageIntersect: 0,
    };
  }
};

export type OffsetStats = {
  offsetMatch: boolean;
  sameNumberVertices: boolean;
  lngMean?: number;
  lngStd?: number;
  latMean?: number;
  latStd?: number;
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

  const lngOffsets: number[] = [];
  const latOffsets: number[] = [];
  poly2coords
    .slice(0, -1)
    .forEach((coords, i) => [
      lngOffsets.push(coords[0] - poly1coords[i][0]),
      latOffsets.push(coords[1] - poly1coords[i][1]),
    ]);

  const lngMean = stats.mean(lngOffsets);
  const lngStd = stats.stdev(lngOffsets);
  const latMean = stats.mean(latOffsets);
  const latStd = stats.stdev(latOffsets);

  const offsetMatch =
    Math.abs(lngMean) < offsetMeanThreshold &&
    Math.abs(latMean) < offsetMeanThreshold &&
    lngStd < offsetStdThreshold &&
    latStd < offsetStdThreshold;

  return {
    offsetMatch,
    sameNumberVertices: true,
    lngMean,
    lngStd,
    latMean,
    latStd,
  };
};

/**
 * Use this instead of turf.booleanContains to allow some tolerance e.g. if subPoly has edges that
 * go slightly outside of the containing polygon
 */
const polygonContains = (
  poly: Feature<Polygon>,
  subPoly: Feature<Polygon>
): boolean => {
  const intersect = turf.intersect(
    turf.truncate(turf.featureCollection([poly, subPoly]))
  );
  if (!intersect) return false;

  const percentageIntersect = (turf.area(intersect) * 100) / turf.area(subPoly);
  return percentageIntersect > percentageIntersectThreshold;
};

/**
 * Compare old and new poly coordinates and return the type of match.
 *
 * TODO: split some of this function into smaller functions. It's too long and hard to understand.
 *
 * @param suggestedLngLatOffset an offset to try, if we are unable to calculate one for this case
 *        e.g. the offset of a nearby polygon in the INSPIRE dataset
 * @param titleAddress address of matching title (if it exists)
 * @returns the type of match, percentage interesect (after any offsetting), offset statistics, and
 *        the IDs of other polygons relating to the match (e.g. if a segment/merge)
 */
export const comparePolygons = async (
  oldInspireId: number,
  newInspireId: number,
  oldCoords: number[][],
  newCoords: number[][],
  suggestedLngLatOffset: number[] = [0, 0],
  titleAddress: string | undefined = undefined
): Promise<{
  match: Match;
  percentageIntersect?: number;
  offsetStats?: OffsetStats;
  newSegmentIds?: number[];
  oldMergedIds?: number[];
}> => {
  if (geocoderOptions.apiKey && !geocoder) {
    geocoder = NodeGeocoder(geocoderOptions);
  }

  if (areExactMatch(oldCoords, newCoords)) {
    return { match: Match.Exact, percentageIntersect: 100 };
  }

  // Let's now check if one polygon is just offset from the other, but with exact same shape & size
  const offsetStats = compareOffset(oldCoords, newCoords);

  if (offsetStats.offsetMatch) {
    return {
      match: Match.ExactOffset,
      offsetStats,
      percentageIntersect: 100, // No point calculating since offset test passed
    };
  }

  // They're not an exact offset match, but let's try offsetting by the suggested offset and assess
  // their overlap.
  const oldCoordsWithoutOffset = oldCoords;
  oldCoords = oldCoords.map((coords) => [
    coords[0] + suggestedLngLatOffset[0],
    coords[1] + suggestedLngLatOffset[1],
  ]);
  const newCoordsMinusOffset = newCoords.map((coords) => [
    coords[0] - suggestedLngLatOffset[0],
    coords[1] - suggestedLngLatOffset[1],
  ]);
  let percentageIntersect: number;

  try {
    const overlap = calculateOverlap(oldCoords, newCoords);
    percentageIntersect = overlap.percentageIntersect;

    // The absolute threshold test is for very, very big polygons
    if (
      overlap.absoluteDifferenceM2 < absoluteDifferenceThresholdM2 &&
      percentageIntersect > percentageIntersectThreshold
    ) {
      return {
        match: Match.HighOverlap,
        percentageIntersect,
        offsetStats,
      };
    }

    if (percentageIntersect === 0) {
      logger.debug(
        {
          oldInspireId,
          newInspireId,
          oldLngLat: oldCoords[0],
          newLngLat: newCoords[0],
          percentageIntersect,
        },
        "polygon moved to a new location"
      );

      if (titleAddress) {
        logger.debug(`Title address is ${titleAddress}`);
        let results = [];
        // Try geocoding the matching title address
        try {
          results = await geocoder?.geocode(`${titleAddress}, UK`);
        } catch (err) {
          logger.error(err, "Failed to geocode title address");
        }

        if (results.length > 0) {
          // Check against each of the geocoded results and find closest match
          const points = results.map((result) =>
            turf.point([result.longitude, result.latitude])
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
            logger.debug(
              {
                oldInspireId,
                newInspireId,
              },
              `Poly moved and its center is ${metersFromAddress} m from its associated title address, so accept match`
            );
            return {
              match: Match.Moved,
              percentageIntersect,
              offsetStats,
            };
          } else {
            logger.debug(
              {
                oldInspireId,
                newInspireId,
              },
              `Poly moved and its center is ${metersFromAddress} m from its associated title address, so match failed`
            );
          }
        }
      }
    }
  } catch (error) {
    logger.error(
      {
        error,
        oldInspireId,
        newInspireId,
        oldCoordsPlusOffset: oldCoords,
        lngLatOffset: suggestedLngLatOffset,
        newCoords,
      },
      `We hit an error comparing polygons`
    );

    // Re-throw this error whilst we're debugging the pipeline so we don't miss errors. Remove this
    // later, since we don't want to stop the whole pipeline for one error (and maybe integrate with
    // Glitchtip for better error tracking)
    throw error;

    return {
      match: Match.Fail,
      percentageIntersect,
      offsetStats,
      newSegmentIds: [],
    };
  }

  // Skip the rest of the analysis for now, until we work out how to optimise the code
  return {
    match: Match.Fail,
    percentageIntersect,
    offsetStats,
    newSegmentIds: [],
  };

  // TODO: move all this to separate segment/merge function?

  // Truncate each coord to 6 d.p. since higher precision can cause issues with turf calculations
  const oldPoly = turf.truncate(turf.polygon([oldCoords]));
  const oldPolyWithoutOffset = turf.truncate(
    turf.polygon([oldCoordsWithoutOffset])
  );
  const newPoly = turf.truncate(turf.polygon([newCoords]));
  const newPolyMinusOffset = turf.truncate(
    turf.polygon([newCoordsMinusOffset])
  );

  // Get polyons that are adjacent to this polygon in our old and new data. Don't use offset since
  // we are matching against existing polygons in the original data.
  const oldPolyWithBuffer = turf.buffer(oldPolyWithoutOffset, 0.005, {
    units: "kilometers",
  });
  // search existing polygons that intersect with this buffered poly
  const oldAdjacentPolys = await getExistingInspirePolygons(
    undefined,
    oldPolyWithBuffer.geometry
  );
  const oldAdjacentPolyIds = new Set<number>(
    oldAdjacentPolys.map((polygon: any) => polygon.poly_id)
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
      .filter((id) => id !== newInspireId)
  );

  // Let's now take a look at:
  // - boundaryGained. This is the new area (if any) that is in the new poly but not in the old poly.
  //   If there were old polygons within this area which are no longer present, a boundary merge has
  //   occured so we will add the old INSPIRE IDs to oldMergedIds. Use old offsets since we are matching
  //   against existing polygons in the original data.
  // - boundaryLost. This is the old area (if any) that was in the old poly but no longer in the new one.
  //   If there are new polygons within this area, a boundary segmentation has occured so we will
  //   add the new INSPIRE IDs to newSegmentIds
  const boundaryGained = turf.difference(
    turf.featureCollection([newPolyMinusOffset, oldPolyWithoutOffset])
  );
  const boundaryLost = turf.difference(
    turf.featureCollection([oldPoly, newPoly])
  );

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
            remainder = remainder
              ? turf.difference(
                  turf.featureCollection([remainder, polygonGained])
                )
              : null;
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
            remainder = remainder
              ? turf.difference(
                  turf.featureCollection([remainder, polygonGained])
                )
              : null;
            return;
          }

          // Match against old polygons in the existing database
          const matchedPolys: any = (
            await getExistingInspirePolygons(
              undefined,
              shrunkPolygonGained.geometry
            )
          ).filter(
            (poly: any) =>
              poly.poly_id !== oldInspireId &&
              // MySQL sometimes gives weird false positives, so sanity check with Turf
              turf.booleanIntersects(
                shrunkPolygonGained,
                turf.polygon(poly.geom.coordinates)
              )
          );

          for (const matchedPoly of matchedPolys) {
            const matchedPolyFeature = turf.polygon(
              matchedPoly.geom.coordinates
            );
            remainder = remainder
              ? turf.difference(
                  turf.featureCollection([remainder, matchedPolyFeature])
                )
              : null;

            // If this old polygon is now adjacent to the new polygon, the boundaries must have
            // shifted a bit and it wasn't part of the merge
            if (newAdjacentPolyIds.has(matchedPoly.poly_id)) {
              remainder = remainder
                ? turf.difference(
                    turf.featureCollection([remainder, matchedPolyFeature])
                  )
                : null;
              continue;
            }

            // If this old polygon doesn't exist anymore and is completeley contained within the new
            // polygon's boundaries, class this as a merged polygon.
            //
            // If it is not completely contained within the new polygon's boundaries, something more
            // complicated has occured so retun as a failed match.
            //
            // If it still exists and isn't adjacent, something very strange has happened e.g. the
            // old poly has been relocated, so also mark as a fail.
            const matchedPolyStillExists = await pendingPolygonExists(
              matchedPoly.poly_id
            );
            if (!matchedPolyStillExists) {
              oldMergedIds.add(matchedPoly.poly_id);
              if (polygonContains(newPolyMinusOffset, matchedPolyFeature)) {
                logger.debug(
                  {
                    oldInspireId,
                    newInspireId,
                  },
                  `merge match with ${matchedPoly.poly_id}`
                );
                remainder = remainder
                  ? turf.difference(
                      turf.featureCollection([remainder, matchedPolyFeature])
                    )
                  : null;
                continue;
              } else {
                logger.debug(
                  {
                    oldInspireId,
                    newInspireId,
                    matchedId: matchedPoly.poly_id,
                    lngLat: newCoords[0],
                    percentageIntersect,
                  },
                  "Old matched poly is not completely contained within the new poly, marking as a failed match"
                );
              }
            } else {
              logger.info(
                {
                  oldInspireId,
                  newInspireId,
                  matchedId: matchedPoly.poly_id,
                  lngLat: newCoords[0],
                  percentageIntersect,
                },
                "Inspire ID of merged territory has moved somewhere else, marking as a failed match"
              );
              // It's not technically a 'new segment' but add it here so that it will also be marked as a fail too
              newSegmentIds.add(matchedPoly.poly_id);
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
          remainder = remainder
            ? turf.difference(
                turf.featureCollection([remainder, remainderPolygon])
              )
            : null;
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
          remainder = remainder
            ? turf.difference(
                turf.featureCollection([remainder, remainderPolygon])
              )
            : null;
          return;
        }

        const matchedPolys: any[] = (
          await getPendingPolygonsInSearchArea(JSON.stringify(shrunkRemainder))
        )
          // MySQL sometimes gives weird false positives, so sanity check with Turf
          .filter((poly: any) =>
            turf.booleanIntersects(
              shrunkRemainder,
              turf.polygon(poly.geom.coordinates)
            )
          );

        if (matchedPolys.length > 0) {
          const polysThatAlreadyExisted: any[] =
            await getExistingInspirePolygons(
              matchedPolys.map((poly) => poly.poly_id)
            );
          const polyIdsThatAlreadyExisted = polysThatAlreadyExisted.map(
            (poly) => poly.poly_id
          );

          for (const matchedPoly of matchedPolys) {
            const matchedPolyFeature = turf.polygon(
              matchedPoly.geom.coordinates
            );

            if (oldAdjacentPolyIds.has(matchedPoly.poly_id)) {
              // If the match was already an adjacent poly, we can assume boundary has just shifted
              remainder = remainder
                ? turf.difference(
                    turf.featureCollection([remainder, matchedPolyFeature])
                  )
                : null;
              continue;
            }

            newSegmentIds.add(matchedPoly.poly_id);
            if (failedMatch) {
              continue; // Don't bother analysing further since the match is already a fail
            }

            // If this poly is new, class this as a segmented polygon. And if it is not completely
            // contained within boundaryLost, something more complicated has occured so retun as a
            // failed match
            if (!polyIdsThatAlreadyExisted.includes(matchedPoly.poly_id)) {
              // Check whether this segment is fully within the old polygon
              if (polygonContains(oldPoly, matchedPolyFeature)) {
                remainder = remainder
                  ? turf.difference(
                      turf.featureCollection([remainder, matchedPolyFeature])
                    )
                  : null;
                continue;
              } else {
                // Something complicated has happened e.g. property has segmented and some segments
                // have taken land from a neighbouring property. Mark as a fail.
                logger.debug(
                  {
                    oldInspireId,
                    newInspireId,
                    matchedInspireId: matchedPoly.poly_id,
                    lngLat: newCoords[0],
                    percentageIntersect,
                  },
                  "matched polygon is not fully contained within the old poly"
                );
              }
            } else {
              // This matched poly is not new and wasn't adjacent, so something more strange has
              // happened e.g. an old poly has been relocated. Mark as a fail and record matched
              // poly since we don't need to analyse them again
              logger.info(
                {
                  oldInspireId,
                  newInspireId,
                  matchedInspireId: matchedPoly.poly_id,
                  lngLat: newCoords[0],
                  matchedOldLngLat: polysThatAlreadyExisted.find(
                    (poly) => poly.poly_id === matchedPoly.poly_id
                  ).geom.coordinates[0][0],
                  percentageIntersect,
                },
                "new segment poly has moved"
              );
            }
            failedMatch = true;
          }
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

  if (
    (incompleteMerge && incompleteSegmentation) ||
    (incompleteMerge && newSegmentIds.size) ||
    (oldMergedIds.size && incompleteSegmentation) ||
    (oldMergedIds.size && newSegmentIds.size)
  ) {
    logger.debug(
      {
        oldInspireId,
        newInspireId,
        oldMergedIds: Array.from(oldMergedIds),
        newSegmentIds: Array.from(newSegmentIds),
        lngLat: newCoords[0],
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
        oldInspireId,
        newInspireId,
        oldMergedIds: Array.from(oldMergedIds),
        lngLat: newCoords[0],
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
        oldInspireId,
        newInspireId,
        newSegmentIds: Array.from(newSegmentIds),
        lngLat: newCoords[0],
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
        oldInspireId,
        newInspireId,
        oldMergedIds: Array.from(oldMergedIds),
        lngLat: newCoords[0],
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
        oldInspireId,
        newInspireId,
        newSegmentIds: Array.from(newSegmentIds),
        lngLat: newCoords[0],
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

  if (oldMergedIds.size === 0 && newSegmentIds.size === 0) {
    // This is just a boundary shift i.e. the boundary changed shape without merging/segmenting, and
    // land was maybe taken from/given to a neighbouring property.
    logger.debug(
      {
        oldInspireId,
        newInspireId,
        lngLat: newCoords[0],
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

  logger.error(
    {
      oldInspireId,
      newInspireId,
      oldMergedIds,
      newSegmentIds,
      lngLat: newCoords[0],
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

/**
 * @returns true if the given polygon coords overlap with an existing poly.
 */
export const coordsOverlapWithExistingPoly = async (
  coords: number[][]
): Promise<boolean> => {
  const poly = turf.polygon([coords]);
  const matchedPolys: any[] = await getExistingInspirePolygons(
    undefined,
    poly.geometry
  );

  return matchedPolys.length > 0;
};

/**
 * Find an old polygon that no longer exists and contained or was contained by the given coords.
 *
 * @returns the old poly's INSPIRE ID, coords, and matching title address, or null if none
 *          match.
 */
export const findOldContainingOrContainedPoly = async (
  coords: number[][]
): Promise<{
  inspireId: number;
  coords: number[][];
  titleNo: string;
  titleAddress: string;
}> => {
  const poly = turf.polygon([coords]);
  const matchedPolys: any[] = await getExistingInspirePolygons(
    undefined,
    poly.geometry
  );

  for (const matchedPoly of matchedPolys) {
    const matchedPolyFeature = turf.polygon(matchedPoly.geom.coordinates);
    const matchedPolyStillExists = await pendingPolygonExists(
      matchedPoly.poly_id
    );
    if (
      !matchedPolyStillExists &&
      (polygonContains(poly, matchedPolyFeature) ||
        polygonContains(matchedPolyFeature, poly))
    ) {
      return {
        inspireId: matchedPoly.poly_id,
        coords: matchedPoly.geom.coordinates[0],
        titleNo: matchedPoly.title_no,
        titleAddress: matchedPoly.property_address,
      };
    }
  }

  return null;
};
