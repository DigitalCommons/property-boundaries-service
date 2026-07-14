import { DataTypes } from "sequelize";
import { sequelize } from "./database";

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

export const LandOwnershipSnapshotModel = sequelize.define(
  "LandOwnershipSnapshot",
  {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    title_no: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    snapshot_date: {
      allowNull: false,
      type: DataTypes.DATEONLY,
    },
    proprietor_name: DataTypes.TEXT,
    company_registration_no: DataTypes.STRING,
    property_address: DataTypes.TEXT,
    district: DataTypes.STRING,
    county: DataTypes.STRING,
    region: DataTypes.STRING,
    postcode: DataTypes.STRING,
  },
  {
    tableName: "land_ownership_snapshots",
    createdAt: true,
    updatedAt: false,
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

PolygonModel.hasMany(LandOwnershipModel, {
  foreignKey: "title_no",
  sourceKey: "title_no",
});
LandOwnershipModel.belongsTo(PolygonModel, {
  foreignKey: "title_no",
  targetKey: "title_no",
});
