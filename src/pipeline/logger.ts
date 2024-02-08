import pino from "pino";
import fs from "fs";

export default function getLogger(pipelineUniqueKey: string) {
  fs.mkdirSync("logs", { recursive: true });

  return pino(
    {
      level: "info",
      formatters: {
        level: (label) => {
          return { level: label.toUpperCase() };
        },
        bindings: () => ({}), // don't need to include PID or hostname
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination(
      process.env.NODE_ENV === "development" // log to stdout if in development, else to file
        ? 1
        : `logs/${
            new Date().toISOString().split("T")[0]
          }_${pipelineUniqueKey}.log`
    )
  );
}
