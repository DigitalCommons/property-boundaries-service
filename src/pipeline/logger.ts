import pino from "pino";
import fs from "fs";
import { getRunningPipelineKey } from "./util";

export default function getLogger() {
  fs.mkdirSync("logs", { recursive: true });

  return pino(
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
      dest:
        process.env.NODE_ENV === "development" // log to stdout if in development, else to file
          ? 1
          : `logs/${
              new Date().toISOString().split("T")[0]
            }_${getRunningPipelineKey()}.log`,
      sync: true,
    })
  );
}
