# Property Boundaries Service

This service manages a database and an API to serve data from the land registry's INSPIRE polygon and company ownership data. The service also has a pipeline that, when run, updates the database with the latest land registry data and backs up old data.

## Requirements

- NodeJS
- MySQL
- [GDAL tools](https://gdal.org/download.html) (includes the `ogr2ogr` command line tool)
- PM2

## Installing and deploying

See [docs/deployment.md](docs/deployment.md).

## Useful dev commands

- `npx sequelize-cli db:migrate:undo:all && npx sequelize-cli db:migrate` to reset database migrations
- `npm run dev:serve` to start the server responding to API requests.
- `npm run build && npm run plot` to plot some of the analysis after a pipeline has run

## Ownerships + INSPIRE updates pipeline

All of the pipeline-related code is in the `src/pipeline` directory. The pipeline can be triggered by an API request like this:

`https://<property boundaries service api url>/run-pipeline?secret=<secret>`

or the pipeline can be started with additional options (see PipelineOptions for details), e.g.:

`https://<property boundaries service api url>/run-pipeline?secret=<secret>&startAtTask=analyseInspire&updateBoundaries=true`

## Analysing the output

A pipeline always updates the Land Ownership data (this is the fast, easy bit of the pipeline). Once the `updateOwnerships` task is complete, the new data should be visible in LX for all users.

After the `downloadOwnerships` task, a LX super user can see the pending INSPIRE polygons that have been downloaded in a separate, secret data layer.

If the `updateBoundaries` param is true, the `analyseInspire` task will write the pending polygons that are accepted as a successful match into the DB, so that they're visible for all users. Further detailed output for the pipeline can be found in the `analysis` folder in the project's root folder. This output can help you manually investigate something further e.g. if you want to investigate a failed match:

- find the details in `failed-matches.json` and copy a lat-lng of a vertex
- login to LX as a super user (to become a super user, update your record in MySQL on the server)
- enable the Pending Polygons data layer
- search for the lat-lng in the LX search bar, then click on nearby properties to visualise the polygon(s) involved
