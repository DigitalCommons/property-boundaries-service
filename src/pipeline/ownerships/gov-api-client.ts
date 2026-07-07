import axios from "axios";
import { logger } from "../logger.js";

type DatasetHistoryResponse = {
  dataset: "ocod" | "ccod";
  dataset_history: {
    file_size: string;
    filename: string;
    last_updated: string;
    unsorted_date: string;
  }[];
};

type LatestDatasetResponse = {
  result: {
    resources: {
      file_name: string;
      file_size: number;
    }[];
    last_updated: string;
  };
};

type FullDatasetResponse = {
  result: {
    download_url: string;
  };
};

type DatasetHistory = {
  fileSize: string;
  fileName: string;
  lastUpdated: string;
  unsortedDate: string;
  type: string;
  download: string;
};

type LatestDataset = {
  fileName: string;
  type: string;
  fileSize: number;
  download: string;
  unsortedDate: string;
};

type DataSet = {
  downloadUrl: string;
};

type FileDownloadResponse =
  | {
      success: true;
      result: {
        download_url: string;
        resource: string;
        valid_for_seconds: number;
      };
    }
  | {
      success: false;
      error: string;
    };

export const govApiClient = axios.create({
  baseURL: process.env.GOV_API_URL,
  headers: {
    Authorization: process.env.GOV_API_KEY,
  },
});

/**
 * Retrieves the history of datasets based on their type.
 * @param overseas get dataset history for overseas data
 */
export const getDatasetHistory = async (
  overseas: boolean,
): Promise<DatasetHistory[] | null> => {
  const type = overseas ? "ocod" : "ccod";
  try {
    const response = await govApiClient.get<DatasetHistoryResponse>(
      `/datasets/history/${type}`,
    );
    return response.data.dataset_history.map((dataset) => ({
      type,
      lastUpdated: dataset.last_updated,
      fileSize: dataset.file_size,
      fileName: dataset.filename,
      // convert to YYYY-MM-DD format
      unsortedDate: dataset.unsorted_date.split("-").reverse().join("-"),
      download: `${process.env.GOV_API_URL}/datasets/history/${type}/${dataset.filename}`,
    }));
  } catch (err) {
    logger.error(err, `Failed to get ${type} dataset history`);
    return null;
  }
};

/**
 * Retrieves the latest datasets based on their type.
 * @param overseas get latest datasets for overseas data
 */
export const getLatestDatasets = async (
  overseas: boolean,
): Promise<LatestDataset[] | null> => {
  const type = overseas ? "ocod" : "ccod";
  try {
    const response = await govApiClient.get<LatestDatasetResponse>(
      `/datasets/${type}`,
    );
    return response.data.result.resources.map((dataset) => ({
      fileName: dataset.file_name,
      type,
      fileSize: dataset.file_size,
      download: `${process.env.GOV_API_URL}/datasets/${type}/${dataset.file_name}`,
      unsortedDate: new Date(response.data.result.last_updated)
        .toISOString()
        .split("T")[0],
    }));
  } catch (err) {
    logger.error(err, `Failed to get latest ${type} datasets`);
    return null;
  }
};

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

/**
 * Downloads a file from the gov API.
 * @param downloadUrl The URL of the file to download.
 */
export const datasetDownload = async (
  downloadUrl: string,
): Promise<DataSet | null> => {
  try {
    const response = await govApiClient.get<FileDownloadResponse>(downloadUrl);
    if (response.data.success !== true) {
      logger.error(
        `Failed to download file from ${downloadUrl}: ${response.data.error}`,
      );
      return null;
    }
    return { downloadUrl: response.data.result.download_url };
  } catch (err) {
    logger.error(err, `Failed to download file from ${downloadUrl}`);
    return null;
  }
};
