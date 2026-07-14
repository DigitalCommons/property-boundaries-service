"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE land_ownership_snapshots (
        id int NOT NULL AUTO_INCREMENT,
        title_no varchar(255) NOT NULL,
        snapshot_date date NOT NULL,
        proprietor_name text DEFAULT NULL,
        company_registration_no varchar(255) DEFAULT NULL,
        property_address text DEFAULT NULL,
        district varchar(255) DEFAULT NULL,
        county varchar(255) DEFAULT NULL,
        region varchar(255) DEFAULT NULL,
        postcode varchar(255) DEFAULT NULL,
        createdAt datetime DEFAULT CURRENT_TIMESTAMP,        
        PRIMARY KEY (id),
        INDEX idx_snapshot_date_proprietor_name (snapshot_date, proprietor_name(255))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("land_ownership_snapshots");
  },
};
