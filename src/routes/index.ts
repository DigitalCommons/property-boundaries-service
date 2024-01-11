import {
  ServerRoute,
  Request,
  ResponseObject,
  ResponseToolkit,
} from "@hapi/hapi";
import {
  getPolygonsByArea,
  getPolygonsByProprietorName,
  getPolygonsByIdAndSearchArea,
} from "../queries/query";

type GetPolygonsInBoxRequest = Request & {
  query: {
    sw_lng: number;
    sw_lat: number;
    ne_lng: number;
    ne_lat: number;
    secret: string;
  };
};

// TODO:
// - combine with search route?
async function getPolygonsInBox(
  request: GetPolygonsInBoxRequest,
  h: ResponseToolkit
): Promise<ResponseObject> {
  const { sw_lng, sw_lat, ne_lng, ne_lat, secret } = request.query;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  if (!sw_lng || !sw_lat || !ne_lng || !ne_lat) {
    return h.response("bounds are not valid").code(400);
  }

  const searchArea = `POLYGON ((${sw_lng} ${sw_lat}, ${ne_lng} ${sw_lat}, ${ne_lng} ${ne_lat}, ${sw_lng} ${ne_lat}, ${sw_lng} ${sw_lat}))`;

  const polygons = await getPolygonsByArea(searchArea);

  // TODO: remove this double-nested array and fix on backend API too
  return h.response([polygons]).code(200);
}

type GetPolygonsRequest = Request & {
  payload: {
    poly_ids?: number[];
    searchArea?: string;
    secret: string;
  };
};

/**
 * Get polygons that:
 * - match with the ID(s) (if given)
 * AND
 * - intersect with the search area (if given as a GeoJSON Polygon geometry)
 */
async function getPolygons(
  request: GetPolygonsRequest,
  h: ResponseToolkit
): Promise<ResponseObject> {
  const { poly_ids, searchArea, secret } = request.payload;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  if ((!poly_ids || poly_ids.length === 0) && !searchArea) {
    return h.response("poly_ids and/or searchArea must be given").code(400);
  }

  const result = await getPolygonsByIdAndSearchArea(poly_ids, searchArea);

  return h.response(result).code(200);
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
  handler: getPolygonsInBox,
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

/**
 * Only used in development of analyse script
 * Use POST so that it can receive a large list of poly_ids in one request.
 */
const getPolygonsRoute: ServerRoute = {
  method: "POST",
  path: "/polygonsDevSearch",
  handler: getPolygons,
  options: {
    auth: false,
  },
};

const routes = [getBoundariesRoute, getPolygonsRoute, searchRoute];

export default routes;
