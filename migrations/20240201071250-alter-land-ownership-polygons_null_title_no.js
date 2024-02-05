"use strict";

// title_no is optional, since not all polygons have a matching title in land_ownerships.
// To make this clearer, ALTER title_no to allow null, and set all empty title_nos to NULL.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `ALTER TABLE land_ownership_polygons MODIFY title_no varchar(255) DEFAULT NULL`
    );
    await queryInterface.sequelize.query(
      `UPDATE land_ownership_polygons SET title_no = NULL WHERE title_no = ''`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `UPDATE land_ownership_polygons SET title_no = '' WHERE title_no IS NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE land_ownership_polygons MODIFY title_no varchar(255) NOT NULL`
    );
  },
};
