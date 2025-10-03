"use strict";

module.exports = {
  /**
   * A table of OS NGD land polygons with spatial index and england_and_wales_id reference.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE os_land_polys (
        id int NOT NULL AUTO_INCREMENT,
        geom POLYGON NOT NULL /*!80003 SRID 4326 */,
        england_and_wales_id int NOT NULL,
        os_ngd_id varchar(255),
        createdAt datetime DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        SPATIAL KEY geom (geom),
        KEY england_and_wales_id (england_and_wales_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP TABLE os_land_polys`);
  },
};
