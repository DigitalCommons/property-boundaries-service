import "dotenv/config";
import axios from "axios";
import { hostname } from "os";
import { startPipelineRun } from "../queries/query";
import { updateOwnerships } from "./ownerships/update";
import { downloadAndBackupInspirePolygons } from "./inspire/download";
import { analyseAllPendingPolygons } from "./inspire/analyse-all";
import getLogger from "./logger";
import moment from "moment-timezone";

const matrixWebhookUrl = process.env.MATRIX_WEBHOOK_URL;

/** Set flag so we don't run 2 pipelines at the same time, which would lead to file conflicts */
let running = false;

/** The pipeline runs these methods in this order */
const tasks = [
  {
    name: "ownerships",
    desc: "Get the latest UK & Overseas Companies property ownerhsip data and store it in the land_ownerships DB table",
    method: async (uniqueKey: string) => await updateOwnerships(uniqueKey),
  },
  {
    name: "downloadInspire",
    desc: "Download the latest INSPIRE polygons, backup the data, and store it in the pending_inspire_polygons DB table",
    method: async (uniqueKey: string) =>
      await downloadAndBackupInspirePolygons(uniqueKey),
  },
  {
    name: "analyseInspire",
    desc: "Compare pending_inspire_polygons with the existing land_ownership_polygons and classify changes. Accept changes that meet criteria for a match and output detailed analysis about failed matches.",
    method: async (uniqueKey: string) =>
      await analyseAllPendingPolygons(uniqueKey),
  },
];

/**
 * This is the main function to run our company ownerships + INSPIRE pipeline.
 */
const runPipeline = async (uniqueKey: string, startAtTask?: string) => {
  running = true;
  const startTimeMs = Date.now();
  const logger = getLogger(uniqueKey);

  let startTaskIndex = tasks.findIndex((task) => task.name === startAtTask);
  if (startTaskIndex === -1) {
    if (startAtTask) {
      logger.error(
        `${startAtTask} isn't a valid task, so just start at beginning of pipeline`
      );
    }
    startAtTask = undefined;
    startTaskIndex = 0;
  }
  logger.info(
    `Started pipeline run ${uniqueKey} at ${startAtTask || "beginning"}`
  );

  try {
    let output: string | void;
    for (const task of tasks.slice(startTaskIndex)) {
      const msg = `Pipeline ${uniqueKey} running task: ${task.name}`;
      logger.info(msg);
      console.log(msg); // Include task logs to console so they also show up in the pm2 logs
      output = await task.method(uniqueKey);
      logger.info(`Output of task ${task.name}: ${output}`);
    }

    // Output of last task should be a summary table of the analysis, which we want to send to Matrix
    const summaryTable = output || "Error: no summary table";

    running = false;
    const timeElapsed = moment.duration(Date.now() - startTimeMs);
    const timeElapsedString = `${timeElapsed.hours()} h ${timeElapsed.minutes()} min`;
    const msg = `Pipeline ${uniqueKey} finished in ${timeElapsedString}`;
    logger.info(msg);
    console.log(msg);

    // Notify Matrix
    if (matrixWebhookUrl) {
      await axios.post(matrixWebhookUrl, {
        msgtype: "m.text",
        body: `[${hostname()}] [property_boundaries] ✅ Successful ownership + INSPIRE pipeline ${uniqueKey}. Time elapsed: ${timeElapsedString}\n\`\`\`\n${summaryTable}\n\`\`\``,
      });
    }
  } catch (err) {
    running = false;
    logger.error(err, "Pipeline failed");
    console.error(`Pipeline ${uniqueKey} failed`, err?.message);

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
 * Function which is exposed to Hapi API to trigger a pipeline run. Starts the pipeline but doesn't
 * wait for it to finish
 * @returns unique key for the pipeline, or null if the pipeline is already running
 */
export const triggerPipelineRun = async (
  startAtTask?: string
): Promise<string> => {
  if (running) {
    console.error("Pipeline already running");
    return null;
  }

  const uniqueKey = await startPipelineRun();
  runPipeline(uniqueKey, startAtTask);
  return uniqueKey;
};
