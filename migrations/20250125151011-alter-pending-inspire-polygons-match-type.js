"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pending_inspire_polygons ADD COLUMN match_type varchar(60) DEFAULT NULL`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pending_inspire_polygons DROP COLUMN match_type`
    );
  },
};
