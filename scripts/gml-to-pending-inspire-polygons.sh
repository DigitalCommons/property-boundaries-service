#!/usr/bin/env bash

# This script requires 2 arguments:
#  1. the GML filename containing INSPIRE data
#  2. name of the council
#
# It inserts all of the features in the GML file into the pending_inspire_polygons MySQL DB table,
# with the EPSG:4326 projection (the standard GPS projection used by GeoJSON and in our DB), using
# the GDAL ogrinfo and ogr2ogr tools.

set -e
set -x

# Some INSPIRE council GML files have no features, so we need to check for this
if grep -q 'numberMatched="0"' "$1"; then
  echo "No features in $1 , exiting"
  exit 0
fi

# Remove the schemaLocation attribute from the GML file, since GDAL tries to load it for some reason
# and it takes a long time
sed -i -e '0,/ xsi:schemaLocation="[^"]*"/ s///' "$1"

# Delete temp sqlite file if it exists
rm -f temp.sqlite

# Convert the GML file to a SQLite database so we can manipulate the data
ogr2ogr -f SQLite -skipfailures -nln polygons temp.sqlite $1

# Add a council column
ogrinfo temp.sqlite -sql "ALTER TABLE polygons ADD COLUMN council varchar(255)"
ogrinfo temp.sqlite -sql "UPDATE polygons SET council = \"$2\""

# Delete existing pending polygons for this council, in case we are re-running after a failure
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "DELETE FROM pending_inspire_polygons WHERE council = \"$2\""

# Import the data into the pending_inspire_polygons table
# Use GROUP BY to remove duplicate features in dataset with the same poly_id [removed, may need to re-add if an issue]
# TODO: add -xyRes "0.0000001 deg" to round to 6 d.p., but this is only supported in GDAL 3.9+
ogr2ogr -f MySQL -append -skipfailures -nln pending_inspire_polygons -t_srs EPSG:4326 \
  "MySQL:$DB_NAME,user=$DB_USER,password=$DB_PASSWORD" temp.sqlite -unsetFid \
  -sql 'SELECT INSPIREID AS poly_id, geometry AS geom, council FROM polygons'

# Delete the temp sqlite file
rm temp.sqlite
