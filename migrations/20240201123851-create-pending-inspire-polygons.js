"use strict";

module.exports = {
  /**
   * Same def as land_ownership_polygons, apart from title_no (which isn't in INSPIRE data).
   * Also include an 'accepted' column, which we set if we decide to accept the new polygon geometry
   * in our pipeline, and a 'council' column to indicate which council the data is from.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE pending_inspire_polygons (
        id int NOT NULL AUTO_INCREMENT,
        poly_id int NOT NULL,
        geom geometry NOT NULL /*!80003 SRID 4326 */,
        council varchar(255) NOT NULL,
        accepted boolean NOT NULL DEFAULT false,
        createdAt datetime DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        SPATIAL KEY geom (geom),
        KEY poly_id (poly_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP TABLE pending_inspire_polygons`);
  },
};
