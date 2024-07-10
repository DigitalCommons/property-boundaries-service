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

## TODO (roughly in priority order)

- Step back and think about what we want the pipeline to achieve, and what info we want to try to save as boundaries gradually change. Prioritise and try to narrow the scope. And think about whether we need any other data sources to achieve this.

- Add analytics and do profiling to find where the bottlenecks are in analysis script, so they can be optimised. The script takes far too long currently - around 30 mins per council. Also decide which bits of the algorithm are most needed and remove some computation that isn't necessary. And allow pipelines to resume automatically if something goes wrong e.g. the server reboots, which is fairly likely since the pipeline is going to take a long time even if we optimise it really well (it's processing a huge amount of data!)

- Fully spec the behaviour of the pipeline, in particular the matching algorithm for INSPIRE
  polygons, then add unit tests to match this spec

  - Mocha is set up for this. I made a methods.test.ts file, using GitHub Copilot, inspired by the [Land Explorer backend](https://github.com/DigitalCommons/land-explorer-front-end/wiki/Testing#unit-tests)
  - Add these tests to a Github CI pipeline, like on LX backend
  - We'll need to modularise some of the long functions in the pipeline a bit more (e.g. the `comparePolygons` function) to make unit testing easier
  - Maybe we need to plot some different polygon scenarios that can be visualised and used for different edge cases.

- Address the various 'TODO' comments around the codebase

- Add some docs to `/docs` to give a high-level overview of what the pipeline is doing. But wherever possible,
  especially for low-level details, prefer Mocha specs over written
  documentation. Docs can be ignored but specs with unit tests can't.

- Improve how the results of the analysis can be understood/visualised. It's currently a lot of data, and it's hard to know which matches to check individually.

- Enable strict Typescript checking in tsconfig.json and fixup existing checking failures. Use more modern Sequelize definitions so that we get types https://sequelize.org/docs/v7/models/defining-models/
