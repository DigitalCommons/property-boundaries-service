// This is a script that takes all INSPIRE polygons in the land_ownership_polygons table (optinally
// filtered to those created since a given date) and clips their geometries from all unregistered
// land boundaries in the unregistered_land table.
//
// Note: This clipping happens for new/changed pending INSPIRE polygons during the monthly INSPIRE
// pipeline in analyse-all.ts, before the pending polygons are written to the
// land_ownership_polygons table. But sometimes we need to use this script to clip existing
// polygons, e.g. if we copy or restore a backup of the unregistered land table and need to
// ensure its consistency with the current land_ownership_polygons table, so that we don't have any
// overlap between the two tables.
//
// Example usage: node --loader ts-node/esm src/pipeline/inspire/unregistered/clip-land-ownerhsip-polygons-from-unregistered-land.ts "2025-07-28 17:22:41"

import { Feature, MultiPolygon, Polygon } from "geojson";
import * as turf from "@turf/turf";
import moment from "moment-timezone";
import {
  bulkCreateUnregisteredLandPolygons,
  deleteUnregisteredLandPolygon,
  getNextLandOwnershipPolygonCreatedSinceDate,
  getUnregisteredPolysIntersectingWithLandOwnershipPoly,
} from "../../../queries/query.js";

/**
 * @param sinceTimestamp Optional. If provided, only process polygons created since this timestamp.
 *                        Example: "2025-07-28 17:22:41"
 */
const clipLandOwnershipPolygonsFromUnregisteredLand = async (
  sinceTimestamp: string,
) => {
  const sinceDate = moment(sinceTimestamp, "YYYY-MM-DD HH:mm:ss").toDate();

  // Loop through each land ownerhsip polygon that was created since the given date
  let poly: any = await getNextLandOwnershipPolygonCreatedSinceDate(
    0,
    sinceDate,
  );

  while (poly) {
    console.log(`Processing land ownership polygon id: ${poly.id}`);

    // Get all unregistered land polys that intersect with this poly
    const intersectingUnregisteredPolys =
      await getUnregisteredPolysIntersectingWithLandOwnershipPoly(poly.poly_id);

    if (intersectingUnregisteredPolys.length === 0) {
      // No intersecting unregistered polygons, so skip to next poly
      poly = await getNextLandOwnershipPolygonCreatedSinceDate(
        poly.id + 1,
        sinceDate,
      );
      continue;
    }

    const logObj = {
      polyId: poly.id,
      inspireId: poly.poly_id,
      inspireCoords: [
        poly.geom.coordinates[0][0][1],
        poly.geom.coordinates[0][0][0],
      ],
      unregisteredPolyIds: intersectingUnregisteredPolys.map((p) => p.id),
      unregisteredPoly1Coords: [
        intersectingUnregisteredPolys[0].geom.coordinates[0][0][1],
        intersectingUnregisteredPolys[0].geom.coordinates[0][0][0],
      ],
    };

    console.log(
      `Found ${
        intersectingUnregisteredPolys.length
      } intersecting unregistered polygons:\n${JSON.stringify(
        logObj,
        null,
        2,
      )}`,
    );

    // For each intersecting unregistered polygon, clip the land ownerhsip poly from it
    for (const unregisteredPoly of intersectingUnregisteredPolys) {
      // Clip the land ownership poly away from the unregistered polygon
      let clippedUnregisteredPoly: Feature<Polygon | MultiPolygon>;

      try {
        clippedUnregisteredPoly = turf.difference(
          // Truncate coords to 6 d.p. since higher precision can cause issues with turf calculations
          turf.truncate(
            turf.featureCollection([
              turf.polygon(unregisteredPoly.geom.coordinates),
              turf.polygon(poly.geom.coordinates),
            ]),
          ),
        );
      } catch (error) {
        // sometimes this happens due to floating point precision issues with turf when the
        // borders of polygons are long and very close to each other. In this case, truncate
        // the coordinates to 5 d.p. (~0.5 m precision) and try again, since this seems to cause
        // fewer issues
        console.log(
          `Turf difference failed with error "${error.message}", trying again with 5 d.p. precision. poly_id: ${poly.poly_id}, unregisteredPolyId: ${unregisteredPoly.id}`,
        );
        clippedUnregisteredPoly = turf.difference(
          // Truncate coords to 6 d.p. since higher precision can cause issues with turf calculations
          turf.truncate(
            turf.featureCollection([
              turf.polygon(unregisteredPoly.geom.coordinates),
              turf.polygon(poly.geom.coordinates),
            ]),
            { precision: 5 },
          ),
        );
      }

      // Delete the original unregistered polygon
      await deleteUnregisteredLandPolygon(unregisteredPoly.id);

      if (clippedUnregisteredPoly) {
        // Before inserting the new clipped geometry into the unregistered_land table, flatten it
        // into individual polygons, and filter out slivers by only keeping those which are bigger
        // than 20 m2 and don't disappear if we shrink the borders by 2 m
        const flattenedClippedFeatures = turf
          .truncate(turf.flatten(clippedUnregisteredPoly))
          .features.filter(
            (f) =>
              turf.area(f) > 20 &&
              turf.area(
                turf.buffer(f, -2, { units: "meters" }) ?? turf.polygon([]),
              ) > 0,
          );
        await bulkCreateUnregisteredLandPolygons(flattenedClippedFeatures);
        console.log(
          `Clipped unregistered poly into ${flattenedClippedFeatures.length} smaller piece(s). poly_id: ${poly.poly_id}, unregisteredPolyId: ${unregisteredPoly.id}`,
        );
      } else {
        console.log(
          `Removed unregistered poly completely since it is contained within land ownership polygon. poly_id: ${poly.poly_id}, unregisteredPolyId: ${unregisteredPoly.id}`,
        );
      }
    }

    poly = await getNextLandOwnershipPolygonCreatedSinceDate(
      poly.id + 1,
      sinceDate,
    );
  }
};

clipLandOwnershipPolygonsFromUnregisteredLand(process.argv[2])
  .then(() => {
    console.log("Clipped unregistered land successfully.");
  })
  .catch((error) => {
    console.log("Error clipping unregistered land", error);
  });
