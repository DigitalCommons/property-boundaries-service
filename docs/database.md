# The Database

We use MySQL, currently on version 8.0.41.

There are the tables in our database:

- `land_ownerships` -
  each row is a title register i.e. the ownership info of a freehold and leasehold
- `land_ownership_polygons` -
  each row gives the geometry of a land boundary for a registered property polygon, and possibly a
  title no, which will link it to the above table with a many-to-one relationship (polygons-to-title).
- `pipeline-runs` -
  each row provides details of a run of the pipeline, indicating its start time, status and progress.
- `pending-inspire-polygons` - 
  this is where pending geometries of newly downloaded INSPIRE polys are stored, then each one is
  analysed by the pipeline algorithm and marked as accepted or failed. Eventually they are written
  into the main `land_ownerships` table
- `pending-polygon-deletions` -
  a list of INSPIRE IDs that are marked for deletion by the pipeline algorithm. Currently this is not
  used, but would be used if e.g. 2 INSPIRE polygons have merged and we want to delete one of the old
  polygons that no longer exists.
- `unregistered_land` -
  each row has the geometry of a polygon boundary for a piece of unregistered land
- `england_and_wales` -
  this is a temporary table, created once for one-time unregistered land initialisation script, so
  doesn't have a Sequelize migration
- `os_land_polys` -
  this is a table used in the one-time unregistered land initialisation script

View the `migrations` folder to see their full definitions.

You can find more background on how the data relates to the real world in [pipeline.md](./pipeline.md#overview-of-the-data).

## Backups

At DCC, we use [Borgmatic](https://torsion.org/borgmatic){target="\_blank"} (powered by [Borg](https://www.borgbackup.org){target="\_blank"}) to handle our database backups. This is configured by our DCC [Ansible scripts](https://github.com/DigitalCommons/technology-and-infrastructure/tree/master/ansible){target="\_blank"}.

A backup of the production database is scheduled to run on the 8th night of each month (to ensure it's after the month's INSPIRE data has been published on the first Sunday of the month). Borg archives are kept in
a remote storage box, and also the latest archive is stored locally on each server (prod-2, staging-2 and dev-2)
for ease of restoration in an emergency.

To avoid getting into too many details here that
are specific to our DCC infrastructure, see [this GitHub comment](https://github.com/DigitalCommons/technology-and-infrastructure/issues/116#issuecomment-2163420776){target="\_blank"} for the full picture.

### How to restore

On any of prod-2, staging-2 and dev-2, to rollback the database to the latest Borg archive, which is kept locally on each server, you can run `npm run rollback-db`. This will run the script that our Ansible setup scripts should have
installed in `~/.local/bin/borgmatic/rollback-$DB_NAME.sh`.

If you are using this application in a non-DCC setup, you can save your own `rollback-$DB_NAME.sh` script
to this location.
