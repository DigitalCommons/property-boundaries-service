import "dotenv/config";
import axios from "axios";
import * as unzip from "unzip-stream";
import csvParser, { CsvParser } from "csv-parser";
import { Logger } from "pino";

// These are all helper functions for the 2 main functions in ./update.ts

export const getDatasetHistory = async (overseas: boolean, logger: Logger) => {
  const type = overseas ? "ocod" : "ccod";
  const response = await axios.get(
    `${process.env.GOV_API_URL}/datasets/history/${type}`,
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );
  if (response.status !== 200) {
    logger.error(
      `We failed to get ${type} dataset history, status code: ${response.status}`
    );
    return;
  }
  return response.data.dataset_history.map((dataset) => ({
    ...dataset,
    type,
    // convert to YYYY-MM-DD format
    unsorted_date: dataset.unsorted_date.split("-").reverse().join("-"),
    download: `${process.env.GOV_API_URL}/datasets/history/${type}/${dataset.filename}`,
  }));
};

export const getLatestDatasets = async (overseas: boolean, logger: Logger) => {
  const type = overseas ? "ocod" : "ccod";
  const response = await axios.get(
    `${process.env.GOV_API_URL}/datasets/${type}`,
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );
  if (response.status !== 200) {
    logger.error(
      `We failed to get the latest ${type} dataset, status code: ${response.status}`
    );
    return;
  }

  return response.data.result.resources.map((dataset) => ({
    // Include date of the data and map to the same format that is used elsewhere in the code
    filename: dataset.file_name,
    type,
    download: `${process.env.GOV_API_URL}/datasets/${type}/${dataset.file_name}`,
    unsorted_date: new Date(response.data.result.last_updated) // convert to YYY-MM-DD
      .toISOString()
      .split("T")[0],
  }));
};

/**
 * Fetch zipped CSV file from URL and pipe chunks of multiple rows of the data into a function.
 */
export const pipeZippedCsvFromUrlIntoFun = async (
  downloadUrl: string,
  processChunkOfRowsFunc: (chunkOfRows: any[]) => Promise<void>,
  chunkSize: number,
  logger: Logger,
  logProgress: boolean = true
) => {
  const response = await axios.get(downloadUrl, {
    responseType: "stream",
  });

  await new Promise((resolve, reject) => {
    response.data.pipe(unzip.Parse()).on("entry", (entry) => {
      var filePath = entry.path;
      logger.info(`Reading ${filePath}`);

      if (filePath.substr(filePath.lastIndexOf(".") + 1) === "csv") {
        const csvPipe: CsvParser = entry.pipe(csvParser());
        let rowCount = 0;
        const rowsToSend = [];
        let sendingChunk = false;

        csvPipe.on("data", async (row) => {
          rowCount++;

          // Check if we need send a chunk
          if (rowsToSend.length >= chunkSize && !sendingChunk) {
            sendingChunk = true;
            csvPipe.pause(); // pause the stream to avoid OOM error
            if (logProgress) {
              logger.info(
                `Row ${rowCount} of ${filePath} , processing chunk of size ${chunkSize}`
              );
            }
            const chunk = rowsToSend.splice(0, chunkSize);
            await processChunkOfRowsFunc(chunk);
            sendingChunk = false;
            csvPipe.resume();
          }

          if (Object.keys(row).length === 2) {
            // This is the last row of the CSV, which we can ignore
            return;
          }
          rowsToSend.push(row);
        });

        csvPipe.on("end", resolve);
        csvPipe.on("error", reject);
      } else {
        entry.autodrain();
      }
    });
  });
};
