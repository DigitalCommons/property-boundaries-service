import { MeiliSearch } from "meilisearch";
import { logger } from "../pipeline/logger.js";

const DEFAULT_ADMIN_KEY_NAME = "Default Admin API Key";

let meiliClient: MeiliSearch | null = null;

export async function initMeiliSearch(): Promise<void> {
  logger.info("Initialising MeiliSearch client...");
  const masterClient = new MeiliSearch({
    host: process.env.MEILI_HOST,
    apiKey: process.env.MEILI_MASTER_KEY,
  });

  logger.info("Getting MeiliSearch admin key");
  const { results } = await masterClient.getKeys();
  const adminKey = results.find((k) => k.name === DEFAULT_ADMIN_KEY_NAME)?.key;

  if (!adminKey) throw new Error("Meilisearch admin key not found");

  meiliClient = new MeiliSearch({
    host: process.env.MEILI_HOST,
    apiKey: adminKey,
  });

  // health check to confirm connection is working
  const healthy = await meiliClient.isHealthy();
  if (!healthy) throw new Error("MeiliSearch is not healthy");

  logger.info("Successfully initialised MeiliSearch client");
}

export function getMeiliClient(): MeiliSearch {
  if (!meiliClient) {
    throw new Error("MeiliSearch client not initialised");
  }
  return meiliClient;
}
