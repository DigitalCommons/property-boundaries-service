# Property Boundaries Service

This service manages a database and an API to serve data that was taken from the Land Registry's INSPIRE polygon and company ownership datasets. The service also has a pipeline that, when run, updates the database with the latest Land Registry data and backs up old data.

## Documenation

You can find the full documentation for the Property Boundaries Service, including how to install,
[here](https://digitalcommons.github.io/property-boundaries-service/).

## Useful dev commands

- `npx sequelize-cli db:migrate:undo:all && npx sequelize-cli db:migrate` to reset database migrations
- `npm run dev:serve` to start the server responding to API requests.
- `npm run build && npm run plot` to plot some of the analysis after a pipeline has run
