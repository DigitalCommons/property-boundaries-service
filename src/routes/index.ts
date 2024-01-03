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
import path from "path";
import fs from "fs";

/** Handler for testing our newly generated INSPIRE JSONs */
async function getBoundariesDummy(request: Request): Promise<any> {
  // Get dummy info from a specific council
  const data = JSON.parse(
    fs.readFileSync(
      path.resolve(`./generated/Birmingham_City_Council.json`),
      "utf8"
    )
  );
  console.log(
    "Last polygon in dataset:",
    data.features.slice(-1)[0].geometry.coordinates[0]
  );

  const id_we_want = 23408026;
  let index = data.features.findIndex(
    (feature) => feature.properties.INSPIREID === id_we_want
  );
  if (index === -1) {
    console.log("ID doesn't exist, so just show first 500");
    index = 250;
  }

  // Transform into what LX expects
  const polygons = data.features
    .slice(index - 250, index + 250)
    .map((feature) => ({
      poly_id: feature.properties.INSPIREID,
      geom: {
        ...feature.geometry,
        coordinates: [
          feature.geometry.coordinates[0].map((c) => c.toReversed()),
        ],
      },
    }));
  return [polygons];
}

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

  // If some or all polygons exist, return with a 200 OK but indicate if any are missing in the data
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
  handler: getBoundariesDummy, // TODO: change this back to getBoundaries in the live app
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
