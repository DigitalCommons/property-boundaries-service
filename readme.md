# Property Boundaries Service

This service manages a database and an API to serve data from the land registry's INSPIRE polygon and company ownership data. The service also has a pipeline that, when run, updates the database with the latest land registry data and backs up old data.

## Requirements

- NodeJS
- MySQL
- [GDAL tools](https://gdal.org/download.html) (includes the `ogr2ogr` command line tool)
- PM2

## Installing and deploying

- Run the `install-remote.sh` script from your local machine to install the application e.g.:

  ```
  bash install-remote.sh -u aubergine root@prod-2.digitalcommons.coop
  ```

  Note that this will only succeed once you have uploaded the GitHub SSH deploy key (explained in the script's output).

- Log into the server and, in the codebase, copy `.env.example` to `.env`.
- Fill in `.env` with the credentials and API keys (in BitWarden or the password-store).
- `bash scripts/deploy.sh` to run the DB migration scripts, build and serve the app with PM2

## Useful dev commands

- `npx sequelize-cli db:migrate:undo:all && npx sequelize-cli db:migrate` to reset database migrations
- `npm run dev:serve` to start the server responding to API requests.
- `npm run build && npm run plot` to plot some of the analysis after a pipeline has run

## Ownerships + INSPIRE updates pipeline

All of the pipeline-related code is in the `src/pipeline` directory. The pipeline can be triggered by an API request like this:

`https://<property boundaries service api url>/run-pipeline?secret=<secret>`

or the pipeline can be started at a specific task (e.g. if you don't want to re-download the INSPIRE data again and just want to analyse the pending polygons):

`https://<property boundaries service api url>/run-pipeline?secret=<secret>&startAtTask=analyseInspire`

The resulting data for a pipeline can be found in the `analysis` folder in the project's root folder, in a directory whose name includes the
pipeline's time and unique key.

## TODO

- Address the various 'TODO' comments around the codebase

- Fully spec the behaviour of the pipeline, in particular the matching algorithm for INSPIRE
  polygons, then add unit tests to match this spec

  - Use Mocha for writing a specification and tests, like we have started to do on the [Land Explorer backend](https://github.com/DigitalCommons/land-explorer-front-end/wiki/Testing#unit-tests)
  - Add these tests to a Github CI pipeline, like on LX backend
  - We'll need to modularise some of the long functions in the pipeline a bit more (e.g. the `comparePolygons` function) to make unit testing easier

- Add analytics and do profiling to find where bottlenecks are in analysis script, so they can be optimised. The script takes far too long currently - around 30 mins per council.

- Add some docs to `/docs` to give a high-level overview of what the pipeline is doing. But wherever possible,
  especially for low-level details, prefer Mocha specs over written
  documentation. Docs can be ignored but specs with unit tests can't.

- Create an admin panel, maybe with a library like `react-admin`, so that we can easily search through our DB and visualise the results of pipelines. It would be great if pipelines created visualisations of some of the changed polygons, which could then be viewed in the admin panel, including:

  - a sample of successful matches (for quality control)
  - the full set of failed matches, which will indicate ways to improve the algorithm going forwards

- Enable strict Typescript checking in tsconfig.json and fixup existing checking failures.
