"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs ADD COLUMN last_poly_analysed int DEFAULT NULL`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs DROP COLUMN last_poly_analysed`
    );
  },
};
