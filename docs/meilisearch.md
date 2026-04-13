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
