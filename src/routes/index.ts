import {
  ServerRoute,
  Request,
  ResponseObject,
  ResponseToolkit,
} from "@hapi/hapi";
import {
  getPolygonsByArea,
  getPolygonsByProprietorName,
  getPolygonsByIdInSearchArea,
} from "../queries/query";
import path from "path";
import fs from "fs";
import { triggerPipelineRun } from "../pipeline/run";

/** Handler for testing our newly generated INSPIRE JSONs */
async function getBoundariesDummy(request: Request): Promise<any> {
  // Get dummy info from a specific council
  const data = JSON.parse(
    fs.readFileSync(
      path.resolve(`./geojson/Adur_District_Council.json`),
      "utf8"
    )
  );
  console.log(
    "Last polygon in dataset:",
    data.features.slice(-1)[0].geometry.coordinates[0]
  );

  // CHANGE THESE:
  const id_we_want = 34853603;
  const numSurroundingPolys = 2000;

  let index = data.features.findIndex(
    (feature) => feature.properties.INSPIREID === id_we_want
  );
  if (index === -1) {
    console.log("ID doesn't exist, so just show first", numSurroundingPolys);
    index = Math.round(numSurroundingPolys / 2) - 1;
  }
  const firstNearbyPolygonIndex = Math.max(
    0,
    index - Math.round(numSurroundingPolys / 2)
  );

  // Transform into what LX expects
  const polygons = data.features
    .slice(
      firstNearbyPolygonIndex,
      firstNearbyPolygonIndex + numSurroundingPolys + 1
    )
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

type GetPolygonsInBoxRequest = Request & {
  query: {
    sw_lng: number;
    sw_lat: number;
    ne_lng: number;
    ne_lat: number;
    secret: string;
  };
};

// TODO: combine with search route so we can filter by a box and ownership at the same time?
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
    includeLeaseholds?: boolean;
    secret: string;
  };
};

/**
 * Get polygons that:
 * - match with the ID(s) (if given)
 * AND
 * - intersect with the search area (if given as a GeoJSON Polygon geometry)
 */
async function getPolygonsByIdInArea(
  request: GetPolygonsRequest,
  h: ResponseToolkit
): Promise<ResponseObject> {
  const { poly_ids, searchArea, includeLeaseholds, secret } = request.payload;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  if ((!poly_ids || poly_ids.length === 0) && !searchArea) {
    return h.response("poly_ids and/or searchArea must be given").code(400);
  }

  const result = await getPolygonsByIdInSearchArea(
    poly_ids,
    searchArea,
    includeLeaseholds
  );

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

type RunPipelineRequest = Request & {
  query: {
    secret: string;
  };
};

const runPipeline = async (
  request: RunPipelineRequest,
  h: ResponseToolkit
): Promise<ResponseObject> => {
  const { secret } = request.query;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  const uniqueKey = await triggerPipelineRun();
  const msg = uniqueKey
    ? `Pipeline ${uniqueKey} has started`
    : "Pipeline already running";
  console.log(msg);
  return h.response(msg);
};

const getBoundariesRoute: ServerRoute = {
  method: "GET",
  path: "/boundaries",
  handler: getPolygonsInBox, // TODO: change this back to getPolygonsInBox in the live app
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
 * Use POST so that it can receive a large list of poly_ids in one request.
 */
const getPolygonsRoute: ServerRoute = {
  method: "POST",
  path: "/polygons",
  handler: getPolygonsByIdInArea,
  options: {
    auth: false,
  },
};

const runPipelineRoute: ServerRoute = {
  method: "GET",
  path: "/run-pipeline",
  handler: runPipeline,
  options: {
    auth: false,
  },
};

const routes = [
  getBoundariesRoute,
  getPolygonsRoute,
  searchRoute,
  runPipelineRoute,
];

export default routes;
