#!/usr/bin/env bash

# This script downloads the latest INSPIRE data backup from our Hetzner storage box (as zip files
# for each council). This is useful for re-running the pipeline on the latest data after the month
# has passed, for example if the gov Land Reg website has stopped working.
# 
# It prints to stdout the month of the latest backup in the format YYYY-MM.

set -e

# Download the latest INSPIRE data from our storage box
if [ -z "$REMOTE_BACKUP_DESTINATION_PATH" ]; then
  echo "REMOTE_BACKUP_DESTINATION_PATH environment variable not set"
  exit 1
fi
server_dest="${REMOTE_BACKUP_DESTINATION_PATH%%:*}"
backups_path="${REMOTE_BACKUP_DESTINATION_PATH#*:}"
downloads_dir="downloads"
mkdir -p "$downloads_dir"

month=$(ssh -p${REMOTE_BACKUP_SSH_PORT:-22} -o StrictHostKeyChecking=no $server_dest "ls $backups_path" | xargs -n 1 | tail -n 1)
rsync -a -e "ssh -p${REMOTE_BACKUP_SSH_PORT:-22} -o StrictHostKeyChecking=no" $REMOTE_BACKUP_DESTINATION_PATH/$month $downloads_dir

# Print the month of the latest backup
echo "$month"
