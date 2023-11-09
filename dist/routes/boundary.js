"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const query_1 = require("../queries/query");
function getBoundaries(request) {
    return __awaiter(this, void 0, void 0, function* () {
        const { sw_lng, sw_lat, ne_lng, ne_lat } = request.query;
        if (!sw_lng)
            return "no bounds provided";
        const searchArea = `POLYGON ((${sw_lng} ${sw_lat}, ${ne_lng} ${sw_lat}, ${ne_lng} ${ne_lat}, ${sw_lng} ${ne_lat}, ${sw_lng} ${sw_lat}))`;
        const polygons = yield (0, query_1.getPolygonsByArea)(searchArea);
        return polygons;
    });
}
const getBoundariesRoute = {
    method: "GET",
    path: "/boundaries",
    handler: getBoundaries,
    options: {
        auth: 'secret'
    }
};
const boundaryRoutes = [getBoundariesRoute];
exports.default = boundaryRoutes;
//# sourceMappingURL=boundary.js.map