# Intro

Welcome to the Property Boundaries Service documentaion!

Here are some things you should know as a new developer.

## How is the PBS used?

The PBS serves data to the LandExplorer app's 'Land Ownership' layers. The [LX User
guide](https://digital-commons.gitbook.io/landexplorer-user-guide/functionality/cog-menu/land-ownership)
explains how to use the layer in more detail.

## Where does the property data come from?

To get an overview of the data we handle, and how it gets updated by the Ownerships + INSPIRE
pipeline, see [pipeline.md](./pipeline.md).

## Useful dev commands

- `npx sequelize-cli db:migrate` to run new database migration(s)
- `npx sequelize-cli db:migrate:undo:all` to reset database migrations
- `npm run dev:serve` to start the server responding to API requests.
- `npm run build && npm run plot` to plot some of the analysis after a pipeline has run

## Troubleshooting

### General tips

There are a few places to look for diagnostics to help you if something has gone wrong e.g. if you
received Matrix notifications to the devops channel that the pipeline failed or the server went down.

- The `property-boundaries-service/logs` folder on the server has a record of the logs from past
  pipelines. You can identify files by the pipeline ID an its start time, which are in the filename.
  There will hopefully be an error log at the end of the file, indicating something went wrong
- You can also check the last 100 pm2 error logs by running `pm2 logs --err --lines 100`. These are
  the logs that are sent stderr (with `console.error` in the code)
- If there still isn't much info, you might find more in the logs for the systemd service that's
  running pm2 by running `journalctl --user -u pm2.service` (note this is specific to our DCC deployment).
  Often this is where OOMEs will show up - see below for how to further debug these.
- If you still don't have any explanation, maybe the whole server rebooted unexpectedly - you can check
  this with `journalctl -u systemd-shutdown` (these last up to a month), or `last reboot`.

### Known errors

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

If you stop the app (`pm2 stop property-boundaries-service`) and restart it with `npm run debug:serve`,
the app will run with the `--heapsnapshot-near-heap-limit` Node argument. This reduces the max heap
limit for debug purposes and will try to produce 2 heap dumps when the heap usage is approaching the
limit. You can then download these dump files to your local machine and view them in your browser's dev tools.

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
