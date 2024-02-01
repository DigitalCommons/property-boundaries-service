"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `CREATE TABLE pipeline_runs (
        id int NOT NULL AUTO_INCREMENT,
        unique_key varchar(255) NOT NULL,

        /* These dates are set once the data updates have completed. NULL suggests pipeline didn't finish */
        latest_ownership_data date DEFAULT NULL, 
        latest_inspire_data date DEFAULT NULL,

        startedAt datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY (unique_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP TABLE pipeline_runs`);
  },
};
