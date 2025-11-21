import {
  Sequelize,
  DataTypes,
  QueryTypes,
  Op,
  WhereOptions,
  Options,
} from "sequelize";
import { Feature, MultiPolygon, Polygon } from "geojson";
import * as turf from "@turf/turf";
import { customAlphabet } from "nanoid";
import {
  getRunningPipelineKey,
  setRunningPipelineKey,
} from "../pipeline/util.js";
import { Match } from "../pipeline/inspire/match.js";
import dbConfig from "../../config/config.js";
import pino from "pino";

/** Used to generate pipeline unique keys */
const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 10);

const MAX_RETRIES_FOR_A_POLYGON = 1;

// TODO: move this instance creation and model definitions into a separate 'models' file. Just have
// callable queries in this file

const { database, username, password, ...config } = (dbConfig[
  process.env.NODE_ENV
] ?? dbConfig.production) as Options;

export const sequelize = new Sequelize(database, username, password, config);

export const PolygonModel = sequelize.define(
  "Polygon",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    poly_id: {
      unique: true,
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    title_no: {
      defaultValue: null,
      type: DataTypes.STRING,
    },
    geom: {
      allowNull: false,
      type: DataTypes.GEOMETRY("POLYGON", 4326),
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    tableName: "land_ownership_polygons",
  },
);

export const PendingPolygonModel = sequelize.define(
  "PendingPolygon",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    poly_id: {
      unique: true,
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    geom: {
      allowNull: false,
      type: DataTypes.GEOMETRY("POLYGON", 4326),
    },
    council: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    accepted: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    match_type: DataTypes.STRING,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    tableName: "pending_inspire_polygons",
  },
);

export const PendingDeletionModel = sequelize.define(
  "PendingDeletion",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    poly_id: {
      unique: true,
      allowNull: false,
      type: DataTypes.INTEGER,
    },
  },
  {
    tableName: "pending_polygon_deletions",
    createdAt: false,
    updatedAt: false,
  },
);

export const LandOwnershipModel = sequelize.define(
  "LandOwnership",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    title_no: {
      unique: true,
      allowNull: false,
      type: DataTypes.STRING,
    },
    tenure: DataTypes.STRING,
    property_address: DataTypes.TEXT,
    district: DataTypes.STRING,
    county: DataTypes.STRING,
    region: DataTypes.STRING,
    postcode: DataTypes.STRING,
    multiple_address_indicator: DataTypes.STRING,
    price_paid: DataTypes.STRING,
    proprietor_name_1: DataTypes.TEXT,
    company_registration_no_1: DataTypes.STRING,
    proprietor_category_1: DataTypes.STRING,
    proprietor_1_address_1: DataTypes.TEXT,
    proprietor_1_address_2: DataTypes.TEXT,
    proprietor_1_address_3: DataTypes.TEXT,
    proprietor_name_2: DataTypes.TEXT,
    company_registration_no_2: DataTypes.STRING,
    proprietor_category_2: DataTypes.STRING,
    proprietor_2_address_1: DataTypes.TEXT,
    proprietor_2_address_2: DataTypes.TEXT,
    proprietor_2_address_3: DataTypes.TEXT,
    proprietor_name_3: DataTypes.TEXT,
    company_registration_no_3: DataTypes.STRING,
    proprietor_category_3: DataTypes.STRING,
    proprietor_3_address_1: DataTypes.TEXT,
    proprietor_3_address_2: DataTypes.TEXT,
    proprietor_3_address_3: DataTypes.TEXT,
    proprietor_name_4: DataTypes.TEXT,
    company_registration_no_4: DataTypes.STRING,
    proprietor_category_4: DataTypes.STRING,
    proprietor_4_address_1: DataTypes.TEXT,
    proprietor_4_address_2: DataTypes.TEXT,
    proprietor_4_address_3: DataTypes.TEXT,
    date_proprietor_added: DataTypes.STRING,
    additional_proprietor_indicator: DataTypes.STRING,
    proprietor_uk_based: DataTypes.BOOLEAN,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    tableName: "land_ownerships",
  },
);

export const PipelineRunModel = sequelize.define(
  "PipelineRun",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    unique_key: {
      allowNull: false,
      unique: true,
      type: DataTypes.STRING,
    },
    startedAt: DataTypes.DATE,
    latest_ownership_data: DataTypes.DATEONLY,
    latest_inspire_data: DataTypes.DATEONLY,
    last_task: DataTypes.STRING,
    last_council_downloaded: DataTypes.STRING,
    last_poly_analysed: DataTypes.INTEGER,
    status: DataTypes.TINYINT,
    options: DataTypes.JSON,
  },
  {
    tableName: "pipeline_runs",
    createdAt: "startedAt",
    updatedAt: false,
  },
);

export const UnregisteredLandModel = sequelize.define(
  "UnregisteredLand",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    geom: {
      allowNull: false,
      type: DataTypes.GEOMETRY("POLYGON", 4326),
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    tableName: "unregistered_land",
  },
);

export const OsLandPolysModel = sequelize.define(
  "OsLandPolys",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    geom: {
      allowNull: false,
      type: DataTypes.GEOMETRY("POLYGON", 4326),
    },
    england_and_wales_id: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    os_ngd_id: {
      allowNull: true,
      type: DataTypes.STRING,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    tableName: "os_land_polys",
  },
);

export enum PipelineStatus {
  Running = 1,
  Stopped = 0,
  Interrupted = -1,
}

PolygonModel.hasMany(LandOwnershipModel, {
  foreignKey: "title_no",
  sourceKey: "title_no",
});
LandOwnershipModel.belongsTo(PolygonModel, {
  foreignKey: "title_no",
  targetKey: "title_no",
});

export const deleteAllPendingPolygons = async () => {
  await PendingPolygonModel.truncate({ restartIdentity: true });
};

/**
 * Mark all pending polygons as not accepted, and remove all polygons pending deletion.
 */
export const resetAllPendingPolygons = async () => {
  await sequelize.query(
    `UPDATE pending_inspire_polygons SET accepted = false, match_type = NULL`,
    {
      type: QueryTypes.UPDATE,
      benchmark: true,
    },
  );
  await PendingDeletionModel.truncate({ restartIdentity: true });
};

export const bulkCreatePendingPolygons = async (
  polygonGeojsonFeatures: Feature<Polygon>[],
  council: string,
  logging = false,
) => {
  const numFeatures = polygonGeojsonFeatures.length;
  if (numFeatures === 0) {
    // No polygons to create
    return;
  }
  const parsedPolygonValues = polygonGeojsonFeatures.map((feature) => [
    feature.properties.INSPIREID, // poly_id
    JSON.stringify(feature.geometry), // geom
    council,
    false, // accepted
  ]);

  const query = `INSERT INTO pending_inspire_polygons (poly_id, geom, council, accepted)
    VALUES
    ${"(?, ST_GeomFromGeoJSON(?), ?, ?),".repeat(numFeatures - 1)}
    (?, ST_GeomFromGeoJSON(?), ?, ?)
    ON DUPLICATE KEY UPDATE
      geom = VALUES(geom), council = VALUES(council), accepted = VALUES(accepted);`;

  return await sequelize.query(query, {
    replacements: parsedPolygonValues.flat(),
    type: QueryTypes.INSERT,
    logging: logging ? console.log : false,
    benchmark: true,
  });
};

export const bulkCreateUnregisteredLandPolygons = async (
  polygons: Feature<Polygon>[],
  logging = false,
) => {
  const numFeatures = polygons.length;
  if (numFeatures === 0) {
    // No polygons to create
    return;
  }

  const query = `INSERT INTO unregistered_land (geom)
    VALUES
    ${"(ST_GeomFromGeoJSON(?)),".repeat(numFeatures - 1)}
    (ST_GeomFromGeoJSON(?))`;

  return await sequelize.query(query, {
    replacements: polygons.map((f) => JSON.stringify(f.geometry)),
    type: QueryTypes.INSERT,
    logging: logging ? console.log : false,
    benchmark: true,
  });
};

/**
 * This is just used once in the initialise-unregistered-land-layer.ts script.
 */
export const bulkCreateEnglandAndWalesPolygons = async (
  polygons: Feature<Polygon>[],
  logging = false,
) => {
  await sequelize.query(
    `CREATE TABLE england_and_wales LIKE unregistered_land;`,
    {
      type: QueryTypes.RAW,
    },
  );

  const numFeatures = polygons.length;
  if (numFeatures === 0) {
    throw new Error(
      `Expected > 0 England and Wales polygons but received ${numFeatures} polygons`,
    );
  }

  const query = `INSERT INTO england_and_wales (geom)
    VALUES
    ${"(ST_GeomFromGeoJSON(?)),".repeat(numFeatures - 1)}
    (ST_GeomFromGeoJSON(?))`;

  return await sequelize.query(query, {
    replacements: polygons.map((f) => JSON.stringify(f.geometry)),
    type: QueryTypes.INSERT,
    logging: logging ? console.log : false,
    benchmark: true,
  });
};

/**
 * Bulk create OS NGD land polygons with england_and_wales_id reference.
 */
export const bulkCreateOsLandPolys = async (
  polygons: Array<
    Feature<Polygon> & { england_and_wales_id: number; os_ngd_id?: string }
  >,
  logging = false,
) => {
  const numFeatures = polygons.length;
  if (numFeatures === 0) {
    return;
  }

  const parsedValues = polygons.map((polygon) => [
    JSON.stringify(polygon.geometry), // geom
    polygon.england_and_wales_id, // england_and_wales_id
    polygon.os_ngd_id || null, // os_ngd_id
  ]);

  const query = `INSERT INTO os_land_polys (geom, england_and_wales_id, os_ngd_id)
    VALUES
    ${"(ST_GeomFromGeoJSON(?), ?, ?),".repeat(numFeatures - 1)}
    (ST_GeomFromGeoJSON(?), ?, ?)`;

  return await sequelize.query(query, {
    replacements: parsedValues.flat(),
    type: QueryTypes.INSERT,
    logging: logging ? console.log : false,
    benchmark: true,
  });
};

export const englandAndWalesTableExists = async () => {
  return (
    (
      await sequelize.query(
        `SELECT * FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'england_and_wales';`,
        {
          type: QueryTypes.SELECT,
        },
      )
    ).length > 0
  );
};

export const deleteUnregisteredLandPolygon = async (id: number) =>
  await UnregisteredLandModel.destroy({
    where: { id },
  });

export const getIntersectingPendingInspirePolys = async (
  englandAndWalesId: number,
): Promise<PendingPolygon[]> =>
  await sequelize.query<PendingPolygon>(
    `SELECT i.* FROM
      england_and_wales e
      JOIN pending_inspire_polygons i ON ST_Intersects(e.geom, i.geom)
      WHERE e.id = ?;`,
    {
      replacements: [englandAndWalesId],
      type: QueryTypes.SELECT,
    },
  );

/**
 * Get OS NGD land features by england_and_wales_id bbox that they sit within.
 */
export const getOsLandFeaturesByEnglandAndWalesId = async (
  englandAndWalesId: number,
): Promise<Feature<Polygon>[]> => {
  const results = await sequelize.query<{
    geom: GeoJSON.Polygon;
  }>(`SELECT geom FROM os_land_polys WHERE england_and_wales_id = ?`, {
    replacements: [englandAndWalesId],
    type: QueryTypes.SELECT,
  });

  return results.map((result) => ({
    type: "Feature" as const,
    geometry: result.geom,
    properties: {},
  }));
};

/**
 * Get unregistered land polygons that intersect with a given pending inspire polygon
 */
const getIntersectingUnregisteredPolys = async (pendingPolyId: number) =>
  await sequelize.query<{ id: number; geom: GeoJSON.Polygon }>(
    `SELECT u.* FROM
      pending_inspire_polygons p
      JOIN unregistered_land u ON ST_Intersects(p.geom, u.geom)
      WHERE p.id = ?;`,
    {
      replacements: [pendingPolyId],
      type: QueryTypes.SELECT,
    },
  );

/**
 * Take all pending_inspire_polygons that don't have match_type = exact (i.e. new or changed ones).
 * Clip their geometries from all the unregistered_land polygons that intersect with them, updating
 * their geometries in the unregistered_land table.
 *
 * @param newOrChangedOnly Defaults to true. If set to false, clip all pending polygons including
 *    those with match_type = exact, not just those that are new or changed.
 */
export const clipPendingPolygonsFromUnregisteredLand = async (
  logger: pino.Logger,
  newOrChangedOnly = true,
) => {
  // Loop through each pending inspire polygon
  let pendingPoly = await getNextPendingPolygon(0);

  while (pendingPoly) {
    if (newOrChangedOnly && pendingPoly.match_type === Match.Exact) {
      // Skip exact matches
      pendingPoly = await getNextPendingPolygon(pendingPoly.id + 1);
      continue;
    }

    // Get all unregistered land polys that intersect with this pending poly
    const intersectingUnregisteredPolys =
      await getIntersectingUnregisteredPolys(pendingPoly.id);

    if (intersectingUnregisteredPolys.length === 0) {
      // No intersecting unregistered polygons, so skip to next pending poly
      pendingPoly = await getNextPendingPolygon(pendingPoly.id + 1);
      continue;
    }

    logger.info(
      {
        pendingPolyId: pendingPoly.id,
        pendingPolyIdCoords: pendingPoly.geom.coordinates[0][0],
      },
      `Found ${intersectingUnregisteredPolys.length} intersecting unregistered polygons`,
    );

    // For each intersecting unregistered polygon, clip the pending poly from it
    for (const unregisteredPoly of intersectingUnregisteredPolys) {
      // Clip the pending poly away from the unregistered polygon
      let clippedUnregisteredPoly: Feature<Polygon | MultiPolygon>;

      try {
        clippedUnregisteredPoly = turf.difference(
          // Truncate coords to 6 d.p. since higher precision can cause issues with turf calculations
          turf.truncate(
            turf.featureCollection([
              turf.polygon(unregisteredPoly.geom.coordinates),
              turf.polygon(pendingPoly.geom.coordinates),
            ]),
          ),
        );
      } catch (error) {
        // sometimes this happens due to floating point precision issues with turf when the
        // borders of polygons are long and very close to each other. In this case, truncate
        // the coordinates to 5 d.p. (~0.5 m precision) and try again, since this seems to cause
        // fewer issues
        logger.warn(
          {
            pendingPolyId: pendingPoly.id,
            unregisteredPolyId: unregisteredPoly.id,
          },
          `Turf difference failed with error "${error.message}", trying again with 5 d.p. precision.`,
        );
        clippedUnregisteredPoly = turf.difference(
          // Truncate coords to 6 d.p. since higher precision can cause issues with turf calculations
          turf.truncate(
            turf.featureCollection([
              turf.polygon(unregisteredPoly.geom.coordinates),
              turf.polygon(pendingPoly.geom.coordinates),
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
      }
    }

    // Get the next pending polygon
    pendingPoly = await getNextPendingPolygon(pendingPoly.id + 1);
  }
};

/** A subset of the fields in the model, which are used for analysis */
export type PendingPolygon = {
  id: number;
  poly_id: number;
  geom: Polygon;
  council: string;
  match_type: Match | null;
};

/**
 * Return the next pending polygon with id at least equal to minId, or null if none exist.
 *
 * Note: Before returning the polygon, delete other polygons from the table that have the same
 * poly_id, to avoid reprocessing the same data later. Duplicates show up in the data when the same
 * polygon lies on a boundary between multiple councils. We don't just make poly_id a unique key,
 * since this causes issues in the earlier download step when inserting data from each council.
 */
export const getNextPendingPolygon = async (
  minId: number,
): Promise<PendingPolygon> => {
  const polygon: any = await PendingPolygonModel.findOne({
    where: { id: { [Op.gte]: minId } },
    raw: true,
  });

  if (polygon) {
    // Delete other polygons with the same poly_id that have id greater than the current polygon
    await PendingPolygonModel.destroy({
      where: { poly_id: polygon.poly_id, id: { [Op.gt]: polygon.id } },
    });
  }

  return polygon;
};

/**
 * Return the next unregistered_land polygon with id at least equal to minId, or null if none exist.
 */
export const getNextUnregisteredLandPolygon = async (
  minId: number,
): Promise<{ id: number; geom: GeoJSON.Polygon }> => {
  const polygon: any = await UnregisteredLandModel.findOne({
    where: { id: { [Op.gte]: minId } },
    raw: true,
  });

  return polygon
    ? {
        id: polygon.id,
        geom: polygon.geom,
      }
    : null;
};

/**
 * Return the next england_and_wales polygon with id at least equal to minId, or null if none exist.
 * This is only used in the initialise-unregistered-land-layer.ts script.
 */
export const getNextEnglandAndWalesPolygon = async (
  minId: number,
): Promise<{ id: number; geom: GeoJSON.Polygon }> => {
  const polygons: any = await sequelize.query(
    `SELECT id, geom FROM england_and_wales WHERE id >= ? LIMIT 1;`,
    {
      replacements: [minId],
      type: QueryTypes.SELECT,
      raw: true,
    },
  );

  return polygons.length > 0
    ? {
        id: polygons[0].id,
        geom: polygons[0].geom,
      }
    : null;
};

export const createOrUpdateLandOwnership = async (
  ownership,
  overseas: boolean,
  logging = false,
) => {
  await bulkCreateOrUpdateLandOwnerships([ownership], overseas, logging);
};

/**
 * Create each land ownership record if the title number doesn't already exist. If the title number
 * already exists, update the existing record with the new values.
 *
 * @param ownerships array of ownership objects with the same keys as provided by the gov,
 * documented here: https://use-land-property-data.service.gov.uk/datasets/ccod/tech-spec (note that
 * some bad records don't match this spec though)
 */
export const bulkCreateOrUpdateLandOwnerships = async (
  ownerships: any[],
  overseas: boolean,
  logging = false,
) => {
  const parsedOwnerships = ownerships.map((ownership) => ({
    title_no: ownership["Title Number"],
    tenure: ownership.Tenure,
    property_address: ownership["Property Address"] || null,
    district: ownership.District || null,
    county: ownership.County || null,
    region: ownership.Region || null,
    postcode: ownership.Postcode || null,
    multiple_address_indicator: ownership["Multiple Address Indicator"] || null,
    price_paid: ownership["Price Paid"] || null,
    proprietor_name_1: ownership["Proprietor Name (1)"] || null,
    company_registration_no_1:
      ownership["Company Registration No. (1)"] || null,
    proprietor_category_1: ownership["Proprietorship Category (1)"] || null,
    proprietor_1_address_1: ownership["Proprietor (1) Address (1)"] || null,
    proprietor_1_address_2: ownership["Proprietor (1) Address (2)"] || null,
    proprietor_1_address_3: ownership["Proprietor (1) Address (3)"] || null,
    proprietor_name_2: ownership["Proprietor Name (2)"] || null,
    company_registration_no_2:
      ownership["Company Registration No. (2)"] || null,
    proprietor_category_2: ownership["Proprietorship Category (2)"] || null,
    proprietor_2_address_1: ownership["Proprietor (2) Address (1)"] || null,
    proprietor_2_address_2: ownership["Proprietor (2) Address (2)"] || null,
    proprietor_2_address_3: ownership["Proprietor (2) Address (3)"] || null,
    proprietor_name_3: ownership["Proprietor Name (3)"] || null,
    company_registration_no_3:
      ownership["Company Registration No. (3)"] || null,
    proprietor_category_3: ownership["Proprietorship Category (3)"] || null,
    proprietor_3_address_1: ownership["Proprietor (3) Address (1)"] || null,
    proprietor_3_address_2: ownership["Proprietor (3) Address (2)"] || null,
    proprietor_3_address_3: ownership["Proprietor (3) Address (3)"] || null,
    proprietor_name_4: ownership["Proprietor Name (4)"] || null,
    company_registration_no_4:
      ownership["Company Registration No. (4)"] || null,
    proprietor_category_4: ownership["Proprietorship Category (4)"] || null,
    proprietor_4_address_1: ownership["Proprietor (4) Address (1)"] || null,
    proprietor_4_address_2: ownership["Proprietor (4) Address (2)"] || null,
    proprietor_4_address_3: ownership["Proprietor (4) Address (3)"] || null,
    date_proprietor_added:
      // convert DD-MM-YYYY to YYYY-MM-DD
      ownership["Date Proprietor Added"]?.split("-").reverse().join("-") ||
      null,
    additional_proprietor_indicator:
      ownership["Additional Proprietor Indicator"] || null,
    proprietor_uk_based: !overseas,
  }));

  await LandOwnershipModel.bulkCreate(parsedOwnerships, {
    logging: logging ? console.log : false,
    benchmark: true,
    updateOnDuplicate: [
      "tenure",
      "property_address",
      "district",
      "county",
      "region",
      "postcode",
      "multiple_address_indicator",
      "price_paid",
      "proprietor_name_1",
      "company_registration_no_1",
      "proprietor_category_1",
      "proprietor_1_address_1",
      "proprietor_1_address_2",
      "proprietor_1_address_3",
      "proprietor_name_2",
      "company_registration_no_2",
      "proprietor_category_2",
      "proprietor_2_address_1",
      "proprietor_2_address_2",
      "proprietor_2_address_3",
      "proprietor_name_3",
      "company_registration_no_3",
      "proprietor_category_3",
      "proprietor_3_address_1",
      "proprietor_3_address_2",
      "proprietor_3_address_3",
      "proprietor_name_4",
      "company_registration_no_4",
      "proprietor_category_4",
      "proprietor_4_address_1",
      "proprietor_4_address_2",
      "proprietor_4_address_3",
      "date_proprietor_added",
      "additional_proprietor_indicator",
      "proprietor_uk_based",
    ],
  });
};

export const bulkDeleteLandOwnerships = async (
  titleNumbers: string[],
  logging = false,
) => {
  await LandOwnershipModel.destroy({
    logging: logging ? console.log : false,
    where: {
      title_no: titleNumbers,
    },
  });
};

export const deleteAllLandOwnerships = async () => {
  await LandOwnershipModel.truncate();
};

export async function getLandOwnership(title_no: string) {
  const landOwnership = await LandOwnershipModel.findOne({
    where: {
      title_no: title_no,
    },
    raw: true,
  });

  return landOwnership;
}

/**
 * Get polygons that:
 * - match with the ID(s) (if given)
 * AND
 * - intersect with the search area (if given)
 *
 * Limit result to 5000 polygons to avoid OOMEs.
 *
 * @param poly_ids an array of INSPIRE IDs
 * @param searchArea a stringified GeoJSON Polygon geometry
 * @param includeLeasholds whether to include polygons for leasholds (default true)
 * @returns an array of polygons that match the criteria
 */

export const getPolygonsByIdInSearchArea = async (
  poly_ids?: number[],
  searchArea?: string,
  includeLeasholds = true,
) => {
  const noLeaseholdsCondition =
    includeLeasholds === false
      ? `AND ( tenure = 'Freehold' OR tenure IS NULL )`
      : "";

  if (!poly_ids || poly_ids.length === 0) {
    // Just search by area
    if (!searchArea) {
      console.error("This shouldn't happen, some criteria must be given");
      return [];
    }

    const query = `SELECT land_ownerships.*, land_ownership_polygons.*
    FROM land_ownership_polygons
    LEFT JOIN land_ownerships
    ON land_ownership_polygons.title_no = land_ownerships.title_no
    WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?)) 
    ${noLeaseholdsCondition}
    LIMIT 5000;`;

    return await sequelize.query(query, {
      replacements: [searchArea],
      type: QueryTypes.SELECT,
    });
  }

  const searchAreaCondition = searchArea
    ? `AND ST_Intersects(land_ownership_polygons.geom, ST_GeomFromGeoJSON(?)) `
    : "";
  const uniquePolyIds = new Set<number>(poly_ids);

  const query = `SELECT land_ownerships.*, land_ownership_polygons.*
    FROM land_ownership_polygons
    LEFT JOIN land_ownerships
    ON land_ownership_polygons.title_no = land_ownerships.title_no
    WHERE poly_id IN (${Array(uniquePolyIds.size).fill("?").join(",")})
    ${searchAreaCondition}
    ${noLeaseholdsCondition}
    LIMIT ${uniquePolyIds.size};`;

  const replacements: (string | number)[] = Array.from(uniquePolyIds);
  if (searchArea) {
    replacements.push(searchArea);
  }

  return await sequelize.query(query, {
    replacements,
    type: QueryTypes.SELECT,
  });
};

/**
 * Get polygons owned (or partly owned) by local authorities that intersect with the search area.
 * Limit result to 5000 polygons to avoid OOMEs.
 *
 * @param searchArea a stringified GeoJSON Polygon geometry
 */
export const getLocalAuthorityPolygonsInSearchArea = async (
  searchArea: string,
) => {
  const query = `SELECT land_ownerships.*, land_ownership_polygons.*
  FROM land_ownership_polygons
  LEFT JOIN land_ownerships
  ON land_ownership_polygons.title_no = land_ownerships.title_no
  WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?))
  AND (
    proprietor_category_1 = 'Local Authority' OR
    proprietor_category_2 = 'Local Authority' OR
    proprietor_category_3 = 'Local Authority' OR
    proprietor_category_4 = 'Local Authority'
  )
  LIMIT 5000;`;

  return await sequelize.query(query, {
    replacements: [searchArea],
    type: QueryTypes.SELECT,
  });
};

/**
 * Get polygons owned (or partly owned) by the Church of England that intersect with the search area.
 * Limit result to 5000 polygons to avoid OOMEs.
 *
 * @param searchArea a stringified GeoJSON Polygon geometry
 */
export const getChurchOfEnglandPolygonsInSearchArea = async (
  searchArea: string,
) => {
  // This may grow to a list of matches that we identify later
  const churchOfEnglandProprietorMatches = ["church commissioners", "diocese"];

  const churchOfEnglandCondition = churchOfEnglandProprietorMatches
    .map(
      (match) => `proprietor_name_1 LIKE '%${match}%'
                  OR proprietor_name_2 LIKE '%${match}%'
                  OR proprietor_name_3 LIKE '%${match}%'
                  OR proprietor_name_4 LIKE '%${match}%'`,
    )
    .join(" OR ");

  const query = `SELECT land_ownerships.*, land_ownership_polygons.*
  FROM land_ownership_polygons
  LEFT JOIN land_ownerships
  ON land_ownership_polygons.title_no = land_ownerships.title_no
  WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?))
  AND (${churchOfEnglandCondition})
  LIMIT 5000;`;

  return await sequelize.query(query, {
    replacements: [searchArea],
    type: QueryTypes.SELECT,
  });
};

/**
 * Get pending polygons that intersect with the search area.
 *
 * To each returned item, we add a 'tenure' property, which is set to 'Accepted' if the pending
 * polygon is marked as accepted, and left blank otherwise. This is since the front-end colours
 * polygons based on them having a tenure field. It's a bit of a hack to make the results visually
 * clearer, without having to add extra logic to the front-end.
 *
 * Limit result to 5000 polygons to avoid OOMEs.
 *
 * @param searchArea a stringified GeoJSON Polygon geometry
 * @param acceptedOnly whether to only return accepted pending polygons (default to all)
 * @returns an array of pending polygons that match the criteria
 */
export const getPendingPolygonsInSearchArea = async (
  searchArea: string,
  acceptedOnly = false,
) => {
  const acceptedCondition = acceptedOnly ? "AND accepted = true" : "";
  const query = `SELECT *, IF(accepted, 'Accepted', '') as tenure
    FROM pending_inspire_polygons
    WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?))
    ${acceptedCondition}
    LIMIT 5000;`;

  return await sequelize.query(query, {
    replacements: [searchArea],
    type: QueryTypes.SELECT,
  });
};

/**
 * Get unregistered land boundaries that intersect with the search area.
 *
 * Limit result to 5000 polygons to avoid OOMEs.
 *
 * @param searchArea a stringified GeoJSON Polygon geometry
 * @returns an array of polygons that match the criteria
 */

export const getUnregisteredPolygonsInSearchArea = async (
  searchArea: string,
) => {
  const query = `SELECT id as poly_id, geom
    FROM unregistered_land
    WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?)) 
    LIMIT 5000;`;

  return await sequelize.query(query, {
    replacements: [searchArea],
    type: QueryTypes.SELECT,
  });
};

/**
 * Return pending polygon with poly_id if it exists, or null.
 */
export const getPendingPolygon = async (
  poly_id: number,
): Promise<PendingPolygon> => {
  const polygon: any = await PendingPolygonModel.findOne({
    where: { poly_id },
    raw: true,
  });

  return polygon;
};

/**
 * Check whether a pending polygon with the given poly_id exists.
 */
export const pendingPolygonExists = async (
  poly_id: number,
): Promise<boolean> => {
  const polygon = await getPendingPolygon(poly_id);
  return polygon !== null;
};

/**
 * Mark pending polygon as accepted, with a specific match type.
 */
export const acceptPendingPolygon = async (poly_id: number, match: Match) => {
  await PendingPolygonModel.update(
    { accepted: true, match_type: match },
    {
      where: {
        poly_id,
      },
    },
  );
};

/**
 * Ensure pending polygon is marked as "fail" and not accepted.
 */
export const rejectPendingPolygon = async (poly_id: number) => {
  await PendingPolygonModel.update(
    { accepted: false, match_type: Match.Fail },
    {
      where: {
        poly_id,
      },
    },
  );
};

/**
 * Mark existing polygon for deletion.
 */
export const markPolygonDeletion = async (poly_id: number) => {
  await PendingDeletionModel.findOrCreate({
    where: {
      poly_id,
    },
  });
};

/**
 * Insert all accepted pending polygons into the main land_ownership_polygons table
 */
export const insertAllAcceptedPendingPolygons = async () => {
  // Insert in chunks so we don't hit MySQL buffer limit
  const lastPendingPolygon: any = await PendingPolygonModel.findOne({
    order: [["id", "DESC"]],
    raw: true,
  });

  const chunkSize = 100000;
  for (let i = 0; i <= (lastPendingPolygon?.id ?? 0); i += chunkSize) {
    const query = `INSERT INTO land_ownership_polygons (poly_id, geom, updatedAt)
    SELECT p.poly_id, p.geom, p.createdAt
    FROM pending_inspire_polygons p WHERE accepted = true
      AND id >= ${i} AND id < ${i + chunkSize}
    ON DUPLICATE KEY UPDATE geom = p.geom, updatedAt = p.createdAt;`;

    await sequelize.query(query, {
      type: QueryTypes.INSERT,
    });
  }
};

/**
 * Delete all polygons pending deletion from land_ownerhsip_polygons table, then clear
 * pending_polygon_deletions.
 */
export const deleteAllPolygonsPendingDeletion = async () => {
  const query = `DELETE land_ownership_polygons
  FROM land_ownership_polygons INNER JOIN pending_polygon_deletions
  ON land_ownership_polygons.poly_id = pending_polygon_deletions.poly_id`;

  await sequelize.query(query, {
    type: QueryTypes.DELETE,
  });

  return await PendingDeletionModel.truncate({ restartIdentity: true });
};

/**
 * Find property polygons that intersect within the given search area.
 *
 * @param searchArea a Polygon in WKT format
 * @returns an array of polygons, with ownership info for each polygon if it exists
 */
export const getPolygonsByArea = async (searchArea: string) => {
  const query = `SELECT land_ownerships.*, land_ownership_polygons.*
    FROM land_ownership_polygons
    LEFT JOIN land_ownerships
    ON land_ownership_polygons.title_no = land_ownerships.title_no
    WHERE ST_Intersects(land_ownership_polygons.geom, ST_GeomFromText(?,4326));`;

  const polygonsAndOwnerships = await sequelize.query(query, {
    replacements: [searchArea],
    type: QueryTypes.SELECT,
  });

  return polygonsAndOwnerships;
};

export const getPolygonsByProprietorName = async (name: string) => {
  const polygonsAndOwnerships = await LandOwnershipModel.findAll({
    where: {
      proprietor_name_1: name,
    },
    include: PolygonModel,
    raw: true,
  });

  return polygonsAndOwnerships.map((polyAndOwn) => {
    const poly = {
      ...polyAndOwn,
      poly_id: polyAndOwn["Polygon.poly_id"],
      geom: polyAndOwn["Polygon.geom"],
    };

    delete poly["Polygon.poly_id"];
    delete poly["Polygon.geom"];

    return poly;
  });
};

/** Create an entry in the pipeline_runs table, store and return its unique key */
export const startPipelineRun = async (options: any): Promise<string> => {
  const unique_key = nanoid();
  await PipelineRunModel.create({
    unique_key,
    status: PipelineStatus.Running,
    options,
  });
  setRunningPipelineKey(unique_key);
  return unique_key;
};

/** Mark the current pipeline run as stopped */
export const stopPipelineRun = async () => {
  await PipelineRunModel.update(
    { status: PipelineStatus.Stopped },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    },
  );
};

/** Mark the specified pipeline run as interrupted */
export const markPipelineRunInterrupted = async (key: string) => {
  await PipelineRunModel.update(
    { status: PipelineStatus.Interrupted },
    {
      where: {
        unique_key: key,
      },
    },
  );
};

/** Check if the current pipeline is running */
export const isPipelineRunning = async (): Promise<boolean> => {
  const currentPipelineRun: any = await PipelineRunModel.findOne({
    where: {
      unique_key: getRunningPipelineKey(),
    },
    raw: true,
  });
  return currentPipelineRun?.status === PipelineStatus.Running;
};

/**
 * Set latest ownership data date for a pipeline run.
 * @param date in YYYY-MM-DD format
 */
export const setPipelineLatestOwnershipData = async (date: string) => {
  await PipelineRunModel.update(
    { latest_ownership_data: date },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    },
  );
};

/**
 * Return the date of the latest ownership data that was processed by the latest pipeline run, or
 * null if no pipeline has completed yet.
 */
export const getLatestOwnershipDataDate = async () => {
  const latestRun: any = await PipelineRunModel.findOne({
    where: { latest_ownership_data: { [Op.ne]: null } },
    order: [["startedAt", "DESC"]],
  });
  return latestRun ? new Date(latestRun.latest_ownership_data) : null;
};

/**
 * Set latest INSPIRE polygon data date for a pipeline run.
 * @param date in YYYY-MM-DD format
 */
export const setPipelineLatestInspireData = async (date: string) => {
  await PipelineRunModel.update(
    { latest_inspire_data: date },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    },
  );
};

/**
 * Get the previous pipeline run, or null if no pipeline has completed yet.
 */
export const getLastPipelineRun = async (): Promise<any> => {
  return await PipelineRunModel.findOne({
    where: { unique_key: { [Op.ne]: getRunningPipelineKey() } },
    order: [["startedAt", "DESC"]],
    raw: true,
  });
};

/**
 * Check if the last (MAX_RETRIES_FOR_A_POLYGON + 1) pipelines have all been interrupted and failed
 * to process the same polygon. This means we've used up all retries for a polygon and should move
 * on.
 */
export const hitMaxRetriesForAPolygon = async (): Promise<boolean> => {
  const lastPipelineRuns: any[] = await PipelineRunModel.findAll({
    where: { unique_key: { [Op.ne]: getRunningPipelineKey() } },
    order: [["startedAt", "DESC"]],
    limit: MAX_RETRIES_FOR_A_POLYGON + 1,
    raw: true,
  });

  return lastPipelineRuns?.every(
    (run) =>
      run.status === PipelineStatus.Interrupted &&
      run.last_task === "analyseInspire" &&
      run.last_poly_analysed &&
      run.last_poly_analysed === lastPipelineRuns[0].last_poly_analysed,
  );
};

/**
 * Get the start time of the pipeline run that was originally triggered i.e. before interruptions
 * that were automatically resumed. Return as time in EPOCH milliseconds.
 */
export const getPipelineStartTimeIncludingInterruptions =
  async (): Promise<number> => {
    const pipelineRunsDesc: any[] = await PipelineRunModel.findAll({
      order: [["startedAt", "DESC"]],
      raw: true,
    });

    const indexOfLastCompletedRun = pipelineRunsDesc
      .slice(1)
      .findIndex((run) => run?.status !== PipelineStatus.Interrupted);

    return new Date(
      pipelineRunsDesc[Math.max(indexOfLastCompletedRun, 0)].startedAt,
    ).getTime();
  };

/**
 * Set last task that has been reached in a pipeline run.
 */
export const setPipelineLastTask = async (task: string) => {
  await PipelineRunModel.update(
    { last_task: task },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    },
  );
};

/**
 * Set last council for which we downloaded INSPIRE data and inserted into pending_inspire_polygons.
 */
export const setPipelineLastCouncilDownloaded = async (council: string) => {
  await PipelineRunModel.update(
    { last_council_downloaded: council },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    },
  );
};

/**
 * Set row ID of the last polygon we analysed in pending_inspire_polygons.
 */
export const setPipelineLastPolyAnalysed = async (id: number) => {
  await PipelineRunModel.update(
    { last_poly_analysed: id },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    },
  );
};

/**
 * Returns the total pending inspire polygon count
 *  - up to the row with @param upToId (if specified), AND
 *  - with match_type equal to @param match_type (if specified),
 * or the whole table if neither options specified.
 */
export const getPendingPolygonCount = async (
  upToId?: number,
  match_type?: Match,
): Promise<number> => {
  const where: WhereOptions = {};
  if (upToId !== undefined) {
    where.id = { [Op.lt]: upToId };
  }
  if (match_type !== undefined) {
    where.match_type = match_type;
  }
  return await PendingPolygonModel.count({ where });
};
