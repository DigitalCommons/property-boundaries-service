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

  // TODO: remove this double-nested array and fix on backend API too
  return [polygons];
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
  const poly_ids = typeof poly_id === "object" ? poly_id : [poly_id];

  if (poly_ids.length === 0) {
    return h.response("missing poly_id parameter").code(400);
  }

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  const result = await getPolygonsById(poly_ids);

  if (result.polygons.length > 0) {
    // If at least some polygons exist, return with a 200 OK but indicate if any are missing in data
    return h.response(result).code(200);
  } else {
    return h.response(result).code(404);
  }
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
