import { Sequelize, DataTypes, QueryTypes, Op } from "sequelize";
import { Feature, Polygon } from "@turf/turf";
import { customAlphabet } from "nanoid";

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
      type: DataTypes.GEOMETRY,
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
      type: DataTypes.GEOMETRY,
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
    latest_ownership_data: DataTypes.DATEONLY,
    latest_inspire_data: DataTypes.DATEONLY,
    startedAt: DataTypes.DATE,
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
  await PendingPolygonModel.truncate();
};

export const bulkCreatePendingPolygons = async (
  polygonGeojsonFeatures: Feature<Polygon>[],
  council: string,
  logging = false
) => {
  const parsedPolygons = polygonGeojsonFeatures.map((feature) => ({
    poly_id: feature.properties.INSPIREID,
    geom: feature.geometry,
    council,
    accepted: false,
  }));

  await PendingPolygonModel.bulkCreate(parsedPolygons, {
    logging: logging ? console.log : false,
    benchmark: true,
    updateOnDuplicate: ["geom", "council", "accepted"],
  });
};

/** A subset of the fields in the model, which are used for analysis */
export type PendingPolygon = {
  id: number;
  poly_id: number;
  geom: Polygon;
  council: string;
};

/** Return the next pending polygon with id at least equal to minId  */
export const getNextPendingPolygon = async (
  minId: number
): Promise<PendingPolygon> => {
  const polygon: any = await PendingPolygonModel.findOne({
    where: { id: { [Op.gte]: minId } },
    raw: true,
  });

  return {
    id: polygon.id,
    poly_id: polygon.poly_id,
    geom: polygon.geom,
    council: polygon.council,
  };
};

export const createOrUpdatePolygonGeom = async (
  poly_id: number,
  geom: Polygon,
  logging = false
) => {
  await PolygonModel.upsert(
    {
      poly_id,
      geom,
    },
    {
      logging: logging ? console.log : false,
    }
  );
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

    const query = `SELECT *
    FROM land_ownership_polygons
    LEFT JOIN land_ownerships
    ON land_ownership_polygons.title_no = land_ownerships.title_no
    WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?)) 
    ${noLeaseholdsCondition};`;

    return await sequelize.query(query, {
      replacements: [searchArea],
      type: QueryTypes.SELECT,
    });
  }

  const searchAreaCondition = searchArea
    ? `AND ST_Intersects(land_ownership_polygons.geom, ST_GeomFromGeoJSON(?)) `
    : "";
  const uniquePolyIds = new Set<number>(poly_ids);

  const query = `SELECT *
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
 * Get pending polygons that intersect with the search area.
 *
 * @param searchArea a stringified GeoJSON Polygon geometry
 * @returns an array of pending polygons that match the criteria
 */
export const getPendingPolygonsInSearchArea = async (searchArea: string) => {
  const query = `SELECT *
    FROM pending_inspire_polygons
    WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(?));`;

  return await sequelize.query(query, {
    replacements: [searchArea],
    type: QueryTypes.SELECT,
  });
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
 * Find property polygons that intersect within the give search area.
 *
 * @param searchArea a Polygon in WKT format
 * @returns an array of polygons, with ownership info for each polygon if it exists
 */
export const getPolygonsByArea = async (searchArea: string) => {
  const query = `SELECT *
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

/** Create an entry in the pipeline_runs table and return its unique key */
export const startPipelineRun = async (): Promise<string> => {
  const unique_key = nanoid();
  await PipelineRunModel.create({
    unique_key,
  });
  return unique_key;
};

/**
 * Set latest ownership data date for a pipeline run.
 * @param unique_key the unique_key for the pipeline run
 * @param date in YYYY-MM-DD format
 */
export const setPipelineLatestOwnershipData = async (
  unique_key: string,
  date: string
) => {
  await PipelineRunModel.update(
    { latest_ownership_data: date },
    {
      where: {
        unique_key,
      },
    }
  );
};

/**
 * Set latest INSPIRE polygon data date for a pipeline run.
 * @param unique_key the unique_key for the pipeline run
 * @param date in YYYY-MM-DD format
 */
export const setPipelineLatestInspireData = async (
  unique_key: string,
  date: string
) => {
  await PipelineRunModel.update(
    { latest_inspire_data: date },
    {
      where: {
        unique_key,
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
