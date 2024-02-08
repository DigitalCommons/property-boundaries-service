import axios from "axios";
import chunk from "lodash.chunk";
import {
  deleteAllLandOwnerships,
  bulkDeleteLandOwnerships,
  bulkCreateOrUpdateLandOwnerships,
  getLatestOwnershipDataDate,
  setPipelineLatestOwnershipData,
} from "../../queries/query";
import {
  getDatasetHistory,
  getLatestDatasets,
  pipeZippedCsvFromUrlIntoFun,
} from "./helpers";
import getLogger from "../logger";
import { Logger } from "pino";

/**
 * Ensure the land_ownerships DB table is up-to-date.
 *
 * We do this by:
 * - Checking the latest pipeline run date
 * - If the pipeline hasn't run before, downloading the first full set of data from Nov 2017
 * - Downloading monthly changes to UK company + overseas company ownerships since the latest update
 * - Looping through the monthly changes chronologically and updating land_ownerships accordingly
 */
export const updateOwnerships = async (pipelineUniqueKey: string) => {
  const logger = getLogger(pipelineUniqueKey);

  const latestOwnershipDataDate = await getLatestOwnershipDataDate();

  if (latestOwnershipDataDate) {
    logger.info(`Latest ownership data is from ${latestOwnershipDataDate}`);
  } else {
    // If pipeline has not run before, we need to download the whole UK and overseas companies
    // datasets from Nov 2017 (the first set of data provided by the gov API in the current data
    // format)
    logger.info(
      "Download the first full set of ownership data published in Nov 2017"
    );
    await downloadOwnershipsFullData(11, 2017, pipelineUniqueKey, logger);
  }

  const ccodHistoricalDatasets = await getDatasetHistory(false, logger);
  const ocodHistoricalDatasets = await getDatasetHistory(true, logger);

  // Add the latest datasets which are (annoyingly) not included in the history API's response
  const latestCcodDatasets = await getLatestDatasets(false, logger);
  const latestOcodDatasets = await getLatestDatasets(true, logger);

  const unsortedListOfDatasets = [
    ...ccodHistoricalDatasets,
    ...ocodHistoricalDatasets,
    ...latestCcodDatasets,
    ...latestOcodDatasets,
  ];

  const filesToProcess = unsortedListOfDatasets
    .filter(
      (dataset) =>
        // only keep monthly 'change only updates'
        dataset.filename.includes("_COU_") &&
        // only keep new files since the latest pipeline run
        new Date(dataset.unsorted_date) > latestOwnershipDataDate
    )
    // Sort chronologically (oldest first)
    .sort((a, b) => (a.unsorted_date > b.unsorted_date ? 1 : -1));

  logger.info(`There are ${filesToProcess.length} change files to process`);

  for (const [index, file] of filesToProcess.entries()) {
    const ownershipAdditions = [];
    const ownershipDeletions = [];
    const badOwnerships = [];

    /** Thhe function we'll use to process each CSV row and add it to the apprioriate array */
    const addOwnershipToArray = async (ownership: any) => {
      if (ownership["Title Number"] === "Row Count:") {
        // This is the last row of the CSV, which we can ignore
        return;
      }

      switch (ownership["Change Indicator"]) {
        case "A":
          ownershipAdditions.push(ownership);
          break;
        case "D":
          ownershipDeletions.push(ownership);
          break;
        default:
          logger.error(
            { filename: file.filename, ownership },
            "No change indicator... we don't expect this!"
          );
          badOwnerships.push(ownership);
      }
    };

    const fileResponse = await axios.get(file.download, {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    });

    // The change files are small enough to keep all the data in memory, so we can just use a
    // chunk size of 1 and then do the DB operations later. We want to do this so that we can
    // filter additions and deletions and avoid data loss
    await pipeZippedCsvFromUrlIntoFun(
      fileResponse.data.result.download_url,
      (ownershipsChunk) => addOwnershipToArray(ownershipsChunk[0]),
      1,
      logger,
      false
    );

    // First processs deletions, then additions (so we don't delete new data)
    const ownershipDeletionTitleNos = ownershipDeletions.map(
      (ownership) => ownership["Title Number"]
    );
    await bulkDeleteLandOwnerships(ownershipDeletionTitleNos);

    // TODO: rather than just updating the entries of each title and overwriting old data, it would
    // be nice to keep the old data (especially when there is a change of owner), so that we are
    // eventually able to show users a list of ownership history. Since the history of these
    // datasets is publicly available, this is a feature we can add later without storing all the
    // data ourselves

    // break additions into chunks of 2000 so we don't hit max packet limit for MySQL
    const chunksOfAdditions = chunk(ownershipAdditions, 20000);
    for (const chunk of chunksOfAdditions) {
      await bulkCreateOrUpdateLandOwnerships(chunk, file.type === "ocod");
    }

    logger.info(
      {
        file: file.filename,
        additions: ownershipAdditions.length,
        deletions: ownershipDeletions.length,
        badEntries: badOwnerships.length,
      },
      "Finished processing ownership change file"
    );

    // If there are no more files from the same date to process, update DB with this latest date
    if (
      !filesToProcess[index + 1] ||
      filesToProcess[index + 1].unsorted_date > file.unsorted_date
    ) {
      await setPipelineLatestOwnershipData(
        pipelineUniqueKey,
        file.unsorted_date
      );
    }
  }
};

/**
 * Download the full Land Reg UK Companies and Land Reg Overseas Companies data for a particular
 * month and year (since Nov 2017), then pipe it into the land_ownerships DB table. This method
 * deletes existing data in the land_ownerships table.
 *
 * According to the gov website, the UK dataset contains over 3.2 million records and the overseas
 * dataset contains over 100K.
 */
async function downloadOwnershipsFullData(
  month: number,
  year: number,
  pipelineUniqueKey: string,
  logger: Logger
) {
  if (year < 2017 || (year === 2017 && month < 11)) {
    logger.error("Must specify a month since Nov 2017");
    return null;
  }
  const paddedMonth = String(month).padStart(2, "0");

  /** The function we'll use to process each chunk of CSV rows and insert them into the DB */
  const processOwnership = async (ownerships: any[], overseas: boolean) => {
    await bulkCreateOrUpdateLandOwnerships(ownerships, overseas, false);
  };

  const datasetUKResponse = await axios.get(
    `${process.env.GOV_API_URL}/datasets/history/ccod/CCOD_FULL_${year}_${paddedMonth}.zip`,
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );

  if (datasetUKResponse.status !== 200) {
    logger.error(
      `We failed to get UK data for ${paddedMonth}/${year} , status code: ${datasetUKResponse.status}`
    );
    return;
  }

  // Reset the table to avoid conflicting data
  await deleteAllLandOwnerships();

  await pipeZippedCsvFromUrlIntoFun(
    datasetUKResponse.data.result.download_url,
    (ownership) => processOwnership(ownership, false),
    20000,
    logger
  );

  const datasetOverseasResponse = await axios.get(
    `${process.env.GOV_API_URL}/datasets/history/ocod/OCOD_FULL_${year}_${paddedMonth}.zip`,
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );

  if (datasetOverseasResponse.status !== 200) {
    logger.error(
      `We failed to get overseas data for ${paddedMonth}/${year} , status code: ${datasetOverseasResponse.status}`
    );
    return;
  }

  await pipeZippedCsvFromUrlIntoFun(
    datasetOverseasResponse.data.result.download_url,
    (ownership) => processOwnership(ownership, true),
    20000,
    logger
  );

  logger.info(
    `Finished downloading the whole UK and overseas companies data from ${paddedMonth}/${year}`
  );
  await setPipelineLatestOwnershipData(
    pipelineUniqueKey,
    `${year}-${paddedMonth}-28` // data is valid until the start of next month, so the exact day doesn't really matter
  );
}
