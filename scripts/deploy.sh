#!/usr/bin/env bash

# Run this script on the server to pull the latest code and deploy it.
# You can optionally supply the intended git branch to pull as the first argument.

set -e
set -x

# If branch was inputted as argument, check it is checked out
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ ! -z "$1" ] && [ $1 != $CURRENT_BRANCH ]; then
    echo "ERROR: We cannot deploy branch $1 because the branch $CURRENT_BRANCH is checked out"
    exit 1
fi

# Pull latest code
git pull

# Install dependencies
npm ci

# Transpile ts into js
npm run build

# Run migrations
npx sequelize-cli db:migrate

# Restart the app, or start it for the first time
pm2_started=$(if pm2 list -m 2> /dev/null | grep -q property-boundaries-service; then echo "true" ; else echo "false" ; fi)

if [ $pm2_started = "true" ] ; then
    pm2 restart property-boundaries-service
else
    npm run serve
    
    # Save the PM2 config so it gets resurrected on system reboot
    pm2 save
fi
