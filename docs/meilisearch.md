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

### API endpoint

`GET /api/proprietors`

This endpoint is backed by Meilisearch. When called, it queries the `proprietors` index using the provided `searchTerm` and returns a paginated slice of matching documents. Meilisearch handles fuzzy matching, so partial or misspelled names will still return relevant results.

The flow is:

```
Frontend → LX Backend → GET /api/proprietors → Meilisearch (proprietors index)
```

If the Meilisearch client has not been initialised (e.g. Meilisearch is unavailable at startup), the endpoint returns a 500 error.

Headers:

| Header      | Required | Description                   |
|-------------|----------|-------------------------------|
| `x-api-key` | Yes      | API secret for authentication |

Query parameters:

| Parameter    | Required | Default | Description                              |
|--------------|----------|---------|------------------------------------------|
| `searchTerm` | Yes      | —       | The name (or partial name) to search for |
| `page`       | No       | `1`     | Page number (positive integer)           |
| `pageSize`   | No       | `10`    | Results per page (1–100)                 |

Example request:
```
GET /api/proprietors?searchTerm=Cambri&page=1&pageSize=10
x-api-key: <secret>
```

Example response:
```json
{
  "results": [
    { "id": 1, "proprietorName": "Cambridge Council" }
  ],
  "page": 1,
  "pageSize": 10,
  "totalResults": 3453
}
```

The endpoint supports request abortion - if the client closes the connection, the in-flight
Meilisearch query is cancelled via an `AbortController` signal.
