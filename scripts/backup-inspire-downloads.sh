#!/usr/bin/env bash

# Run this script to upload the raw INSPIRE zip files in downloads/ to our Hetzner storage box.

onError() {
  if [ -z "$MATRIX_WEBHOOK_URL" ]; then
    echo 'Error! Exiting...'
  else
    echo 'Error! Notifying Matrix webhook and exiting...'
    curl -X POST -H 'Content-type: application/json' \
      --data '{"msgtype":"m.text", "body":"['$HOSTNAME'] [property_boundaries] 🔴 Backup of raw INSPIRE data failed"}' \
      $MATRIX_WEBHOOK_URL
  fi
}

trap 'onError' ERR

HOSTNAME=$(hostname)

# Upload only the zip files (i.e. the raw files downloaded from the INSPIRE website)
rsync -e 'ssh -p23' --recursive --prune-empty-dirs --include="*/" --include="*.zip" --exclude="*" downloads/ $REMOTE_BACKUP_DESTINATION_PATH

if [ -z "$MATRIX_WEBHOOK_URL" ]; then
    echo 'Success!'
else
  echo 'Notifying Matrix webhook of success...'
  curl -X POST -H 'Content-type: application/json' \
    --data '{"msgtype":"m.text", "body":"['$HOSTNAME'] [property_boundaries] ✅ Successful backup of raw INSPIRE data"}' \
    $MATRIX_WEBHOOK_URL
fi

