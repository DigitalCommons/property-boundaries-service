import pino from "pino";

export let logger: pino.Logger;

export const initLogger = (pipelineKey?: string) => {
  logger = pino(
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
        process.env.NODE_ENV === "development" || !pipelineKey
          ? 1 // log to stdout
          : `logs/${new Date().toISOString().split(".")[0]}_${pipelineKey}.log`,
      sync: true,
      mode: 0o600, // read/write by app user only
    })
  );

  logger.info(`Logger initialised`);
};

initLogger();
