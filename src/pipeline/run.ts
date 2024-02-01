import "dotenv/config";
import { startPipelineRun } from "../queries/query";
import { updateOwnerships } from "./ownerships/update";

/**
 * This is the main function to run our company ownerships + INSPIRE pipeline.
 *
 */
export const runPipeline = async () => {
  const uniqueKey = await startPipelineRun();

  updateOwnerships(uniqueKey);

  // download latest inspire data

  // Test that the new data looks okay (e.g. add at least a basic sanity check that the new data isn't corrupted or empty)

  // backup the latest inspire data to our Hetzner storage box

  // run our matching algorithm on the new data
};

runPipeline();
