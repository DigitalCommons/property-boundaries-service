# Property Boundaries Service

This service manages a database and an API to serve data from the land registry's INSPIRE polygon and company ownership data. The service also has a pipeline that, when run, updates the database with the latest land registry data and backs up old data.

## Requirements

- Nodejs
- MySQL
- [GDAL tools](https://gdal.org/download.html) (includes the `ogr2ogr` command line tool)
- PM2 (for running in production)
- Nodemon (for running in development)

## Installation

- `npm install` to install the required packages.
- Copy `.env.example` and rename the copy to `.env`.
- Fill in the `.env` with the database credentials and government gateway api key (in Bitwarden).
- `npx sequelize-cli db:migrate` to run the migration scripts that create the tables of the database.

## Running

- `npm run build` to transpile the typescript code into javascript in the `/dist` folder.
- `npm run download` to download the INSPIRE data for each council, transform it to GeoJSON, and store the JSON files in the `/geojson` folder.
- `npm run analyse` to run the analysis script.
- `npm run plot` to plot the results of the analysis script.
- `npm run serve` or `npm run dev:serve` to start the server responding to api requests.

## Useful dev commands

- `npx sequelize-cli db:migrate:undo:all` to reset database migrations

## Ownerships + INSPIRE updates pipeline

All of the pipeline-related code is in the `src/pipeline` directory. The pipeline can be triggered by a `run-pipeline` GET request.
The resulting data for a pipeline can be found in the `analysis` folder in the project's root folder, in a directory whose name includes the
pipeline's time and unique key.

## TODO

- Address the various 'TODO' comments around the codebase

- Query local DB rather than making HTTP requests to a live server. This will greatly increase the speed of the INSPIRE updates. But we maybe need to make a new DB table for 'pending polygons' which replaces the polygons table (or inserts without deleting polygons that no longer exist?) after all the changes have been processed.

- Use a logging library (e.g. Winston) to log the results of pipelines into a dedicated file for
  each pipeline run. This will give us more control than piping to files using shell commands.

- Fully spec the behaviour of the pipeline, in particular the matching algorithm for INSPIRE
  polygons, then add unit tests to match this spec

  - Use Mocha for writing a specification and tests, like we have started to do on the [Land Explorer backend](https://github.com/DigitalCommons/land-explorer-front-end/wiki/Testing#unit-tests)
  - Add these tests to a Github CI pipeline, like on LX backend
  - We'll need to modularise some of the long functions in the pipeline a bit more (e.g. the `comparePolygons` function) to make unit testing easier

- Add some docs to `/docs` to give a high-level overview of what the pipeline is doing. But wherever possible,
  especially for low-level details, prefer Mocha specs over written
  documentation. Docs can be ignored but unit tests can't.
- Create an admin panel, maybe with a library like `react-admin`, so that we can easily search through our DB and visualise the results of pipelines. It would be great if pipelines created visualisations of some of the changed polygons, which could then be viewed in the admin panel, including:

  - a sample of successful matches (for quality control)
  - the full set of failed matches, which will indicate ways to improve the algorithm going forwards

- Enable strict Typescript checking in tsconfig.json
