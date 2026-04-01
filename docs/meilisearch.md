## Meilisearch

[Meilisearch](https://www.meilisearch.com/) is used for fuzzy searching of proprietors.

### Local Docker Setup
1. Ensure Docker is installed and is running
2. Run `docker compose up -d`

This starts the Meilisearch container on port 7700. The web dashboard is available at
`http://localhost:7700` - use the value of `MEILI_MASTER_KEY` from your `.env` to authenticate.

Data is stored in a named Docker volume (`meilisearch_data`) and persists across container restarts.

### Client
The Meilisearch client is initialised in the `start()` method of `app.ts`. It connects to Meilisearch using the master key, retrieves the auto-generated 'Default Admin API Key', and uses this key to set up the client for backend queries.

If Meilisearch initialisation fails, the application logs the error and continues running. This prevents the app from failing entirely due to Meilisearch issues, allowing the frontend to display an error when fuzzy searching is unavailable

To use this client, call
```
getMeiliClient();
```
from `src/meilisearch/client.js`

### Proprietors index

The `proprietors` Meilisearch index holds all distinct proprietor names from the `land_ownerships` table and is used for fuzzy proprietor search.

Each document has the shape:
```json
{ "id": 123456789, "name": "Some Company Ltd" }
```

The `id` is derived from a SHA-256 hash of the name, so it is consistent across pipeline runs.

#### Updating the index

The proprietors index is rebuilt automatically at the end of each full pipeline run (`updateProprietors` task). The process is:

1. Ensure the live `proprietors` index exists (create it if not).
2. Delete any leftover `proprietors_temp` index from a previous failed run.
3. Create `proprietors_temp` and configure its settings.
4. Query all distinct proprietor names from `land_ownerships` and insert them into `proprietors_temp` in batches of 10,000.
5. Swap `proprietors_temp` into `proprietors` — the live index is never taken offline.
6. Delete `proprietors_temp`.

If anything fails, `proprietors_temp` is cleaned up and the live `proprietors` index is left untouched.

#### Refreshing the index standalone

To rebuild the proprietors index without running the full pipeline, pass `startAtTask=updateProprietors` to the `/run-pipeline` endpoint (currently there is no endOfTask parameter needed as this is the last task in the list but double check this):

```
GET /run-pipeline?secret=<SECRET>&startAtTask=updateProprietors
```

This starts from the `updateProprietors` task only, using the existing data already in `land_ownerships`.
