import { Sequelize, DataTypes, Op } from "sequelize";

export const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: 'localhost',
    dialect: 'mysql'
});

export const PolygonModel = sequelize.define('Polygon', {
    id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
    },
    poly_id: DataTypes.STRING,
    title_no: {
        unique: true,
        type: DataTypes.STRING
    },
    geom: DataTypes.GEOMETRY,
    createdAt: {
        allowNull: false,
        type: DataTypes.DATE
    },
    updatedAt: {
        allowNull: false,
        type: DataTypes.DATE
    }
}, {
    tableName: 'land_ownership_polygons',
});

export const LandOwnershipModel = sequelize.define('LandOwnership', {
    id: {
        primaryKey: true,
        type: DataTypes.INTEGER,
    },
    title_no: DataTypes.STRING,
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
    createdAt: {
        allowNull: false,
        type: DataTypes.DATE,
    },
    updatedAt: {
        allowNull: false,
        type: DataTypes.DATE,
    },
}, {
    tableName: 'land_ownerships',
});

PolygonModel.hasMany(LandOwnershipModel, { foreignKey: "title_no" });
LandOwnershipModel.belongsTo(PolygonModel, { foreignKey: "title_no" });

export async function createLandOwnership(ownership) {
    await LandOwnershipModel.create({
        title_no: ownership['Title Number'],
        tenure: ownership.Tenure,
        property_address: ownership['Property Address'],
        district: ownership.District,
        county: ownership.County,
        region: ownership.Region,
        postcode: ownership.Postcode,
        multiple_address_indicator: ownership['Multiple Address Indicator'],
        price_paid: ownership['Price Paid'],
        proprietor_name_1: ownership['Proprietor Name (1)'],
        company_registration_no_1: ownership['Company Registration No. (1)'],
        proprietor_category_1: ownership['Proprietorship Category (1)'],
        proprietor_1_address_1: ownership['Proprietor (1) Address (1)'],
        proprietor_1_address_2: ownership['Proprietor (1) Address (2)'],
        proprietor_1_address_3: ownership['Proprietor (1) Address (3)'],
        date_proprietor_added: ownership['Date Proprietor Added'],
        additional_proprietor_indicator: ownership['Additional Proprietor Indicator'],
        proprietor_uk_based: ownership.proprietor_uk_based,
    })
}

export async function getLandOwnership(title_no: string) {
    const landOwnership = await LandOwnershipModel.findOne({
        where: {
            title_no: title_no
        },
        raw: true
    });

    return landOwnership;
}

export async function getPolygons() {
    const polygons = await PolygonModel.findAll();

    return polygons;
}

export async function getPolygonsByArea(searchArea: string) {
    const query = `SELECT *
    FROM ${process.env.DB_NAME}.land_ownership_polygons
    LEFT JOIN ${process.env.DB_NAME}.land_ownerships
    ON ${process.env.DB_NAME}.land_ownership_polygons.title_no = ${process.env.DB_NAME}.land_ownerships.title_no
    WHERE ST_Intersects(${process.env.DB_NAME}.land_ownership_polygons.geom, ST_GeomFromText("${searchArea}"));`;

    const polygonsAndOwnerships = await sequelize.query(query);

    return polygonsAndOwnerships;
}