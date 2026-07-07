import { Options, Sequelize } from "sequelize";
import dbConfig from "../../config/config.js";

const { database, username, password, ...config } = (dbConfig[
  process.env.NODE_ENV
] ?? dbConfig.production) as Options;

export const sequelize = new Sequelize(database, username, password, config);
