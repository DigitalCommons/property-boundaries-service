"use strict";

module.exports = {
  /**
   * List of poly_ids pending deletion from land_ownership_polygons.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE pending_polygon_deletions (
        id int NOT NULL AUTO_INCREMENT,
        poly_id int NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY poly_id (poly_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `DROP TABLE pending_polygon_deletions`
    );
  },
};
