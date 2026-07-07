import chunk from "lodash.chunk";
import {
  deleteAllLandOwnerships,
  bulkDeleteLandOwnerships,
  bulkCreateOrUpdateLandOwnerships,
  RawOwnership,
} from "../../queries/land-ownership-query.js";
import {
  getLatestOwnershipDataDate,
  setPipelineLatestOwnershipData,
} from "../../queries/query.js";
import {
  fileDownload,
  getDatasetHistory,
  getFullOverseasDataset,
  getFullUKDataset,
  getLatestDatasets,
} from "./gov-api-client.js";
import { pipeZippedCsvFromUrlIntoFun } from "./csv.js";
import { logger } from "../logger.js";
import { notifyMatrix } from "../util.js";

/**
 * Ensure the land_ownerships DB table is up-to-date.
 *
 * We do this by:
 * - Checking the latest pipeline run date
 * - If the pipeline hasn't run before, downloading the first full set of data from Nov 2017
 * - Downloading monthly changes to UK company + overseas company ownerships since the latest update
 * - Looping through the monthly changes chronologically and updating land_ownerships accordingly
 */
export const updateOwnerships = async (options: any) => {
  let latestOwnershipDataDate = await getLatestOwnershipDataDate();

  if (latestOwnershipDataDate) {
    logger.info(`Latest ownership data is from ${latestOwnershipDataDate}`);
  } else {
    // If pipeline has not run before, we need to download the whole UK and overseas companies
    // datasets from Nov 2017 (the first set of data provided by the gov API in the current data
    // format)
    logger.info(
      "Download the first full set of ownership data published in Nov 2017",
    );
    await downloadOwnershipsFullData(11, 2017);
    latestOwnershipDataDate = new Date("2017-11-28");
  }

  const ccodHistoricalDatasets = await getDatasetHistory(false);
  if (!ccodHistoricalDatasets) {
    return;
  }
  const ocodHistoricalDatasets = await getDatasetHistory(true);
  if (!ocodHistoricalDatasets) {
    return;
  }
  // Add the latest datasets which are (annoyingly) not included in the history API's response
  const latestCcodDatasets = await getLatestDatasets(false);
  if (!latestCcodDatasets) {
    return;
  }
  const latestOcodDatasets = await getLatestDatasets(true);
  if (!latestOcodDatasets) {
    return;
  }

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
        dataset.fileName.includes("_COU_") &&
        // only keep new files since the latest pipeline run
        new Date(dataset.unsortedDate) > latestOwnershipDataDate,
    )
    // Sort chronologically (oldest first)
    .sort((a, b) => (a.unsortedDate > b.unsortedDate ? 1 : -1));

  logger.info(`There are ${filesToProcess.length} change files to process`);

  for (const [index, file] of filesToProcess.entries()) {
    logger.info(
      `Processing ownership change file ${file.fileName}, size ${file.fileSize}`,
    );

    const ownershipAdditions: RawOwnership[] = [];
    const ownershipDeletions: RawOwnership[] = [];

    /** Thhe function we'll use to process each CSV row and add it to the apprioriate array */
    const addOwnershipToArray = async (ownership: RawOwnership) => {
      if (!ownership || ownership["Title Number"] === "Row Count:") {
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
            { filename: file.fileName, ownership },
            "No change indicator... we don't expect this!",
          );
          throw new Error(
            `No change indicator for ownership title ${ownership["Title Number"]} in file ${file.fileName}`,
          );
      }
    };

    const fileResponse = await fileDownload(file);

    // The change files are small enough to keep all the data in memory, so we can just use a
    // chunk size of 1 and then do the DB operations later. We want to do this so that we can
    // filter additions and deletions and avoid data loss
    await pipeZippedCsvFromUrlIntoFun(
      fileResponse.data.result.download_url,
      (ownershipsChunk) => addOwnershipToArray(ownershipsChunk[0]),
      1,
      false,
    );

    // First processs deletions, then additions (so we don't delete new data)
    const ownershipDeletionTitleNos = ownershipDeletions.map(
      (ownership) => ownership["Title Number"],
    );
    logger.info(`Deleting ${ownershipDeletionTitleNos.length} ownerships`);
    await bulkDeleteLandOwnerships(ownershipDeletionTitleNos);

    // TODO: rather than just updating the entries of each title and overwriting old data, it would
    // be nice to keep the old data (especially when there is a change of owner), so that we are
    // eventually able to show users a list of ownership history. Since the history of these
    // datasets is publicly available, this is a feature we can add later without storing all the
    // data ourselves

    logger.info(`Creating ${ownershipAdditions.length} ownerships`);

    // break additions into chunks of 2000 so we don't hit max packet limit for MySQL
    const chunksOfAdditions = chunk(ownershipAdditions, 20000);
    for (const chunk of chunksOfAdditions) {
      await bulkCreateOrUpdateLandOwnerships(chunk, file.type === "ocod");
    }

    logger.info(`Finished processing ${file.fileName}`);

    // If there are no more files from the same date to process, update DB with this latest date
    if (
      !filesToProcess[index + 1] ||
      filesToProcess[index + 1].unsortedDate > file.unsortedDate
    ) {
      await setPipelineLatestOwnershipData(file.unsortedDate);
    }
  }

  await notifyMatrix(`✅ Successful update of ownership info`);
};

/**
 * Download the full Land Reg UK Companies and Land Reg Overseas Companies data for a particular
 * month and year (since Nov 2017), then pipe it into the land_ownerships DB table. This method
 * deletes existing data in the land_ownerships table.
 *
 * According to the gov website, the UK dataset contains over 3.2 million records and the overseas
 * dataset contains over 100K.
 */
async function downloadOwnershipsFullData(month: number, year: number) {
  if (year < 2017 || (year === 2017 && month < 11)) {
    logger.error("Must specify a month since Nov 2017");
    return null;
  }
  const paddedMonth = String(month).padStart(2, "0");

  /** The function we'll use to process each chunk of CSV rows and insert them into the DB */
  const processOwnership = async (ownerships: any[], overseas: boolean) => {
    await bulkCreateOrUpdateLandOwnerships(ownerships, overseas, false);
  };

  const datasetUKResponse = await getFullUKDataset(month, year);
  if (!datasetUKResponse) {
    return;
  }

  // Reset the table to avoid conflicting data
  await deleteAllLandOwnerships();
  // Reset the history table to avoid conflicting data
  // await deleteAllHistoricLandOwnerships();

  await pipeZippedCsvFromUrlIntoFun(
    datasetUKResponse.downloadUrl,
    (ownership) => processOwnership(ownership, false),
    20000,
  );

  const datasetOverseasResponse = await getFullOverseasDataset(month, year);
  if (!datasetOverseasResponse) {
    return;
  }

  await pipeZippedCsvFromUrlIntoFun(
    datasetOverseasResponse.downloadUrl,
    (ownership) => processOwnership(ownership, true),
    20000,
  );

  logger.info(
    `Finished downloading the whole UK and overseas companies data from ${paddedMonth}/${year}`,
  );
  await setPipelineLatestOwnershipData(
    `${year}-${paddedMonth}-28`, // data is valid until the start of next month, so the exact day doesn't really matter
  );
}
