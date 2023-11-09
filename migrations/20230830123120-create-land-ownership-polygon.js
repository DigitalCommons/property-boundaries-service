'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('land_ownership_polygons', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      poly_id: {
        type: Sequelize.STRING
      },
      title_no: {
        type: Sequelize.STRING,
        foreignKey: true
      },
      geom: {
        type: Sequelize.GEOMETRY,
        srid: 4326,
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        default: Date.now()
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        default: Date.now()
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('land_ownership_polygons');
  }
};