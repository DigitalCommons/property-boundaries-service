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

# Restart the backend process
pm2 restart 0
