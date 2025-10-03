#!/usr/bin/env bash

# This script restores the app's MySQL database in back to the state of the latest archive in the
# local Borg repo, by calling the rollback script that was installed by Ansible.
# 
# It also sets the last pipeline_runs entry to status = 0 (stopped), to avoid any weird behaviour,
# such as an old interrupted pipeline automatically resuming after the restore.

set -e

if [ -f ~/.local/bin/borgmatic/rollback-$DB_NAME.sh ]; then
    echo "Running rollback and setting last pipeline status to stopped, all in a detached screen session..."
    screen -m -d -S rollback-$DB_NAME bash -c \
        "~/.local/bin/borgmatic/rollback-$DB_NAME.sh && mysql -e \"UPDATE pipeline_runs SET status = 0 ORDER BY id DESC LIMIT 1;\" $DB_NAME"
else
    echo "ERROR: Rollback script not found at ~/.local/bin/borgmatic/rollback-$DB_NAME.sh"
    exit 1
fi 
