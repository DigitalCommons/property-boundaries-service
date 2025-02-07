"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs
        ADD COLUMN status TINYINT DEFAULT 0,
        ADD COLUMN options JSON DEFAULT ('{}')`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs DROP COLUMN status, DROP COLUMN options`
    );
  },
};
