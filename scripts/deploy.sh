#!/usr/bin/env bash

# Run this script on the server deploy the currently checked out code.

set -e
set -x

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
