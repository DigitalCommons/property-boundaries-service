import 'dotenv/config';
import Hapi from "@hapi/hapi";
import { Server } from "@hapi/hapi";
import boundaryRoutes from "./routes/boundary";
import { getBoundariesRoute } from './routes/boundary';

export const server: Server = Hapi.server({
    port: process.env.PORT || 4000,
    host: '0.0.0.0'
});

function index(request: Request): string {
    console.log("Processing request", request);
    return "Nice to meet you!";
}

server.route({
    method: "GET",
    path: "/",
    handler: index,
    options: {
        auth: false
    }
});

server.route({
    method: "GET",
    path: "/work",
    handler: () => "worked",
    options: {
        auth: false
    }
});

server.route(boundaryRoutes);
server.route(getBoundariesRoute);

console.log(`Listening on ${server.settings.host}:${server.settings.port}`);
server.start();

process.on('unhandledRejection', (err) => {
    console.error("unhandledRejection");
    console.error(err);
    process.exit(1);
});