# Property Boundaries Service

This service manages a database and an api to serve data from the land registry's polygon and company ownership data. It uses mysql and typescript.

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
- `npm run generate` to download the polygon and company data and store it in the database.
- `npm run analyse` to run the analysis script.
- `npm run plot` to plot the results of the analysis script.
- `npm serve` or `npm dev:serve` to start the server responding to api requests.

## Database Migration

- `npx sequelize-cli db:migrate:undo:all` to reset migration
