import "dotenv/config";
import {
  getLastPipelineRun,
  setPipelineLastTask,
  startPipelineRun,
} from "../queries/query";
import { updateOwnerships } from "./ownerships/update";
import { downloadAndBackupInspirePolygons } from "./inspire/download";
import { analyseAllPendingPolygons } from "./inspire/analyse-all";
import { logger, initLogger } from "./logger";
import moment from "moment-timezone";
import {
  getLatestInspirePublishDate,
  getRunningPipelineKey,
  notifyMatrix,
} from "./util";

/** Set flag so we don't run 2 pipelines at the same time, which would lead to file conflicts */
let running = false;

type TaskOptions = {
  afterCouncil?: string; // Only process councils after this one, alphabetically
  maxCouncils?: number; // Max number of councils to process INSPIRE data for
  maxPolygons?: number; // Max number of INSPIRE polygons to process
  updateBoundaries?: string; // If 'true', update the boundaries in the main DB table after analysis
  resume?: string; // If 'true', resume from where we left off in the previous run
};

// TODO: use a proper boolean type for resume, using Hapi query.parser (see https://hapi.dev/api/?v=21.3.3)
export type PipelineOptions = {
  startAtTask?: string; // Start from this task
  stopBeforeTask?: string; // Stop before this task
  resume?: string; // If 'true', resume from where we left off in the previous run (ignoring startAtTask)
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
  logger.info(
    `Run pipeline ${pipelineKey} with options: ${JSON.stringify(options)}`
  );

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

  if (taskOptions.resume === "true") {
    // Can only resume if the latest pipeline run date is more recent than the latest INSPIRE
    // publish date
    const latestPipelineRun = await getLastPipelineRun();
    const latestInspirePublishDate = getLatestInspirePublishDate();
    if (
      latestPipelineRun?.startedAt &&
      new Date(latestPipelineRun.startedAt) > latestInspirePublishDate
    ) {
      startAtTask = (await getLastPipelineRun())?.last_task;
      startAtTaskIndex = tasks.findIndex((task) => task.name === startAtTask);
      if (startAtTaskIndex === -1) {
        // Shouldn't hit this but just in case something went wrong with DB
        startAtTaskIndex = 0;
      }
      logger.info(
        `Resuming pipeline run from task ${startAtTask}, old key: ${latestPipelineRun.unique_key}`
      );
    } else {
      taskOptions.resume = "false";
      logger.warn(
        `Can't resume because the latest pipeline run at ${latestPipelineRun.startedAt} was before the most recent INSPIRE publish date ${latestInspirePublishDate}`
      );
    }
  } else {
    taskOptions.resume = "false";
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
      await setPipelineLastTask(task.name);
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

    await notifyMatrix(
      `✅ Successful ownership + INSPIRE pipeline ${pipelineKey}. Time elapsed: ${timeElapsedString}\n\`\`\`\n${summaryTable}\n\`\`\``
    );
  } catch (err) {
    running = false;
    logger.error(err, "Pipeline failed");
    console.error(`Pipeline ${pipelineKey} failed`, err?.message);

    await notifyMatrix(`🔴 Failed ownership + INSPIRE pipeline ${pipelineKey}`);

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
