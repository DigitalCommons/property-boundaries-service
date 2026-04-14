import { createHash } from "crypto";
import chunk from "lodash.chunk";
import { getMeiliClient } from "../../meilisearch/client.js";
import { getDistinctProprietorNames } from "../../queries/proprietor-query.js";
import { logger } from "../logger.js";
import { notifyMatrix } from "../util.js";
import { Settings } from "meilisearch";

const PROPRIETORS_INDEX = "proprietors";
const PROPRIETORS_NEW_INDEX = "proprietors_new";
const BATCH_SIZE = 10000;
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 60000;

export type ProprietorDocument = {
  id: string;
  name: string;
};

/**
 * Derive a consistent ID from a proprietor name using SHA-256.
 * @param name The proprietor name to hash
 * @returns An ID derived from the name
 **/
export function hashName(name: string): string {
  const hex = createHash("sha256").update(name).digest("hex").slice(0, 16);
  return hex;
}

/**
 * Delete an index if it exists, ignoring "index not found" errors.
 * Used for cleaning up the 'new' index before and after the update process, to ensure
 * we don't leave behind stale 'new' indexes after failed runs.
 * @param indexName The name of the index to delete
 * @throws if the deletion operation fails for any reason other than the index not existing (which is not an error for this function)
 **/
export async function deleteIndexIfExists(indexName: string): Promise<void> {
  const client = getMeiliClient();
  const task = await client
    .deleteIndex(indexName)
    .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });

  if (task.status === "succeeded") {
    logger.info(`Deleted Meilisearch index '${indexName}'`);
  } else if (
    task.status === "failed" &&
    task.error?.code === "index_not_found"
  ) {
    logger.info(
      `Meilisearch index '${indexName}' not found for deletion, ignoring`,
    );
  } else {
    throw new Error(
      `Failed to delete index '${indexName}': ${task.status}: error: ${task.error?.message}`,
    );
  }
}

/**
 * Create an index if it doesn't exist. If the index already exists, does nothing.
 * Used for ensuring the live index exists before we attempt to swap into it, and for creating the 'new' index at the start of the update process.
 * @param indexName the index to create
 * @throws if the creation operation fails for any reason other than the index already existing (which is not an error for this function)
 */
export async function createIndexIfNotExists(indexName: string): Promise<void> {
  const client = getMeiliClient();
  const task = await client
    .createIndex(indexName, {
      primaryKey: "id",
    })
    .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });

  if (task.status === "succeeded") {
    logger.info(`Meilisearch index '${indexName}' created successfully`);
  } else if (
    task.status === "failed" &&
    task.error?.code === "index_already_exists"
  ) {
    logger.info(`Meilisearch index '${indexName}' already exists, ignoring`);
  } else {
    throw new Error(
      `Failed to create index '${indexName}': ${task.status}: error: ${task.error?.message}`,
    );
  }
}

/**
 * Swap one index into another
 * Used to swap the 'new' index into the live index at the end of the update process, to make the new data available with minimal downtime.
 * @param indexNameA the index to swap in (the 'new' index with the new data)
 * @param indexNameB the index to swap out (the live index currently in use)
 * @throws if the swap operation fails for any reason, including if either index doesn't exist or if the swap task fails
 **/
export async function swapIndexes(
  indexNameA: string,
  indexNameB: string,
): Promise<void> {
  logger.info(`Swapping '${indexNameA}' into '${indexNameB}'`);

  const client = getMeiliClient();
  const task = await client
    .swapIndexes([{ indexes: [indexNameB, indexNameA], rename: false }])
    .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });

  if (task.status === "succeeded") {
    logger.info("Index swap complete");
  } else {
    throw new Error(
      `Failed to swap '${indexNameA}' into '${indexNameB}': ${task.status}: error: ${task.error?.message}`,
    );
  }
}

/**
 * Insert a batch of proprietor documents into a Meilisearch index
 * @param indexName the index to insert documents into
 * @param documents the proprietor documents to insert
 * @throws if the insertion operation fails for any reason, including if the task fails
 */
export async function batchInsertProprietorDocuments(
  indexName: string,
  documents: ProprietorDocument[],
): Promise<void> {
  const client = getMeiliClient();
  const batches = chunk(documents, BATCH_SIZE);
  logger.info(
    `Inserting ${documents.length} documents in ${batches.length} batch(es)`,
  );

  for (let i = 0; i < batches.length; i++) {
    const task = await client
      .index(indexName)
      .addDocuments(batches[i])
      .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });

    if (task.status === "succeeded") {
      logger.info(
        `Inserted batch ${i + 1}/${
          batches.length
        } of proprietor documents into the ${indexName} index`,
      );
    } else {
      throw new Error(
        `Failed to insert batch ${i + 1}: ${task.status}: error: ${task.error
          ?.message}`,
      );
    }
  }
}

/**
 * Update index settings for a given index.
 * @param indexName the index to update
 * @param settings settings to update the index with
 */
async function updateSettings(
  indexName: string,
  settings: Settings,
): Promise<void> {
  const client = getMeiliClient();

  const task = await client
    .index(indexName)
    .updateSettings(settings)
    .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });
  if (task.status === "succeeded") {
    logger.info(`Updated settings for index '${indexName}' successfully`);
  } else {
    throw new Error(
      `Failed to update settings for index '${indexName}': ${task.status}: error: ${task.error?.message}`,
    );
  }
}

/**
 * Rebuild the Meilisearch proprietors index from the current land_ownerships
 * data. Uses a 'new' index + swap to keep the live index available
 * throughout the process.
 */
export async function updateProprietorsIndex(): Promise<void> {
  if (process.env.MEILISEARCH_ENABLED !== "true") {
    logger.info(
      "MeiliSearch is not enabled, skipping proprietors index update",
    );
    return;
  }
  logger.info("Starting proprietors index update...");
  // Ensure the live index exists (create if absent, so we can swap into it)
  await createIndexIfNotExists(PROPRIETORS_INDEX);

  // Clean up any leftover 'new' index from a previously failed run
  await deleteIndexIfExists(PROPRIETORS_NEW_INDEX);

  // Create the 'new' index
  await createIndexIfNotExists(PROPRIETORS_NEW_INDEX);

  try {
    // Set searchable attributes on 'new' index
    await updateSettings(PROPRIETORS_NEW_INDEX, {
      searchableAttributes: ["name"],
    });

    // Query distinct proprietor names
    const names = await getDistinctProprietorNames();

    // Format into documents with hash-based IDs
    const documents: ProprietorDocument[] = names.map((name) => ({
      id: hashName(name),
      name,
    }));

    // Insert in batches
    await batchInsertProprietorDocuments(PROPRIETORS_NEW_INDEX, documents);

    // Swap the 'new' index into the live index
    await swapIndexes(PROPRIETORS_NEW_INDEX, PROPRIETORS_INDEX);

    // Delete the (now old) 'new' index — it holds the previous live data after swap
    await deleteIndexIfExists(PROPRIETORS_NEW_INDEX);

    logger.info("Proprietors index update completed successfully");

    await notifyMatrix(`✅ Successful update of proprietor index`);
  } catch (err) {
    logger.error(
      err,
      "Proprietors index update failed — cleaning up 'new' index",
    );
    await deleteIndexIfExists(PROPRIETORS_NEW_INDEX);
    throw err;
  }
}
