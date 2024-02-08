"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE land_ownership_polygons (
        id int NOT NULL AUTO_INCREMENT,
        poly_id int NOT NULL,
        title_no varchar(255) NOT NULL,
        geom geometry NOT NULL,
        createdAt datetime DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        SPATIAL KEY geom (geom),
        UNIQUE KEY poly_id (poly_id),
        KEY title_no (title_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP TABLE land_ownership_polygons`);
  },
};
