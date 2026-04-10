import {
  ServerRoute,
  Request,
  ResponseObject,
  ResponseToolkit,
} from "@hapi/hapi";
import { getMeiliClient } from "../../meilisearch/client.js";
import Joi from "joi";
import { logger } from "../../pipeline/logger.js";

export const PROPRIETORS_INDEX = "proprietors";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

type GetProprietorsRequest = Request & {
  query: {
    searchTerm: string;
    page: number;
    pageSize: number;
  };
};

type ProprietorRecord = {
  id: number;
  name: string;
};

/**
 * Searches the proprietors index in MeiliSearch and returns a paginated list of results.
 * @param request The incoming request, containing `searchTerm`, `page`, and `pageSize` query params and an `x-api-key` header
 * @param h The Hapi response toolkit
 * @returns A paginated response containing matched proprietors, or an error response
 */
export const getProprietors = async (
  request: GetProprietorsRequest,
  h: ResponseToolkit,
): Promise<ResponseObject> => {
  const { searchTerm, page, pageSize } = request.query;
  const secret = request.headers["x-api-key"];

  if (!secret || secret !== process.env.SECRET) {
    return h.response().code(403);
  }

  const abortController = new AbortController();
  request.raw.req.on("close", () => {
    abortController.abort();
  });

  try {
    const meiliClient = getMeiliClient();
    const { hits, totalHits } = await meiliClient
      .index<ProprietorRecord>(PROPRIETORS_INDEX)
      .search(
        searchTerm,
        {
          hitsPerPage: pageSize,
          page,
        },
        { signal: abortController.signal },
      );

    const results = hits.map((hit) => ({
      id: hit.id,
      proprietorName: hit.name,
    }));

    return h
      .response({
        results,
        page,
        pageSize,
        totalResults: totalHits,
      })
      .code(200);
  } catch (error: any) {
    if (abortController.signal.aborted || error.name === "AbortError") {
      return h.response("Request aborted").code(499);
    }
    logger.error("Error searching proprietors:", error);
    return h.response("Internal server error").code(500);
  }
};

const querySchema = Joi.object({
  searchTerm: Joi.string().required(),
  page: Joi.number().integer().min(1).optional().default(DEFAULT_PAGE),
  pageSize: Joi.number()
    .integer()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .default(DEFAULT_PAGE_SIZE),
});

export const proprietorsRoute: ServerRoute = {
  method: "GET",
  path: "/api/proprietors",
  handler: getProprietors,
  options: {
    auth: false,
    validate: {
      query: querySchema,
      failAction: async (_request, _h, err) => {
        throw err;
      },
    },
  },
};
