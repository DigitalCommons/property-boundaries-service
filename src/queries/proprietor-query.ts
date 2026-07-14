import { QueryTypes } from "sequelize";
import { logger } from "../pipeline/logger.js";
import { sequelize } from "./database.js";

/**
 * Get all distinct non-empty proprietor names across all 4 proprietor columns.
 */
export const getDistinctProprietorNames = async (): Promise<string[]> => {
  logger.info("Querying distinct proprietor names from land_ownerships");
  const rows = await sequelize.query<{ name: string }>(
    `SELECT proprietor_name_1 AS name FROM land_ownerships WHERE proprietor_name_1 IS NOT NULL AND proprietor_name_1 != ''
     UNION
     SELECT proprietor_name_2 FROM land_ownerships WHERE proprietor_name_2 IS NOT NULL AND proprietor_name_2 != ''
     UNION
     SELECT proprietor_name_3 FROM land_ownerships WHERE proprietor_name_3 IS NOT NULL AND proprietor_name_3 != ''
     UNION
     SELECT proprietor_name_4 FROM land_ownerships WHERE proprietor_name_4 IS NOT NULL AND proprietor_name_4 != ''`,
    { type: QueryTypes.SELECT },
  );
  logger.info(`Found ${rows.length} distinct proprietor names`);
  return rows.map((r) => r.name);
};
