"use strict";

module.exports = {
  /**
   * A table of polygons representing unregistered land.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE unregistered_land (
        id int NOT NULL AUTO_INCREMENT,
        geom POLYGON NOT NULL /*!80003 SRID 4326 */,
        createdAt datetime DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        SPATIAL KEY geom (geom)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP TABLE unregistered_land`);
  },
};
