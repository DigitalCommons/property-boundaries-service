"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`ALTER TABLE pipeline_runs
        ADD COLUMN latest_snapshot_ownership_data date DEFAULT NULL`);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs DROP COLUMN latest_snapshot_ownership_data`,
    );
  },
};
