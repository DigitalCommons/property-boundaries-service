import { ServerRoute, Request } from "@hapi/hapi";
import { getPolygonsByArea } from "../queries/query";

async function getBoundaries(request: Request): Promise<any> {
    const payload: any = request.query;
    const { sw_lng, sw_lat, ne_lng, ne_lat } = payload;

    if (!sw_lng)
        return "no bounds provided";

    const searchArea = `POLYGON ((${sw_lng} ${sw_lat}, ${ne_lng} ${sw_lat}, ${ne_lng} ${ne_lat}, ${sw_lng} ${ne_lat}, ${sw_lng} ${sw_lat}))`;

    const polygons = await getPolygonsByArea(searchArea);

    return polygons;
}

const getBoundariesRoute: ServerRoute = {
    method: "GET",
    path: "/boundaries",
    handler: getBoundaries,
    options: {
        auth: false
    }
}

const boundaryRoutes = [getBoundariesRoute];

export default boundaryRoutes;