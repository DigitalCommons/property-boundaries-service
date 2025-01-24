import { Sequelize, DataTypes, QueryTypes, Op } from "sequelize";
import { Feature, Polygon } from "geojson";
import { customAlphabet } from "nanoid";
import { getRunningPipelineKey, setRunningPipelineKey } from "../pipeline/util";

/** Used to generate pipeline unique keys */
const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 10);

// TODO: move this instance creation and model definitions into a separate 'models' file. Just have
// callable queries in this file

export const sequelize = new Sequelize(
  process.env.DB_NAME!,
  process.env.DB_USER!,
  process.env.DB_PASSWORD,
  {
    host: "localhost",
    dialect: "mysql",
    logging: false,
  }
);

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
  }
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
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    tableName: "pending_inspire_polygons",
  }
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
  }
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
  }
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
  },
  {
    tableName: "pipeline_runs",
    createdAt: "startedAt",
    updatedAt: false,
  }
);

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

export const resetPolygonsPendingDeletion = async () => {
  await PendingDeletionModel.truncate({ restartIdentity: true });
};

export const bulkCreatePendingPolygons = async (
  polygonGeojsonFeatures: Feature<Polygon>[],
  council: string,
  logging = false
) => {
  const numFeatures = polygonGeojsonFeatures.length;
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

/** A subset of the fields in the model, which are used for analysis */
export type PendingPolygon = {
  id: number;
  poly_id: number;
  geom: Polygon;
  council: string;
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
  minId: number
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

  return polygon
    ? {
        id: polygon.id,
        poly_id: polygon.poly_id,
        geom: polygon.geom,
        council: polygon.council,
      }
    : null;
};

export const createOrUpdateLandOwnership = async (
  ownership,
  overseas: boolean,
  logging = false
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
  logging = false
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
  logging = false
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
  includeLeasholds = true
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
  searchArea: string
) => {
  const query = `SELECT land_ownerships.*, land_ownership_polygons.*
  FROM land_ownership_polygons
  LEFT JOIN land_ownerships
  ON land_ownership_polygons.title_no = land_ownerships.title_no
  WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?))
  AND (proprietor_category_1 = 'Local Authority'
    OR proprietor_category_2 = 'Local Authority'
    OR proprietor_category_3 = 'Local Authority'
    OR proprietor_category_4 = 'Local Authority')
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
  searchArea: string
) => {
  // This may grow to a list of proprietors that we identify later
  const churchOfEnglandProprietorNames = [
    "The Church Commissioners for England",
  ];

  const churchOfEnglandCondition = churchOfEnglandProprietorNames
    .map(
      (name) => `AND (
    proprietor_name_1 = '${name}'
      OR proprietor_name_2 = '${name}'
      OR proprietor_name_3 = '${name}'
      OR proprietor_name_4 = '${name}')`
    )
    .join(" ");

  const query = `SELECT land_ownerships.*, land_ownership_polygons.*
  FROM land_ownership_polygons
  LEFT JOIN land_ownerships
  ON land_ownership_polygons.title_no = land_ownerships.title_no
  WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?))
  ${churchOfEnglandCondition}
  LIMIT 5000;`;

  return await sequelize.query(query, {
    replacements: [searchArea],
    type: QueryTypes.SELECT,
  });
};

/**
 * Get pending polygons that intersect with the search area.
 * Limit result to 5000 polygons to avoid OOMEs.
 *
 * @param searchArea a stringified GeoJSON Polygon geometry
 * @param acceptedOnly whether to only return accepted pending polygons (default to all)
 * @returns an array of pending polygons that match the criteria
 */
export const getPendingPolygonsInSearchArea = async (
  searchArea: string,
  acceptedOnly = false
) => {
  const acceptedCondition = acceptedOnly ? "AND accepted = true" : "";
  const query = `SELECT *
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
 * Return pending polygon with poly_id if it exists, or null.
 */
export const getPendingPolygon = async (
  poly_id: number
): Promise<PendingPolygon> => {
  const polygon: any = await PendingPolygonModel.findOne({
    where: { poly_id },
    raw: true,
  });

  return polygon
    ? {
        id: polygon.id,
        poly_id: polygon.poly_id,
        geom: polygon.geom,
        council: polygon.council,
      }
    : null;
};

/**
 * Check whether a pending polygon with the given poly_id exists.
 */
export const pendingPolygonExists = async (
  poly_id: number
): Promise<boolean> => {
  const polygon = await PendingPolygonModel.findOne({ where: { poly_id } });
  return polygon !== null;
};

/**
 * Mark pending polygon as accepted.
 */
export const acceptPendingPolygon = async (poly_id: number) => {
  await PendingPolygonModel.update(
    { accepted: true },
    {
      where: {
        poly_id,
      },
    }
  );
};

/**
 * Ensure pending polygon is marked as not accepted.
 */
export const rejectPendingPolygon = async (poly_id: number) => {
  await PendingPolygonModel.update(
    { accepted: false },
    {
      where: {
        poly_id,
      },
    }
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
  const query = `INSERT INTO land_ownership_polygons (poly_id, geom)
    SELECT p.poly_id, p.geom
    FROM pending_inspire_polygons p WHERE accepted = true
    ON DUPLICATE KEY UPDATE geom = p.geom;`;

  return await sequelize.query(query, {
    type: QueryTypes.INSERT,
  });
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
export const startPipelineRun = async (): Promise<string> => {
  const unique_key = nanoid();
  await PipelineRunModel.create({
    unique_key,
  });
  setRunningPipelineKey(unique_key);
  return unique_key;
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
    }
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
    }
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
 * Set last task that has been reached in a pipeline run.
 */
export const setPipelineLastTask = async (task: string) => {
  await PipelineRunModel.update(
    { last_task: task },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    }
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
    }
  );
};

/**
 * Get row ID of the last polygon marked as accepted in pending_inspire_polygons, or -1 if none are
 * accepted.
 */
export const getLastAcceptedPendingPolygonId = async (): Promise<number> => {
  const polygon: any = await PendingPolygonModel.findOne({
    where: { accepted: true },
    order: [["id", "DESC"]],
  });
  return polygon ? polygon.id : -1;
};

/**
 * Returns the total pending inspire polygon count up to the row with @param upToId, or the whole
 * table if not specified.
 */
export const getPendingPolygonCount = async (
  upToId?: number
): Promise<number> => {
  return await PendingPolygonModel.count({
    where: upToId === undefined ? undefined : { id: { [Op.lt]: upToId } },
  });
};
