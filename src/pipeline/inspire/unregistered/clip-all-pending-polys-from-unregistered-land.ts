// This is a script that takes all pending INSPIRE polygons in the pending_inspire_polygons table
// and clips their geometries from all unregistered land boundaries in the unregistered_land table.
//
// Note: This happens for new/changed pending INSPIRE polygons during the monthly INSPIRE pipeline
// in analyse-all.ts, before the pending polygons are written to the land_ownership_polygons table.
// But sometimes we need to use this script to clip ALL pending INSPIRE polygons, e.g. if we copy or
// restore a backup of the unregistered land table and need to ensure its consistency with the
// current land_ownership_polygons table, so that we don't have any overlap between the two tables.
//
// Example usage:
//    node --loader ts-node/esm src/pipeline/inspire/unregistered/clip-all-pending-polys-from-unregistered-land.ts

import pino from "pino";
import { clipPendingPolygonsFromUnregisteredLand } from "../../../queries/query.js";

const stdoutLogger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
      bindings: () => ({}), // don't need to include PID or hostname
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({
    dest: 1, // log to stdout
  }),
);

clipPendingPolygonsFromUnregisteredLand(stdoutLogger, false)
  .then(() => {
    stdoutLogger.info("Initial unregistered land layer created successfully.");
  })
  .catch((error) => {
    stdoutLogger.error(
      { err: error },
      "Error creating initial unregistered land layer",
    );
  });
