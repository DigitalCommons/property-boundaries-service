# Intro

Welcome to the Property Boundaries Service documentaion!

## What you need to know as a new developer

### How is the PBS used?

The PBS serves data to the LandExplorer app's 'Land Ownership' layers. The [LX User
guide](https://digital-commons.gitbook.io/landexplorer-user-guide/functionality/cog-menu/land-ownership)
explains how to use the layer in more detail.

### Where does the property data come from?

To get an overview of the data we handle, and how it gets updated by the Ownerships + INSPIRE
pipeline, see [pipeline.md](./pipeline.md).

### Useful dev commands

- `npx sequelize-cli db:migrate` to run new database migration(s)
- `npx sequelize-cli db:migrate:undo:all` to reset database migrations
- `npm run dev:serve` to start the server responding to API requests.
- `npm run build && npm run plot` to plot some of the analysis after a pipeline has run

### Troubleshooting

_Please add to this list as you encounter problems during development._

#### Pipeline fails with "Unable to find driver `MySQL'" error

In the `downloadInspire` task of the pipeline, transforming GML data and inserting it into MySQL
step doesn't work on MacOS (and maybe Windows?) since the GDAL ogr2ogr MySQL driver isn't supported.
I couldn't work out how to get this to work, but it works find on the Linux install. Therefore, testing
of this part of the pipeline must be done on the dev server.

You can dump (some of) the `pending_inspire_polygons` DB table from the server and import this on your
local machine in order to test the `analyseInspire` task locally.

#### Out of memory errors (OOMEs)

There's a helpful guide here on how to assess memory leaks in Node https://stackoverflow.com/a/66563755

Some useful Node arguments are `--heap-prof` or `--heapsnapshot-near-heap-limit` to produce heap
dumps, and then viewing these dumps in your local browser's dev tools.

#### The whole database has been messed up by some bad pipeline code 😱

Ideally, this should only happen on dev-2 where you're testing new code, but may happen on staging
or prod too.

Our Borg backup process automatically creates archives each month of the prod-2 database and stores
a copy on the Hetzner storage box and also locally on each of prod-2 (itself), staging-2 and dev-2.

You can rollback the database to the state of this latest archive by running the following script on
the server (as the PBS app user):

```
screen -m -d -S rollback-property_boundaries ~/.local/bin/borgmatic/rollback-property_boundaries.sh &
```

The `screen` command is used to run the rollback in a detached screen session since it may take a
while to complete.
