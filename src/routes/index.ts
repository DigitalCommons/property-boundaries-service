import {
  ServerRoute,
  Request,
  ResponseObject,
  ResponseToolkit,
} from "@hapi/hapi";
import {
  getPendingPolygonsInSearchArea,
  getPolygonsByProprietorName,
  getPolygonsByIdInSearchArea,
  getLocalAuthorityPolygonsInSearchArea,
  getChurchOfEnglandPolygonsInSearchArea,
  getUnregisteredPolygonsInSearchArea,
} from "../queries/query.js";
import { PipelineOptions, triggerPipelineRun } from "../pipeline/run.js";

type GetPolygonsInBoxRequest = Request & {
  query: {
    sw_lng: number;
    sw_lat: number;
    ne_lng: number;
    ne_lat: number;
    type?: string;
    acceptedOnly?: boolean;
    secret: string;
  };
};

// TODO: combine with search route so we can filter by a box and ownership at the same time?
const getPolygonsInBox = async (
  request: GetPolygonsInBoxRequest,
  h: ResponseToolkit,
): Promise<ResponseObject> => {
  const { sw_lng, sw_lat, ne_lng, ne_lat, type, acceptedOnly, secret } =
    request.query;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  if (!sw_lng || !sw_lat || !ne_lng || !ne_lat) {
    return h.response("bounds are not valid").code(400);
  }

  const searchArea = JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [+sw_lng, +sw_lat],
        [+ne_lng, +sw_lat],
        [+ne_lng, +ne_lat],
        [+sw_lng, +ne_lat],
        [+sw_lng, +sw_lat],
      ],
    ],
  });

  let polygons: any[];

  switch (type) {
    case "all":
    case undefined:
      polygons = await getPolygonsByIdInSearchArea(undefined, searchArea);
      break;
    case "localAuthority":
      polygons = await getLocalAuthorityPolygonsInSearchArea(searchArea);
      break;
    case "churchOfEngland":
      polygons = await getChurchOfEnglandPolygonsInSearchArea(searchArea);
      break;
    case "unregistered":
      polygons = await getUnregisteredPolygonsInSearchArea(searchArea);
      break;
    case "pending":
      polygons = await getPendingPolygonsInSearchArea(searchArea, acceptedOnly);
      break;
    default:
      return h.response("unknown ownership type").code(400);
  }

  return h.response(polygons).code(200);
};

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
  h: ResponseToolkit,
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
    includeLeaseholds,
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

type Modify<T, R> = Omit<T, keyof R> & R;

type RunPipelineRequest = Request & {
  query: {
    secret: string;
  } & Modify<
    PipelineOptions,
    {
      // query params are parsed by as strings, we need to convert them to booleans ourselves
      resume?: string;
      updateBoundaries?: string;
      recordStats?: string;
    }
  >;
};

const runPipeline = async (
  request: RunPipelineRequest,
  h: ResponseToolkit,
): Promise<ResponseObject> => {
  const { secret, ...options } = request.query;
  console.log(options);

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  const uniqueKey = await triggerPipelineRun({
    ...options,
    resume: options.resume === "true",
    updateBoundaries: options.updateBoundaries === "true",
    recordStats: options.recordStats === "true",
  });
  const msg = uniqueKey
    ? `Pipeline ${uniqueKey} has started`
    : "Pipeline already running";
  console.log(msg);
  return h.response(`${msg}\n`);
};

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
