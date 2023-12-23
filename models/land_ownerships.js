"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class land_ownerships extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  land_ownerships.init(
    {
      id: DataTypes.BIGINT,
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
    },
    {
      sequelize,
      modelName: "land_ownerships",
    }
  );
  return land_ownerships;
};
