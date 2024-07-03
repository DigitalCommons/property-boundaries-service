import "dotenv/config";
import axios from "axios";
import { hostname } from "os";
import { startPipelineRun } from "../queries/query";
import { updateOwnerships } from "./ownerships/update";
import { downloadAndBackupInspirePolygons } from "./inspire/download";
import { analyseAllPendingPolygons } from "./inspire/analyse-all";
import { logger, initLogger } from "./logger";
import moment from "moment-timezone";
import { getRunningPipelineKey } from "./util";

const matrixWebhookUrl = process.env.MATRIX_WEBHOOK_URL;

/** Set flag so we don't run 2 pipelines at the same time, which would lead to file conflicts */
let running = false;

type TaskOptions = {
  maxCouncils?: number; // Max number of councils to process INSPIRE data for
  maxPolygons?: number; // Max number of INSPIRE polygons to process
  updateBoundaries?: boolean; // Whether to actually update the boundaries in the DB after analysing
};

export type PipelineOptions = {
  startAtTask?: string;
  stopBeforeTask?: string;
} & TaskOptions;

/** The pipeline runs these methods in this order */
const tasks = [
  {
    name: "ownerships",
    desc: "Get the latest UK & Overseas Companies property ownerhsip data and store it in the land_ownerships DB table",
    method: async (options: TaskOptions) => await updateOwnerships(options),
  },
  {
    name: "downloadInspire",
    desc: "Download the latest INSPIRE polygons, backup the data, and store it in the pending_inspire_polygons DB table",
    method: async (options: TaskOptions) =>
      await downloadAndBackupInspirePolygons(options),
  },
  {
    name: "analyseInspire",
    desc: "Compare pending_inspire_polygons with the existing land_ownership_polygons and classify changes. Accept changes that meet criteria for a match and output detailed analysis about failed matches.",
    method: async (options: TaskOptions) =>
      await analyseAllPendingPolygons(options),
  },
];

/**
 * This is the main function to run our company ownerships + INSPIRE pipeline.
 */
const runPipeline = async (options: PipelineOptions) => {
  running = true;
  const startTimeMs = Date.now();
  const pipelineKey = getRunningPipelineKey();

  let { startAtTask, stopBeforeTask, ...taskOptions } = options;

  let startAtTaskIndex = tasks.findIndex((task) => task.name === startAtTask);
  if (startAtTaskIndex === -1) {
    if (startAtTask) {
      logger.error(
        `'${startAtTask}' isn't a valid startAtTask, so just start at beginning of pipeline`
      );
    }
    startAtTask = undefined;
    startAtTaskIndex = 0;
  }
  let stopBeforeTaskIndex = tasks.findIndex(
    (task) => task.name === stopBeforeTask
  );
  if (stopBeforeTaskIndex === -1) {
    if (stopBeforeTask) {
      logger.error(
        `'${stopBeforeTask}' isn't a valid stopBeforeTask, so just continue to the end of the pipeline`
      );
    }
    stopBeforeTask = undefined;
    stopBeforeTaskIndex = tasks.length;
  }

  logger.info(
    `Started pipeline run ${pipelineKey} at ${
      startAtTask || "beginning"
    }, will stop at ${stopBeforeTask || "end"}`
  );

  try {
    let output: string | void;
    for (const task of tasks.slice(startAtTaskIndex, stopBeforeTaskIndex)) {
      const msg = `Pipeline ${pipelineKey} running task: ${
        task.name
      } with options: ${JSON.stringify(taskOptions)}`;
      logger.info(msg);
      console.log(msg); // Include task logs to console so they also show up in the pm2 logs
      output = await task.method(taskOptions);
      logger.info(`Output of task ${task.name}: ${output}`);
    }

    // Output of last task should be a summary table of the analysis, which we want to send to Matrix
    const summaryTable = output || "Error: no summary table";

    running = false;
    const timeElapsed = moment.duration(Date.now() - startTimeMs);
    const timeElapsedString = `${timeElapsed.hours()} h ${timeElapsed.minutes()} min`;
    const msg = `Pipeline ${pipelineKey} finished in ${timeElapsedString}`;
    logger.info(msg);
    console.log(msg);

    // Notify Matrix
    if (matrixWebhookUrl) {
      await axios.post(matrixWebhookUrl, {
        msgtype: "m.text",
        body: `[${hostname()}] [property_boundaries] ✅ Successful ownership + INSPIRE pipeline ${pipelineKey}. Time elapsed: ${timeElapsedString}\n\`\`\`\n${summaryTable}\n\`\`\``,
      });
    }
  } catch (err) {
    running = false;
    logger.error(err, "Pipeline failed");
    console.error(`Pipeline ${pipelineKey} failed`, err?.message);

    // Notify Matrix
    if (matrixWebhookUrl) {
      await axios.post(matrixWebhookUrl, {
        msgtype: "m.text",
        body: `[${hostname()}] [property_boundaries] 🔴 Failed ownership + INSPIRE pipeline ${pipelineKey}`,
      });
    }

    throw err;
  }
};

/**
 * Function which is exposed to server routes to trigger a pipeline run. Starts the pipeline but
 * doesn't wait for it to finish.
 * @returns unique key for the pipeline, or null if the pipeline is already running
 */
export const triggerPipelineRun = async (
  options: PipelineOptions
): Promise<string> => {
  if (running) {
    console.error(`Pipeline ${getRunningPipelineKey()} already running`);
    return null;
  }

  const pipelineKey = await startPipelineRun();
  initLogger(pipelineKey);
  runPipeline(options);
  return pipelineKey;
};
