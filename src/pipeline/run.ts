import "dotenv/config";
import axios from "axios";
import { hostname } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { startPipelineRun } from "../queries/query";
import { updateOwnerships } from "./ownerships/update";
import { downloadInspirePolygons } from "./inspire/download";
import { analyseAllPendingPolygons } from "./inspire/analyse-all";
import getLogger from "./logger";
import { Logger } from "pino";
import moment from "moment-timezone";

const matrixWebhookUrl = process.env.MATRIX_WEBHOOK_URL;

/** Set flag so we don't run 2 pipelines at the same time, which would lead to file conflicts */
let running = false;

/**
 * This is the main function to run our company ownerships + INSPIRE pipeline.
 */
const runPipeline = async (uniqueKey: string) => {
  running = true;
  const logger = getLogger(uniqueKey);
  logger.info(`Started pipeline run ${uniqueKey}`);
  const startTimeMs = Date.now();

  try {
    await updateOwnerships(uniqueKey);

    const latestInspirePublishMonth = getLatestInspirePublishMonth();

    await downloadInspirePolygons(uniqueKey, latestInspirePublishMonth);

    backupInspireDownloads(logger); // don't await, let it run in background

    // Run our matching algorithm on the new INSPIRE data
    const summaryTable = await analyseAllPendingPolygons(uniqueKey, true);

    running = false;
    const timeElapsed = moment.duration(Date.now() - startTimeMs);
    const timeElapsedString = `${timeElapsed.hours()} h ${timeElapsed.minutes()} min`;
    logger.info(`Pipeline ${uniqueKey} finished in ${timeElapsedString}`);

    // Notify Matrix
    if (matrixWebhookUrl) {
      await axios.post(matrixWebhookUrl, {
        msgtype: "m.text",
        body: `[${hostname()}] [property_boundaries] ✅ Successful ownership + INSPIRE pipeline ${uniqueKey}. Time elapsed: ${timeElapsedString}\n\n${summaryTable}`,
      });
    }
  } catch (err) {
    logger.error(err, "Pipeline failed");
    running = false;

    // Notify Matrix
    if (matrixWebhookUrl) {
      await axios.post(matrixWebhookUrl, {
        msgtype: "m.text",
        body: `[${hostname()}] [property_boundaries] 🔴 Failed ownership + INSPIRE pipeline ${uniqueKey}`,
      });
    }

    throw err;
  }
};

/**
 * Run backup script in a separate shell process to upload latest raw INSPIRE data to our Hetzner
 * storage box.
 */
const backupInspireDownloads = async (logger: Logger) => {
  const command = "bash scripts/backup-inspire-downloads.sh";
  logger.info(`Running '${command}'`);
  const { stdout, stderr } = await promisify(exec)(command);
  logger.info(`raw INSPIRE backup script stdout: ${stdout}`);
  logger.info(`raw INSPIRE backup script stderr: ${stderr}`);
};

/**
 * INSPIRE data is published on the first Sunday of every month. This function works out the month
 * of the latest available data in YYYY-MM format
 */
const getLatestInspirePublishMonth = (): string => {
  //
  const date = moment().tz("Europe/London").startOf("month");
  date.day(7); // the next sunday
  if (date.date() > 7) {
    // if the date is now after 7th, go back one week
    date.day(-7);
  }
  const today = moment().tz("Europe/London");
  if (date.isSame(today, "date")) {
    throw new Error(
      "Today is first Sunday of the month. Wait until tomorrow to run pipeline, to avoid data inconsistency problems"
    );
  }
  if (date.isAfter(today)) {
    // Data for this month hasn't been published yet so subtract a month
    date.subtract(1, "month");
  }
  return date.format("YYYY-MM");
};

/**
 * Function which is exposed to Hapi API to trigger a pipeline run. Starts the pipeline but doesn't
 * wait for it to finish
 * @returns unique key for the pipeline, or null if the pipeline is already running
 */
export const triggerPipelineRun = async (): Promise<string> => {
  if (running) {
    console.error("Pipeline already running");
    return null;
  }

  const uniqueKey = await startPipelineRun();
  runPipeline(uniqueKey);
  return uniqueKey;
};
