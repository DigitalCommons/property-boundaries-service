import { addYears, eachYearOfInterval, endOfYear } from "date-fns";
import {
  getFullOverseasDataset,
  getFullUKDataset,
} from "../../gov-api/client.js";
import {
  getLatestOwnershipSnapshotDataDate,
  setPipelineLatestOwnershipSnapshotData,
} from "../../queries/pipeline-query.js";
import { logger } from "../logger.js";
import { pipeZippedCsvFromUrlIntoFun } from "../ownerships/helpers.js";
import { bulkCreateLandOwnershipSnapshots } from "../../queries/land-ownership-snapshot-query.js";
import { TaskOptions } from "../run.js";

const EARLIEST_DATE_TO_PROCESS = new Date(2017, 11, 31); // The earliest end of year date for which we have ownership data

/**
 *
 * @param options
 * @returns
 */
export const updateOwnershipSnapshots = async (options: TaskOptions) => {
  let latestOwnershipSnapshotDataDate =
    await getLatestOwnershipSnapshotDataDate();
  logger.info(
    `Latest ownership snapshot data is from ${latestOwnershipSnapshotDataDate}`,
  );

  let dateToProcessFrom: Date = await getDateToProcessFrom(
    latestOwnershipSnapshotDataDate,
  );

  // guard to check whether there is any new ownership snapshot data to process, if not then return
  const lastFullYearEndDate = endOfYear(addYears(new Date(), -1));
  if (dateToProcessFrom > lastFullYearEndDate) {
    logger.info(
      `No new ownership snapshot data to process, as the latest ownership snapshot data is from ${latestOwnershipSnapshotDataDate}`,
    );
    return;
  }

  const yearsToProcess = eachYearOfInterval({
    start: dateToProcessFrom,
    end: lastFullYearEndDate,
  });

  // loop through each year from dateToProcessFrom to the end of last year and process the ownership snapshot data for that year
  for (let year of yearsToProcess) {
    const success = await downloadAndProcessOwnershipSnapshotDataForYear(
      year.getFullYear(),
      options,
    );

    if (!success) {
      const msg = `Failed to process ownership snapshot data for year ${year.getFullYear()}. Halting further snapshot processing.`;
      logger.error(msg);
      throw new Error(msg);
    }
  }
};

/**
 * if latestOwnershipSnapshotDataDate is null, we need to process from 2017
 * otherwise we need to process from the year of latestOwnershipSnapshotDataDate
 * @param latestOwnershipSnapshotDataDate date of the latest snapshot in the db
 */
const getDateToProcessFrom = async (
  latestOwnershipSnapshotDataDate: Date | null,
): Promise<Date> => {
  let dateToProcessFrom: Date;
  if (!latestOwnershipSnapshotDataDate) {
    logger.info(
      "No ownership snapshot data found, so we will process all years from 2017 to the end of last year",
    );
    dateToProcessFrom = EARLIEST_DATE_TO_PROCESS;
    // TODO clear tables down in case it is a rerun?
  } else {
    logger.info(
      `We will process ownership snapshot data from ${latestOwnershipSnapshotDataDate} to the end of last year`,
    );
    dateToProcessFrom = addYears(latestOwnershipSnapshotDataDate, 1);
  }
  return dateToProcessFrom;
};

/**
 *
 * @param year
 * @param options
 * @returns
 */
const downloadAndProcessOwnershipSnapshotDataForYear = async (
  year: number,
  options: TaskOptions,
): Promise<boolean> => {
  logger.info(`Processing ownership snapshot data for year ${year}`);
  //TODO check if the file exists first? And skip if not - try again next month?!
  const snapshotDate = new Date(year, 11, 31);
  // We need to download the January FULL dataset for the following year.
  // e.g. for December 2023 we need the Jan 2024 file, which contains the snapshot data for 31/12/2023
  const fileYear = year + 1;

  let success = await downloadAndProcessUKDataset(fileYear, snapshotDate);
  if (!success) {
    return success;
  }

  success = await downloadAndProcessOverseasDataset(fileYear, snapshotDate);
  if (!success) {
    return success;
  }

  await setPipelineLatestOwnershipSnapshotData(snapshotDate);
  return true;
};

const downloadAndProcessUKDataset = async (
  fileYear: number,
  snapshotDate: Date,
): Promise<boolean> => {
  //Download the ownership snapshot data for the year and process it
  logger.info(
    `Downloading FULL ownership UK snapshot data for 01/${fileYear} as this contains the data for December ${snapshotDate.getFullYear()}`,
  );

  const ukOwnershipSnapshotData = await getFullUKDataset(1, fileYear);
  if (!ukOwnershipSnapshotData) {
    logger.error(
      `Failed to download FULL UK ownership snapshot data for 01/${fileYear}`,
    );
    return false;
  }
  logger.info(
    `Successfully downloaded FULL UK ownership snapshot data for 01/${fileYear}`,
  );

  try {
    // Process the downloaded data
    await pipeZippedCsvFromUrlIntoFun(
      ukOwnershipSnapshotData.downloadUrl,
      (ownership) =>
        bulkCreateLandOwnershipSnapshots(ownership, snapshotDate, false, false),
      20000,
    );
  } catch (error) {
    logger.error(error);
    logger.error(
      `Failed to process FULL UK ownership snapshot data for 01/${fileYear}`,
    );
    return false;
  }
  return true;
};

const downloadAndProcessOverseasDataset = async (
  fileYear: number,
  snapshotDate: Date,
): Promise<boolean> => {
  //Download the overseas ownership snapshot data for the year and process it
  logger.info(
    `Downloading FULL ownership overseas snapshot data for 01/${fileYear} as this contains the data for December ${snapshotDate.getFullYear()}`,
  );

  const overseasOwnershipSnapshotData = await getFullOverseasDataset(
    1,
    fileYear,
  );
  if (!overseasOwnershipSnapshotData) {
    logger.error(
      `Failed to download FULL Overseas ownership snapshot data for 01/${fileYear}`,
    );
    return false;
  }
  logger.info(
    `Successfully downloaded FULL Overseas ownership snapshot data for 01/${fileYear}`,
  );

  try {
    // Process the downloaded data
    await pipeZippedCsvFromUrlIntoFun(
      overseasOwnershipSnapshotData.downloadUrl,
      (ownership) =>
        bulkCreateLandOwnershipSnapshots(ownership, snapshotDate, true, false),
      20000,
    );
  } catch (error) {
    logger.error(error);
    logger.error(
      `Failed to process FULL overseas ownership snapshot data for 01/${fileYear}`,
    );
    return false;
  }
  return true;
};
