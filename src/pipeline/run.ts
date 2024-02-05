import "dotenv/config";
import axios from "axios";
import { hostname } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { startPipelineRun } from "../queries/query";
import { updateOwnerships } from "./ownerships/update";
import { downloadGeoJsonPolygons } from "./inspire/download";
import { analyseAllGeoJSONs } from "./inspire/analyse-all";

const matrixWebhookUrl = process.env.MATRIX_WEBHOOK_URL;

/** Set flag so we don't run 2 pipelines at the same time, which would lead to file conflicts */
let running = false;

/**
 * This is the main function to run our company ownerships + INSPIRE pipeline.
 */
const runPipeline = async (uniqueKey: string) => {
  running = true;

  try {
    await updateOwnerships(uniqueKey);

    await downloadGeoJsonPolygons(1);

    backupInspireDownloads(); // don't await, let it run in background

    // Run our matching algorithm on the new INSPIRE data
    const summaryTable = await analyseAllGeoJSONs(uniqueKey, false, 1, 100);

    running = false;

    // Notify Matrix
    if (matrixWebhookUrl) {
      await axios.post(matrixWebhookUrl, {
        msgtype: "m.text",
        body: `[${hostname()}] [property_boundaries] ✅ Successful ownership + INSPIRE pipeline ${uniqueKey}\n\n${summaryTable}`,
      });
    }
  } catch (err) {
    console.error("Pipeline failed", err);
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
const backupInspireDownloads = async () => {
  const command = "bash scripts/backup-inspire-downloads.sh";
  console.log(`Running '${command}'`);
  const { stdout, stderr } = await promisify(exec)(command);
  console.log("raw INSPIRE backup script stdout:", stdout);
  console.log("raw INSPIRE backup script stderr:", stderr);
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
