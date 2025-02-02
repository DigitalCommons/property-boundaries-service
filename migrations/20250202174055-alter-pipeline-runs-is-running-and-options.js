"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs
        ADD COLUMN is_running BOOL DEFAULT 0,
        ADD COLUMN options JSON DEFAULT ('{}')`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs DROP COLUMN is_running, DROP COLUMN options`
    );
  },
};
