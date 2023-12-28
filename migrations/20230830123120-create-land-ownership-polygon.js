"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE land_ownerships (
        id bigint DEFAULT NULL,
        title_no varchar(255) NOT NULL,
        tenure varchar(255) DEFAULT NULL,
        property_address text,
        district varchar(255) DEFAULT NULL,
        county varchar(255) DEFAULT NULL,
        region varchar(255) DEFAULT NULL,
        postcode varchar(255) DEFAULT NULL,
        multiple_address_indicator varchar(255) DEFAULT NULL,
        price_paid varchar(255) DEFAULT NULL,
        proprietor_name_1 text,
        company_registration_no_1 varchar(255) DEFAULT NULL,
        proprietor_category_1 varchar(255) DEFAULT NULL,
        proprietor_1_address_1 text,
        proprietor_1_address_2 text,
        proprietor_1_address_3 text,
        proprietor_name_2 text,
        company_registration_no_2 varchar(255) DEFAULT NULL,
        proprietor_category_2 varchar(255) DEFAULT NULL,
        proprietor_2_address_1 text,
        proprietor_2_address_2 text,
        proprietor_2_address_3 text,
        proprietor_name_3 text,
        company_registration_no_3 varchar(255) DEFAULT NULL,
        proprietor_category_3 varchar(255) DEFAULT NULL,
        proprietor_3_address_1 text,
        proprietor_3_address_2 text,
        proprietor_3_address_3 text,
        proprietor_name_4 text,
        company_registration_no_4 varchar(255) DEFAULT NULL,
        proprietor_category_4 varchar(255) DEFAULT NULL,
        proprietor_4_address_1 text,
        proprietor_4_address_2 text,
        proprietor_4_address_3 text,
        date_proprietor_added varchar(255) DEFAULT NULL,
        additional_proprietor_indicator varchar(255) DEFAULT NULL,
        createdAt date DEFAULT NULL,
        updatedAt date DEFAULT NULL,
        proprietor_uk_based tinyint(1) DEFAULT NULL,
        KEY title_no (title_no),
        KEY proprietor_name_1 (proprietor_name_1(255))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP TABLE land_ownership_polygons`);
  },
};
