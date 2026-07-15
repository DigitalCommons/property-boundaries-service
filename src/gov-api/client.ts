import axios from "axios";
import { logger } from "../pipeline/logger.js";
import { DataSet, FullDatasetResponse } from "./types.js";

export const govApiClient = axios.create({
  baseURL: process.env.GOV_API_URL,
  headers: {
    Authorization: process.env.GOV_API_KEY,
  },
});

/**
 * Retrieves the full UK dataset for a specific month and year.
 * @param month The month for which to retrieve data.
 * @param year The year for which to retrieve data.
 */
export const getFullUKDataset = async (
  month: number,
  year: number,
): Promise<DataSet | null> => {
  const paddedMonth = String(month).padStart(2, "0");
  try {
    const response = await govApiClient.get<FullDatasetResponse>(
      `/datasets/history/ccod/CCOD_FULL_${year}_${paddedMonth}.zip`,
    );
    return { downloadUrl: response.data.result.download_url };
  } catch (err) {
    logger.error(err, `Failed to get UK dataset for ${paddedMonth}/${year}`);
    return null;
  }
};

/**
 * Retrieves the full overseas dataset for a specific month and year.
 * @param month The month for which to retrieve data.
 * @param year The year for which to retrieve data.
 */
export const getFullOverseasDataset = async (
  month: number,
  year: number,
): Promise<DataSet | null> => {
  const paddedMonth = String(month).padStart(2, "0");
  try {
    const response = await govApiClient.get<FullDatasetResponse>(
      `/datasets/history/ocod/OCOD_FULL_${year}_${paddedMonth}.zip`,
    );
    return { downloadUrl: response.data.result.download_url };
  } catch (err) {
    logger.error(
      err,
      `Failed to get overseas dataset for ${paddedMonth}/${year}`,
    );
    return null;
  }
};
