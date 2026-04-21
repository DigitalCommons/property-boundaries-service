## Meilisearch

[Meilisearch](https://www.meilisearch.com/) is used for fuzzy searching of proprietors.

### Local Docker Setup
1. Ensure Docker is installed and is running
2. Run `docker compose up -d`

This starts the Meilisearch container on port 7700. The web dashboard is available at
`http://localhost:7700` - use the value of `MEILI_MASTER_KEY` from your `.env` to authenticate.

Data is stored in a named Docker volume (`meilisearch_data`) and persists across container restarts.

### Deployed Docker Setup

Meilisearch runs on the same servers as the property boundaries service - dev-2, staging-2, and prod-2. It is deployed as a Docker container via the Ansible playbook in the `technology-and-infrastructure` repo.

The `MEILI_MASTER_KEY` for each environment is stored in the password store and is passed to the container by the Ansible playbook. 

Unlike the local setup, deployed instances run with `MEILI_ENV=production`, which disables the web dashboard and requires authentication for all API calls.

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
{ "id": "a1b2c3d4e5f60718", "name": "Some Company Ltd" }
```

The `id` is the first 16 hex characters of a SHA-256 hash of the name, so it is consistent across pipeline runs.

#### Updating the index

The proprietors index is rebuilt automatically at the end of each full pipeline run (`updateProprietors` task). The process is:

1. Ensure the live `proprietors` index exists (create it if not).
2. Delete any leftover `proprietors_new` index from a previous failed run.
3. Create `proprietors_new` and configure its settings.
4. Query all distinct proprietor names from `land_ownerships` and insert them into `proprietors_new` in batches of 10,000.
5. Swap `proprietors_new` into `proprietors` - the live index is never taken offline.
6. Delete `proprietors_new`.

If anything fails, `proprietors_new` is cleaned up and the live `proprietors` index is left untouched.

#### Refreshing the index standalone

To rebuild the proprietors index without running the full pipeline, pass `startAtTask=updateProprietors` to the `/run-pipeline` endpoint (currently there is no endOfTask parameter needed as this is the last task in the list but double check this):

```
GET /run-pipeline?secret=<SECRET>&startAtTask=updateProprietors
```

This starts from the `updateProprietors` task only, using the existing data already in `land_ownerships`.

### API endpoint

`GET /api/proprietors`

This endpoint is backed by Meilisearch. When called, it queries the `proprietors` index using the provided `searchTerm` and returns a paginated slice of matching documents. Meilisearch handles fuzzy matching, so partial or misspelled names will still return relevant results.

The flow is:

```
Frontend → LX Backend → GET /api/proprietors → Meilisearch (proprietors index)
```

If the Meilisearch client has not been initialised (e.g. Meilisearch is unavailable at startup), the endpoint returns a 500 error.

Query parameters:

| Parameter    | Required | Default | Description                              |
|--------------|----------|---------|------------------------------------------|
| `searchTerm` | Yes      | —       | The name (or partial name) to search for |
| `page`       | No       | `1`     | Page number (positive integer)           |
| `pageSize`   | No       | `10`    | Results per page (1–100)                 |
| `secret`     | Yes      | —       | API secret for authentication            |

Example request:
```
GET /api/proprietors?searchTerm=Cambri&page=1&pageSize=10&secret=<secret>
```

Example response:
```json
{
  "results": [
    { "id": "a1b2c3d4e5f60718", "proprietorName": "Cambridge Council" }
  ],
  "page": 1,
  "pageSize": 10,
  "totalResults": 3453
}
```

The endpoint supports request abortion - if the client closes the connection, the in-flight
Meilisearch query is cancelled via an `AbortController` signal.
