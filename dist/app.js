"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
require("dotenv/config");
const hapi_1 = __importDefault(require("@hapi/hapi"));
const boundary_1 = __importDefault(require("./routes/boundary"));
exports.server = hapi_1.default.server({
    port: process.env.PORT || 4000,
    host: '0.0.0.0'
});
function index(request) {
    console.log("Processing request");
    return "Is it nice to meet you?";
}
exports.server.route({
    method: "GET",
    path: "/",
    handler: index,
    options: {
        auth: false
    }
});
exports.server.route(boundary_1.default);
console.log(`Listening on ${exports.server.settings.host}:${exports.server.settings.port}`);
exports.server.start();
process.on('unhandledRejection', (err) => {
    console.error("unhandledRejection");
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=app.js.map