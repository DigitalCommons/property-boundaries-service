import {
  ServerRoute,
  Request,
  ResponseObject,
  ResponseToolkit,
} from "@hapi/hapi";
import {
  getPolygonsByArea,
  getPolygonsByProprietorName,
  getPolygonsById,
} from "../queries/query";

// TODO: add error handling and appropriate responses
async function getBoundaries(request: Request): Promise<any> {
  const { sw_lng, sw_lat, ne_lng, ne_lat, secret } = request.query;

  if (!secret || secret !== process.env.SECRET) {
    return "missing or incorrect secret";
  }

  if (!sw_lng || !sw_lat || !ne_lng || !ne_lat) return "bounds are not valid";

  const searchArea = `POLYGON ((${sw_lng} ${sw_lat}, ${ne_lng} ${sw_lat}, ${ne_lng} ${ne_lat}, ${sw_lng} ${ne_lat}, ${sw_lng} ${sw_lat}))`;

  const polygons = await getPolygonsByArea(searchArea);

  return polygons;
}

type GetPolygonRequest = Request & {
  query: { poly_id: number | number[]; secret: string };
};

async function getPolygons(
  request: GetPolygonRequest,
  h: ResponseToolkit,
  d: any
): Promise<ResponseObject> {
  const { poly_id, secret } = request.query;

  // poly_id is a number if 1 id provided, or an array of numbers if multiple provided
  const poly_ids = typeof poly_id === "number" ? [poly_id] : poly_id;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  const { polygons, missing } = await getPolygonsById(poly_ids);

  if (missing.length > 0) {
    return h.response(`poly_ids don't exist: ${missing.join(",")}`).code(404);
  }

  return h.response(polygons);
}

async function search(request: Request): Promise<any> {
  const { proprietorName, secret } = request.query;

  if (!secret || secret !== process.env.SECRET) {
    return "missing or incorrect secret";
  }

  const polygons = await getPolygonsByProprietorName(proprietorName);

  return polygons;
}

const getBoundariesRoute: ServerRoute = {
  method: "GET",
  path: "/boundaries",
  handler: getBoundaries,
  options: {
    auth: false,
  },
};

const getPolygonsRoute: ServerRoute = {
  method: "GET",
  path: "/polygons",
  handler: getPolygons,
  options: {
    auth: false,
  },
};

const searchRoute: ServerRoute = {
  method: "GET",
  path: "/search",
  handler: search,
  options: {
    auth: false,
  },
};

const routes = [getBoundariesRoute, getPolygonsRoute, searchRoute];

export default routes;
