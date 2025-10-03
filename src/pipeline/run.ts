import "dotenv/config";
import {
  getLastPipelineRun,
  getPipelineStartTimeIncludingInterruptions,
  isPipelineRunning,
  markPipelineRunInterrupted,
  PipelineStatus,
  setPipelineLastCouncilDownloaded,
  setPipelineLastPolyAnalysed,
  setPipelineLastTask,
  startPipelineRun,
  stopPipelineRun,
} from "../queries/query.js";
import { updateOwnerships } from "./ownerships/update.js";
import { downloadAndBackupInspirePolygons } from "./inspire/download.js";
import { analyseAllPendingPolygons } from "./inspire/analyse-all.js";
import { logger, initLogger } from "./logger.js";
import moment from "moment-timezone";
import {
  getLatestInspirePublishDate,
  getRunningPipelineKey,
  notifyMatrix,
} from "./util.js";

type TaskOptions = {
  inspireDataRestore?: boolean; // If true, restore INSPIRE data from our latest backup instead of downloading it from the gov website
  afterCouncil?: string; // Only process councils after this one, alphabetically
  maxCouncils?: number; // Max number of councils to process INSPIRE data for
  maxPolygons?: number; // Max number of INSPIRE polygons to process
  recordStats: boolean; // If true, record detailed stats about each polygon match and save in stats.json
  updateBoundaries: boolean; // If true, update the boundaries in the main DB table after analysis
  resume: boolean; // If true, resume from where we left off in the previous run
};

export type PipelineOptions = {
  startAtTask?: string; // Start from this task
  stopBeforeTask?: string; // Stop before this task
  resume: boolean; // If true, resume from where we left off in the previous run (ignoring startAtTask)
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
    `Run pipeline ${pipelineKey} with options: ${JSON.stringify(options)}`,
  );

  try {
    let { startAtTask, stopBeforeTask, ...taskOptions } = options;

    let startAtTaskIndex = tasks.findIndex((task) => task.name === startAtTask);
    if (startAtTaskIndex === -1) {
      if (startAtTask) {
        logger.error(
          `'${startAtTask}' isn't a valid startAtTask, so just start at beginning of pipeline`,
        );
      }
      startAtTask = undefined;
      startAtTaskIndex = 0;
    }
    let stopBeforeTaskIndex = tasks.findIndex(
      (task) => task.name === stopBeforeTask,
    );
    if (stopBeforeTaskIndex === -1) {
      if (stopBeforeTask) {
        logger.error(
          `'${stopBeforeTask}' isn't a valid stopBeforeTask, so just continue to the end of the pipeline`,
        );
      }
      stopBeforeTask = undefined;
      stopBeforeTaskIndex = tasks.length;
    }

    if (taskOptions.resume) {
      // Can only resume downloadInspire task if the latest pipeline run date is more recent than
      // the latest INSPIRE publish date, to ensure we have data consistency
      const latestPipelineRun = await getLastPipelineRun();
      if (
        latestPipelineRun?.last_task !== "downloadInspire" ||
        (latestPipelineRun?.startedAt &&
          new Date(latestPipelineRun.startedAt) > getLatestInspirePublishDate())
      ) {
        startAtTask = latestPipelineRun?.last_task;
        startAtTaskIndex = tasks.findIndex((task) => task.name === startAtTask);
        if (startAtTaskIndex === -1) {
          // Shouldn't hit this but just in case something went wrong with DB
          startAtTaskIndex = 0;
        }
        logger.info(
          `Resuming pipeline run from task ${startAtTask}, old key: ${latestPipelineRun.unique_key}`,
        );
        // set last_council_downloaded and last_poly_analysed from the last pipeline run, so we
        // don't lose where we were (e.g. if pipeline fails before we write in the next value)
        await setPipelineLastCouncilDownloaded(
          latestPipelineRun.last_council_downloaded,
        );
        await setPipelineLastPolyAnalysed(latestPipelineRun.last_poly_analysed);
      } else {
        throw new Error(
          `Can't resume downloadInspire task because the latest pipeline run at ${
            latestPipelineRun.startedAt
          } was before the most recent INSPIRE publish date ${getLatestInspirePublishDate()}`,
        );
      }
    } else {
      taskOptions.resume = false;
    }

    logger.info(
      `Started pipeline run ${pipelineKey} at ${
        startAtTask || "beginning"
      }, will stop at ${stopBeforeTask || "end"}`,
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

    const timeElapsedThisRun = moment.duration(Date.now() - startTimeMs);
    const timeElapsedTotal = moment.duration(
      Date.now() - (await getPipelineStartTimeIncludingInterruptions()),
    );
    // Format time elapsed as h min
    const timeElapsedString = `${Math.floor(
      timeElapsedThisRun.asHours(),
    )} h ${timeElapsedThisRun.minutes()} min (this run), ${Math.floor(
      timeElapsedTotal.asHours(),
    )} h ${timeElapsedTotal.minutes()} min (total)`;

    const msg = `Pipeline ${pipelineKey} finished in ${timeElapsedString}`;
    logger.info(msg);
    console.log(msg);

    const didAnalyseInspireTask =
      stopBeforeTaskIndex >
      tasks.findIndex((task) => task.name === "analyseInspire");

    await notifyMatrix(
      `<p>✅ Successful ownership + INSPIRE pipeline ${pipelineKey}. Time elapsed: ${timeElapsedString}. ${
        didAnalyseInspireTask
          ? taskOptions.updateBoundaries
            ? `Updates are written into the main DB table and visible in production layers. </p>\n<pre>${summaryTable}</pre>`
            : `Updates are visible in the pending polygons layer. </p>\n<pre>${summaryTable}</pre>`
          : "Stopped before analyseInspire task.</p>"
      }`,
      true,
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
  options: PipelineOptions,
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
 * Resume the latest pipeline run if it's still 'running' in the DB, indicating it was interrupted
 * by something that the app didn't catch e.g. the server was shutdown unexpectedly
 */
export const resumePipelineRunIfInterrupted = async () => {
  const latestPipelineRun = await getLastPipelineRun();
  if (latestPipelineRun?.status === PipelineStatus.Running) {
    await markPipelineRunInterrupted(latestPipelineRun.unique_key);

    const options = { ...latestPipelineRun.options, resume: "true" };
    const pipelineKey = await startPipelineRun(options);

    const msg = `Resuming interrupted pipeline run ${latestPipelineRun.unique_key}, new key is ${pipelineKey}`;
    console.log(msg);
    notifyMatrix(msg);

    initLogger(pipelineKey);
    runPipeline(options);
  } else {
    console.log("No interrupted pipeline run to resume");
  }
};
