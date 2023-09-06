'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class land_ownership_polygon extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  land_ownership_polygon.init({
    id: DataTypes.BIGINT,
    poly_id: DataTypes.STRING,
    title_no: DataTypes.STRING,
    geom: DataTypes.GEOMETRY
  }, {
    sequelize,
    modelName: 'land_ownership_polygon',
  });
  return land_ownership_polygon;
};