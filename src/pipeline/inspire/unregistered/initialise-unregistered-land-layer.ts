// This is a one-time script that is used to create the initial unregistered layer.
//
// - First it creates a table of polygons that cover the whole of England and Wales, using the ONS
//   Countries BGC dataset. The coordinates inserted to the table are transformed to the EPSG:4326
//   projection (the standard GPS projection used by GeoJSON and in our DB ), using the GDAL ogr2ogr
//   tool.
// - After this, it loops through the England and Wales polygons and populates the os_land_polys
//   table with all land boundaries (i.e. not transport, water or buildings), using the OS NGD API,
//   that sit within each England and Wales polygon's bounding box.
// - Finally, the script again loops through each England and Wales polygon, removing all registered
//   freehold boundaries (using INSPIRE data) and intersecting with the os_land_polys, then inserts
//   the remaining boundaries into the unregistered_land table.
//
// Before running this script, you must:
//  - download the countries BGC dataset Shapefile from
//    https://open-geography-portalx-ons.hub.arcgis.com/datasets/ons::countries-december-2024-boundaries-uk-bgc-2
//    and unzip the archive
//  - prepare the pending_inspire_polygons table by running the pipeline https://<PBS_URL>/run-pipeline?secret=<secret>&startAtTask=downloadInspire&stopBeforeTask=analyseInspire
//  - fill in the .env file with OS_NGD_API_URL and OS_NGD_API_KEY
//
// Example usage:
//    node --loader ts-node/esm src/pipeline/inspire/unregistered/initialise-unregistered-land-layer.ts ./path/to/countries_bfc.shp
//
// If you do not provide the path to the countries BFC dataset SHP file, the script will assume that
// there is already an england_and_wales table in the DB and not reload these features from a SHP
// file.
//
// Also, as the second argument, you can provide an ID of the england_and_wales polygon to start
// analysing e.g. if you want to resume the script after all OS NGD land features have been
// pre-populated into the os_land_polys table.
//
// Example usage:
//    node --loader ts-node/esm src/pipeline/inspire/unregistered/initialise-unregistered-land-layer.ts '' 13138

import "dotenv/config";
import * as turf from "@turf/turf";
import fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import Path from "node:path";
import Bottleneck from "bottleneck";
import axios from "axios";
import {
  bulkCreateEnglandAndWalesPolygons,
  bulkCreateUnregisteredLandPolygons,
  bulkCreateOsLandPolys,
  getIntersectingPendingInspirePolys,
  getNextEnglandAndWalesPolygon,
  getOsLandFeaturesByEnglandAndWalesId,
  englandAndWalesTableExists,
} from "../../../queries/query.js";
import { Match } from "../match.js";

/**
 * See the top of this file for more details about what this script does.
 *
 * @param {string} countriesShp - The path to the input SHP file containing the countries boundaries
 * @param {number} [startAtEnglandAndWalesId] - The ID of the england_and_wales polygon to start analysing, default the first.
 * @param {numner} [stopBeforeEnglandAndWalesId] - The ID of the england_and_wales polygon to stop before, default don't stop.
 */
export const initialiseUnregisteredLandLayer = async (
  countriesShp: string,
  startAtEnglandAndWalesId?: number,
  stopBeforeEnglandAndWalesId?: number,
) => {
  if (countriesShp) {
    if (await englandAndWalesTableExists()) {
      throw new Error(
        "england_and_wales already exists. Drop this table manually if you want to load in data from a SHP file.",
      );
    }

    // First transform the countries SHP file to a GeoJSON file containing only England and Wales
    const englandAndWalesGeoJSON = "england_and_wales.geojson";
    const layerName = Path.basename(countriesShp, ".shp");
    const command = `ogr2ogr -f GeoJSON -lco RFC7946=YES -skipfailures \
                    -t_srs "+proj=longlat +datum=WGS84 +nadgrids=@OSTN15_NTv2_OSGBtoETRS.gsb" \
                    -sql "SELECT * FROM ${layerName} WHERE CTRY24NM IN ('England', 'Wales')" \
                    ${englandAndWalesGeoJSON} ${countriesShp}`;
    console.log(`Running '${command}'`);
    const { stdout, stderr } = await promisify(exec)(command);
    console.log(`raw ogr2ogr stdout: ${stdout}`);
    console.log(`raw ogr2ogr stderr: ${stderr}`);

    // Parse the GeoJSON file, shrink feature borders by 50m so we don't deal with innacuracies near
    // the coastline, then flatten the multi-polygons into single polygons
    const englandAndWales = turf.flatten(
      turf.buffer(
        turf.truncate(
          JSON.parse(
            fs.readFileSync(englandAndWalesGeoJSON, "utf8"),
          ) as GeoJSON.FeatureCollection,
        ),
        -50,
        { units: "meters" },
      ),
    );

    // Filter out any features that are not polygons or slivers of less than 2000 m2
    englandAndWales.features = englandAndWales.features.filter(
      (f) => f.geometry.type === "Polygon" && turf.area(f) > 2000,
    );
    const numFeatures = englandAndWales.features.length;
    console.log(
      numFeatures,
      "features in England and Wales boundary dataset after filtering slivers",
    );
    console.log("Total area m2:", turf.area(englandAndWales));

    // Split up large polygons so they are more manageable for later steps in the script
    console.time("splitting");
    englandAndWales.features = englandAndWales.features
      .flatMap((f, index) => {
        console.log(
          `Splitting feature ${index + 1} of ${numFeatures}, area`,
          turf.area(f),
        );
        const splitPolys = maybeSplitPoly(f);
        console.log("Split into", splitPolys.length, "polygons");
        return splitPolys;
      })
      .filter((f) => turf.area(f) > 2000); // Filter out any slivers of less than 2000 m2;
    console.timeEnd("splitting");

    console.log(
      "Total number of England and Wales polygons after splitting:",
      englandAndWales.features.length,
    );

    await bulkCreateEnglandAndWalesPolygons(englandAndWales.features);
    console.log("Inserted England and Wales features into DB");

    // Remove the temporary GeoJSON file
    fs.unlinkSync(englandAndWalesGeoJSON);
  } else {
    console.log(
      "No countries SHP file provided, assuming that the england_and_wales table already exists in the DB.",
    );
  }

  if (
    startAtEnglandAndWalesId === undefined ||
    startAtEnglandAndWalesId === stopBeforeEnglandAndWalesId // i.e. skipping the next section
  ) {
    console.log("Populating OS land polys table using OS NGD API...");
    await populateOsLandPolys();
  }

  console.log(
    "Clipping pending_inspire_polygons, roads, rail, water and building from england and wales to create unregistered layer...",
  );
  console.time("clip_all");

  // Loop through each polygon in england_and_wales
  let polyToClip = await getNextEnglandAndWalesPolygon(
    startAtEnglandAndWalesId || 0,
  );

  while (
    polyToClip &&
    (stopBeforeEnglandAndWalesId === undefined ||
      polyToClip.id < stopBeforeEnglandAndWalesId)
  ) {
    console.log(
      "Processing england_and_wales polygon id",
      polyToClip.id,
      ", coords",
      [
        // Reverse so they can be searched in the front-end
        polyToClip.geom.coordinates[0][0][1],
        polyToClip.geom.coordinates[0][0][0],
      ],
      "area m2",
      turf.area(polyToClip.geom),
    );

    // First, clip away any overlapping pending_inspire_polygons
    let remainingPolys: GeoJSON.Feature<GeoJSON.Polygon>[] = [];

    const intersectingInspirePolys = await getIntersectingPendingInspirePolys(
      polyToClip.id,
    );
    console.log(
      "Found",
      intersectingInspirePolys.length,
      "intersecting pending inspire polygons",
    );

    if (intersectingInspirePolys.length > 0) {
      console.time("clip_inspire");

      const diff = turf.featureCollection([
        turf.polygon(polyToClip.geom.coordinates),
        ...intersectingInspirePolys.map((inspirePoly) =>
          turf.polygon(inspirePoly.geom.coordinates),
        ),
      ]);

      let polyWithoutInspire: GeoJSON.Feature<
        GeoJSON.Polygon | GeoJSON.MultiPolygon
      >;

      try {
        polyWithoutInspire = turf.difference(
          // Truncate coords to 6 d.p. since higher precision can cause issues with turf calculations
          turf.truncate(diff),
        );
      } catch (error) {
        // sometimes this happens due to floating point precision issues with turf when the
        // borders of polygons are long and very close to each other. In this case, truncate
        // the coordinates to 5 d.p. (~0.5 m precision) and try again, since this seems to cause
        // fewer issues
        console.warn(
          `Turf difference failed with error "${error.message}" try again with 5 d.p. precision`,
        );
        polyWithoutInspire = turf.difference(
          turf.truncate(diff, { precision: 5 }),
        );
      }

      remainingPolys = turf.truncate(
        turf.flatten(polyWithoutInspire ?? turf.featureCollection([])),
      ).features;

      console.timeEnd("clip_inspire");
    } else {
      // No intersecting inspire polygons, so just add the whole polygon as is
      remainingPolys.push(turf.polygon(polyToClip.geom.coordinates));
    }

    console.log(
      "Clipped away inspire polygons. # clipped polys to further analyse:",
      remainingPolys.length,
    );

    // Now, rather than clipping OS NGD roads, rail, water and buildings features all separately and
    // performing multiple API queries and difference operations, we will just intersect the
    // remainingPolys with OS NGD 'land' features, which are polygons "representing an area on
    // the Earth's surface that has not otherwise been captured as a Building Part, Rail, Road Track
    // Or Path, Structure, or Water Feature Type."
    console.time("clip_osngd");

    // Get OS NGD land features from the pre-populated table
    const landFeatures = await getOsLandFeaturesByEnglandAndWalesId(
      polyToClip.id,
    );

    // We expect that most of the remainingPolys will just be areas of land covering transport,
    // water and buildings, with only a few polys land included in the OS NGD land features dataset.
    // So it's more efficient to do a pairwise intersection, rather than doing an intersection of
    // their unions. Use an RBush index to speed up the spatial queries when finding intersections.
    // For efficiency, index the larger, denser set (landFeatures) and query the smaller set
    // (remainingPolys).
    const index = turf.geojsonRbush<GeoJSON.Polygon>();
    index.load(landFeatures);
    const unregisteredLandPolys = [];

    for (const remainingPoly of remainingPolys) {
      if (!index.collides(remainingPoly)) continue; // cheap to first check if any bboxes intersect

      const candidates = index.search(remainingPoly); // find those whose bbox intersects

      // filter by actual touches before doing expensive union and intersect operations
      const touchingLandFeatures = candidates.features.filter((landFeature) =>
        turf.booleanIntersects(landFeature, remainingPoly),
      );
      if (touchingLandFeatures.length === 0) continue;

      // For efficiency, take union of touching land before intersection
      const landUnion =
        touchingLandFeatures.length > 1
          ? turf.union(turf.featureCollection(touchingLandFeatures))
          : touchingLandFeatures[0];

      try {
        const clipped = turf.intersect(
          // Truncate coords to 6 d.p. since higher precision can cause issues with turf calculations
          turf.truncate(turf.featureCollection([landUnion, remainingPoly])),
        );
        if (clipped) {
          // Before we add the clipped geometry into the DB, filter out slivers by only keeping
          // those which are bigger than 20 m2 and don't disappear if we shrink the borders by 2 m
          unregisteredLandPolys.push(
            ...turf
              .truncate(turf.flatten(clipped))
              .features.filter(
                (f) =>
                  turf.area(f) > 20 &&
                  turf.area(
                    turf.buffer(f, -2, { units: "meters" }) ?? turf.polygon([]),
                  ) > 0,
              ),
          );
        }
      } catch (error) {
        if (
          error.message.includes("Unable to complete output ring starting at")
        ) {
          // sometimes this happens due to an issue with turf or invalid geometry
          console.warn(
            `Turf intersection failed with output ring error, englandAndWales poly id ${polyToClip.id}. Skip this land feature.`,
          );
        } else throw error;
      }
    }
    console.timeEnd("clip_osngd");

    // Add the clipped polygons to the DB
    await bulkCreateUnregisteredLandPolygons(unregisteredLandPolys);
    console.log("Inserted", unregisteredLandPolys.length, "clipped polygons");

    // Get the next polygon to clip
    polyToClip = await getNextEnglandAndWalesPolygon(polyToClip.id + 1);
  }

  console.timeEnd("clip_all");
};

/**
 * Split a large polygon into smaller ones by clipping it to a grid of tiles of size length 0.01
 * degrees (about 1 km). Geometry operations such as turf.difference are much more efficient when
 * applied to smaller polygons with fewer vertices.
 *
 * @returns An array of smaller polygons.
 */
const maybeSplitPoly = (
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
): GeoJSON.Feature<GeoJSON.Polygon>[] => {
  const tileSizeDegrees = 0.01;
  const splitPolys = [];

  if (turf.area(polygon) <= 1 * 1000 * 1000) {
    // Don't need to tile if less than 1 km2
    splitPolys.push(polygon);
  } else {
    const bounds = turf.bbox(polygon);
    // Extend the bounds by tileSizeDegrees in each direction to ensure we cover the whole polygon
    // with the square grid
    const extendedBounds: GeoJSON.BBox = [
      bounds[0] - tileSizeDegrees,
      bounds[1] - tileSizeDegrees,
      bounds[2] + tileSizeDegrees,
      bounds[3] + tileSizeDegrees,
    ];
    // The grid tiles won't be perfectly square, since turf uses degrees as the unit of length, but
    // this doesn't really matter
    const grid = turf.squareGrid(extendedBounds, tileSizeDegrees, {
      units: "degrees",
    });

    for (const tile of grid.features) {
      const tileBbox = turf.bbox(tile);
      // bboxClip is fast and memory efficient but can have degeneracies, so do it first, then use
      // turf.intersect to remove any degenerate edges
      const clippedRough = turf.bboxClip(polygon, tileBbox);
      const clipped = turf.area(clippedRough)
        ? turf.intersect(
            turf.truncate(
              turf.featureCollection([
                clippedRough as GeoJSON.Feature<
                  GeoJSON.Polygon | GeoJSON.MultiPolygon
                >,
                tile,
              ]),
            ),
          )
        : null;
      if (clipped?.geometry?.type === "Polygon") {
        splitPolys.push(clipped);
      } else if (clipped?.geometry?.type === "MultiPolygon") {
        const clippedFlat = turf.flatten(clipped).features;
        splitPolys.push(...clippedFlat);
      }
    }
  }
  return splitPolys;
};

// Allow at most 50 requests per minute (the OS NGD API rate limit)
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1200,
});
// Retry requests on error up to 3 times. This doesn't include rate limit errors, which we retry
// without a limit.
let retries = 0;
const MAX_RETRIES = 3;

const fetchOsNgdLandFeatures = async (
  bbox: GeoJSON.BBox,
): Promise<GeoJSON.Feature<GeoJSON.Polygon>[]> => {
  const osngdFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];

  // OS NGD API returns max 100 features per request
  let moreDataToFetch = true;
  let offset = 0;

  while (moreDataToFetch) {
    if ((await limiter.currentReservoir()) === 0) {
      console.log(
        "Waiting since we have done 50 OS NGD requests in the last minute",
      );
    }

    try {
      const response = await limiter.schedule(() =>
        axios.get(
          `${
            process.env.OS_NGD_API_URL
          }/collections/lnd-fts-land-3/items?bbox=${bbox.join(
            ",",
          )}&offset=${offset}&key=${process.env.OS_NGD_API_KEY}`,
        ),
      );
      retries = 0;

      const data =
        (await response.data) as GeoJSON.FeatureCollection<GeoJSON.Polygon> & {
          numberReturned: number;
        };
      osngdFeatures.push(...data.features);
      moreDataToFetch = data.numberReturned === 100;
      offset += 100;
    } catch (error) {
      if (error?.response?.status === 429) {
        retries = 0; // Reset retries on rate limit error
        console.warn(
          `OS NGD API rate limit exceeded, waiting for 10 seconds before retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
        continue;
      }

      console.error(
        `We failed to fetch OS NGD land features in ${JSON.stringify(
          bbox,
        )}, error: ${error.message}`,
      );
      if (retries < MAX_RETRIES) {
        retries++;
        console.log(`Retrying...`);
        continue;
      }
      throw error;
    }
  }

  console.log("We fetched", osngdFeatures.length, "OS NGD features");
  return osngdFeatures;
};

/**
 * Populate the os_land_polys table with OS NGD land features for all england_and_wales polygons.
 * This function should be run after the england_and_wales table is populated.
 */
export const populateOsLandPolys = async () => {
  let englandAndWalesPoly = await getNextEnglandAndWalesPolygon(0);
  let totalFeatures = 0;

  while (englandAndWalesPoly) {
    // Check if this england_and_wales polygon has already been processed
    if (
      (await getOsLandFeaturesByEnglandAndWalesId(englandAndWalesPoly.id))
        .length > 0
    ) {
      console.log(
        `Skipping england_and_wales id ${englandAndWalesPoly.id} - already downloaded OS land features`,
      );
      englandAndWalesPoly = await getNextEnglandAndWalesPolygon(
        englandAndWalesPoly.id + 1,
      );
      continue;
    }

    console.log(
      `Downloading OS NGD land features for england_and_wales id ${englandAndWalesPoly.id}`,
    );
    try {
      // Get OS NGD land features for this polygon's bbox
      const landFeatures = await fetchOsNgdLandFeatures(
        turf.bbox(englandAndWalesPoly.geom),
      );

      if (landFeatures.length > 0) {
        // Add england_and_wales_id to each feature
        const featuresWithId = landFeatures.map((feature) => ({
          ...feature,
          england_and_wales_id: englandAndWalesPoly.id,
          os_ngd_id: feature.properties?.id || feature.properties?.os_ngd_id,
        }));

        // Bulk insert into os_land_polys table
        await bulkCreateOsLandPolys(featuresWithId);
        totalFeatures += featuresWithId.length;

        console.log("Inserted", featuresWithId.length, "OS NGD land features");
      } else {
        console.log(`No OS NGD land features found`);
      }
    } catch (error) {
      console.error(
        `Error processing england_and_wales id ${englandAndWalesPoly.id}:`,
        error,
      );
      // Continue with next polygon instead of failing completely
    }

    // Get next polygon
    englandAndWalesPoly = await getNextEnglandAndWalesPolygon(
      englandAndWalesPoly.id + 1,
    );
  }

  console.log(
    "Finished populating os_land_polys table. Total features inserted:",
    totalFeatures,
  );
};

// Script that runs when invoking this script from command line:
initialiseUnregisteredLandLayer(
  process.argv[2],
  parseInt(process.argv[3]),
  parseInt(process.argv[4]),
)
  .then(() => {
    console.log("Initial unregistered land layer created successfully.");
  })
  .catch((error) => {
    console.error("Error creating initial unregistered land layer:", error);
  });

// Fix OOM during clipping of INSPIRE:
// Processing england_and_wales polygon id 44010 , coords [ 53.590382, -2.462559 ] area m2 733803.844861821
