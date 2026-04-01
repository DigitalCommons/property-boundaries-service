import { createHash } from "crypto";
import chunk from "lodash.chunk";
import { getMeiliClient } from "../../meilisearch/client.js";
import { getDistinctProprietorNames } from "../../queries/proprietor-query.js";
import { logger } from "../logger.js";
import { notifyMatrix } from "../util.js";

const PROPRIETORS_INDEX = "proprietors";
const PROPRIETORS_TEMP_INDEX = "proprietors_temp";
const BATCH_SIZE = 10000;
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 60000;

type ProprietorDocument = {
  id: number;
  name: string;
};

/**
 * Derive a consistent numeric ID from a proprietor name using SHA-256.
 * @param name The proprietor name to hash
 * @returns A numeric ID derived from the name
 **/
const hashName = (name: string): number => {
  const hex = createHash("sha256").update(name).digest("hex").slice(0, 12);
  return parseInt(hex, 16);
};

/**
 * Delete an index if it exists, ignoring "index not found" errors.
 * Used for cleaning up the temp index before and after the update process, to ensure
 * we don't leave behind stale temp indexes after failed runs.
 * @param indexName The name of the index to delete
 **/
async function deleteIndexIfExists(indexName: string): Promise<void> {
  const client = getMeiliClient();
  const task = await client
    .deleteIndex(indexName)
    .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });

  if (task.status === "canceled") {
    logger.info(`Deletion of Meilisearch index '${indexName}' was cancelled`);
  } else if (
    task.status === "failed" &&
    task.error?.code === "index_not_found"
  ) {
    logger.info(
      `Meilisearch index '${indexName}' not found for deletion, ignoring`,
    );
  } else if (task.status !== "succeeded") {
    throw new Error(
      `Failed to delete index '${indexName}': ${task.status}: error: ${task.error?.message}`,
    );
  } else {
    logger.info(`Deleted Meilisearch index '${indexName}'`);
  }
}

/**
 * Create an index if it doesn't exist. If the index already exists, does nothing.
 * Used for ensuring the live index exists before we attempt to swap into it, and for creating the temp index at the start of the update process.
 * @param indexName the index to create
 */
async function createIndexIfNotExists(indexName: string): Promise<void> {
  const client = getMeiliClient();
  try {
    const index = await client.getIndex(indexName);
    logger.debug(`Meilisearch index '${index}' already exists`);
  } catch (err: any) {
    if (err?.cause?.code === "index_not_found") {
      logger.info(
        `Index '${indexName}' does not exist — creating '${indexName}'`,
      );
      const task = await client
        .createIndex(indexName, {
          primaryKey: "id",
        })
        .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });

      if (task.status === "canceled") {
        logger.info(`Creation of index '${indexName}' was cancelled`);
      } else if (task.status !== "succeeded") {
        throw new Error(
          `Failed to create index '${indexName}': ${task.status}: error: ${task.error?.message}`,
        );
      }
    } else {
      throw err;
    }
  }
}

/**
 * Swap one index into another
 * Used to swap the temp index into the live index at the end of the update process, to make the new data available with minimal downtime.
 **/
async function swapIndexes(
  indexNameA: string,
  indexNameB: string,
): Promise<void> {
  logger.info(`Swapping '${indexNameA}' into '${indexNameB}'`);

  const client = getMeiliClient();
  const task = await client
    .swapIndexes([{ indexes: [indexNameB, indexNameA], rename: false }])
    .waitTask({ interval: POLL_INTERVAL_MS, timeout: POLL_TIMEOUT_MS });

  if (task.status === "canceled") {
    logger.info(`Swap of '${indexNameA}' into '${indexNameB}' was cancelled`);
  } else if (task.status !== "succeeded") {
    throw new Error(
      `Failed to swap '${indexNameA}' into '${indexNameB}': ${task.status}: error: ${task.error?.message}`,
    );
  }
  logger.info("Index swap complete");
}

async function batchInsertProprietorDocuments(
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

    if (task.status === "canceled") {
      logger.info(`Insertion of batch ${i + 1} was cancelled`);
    } else if (task.status !== "succeeded") {
      throw new Error(
        `Failed to insert batch ${i + 1}: ${task.status}: error: ${task.error
          ?.message}`,
      );
    }

    logger.info(
      `Inserted batch ${i + 1}/${
        batches.length
      } of proprietor documents into the ${indexName} index`,
    );
  }
}
/**
 * Rebuild the Meilisearch proprietors index from the current land_ownerships
 * data. Uses a temporary index + swap to keep the live index available
 * throughout the process.
 */
export async function updateProprietorsIndex(): Promise<void> {
  const client = getMeiliClient();

  // Ensure the live index exists (create if absent, so we can swap into it)
  await createIndexIfNotExists(PROPRIETORS_INDEX);

  // Clean up any leftover temp index from a previously failed run
  await deleteIndexIfExists(PROPRIETORS_TEMP_INDEX);

  // Create the temporary index
  await createIndexIfNotExists(PROPRIETORS_TEMP_INDEX);

  // Set searchable attributes on temp index
  await client.index(PROPRIETORS_TEMP_INDEX).updateSettings({
    searchableAttributes: ["name"],
  });

  try {
    // Query distinct proprietor names
    logger.info("Querying distinct proprietor names from land_ownerships");
    const names = await getDistinctProprietorNames();
    logger.info(`Found ${names.length} distinct proprietor names`);

    // Format into documents with hash-based IDs
    const documents: ProprietorDocument[] = names.map((name) => ({
      id: hashName(name),
      name,
    }));

    // Insert in batches
    await batchInsertProprietorDocuments(PROPRIETORS_TEMP_INDEX, documents);

    // Swap temp index into the live index
    await swapIndexes(PROPRIETORS_TEMP_INDEX, PROPRIETORS_INDEX);

    // Delete the (now old) temp index — it holds the previous live data after swap
    await deleteIndexIfExists(PROPRIETORS_TEMP_INDEX);

    logger.info("Proprietors index update complete");

    await notifyMatrix(`✅ Successful update of proprietor index`);
  } catch (err) {
    logger.error(
      err,
      "Proprietors index update failed — cleaning up temp index",
    );
    await deleteIndexIfExists(PROPRIETORS_TEMP_INDEX);
    throw err;
  }
}
