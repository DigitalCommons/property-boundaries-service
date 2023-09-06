# Property Boundaries Service

This service manages a database and an api to serve data from the land registry's polygon and company ownership data. It uses mysql and typescript.

## Installation

 - `npm install` to install the required packages.
 - Copy `.env.example` and rename the copy to `.env`.
 - Fill in the `.env` with the database credentials and government gateway api key.
 - `npx sequelize-cli db:migrate` to run the migration scripts that create the tables of the database.

 ## Running

 - `npx tsc` to transpile the typescript code into javascript in the `/dist` folder.
 - `npm run generate` to download the polygon and company data and store it in the database.
 - `npm start` to start the server responding to api requests.