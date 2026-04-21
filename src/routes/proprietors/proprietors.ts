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
const MAX_SEARCH_TERM_LENGTH = 200;

type GetProprietorsRequest = Request & {
  query: {
    searchTerm: string;
    page: number;
    pageSize: number;
    secret: string;
  };
};

type ProprietorRecord = {
  id: string;
  name: string;
};

/**
 * Searches the proprietors index in MeiliSearch and returns a paginated list of results.
 * @param request The incoming request, containing `searchTerm`, `page`, `pageSize` and api secret query params
 * @param h The Hapi response toolkit
 * @returns A paginated response containing matched proprietors, or an error response
 */
export const getProprietors = async (
  request: GetProprietorsRequest,
  h: ResponseToolkit,
): Promise<ResponseObject> => {
  const { searchTerm, page, pageSize, secret } = request.query;

  if (!secret || secret !== process.env.SECRET) {
    return h.response("missing or incorrect secret").code(403);
  }

  const abortController = new AbortController();
  const onClose = () => abortController.abort();
  request.raw.req.on("close", onClose);

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
  } finally {
    request.raw.req.off("close", onClose);
  }
};

const querySchema = Joi.object({
  searchTerm: Joi.string().min(1).max(MAX_SEARCH_TERM_LENGTH).required(),
  page: Joi.number().integer().min(1).optional().default(DEFAULT_PAGE),
  pageSize: Joi.number()
    .integer()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .default(DEFAULT_PAGE_SIZE),
  secret: Joi.string().required(),
});

export const proprietorsRoute: ServerRoute = {
  method: "GET",
  path: "/proprietors",
  handler: getProprietors,
  options: {
    auth: false,
    validate: {
      query: querySchema,
      failAction: (request, h, err) =>
        h
          .response({ message: (err as Error).message })
          .code(400)
          .takeover(),
    },
  },
};
