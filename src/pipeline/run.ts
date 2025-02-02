import "dotenv/config";
import {
  getLastPipelineRun,
  isPipelineRunning,
  setPipelineLastCouncilDownloaded,
  setPipelineLastTask,
  startPipelineRun,
  stopPipelineRun,
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
  setRunningPipelineKey,
} from "./util";

type TaskOptions = {
  afterCouncil?: string; // Only process councils after this one, alphabetically
  maxCouncils?: number; // Max number of councils to process INSPIRE data for
  maxPolygons?: number; // Max number of INSPIRE polygons to process
  recordStats?: string; // If 'true', record detailed stats about each polygon match and save in stats.json
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
  const startTimeMs = Date.now();
  const pipelineKey = getRunningPipelineKey();
  logger.info(
    `Run pipeline ${pipelineKey} with options: ${JSON.stringify(options)}`
  );

  try {
    const latestInspirePublishDate = getLatestInspirePublishDate();
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
        // set last_council_downloaded to the last council we downloaded in the previous run, since
        // this will still be in teh pending_inspire_polygons table
        await setPipelineLastCouncilDownloaded(
          latestPipelineRun.last_council_downloaded
        );
      } else {
        throw new Error(
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

    await stopPipelineRun();
    const timeElapsed = moment.duration(Date.now() - startTimeMs);
    const timeElapsedString = `${timeElapsed.hours()} h ${timeElapsed.minutes()} min`;
    const msg = `Pipeline ${pipelineKey} finished in ${timeElapsedString}`;
    logger.info(msg);
    console.log(msg);

    await notifyMatrix(
      `<p>✅ Successful ownership + INSPIRE pipeline ${pipelineKey}. Time elapsed: ${timeElapsedString}</p>\n<pre>${summaryTable}</pre>`,
      true
    );
  } catch (err) {
    await stopPipelineRun();
    logger.error(err, "Pipeline failed");
    console.error(`Pipeline ${pipelineKey} failed:`, err?.message);

    await notifyMatrix(`🔴 Failed ownership + INSPIRE pipeline ${pipelineKey}`);

    // Don't re-throw error since this is an async process and the API route has already returned
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
  if (await isPipelineRunning()) {
    console.error(`Pipeline ${getRunningPipelineKey()} already running`);
    return null;
  }

  const pipelineKey = await startPipelineRun(options);
  initLogger(pipelineKey);
  runPipeline(options);
  return pipelineKey;
};

/**
 * Resume the latest pipeline run if is_running = 'true' in the DB, indicating it was interrupted by
 * something that the app didn't catch e.g. the server was shutdown unexpectedly
 */
export const resumePipelineRunIfInterrupted = async () => {
  const latestPipelineRun = await getLastPipelineRun();
  if (latestPipelineRun?.is_running) {
    const pipelineKey = latestPipelineRun.unique_key;
    console.log(`Resuming interrupted pipeline run ${pipelineKey}`);

    const options = latestPipelineRun.options ?? {};
    setRunningPipelineKey(pipelineKey);
    initLogger(pipelineKey);
    await runPipeline({ ...options, resume: "true" });
  } else {
    console.log("No interrupted pipeline run to resume");
  }
};
