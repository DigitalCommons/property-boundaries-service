'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('land_ownerships', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      id: {
        type: Sequelize.BIGINT
      },
      title_no: {
        type: Sequelize.STRING
      },
      tenure: {
        type: Sequelize.STRING
      },
      property_address: {
        type: Sequelize.TEXT
      },
      district: {
        type: Sequelize.STRING
      },
      county: {
        type: Sequelize.STRING
      },
      region: {
        type: Sequelize.STRING
      },
      postcode: {
        type: Sequelize.STRING
      },
      multiple_address_indicator: {
        type: Sequelize.STRING
      },
      price_paid: {
        type: Sequelize.STRING
      },
      proprietor_name_1: {
        type: Sequelize.TEXT
      },
      company_registration_no_1: {
        type: Sequelize.STRING
      },
      proprietor_category_1: {
        type: Sequelize.STRING
      },
      proprietor_1_address_1: {
        type: Sequelize.TEXT
      },
      proprietor_1_address_2: {
        type: Sequelize.TEXT
      },
      proprietor_1_address_3: {
        type: Sequelize.TEXT
      },
      proprietor_name_2: {
        type: Sequelize.TEXT
      },
      company_registration_no_2: {
        type: Sequelize.STRING
      },
      proprietor_category_2: {
        type: Sequelize.STRING
      },
      proprietor_2_address_1: {
        type: Sequelize.TEXT
      },
      proprietor_2_address_2: {
        type: Sequelize.TEXT
      },
      proprietor_2_address_3: {
        type: Sequelize.TEXT
      },
      proprietor_name_3: {
        type: Sequelize.TEXT
      },
      company_registration_no_3: {
        type: Sequelize.STRING
      },
      proprietor_category_3: {
        type: Sequelize.STRING
      },
      proprietor_3_address_1: {
        type: Sequelize.TEXT
      },
      proprietor_3_address_2: {
        type: Sequelize.TEXT
      },
      proprietor_3_address_3: {
        type: Sequelize.TEXT
      },
      proprietor_name_4: {
        type: Sequelize.TEXT
      },
      company_registration_no_4: {
        type: Sequelize.STRING
      },
      proprietor_category_4: {
        type: Sequelize.STRING
      },
      proprietor_4_address_1: {
        type: Sequelize.TEXT
      },
      proprietor_4_address_2: {
        type: Sequelize.TEXT
      },
      proprietor_4_address_3: {
        type: Sequelize.TEXT
      },
      date_proprietor_added: {
        type: Sequelize.STRING
      },
      additional_proprietor_indicator: {
        type: Sequelize.STRING
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('land_ownerships');
  }
};