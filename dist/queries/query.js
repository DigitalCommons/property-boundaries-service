"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPolygonsByArea = exports.getPolygons = exports.getLandOwnership = exports.createLandOwnership = exports.LandOwnershipModel = exports.PolygonModel = exports.sequelize = void 0;
const sequelize_1 = require("sequelize");
exports.sequelize = new sequelize_1.Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: 'localhost',
    dialect: 'mysql'
});
exports.PolygonModel = exports.sequelize.define('Polygon', {
    id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: sequelize_1.DataTypes.INTEGER
    },
    poly_id: sequelize_1.DataTypes.STRING,
    title_no: {
        unique: true,
        type: sequelize_1.DataTypes.STRING
    },
    geom: sequelize_1.DataTypes.GEOMETRY,
    createdAt: {
        allowNull: false,
        type: sequelize_1.DataTypes.DATE
    },
    updatedAt: {
        allowNull: false,
        type: sequelize_1.DataTypes.DATE
    }
}, {
    tableName: 'land_ownership_polygons',
});
exports.LandOwnershipModel = exports.sequelize.define('LandOwnership', {
    id: {
        primaryKey: true,
        type: sequelize_1.DataTypes.INTEGER,
    },
    title_no: sequelize_1.DataTypes.STRING,
    tenure: sequelize_1.DataTypes.STRING,
    property_address: sequelize_1.DataTypes.TEXT,
    district: sequelize_1.DataTypes.STRING,
    county: sequelize_1.DataTypes.STRING,
    region: sequelize_1.DataTypes.STRING,
    postcode: sequelize_1.DataTypes.STRING,
    multiple_address_indicator: sequelize_1.DataTypes.STRING,
    price_paid: sequelize_1.DataTypes.STRING,
    proprietor_name_1: sequelize_1.DataTypes.TEXT,
    company_registration_no_1: sequelize_1.DataTypes.STRING,
    proprietor_category_1: sequelize_1.DataTypes.STRING,
    proprietor_1_address_1: sequelize_1.DataTypes.TEXT,
    proprietor_1_address_2: sequelize_1.DataTypes.TEXT,
    proprietor_1_address_3: sequelize_1.DataTypes.TEXT,
    proprietor_name_2: sequelize_1.DataTypes.TEXT,
    company_registration_no_2: sequelize_1.DataTypes.STRING,
    proprietor_category_2: sequelize_1.DataTypes.STRING,
    proprietor_2_address_1: sequelize_1.DataTypes.TEXT,
    proprietor_2_address_2: sequelize_1.DataTypes.TEXT,
    proprietor_2_address_3: sequelize_1.DataTypes.TEXT,
    proprietor_name_3: sequelize_1.DataTypes.TEXT,
    company_registration_no_3: sequelize_1.DataTypes.STRING,
    proprietor_category_3: sequelize_1.DataTypes.STRING,
    proprietor_3_address_1: sequelize_1.DataTypes.TEXT,
    proprietor_3_address_2: sequelize_1.DataTypes.TEXT,
    proprietor_3_address_3: sequelize_1.DataTypes.TEXT,
    proprietor_name_4: sequelize_1.DataTypes.TEXT,
    company_registration_no_4: sequelize_1.DataTypes.STRING,
    proprietor_category_4: sequelize_1.DataTypes.STRING,
    proprietor_4_address_1: sequelize_1.DataTypes.TEXT,
    proprietor_4_address_2: sequelize_1.DataTypes.TEXT,
    proprietor_4_address_3: sequelize_1.DataTypes.TEXT,
    date_proprietor_added: sequelize_1.DataTypes.STRING,
    additional_proprietor_indicator: sequelize_1.DataTypes.STRING,
    proprietor_uk_based: sequelize_1.DataTypes.BOOLEAN,
    createdAt: {
        allowNull: false,
        type: sequelize_1.DataTypes.DATE,
    },
    updatedAt: {
        allowNull: false,
        type: sequelize_1.DataTypes.DATE,
    },
}, {
    tableName: 'land_ownerships',
});
exports.PolygonModel.hasMany(exports.LandOwnershipModel, { foreignKey: "title_no" });
exports.LandOwnershipModel.belongsTo(exports.PolygonModel, { foreignKey: "title_no" });
function createLandOwnership(ownership) {
    return __awaiter(this, void 0, void 0, function* () {
        yield exports.LandOwnershipModel.create({
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
        });
    });
}
exports.createLandOwnership = createLandOwnership;
function getLandOwnership(title_no) {
    return __awaiter(this, void 0, void 0, function* () {
        const landOwnership = yield exports.LandOwnershipModel.findOne({
            where: {
                title_no: title_no
            },
            raw: true
        });
        return landOwnership;
    });
}
exports.getLandOwnership = getLandOwnership;
function getPolygons() {
    return __awaiter(this, void 0, void 0, function* () {
        const polygons = yield exports.PolygonModel.findAll();
        return polygons;
    });
}
exports.getPolygons = getPolygons;
function getPolygonsByArea(searchArea) {
    return __awaiter(this, void 0, void 0, function* () {
        const query = `SELECT *
    FROM boundary_service.land_ownership_polygons
    LEFT JOIN boundary_service.land_ownerships
    ON boundary_service.land_ownership_polygons.title_no = boundary_service.land_ownerships.title_no
    WHERE ST_Intersects(boundary_service.land_ownership_polygons.geom, ST_GeomFromText("${searchArea}"));`;
        const polygonsAndOwnerships = yield exports.sequelize.query(query);
        return polygonsAndOwnerships;
    });
}
exports.getPolygonsByArea = getPolygonsByArea;
//# sourceMappingURL=query.js.map