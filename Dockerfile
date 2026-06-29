# syntax=docker/dockerfile:1

# Multi-stage build for the Property Boundaries Service (Hapi, ESM, TypeScript
# compiled to dist/ with tsc). Modelled on mykomap-monolith/apps/back-end.
# See land-explorer-back-end/docs/containers.md for how to build and run this.

# Node version must be supplied (e.g. 24). No sane default - fail loudly if unset.
ARG NODE_VERSION=nonesuch

# ---- build stage ----
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# git: build/version metadata.
RUN apk add --no-cache git

# Don't download the Playwright chromium browser during npm ci: it isn't built
# for Alpine/musl and isn't needed to build or to run the API server.
# This is an issue with the current setup that is part of the reason the
#  INSPIRE pipeline isn't working - change to 0 to test a fix for this
#  then remove it after the issue is fixed
# See https://github.com/DigitalCommons/property-boundaries-service/issues/45
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build
# Dev deps are kept in this stage so a migrate step targeting it has
# sequelize-cli available. The runtime stage prunes them.

# ---- runtime stage ----
FROM node:${NODE_VERSION}-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ogr2ogr (GDAL) is required by the INSPIRE pipeline task to convert GML to
# GeoJSON. gdal-tools provides it on Alpine.
RUN apk add --no-cache gdal-tools

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/config ./config

# DB migrations run at deploy time (e.g. Coolify's pre-deploy command:
# `npx sequelize-cli db:migrate`, the same command scripts/deploy.sh uses).
# Bring in the migration sources so the CLI can run from the repo root inside
# this image, mirroring the layout deploy.sh expects.
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/seeders ./seeders

# Strip dev deps to slim the image, then add back just the Sequelize CLI (a dev
# dep) which is needed to run migrations at deploy time. Pinned to the major
# version in package.json.
RUN npm prune --omit=dev \
    && npm install --no-save sequelize-cli@6

USER node
EXPOSE 4000

# Docker is the process supervisor; run node directly rather than via pm2.
CMD ["node", "--max-old-space-size=4096", "dist/app.js"]
