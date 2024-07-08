"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pipeline_runs
        ADD COLUMN last_task varchar(50) DEFAULT NULL,
        ADD COLUMN last_council_downloaded varchar(255) DEFAULT NULL
      `
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP TABLE pipeline_runs`);
  },
};
