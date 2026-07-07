import axios from "axios";
import * as unzip from "unzip-stream";
import csvParser, { CsvParser } from "csv-parser";
import { logger } from "../logger.js";

/**
 * Fetch zipped CSV file from URL and pipe chunks of multiple rows of the data into a function.
 */
export const pipeZippedCsvFromUrlIntoFun = async (
  downloadUrl: string,
  processChunkOfRowsFunc: (chunkOfRows: any[]) => Promise<void>,
  chunkSize: number,
  logProgress: boolean = true,
) => {
  const response = await axios.get(downloadUrl, {
    responseType: "stream",
  });

  await new Promise<void>((resolve, reject) => {
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
              logger.debug(
                `Row ${rowCount} of ${filePath}, processing chunk of size ${chunkSize}`,
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

        csvPipe.on("end", async () => {
          // Final chunk
          await processChunkOfRowsFunc(rowsToSend);
          logger.debug(`Finished processing ${rowCount} rows of ${filePath}`);
          resolve();
        });
        csvPipe.on("error", reject);
      } else {
        entry.autodrain();
      }
    });
  });
};
