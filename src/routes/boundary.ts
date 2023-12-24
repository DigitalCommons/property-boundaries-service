import {
  ServerRoute,
  Request,
  ResponseObject,
  ResponseToolkit,
} from "@hapi/hapi";
import {
  getPolygonsByArea,
  getPolygonsByProprietorName,
  getPolygonById,
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
  query: { poly_id: number; secret: string };
};

async function getPolygon(
  request: GetPolygonRequest,
  h: ResponseToolkit,
  d: any
): Promise<ResponseObject> {
  const { poly_id, secret } = request.query;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  const polygon = await getPolygonById(poly_id);

  if (!polygon) {
    return h.response("poly_id doesn't exist").code(404);
  }

  return h.response(polygon);
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
    // TODO: use auth rather than secret in query
    auth: false,
  },
};

const getPolygonRoute: ServerRoute = {
  method: "GET",
  path: "/polygon",
  handler: getPolygon,
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

const boundaryRoutes = [getBoundariesRoute, getPolygonRoute, searchRoute];

export default boundaryRoutes;
