import axios from "axios";
import { logger } from "../logger.js";

type DatasetHistoryResponse = {
  dataset: "ocod" | "ccod";
  dataset_history: {
    file_size: string;
    file_name: string;
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

type FullDataSet = {
  downloadUrl: string;
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
  const response = await govApiClient.get<DatasetHistoryResponse>(
    `/datasets/history/${type}`,
  );
  if (response.status !== 200) {
    logger.error(
      `We failed to get ${type} dataset history, status code: ${response.status}`,
    );
    return null;
  }
  return response.data.dataset_history.map((dataset) => ({
    ...dataset,
    type,
    lastUpdated: dataset.last_updated,
    fileSize: dataset.file_size,
    fileName: dataset.file_name,
    // convert to YYYY-MM-DD format
    unsortedDate: dataset.unsorted_date.split("-").reverse().join("-"),
    download: `${process.env.GOV_API_URL}/datasets/history/${type}/${dataset.file_name}`,
  }));
};

/**
 * Retrieves the latest datasets based on their type.
 * @param overseas get latest datasets for overseas data *
 */
export const getLatestDatasets = async (
  overseas: boolean,
): Promise<LatestDataset[] | null> => {
  const type = overseas ? "ocod" : "ccod";
  const response = await govApiClient.get<LatestDatasetResponse>(
    `/datasets/${type}`,
  );
  if (response.status !== 200) {
    logger.error(
      `We failed to get the latest ${type} dataset, status code: ${response.status}`,
    );
    return null;
  }

  return response.data.result.resources.map((dataset) => ({
    fileName: dataset.file_name,
    type,
    fileSize: dataset.file_size,
    download: `${process.env.GOV_API_URL}/datasets/${type}/${dataset.file_name}`,
    unsortedDate: new Date(response.data.result.last_updated)
      .toISOString()
      .split("T")[0],
  }));
};

/**
 * Retrieves the full UK dataset for a specific month and year.
 * @param month The month for which to retrieve data.
 * @param year The year for which to retrieve data.

 */
export const getFullUKDataset = async (
  month: number,
  year: number,
): Promise<FullDataSet | null> => {
  const paddedMonth = String(month).padStart(2, "0");
  const response = await govApiClient.get<FullDatasetResponse>(
    `/datasets/history/ccod/CCOD_FULL_${year}_${paddedMonth}.zip`,
  );
  if (response.status !== 200) {
    logger.error(
      `We failed to get UK data for ${paddedMonth}/${year}, status code: ${response.status}`,
    );
    return null;
  }
  return { downloadUrl: response.data.result.download_url };
};

/**
 * Retrieves the full overseas dataset for a specific month and year.
 * @param month The month for which to retrieve data.
 * @param year The year for which to retrieve data.
 */
export const getFullOverseasDataset = async (
  month: number,
  year: number,
): Promise<FullDataSet | null> => {
  const paddedMonth = String(month).padStart(2, "0");
  const response = await govApiClient.get<FullDatasetResponse>(
    `/datasets/history/ocod/OCOD_FULL_${year}_${paddedMonth}.zip`,
  );
  if (response.status !== 200) {
    logger.error(
      `We failed to get overseas data for ${paddedMonth}/${year}, status code: ${response.status}`,
    );
    return null;
  }
  return { downloadUrl: response.data.result.download_url };
};

export const fileDownload = async (file: any) => {
  return await govApiClient.get(file.download);
};
