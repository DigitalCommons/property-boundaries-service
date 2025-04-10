import "dotenv/config";
import Hapi from "@hapi/hapi";
import { Server } from "@hapi/hapi";
import qs from "qs";
import routes from "./routes/index";
import { resumePipelineRunIfInterrupted } from "./pipeline/run";
import { logger } from "./pipeline/logger";

export const server: Server = Hapi.server({
  port: process.env.PORT || 4000,
  host: "0.0.0.0",
  debug: { log: ["error"], request: ["error"] },
  query: { parser: (query) => qs.parse(query) },
});

function index(request: Request): string {
  console.log("Processing request");
  return "Is it nice to meet you?";
}

async function start() {
  server.route({
    method: "GET",
    path: "/",
    handler: index,
    options: {
      auth: false,
    },
  });

  server.route(routes);

  // Log requests and response codes
  server.events.on("response", (request: any) => {
    console.log(
      request.info.remoteAddress +
        ": " +
        request.method.toUpperCase() +
        " " +
        request.path +
        " --> " +
        request.response.statusCode,
    );
  });

  console.log(`Listening on ${server.settings.host}:${server.settings.port}`);
  server.start();

  // Resume pipeline run if interrupted
  try {
    await resumePipelineRunIfInterrupted();
  } catch (error) {
    console.error("Failed to resume interrupted pipeline run:", error?.message);
  }
}

process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err, err.stack);
  logger?.error(err, "uncaughtException");
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  logger?.error(promise, `unhandledRejection, reason: ${reason}`);
  process.exit(1);
});

start();
