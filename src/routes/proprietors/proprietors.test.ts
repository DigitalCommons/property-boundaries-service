import { expect } from "chai";
import sinon from "sinon";
import esmock from "esmock";
import { EventEmitter } from "events";

const buildRequest = (
  query: Record<string, string | number | undefined> = {},
  req: EventEmitter = new EventEmitter(),
) => ({
  query: {
    searchTerm: "Cambridge",
    page: 1,
    pageSize: 10,
    secret: process.env.SECRET,
    ...query,
  },
  raw: { req },
});

const buildH = () => {
  const responses: { payload: any; statusCode: number }[] = [];
  const h = {
    response: (payload?: any) => {
      const res = {
        payload,
        statusCode: 200,
        code(statusCode: number) {
          this.statusCode = statusCode;
          return this;
        },
      };
      responses.push(res);
      return res;
    },
    responses,
  };
  return h;
};

describe("GET /api/proprietors", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const buildMeiliMock = (
    sandbox: sinon.SinonSandbox,
    searchResult: {
      hits: any[];
      totalHits?: number;
    } = { hits: [], totalHits: 0 },
  ) => {
    const searchStub = sandbox.stub().resolves(searchResult);
    const indexStub = sandbox.stub().returns({ search: searchStub });
    const getMeiliClientStub = sandbox.stub().returns({ index: indexStub });
    return { searchStub, indexStub, getMeiliClientStub };
  };

  describe("authentication", () => {
    it("returns 403 when secret is missing", async () => {
      // Arrange
      const { getMeiliClientStub } = buildMeiliMock(sandbox);
      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest({ secret: undefined });
      const h = buildH();

      // Act
      const result = await getProprietors(request, h);

      // Assert
      expect(result.statusCode).to.equal(403);
    });

    it("returns 403 when secret is incorrect", async () => {
      // Arrange
      const { getMeiliClientStub } = buildMeiliMock(sandbox);
      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest({ secret: "wrongsecret" });
      const h = buildH();

      // Act
      const result = await getProprietors(request, h);

      // Assert
      expect(result.statusCode).to.equal(403);
    });
  });

  describe("successful response", () => {
    it("returns 200 with correctly shaped results", async () => {
      // Arrange
      const hits = [
        { id: 1, name: "Cambridge Council" },
        { id: 2, name: "Cambridge University" },
      ];
      const { getMeiliClientStub } = buildMeiliMock(sandbox, {
        hits,
        totalHits: 2,
      });

      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest({ searchTerm: "Cambridge" });
      const h = buildH();

      // Act
      const result = await getProprietors(request, h);

      // Assert
      expect(result.statusCode).to.equal(200);
      expect(result.payload).to.deep.equal({
        results: [
          { id: 1, proprietorName: "Cambridge Council" },
          { id: 2, proprietorName: "Cambridge University" },
        ],
        page: 1,
        pageSize: 10,
        totalResults: 2,
      });
    });

    it("returns 200 with empty results array when there are no hits", async () => {
      // Arrange
      const { getMeiliClientStub } = buildMeiliMock(sandbox, {
        hits: [],
        totalHits: 0,
      });

      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest({ searchTerm: "Xyzzy" });
      const h = buildH();

      // Act
      const result = await getProprietors(request, h);

      // Assert
      expect(result.statusCode).to.equal(200);
      expect(result.payload).to.deep.equal({
        results: [],
        page: 1,
        pageSize: 10,
        totalResults: 0,
      });
    });

    it("passes searchTerm, page and pageSize to MeiliSearch", async () => {
      // Arrange
      const { getMeiliClientStub, searchStub } = buildMeiliMock(sandbox, {
        hits: [],
        totalHits: 100,
      });

      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest({
        searchTerm: "Cambri",
        page: 3,
        pageSize: 10,
      });
      const h = buildH();

      // Act
      await getProprietors(request, h);

      // Assert
      expect(
        searchStub.calledWith("Cambri", {
          hitsPerPage: 10,
          page: 3,
        }),
      ).to.be.true;
    });

    it("searches the correct MeiliSearch index", async () => {
      // Arrange
      const { getMeiliClientStub, indexStub } = buildMeiliMock(sandbox);

      const { getProprietors, PROPRIETORS_INDEX } = await esmock(
        "./proprietors.js",
        {
          "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
        },
      );

      const request = buildRequest();
      const h = buildH();

      // Act
      await getProprietors(request, h);

      // Assert
      expect(indexStub.calledWith(PROPRIETORS_INDEX)).to.be.true;
    });
  });

  describe("error handling", () => {
    it("returns 500 when MeiliSearch throws an error", async () => {
      // Arrange
      const searchStub = sandbox
        .stub()
        .rejects(new Error("MeiliSearch unavailable"));
      const indexStub = sandbox.stub().returns({ search: searchStub });
      const getMeiliClientStub = sandbox.stub().returns({ index: indexStub });

      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest();
      const h = buildH();

      // Act
      const result = await getProprietors(request, h);

      // Assert
      expect(result.statusCode).to.equal(500);
      expect(result.payload).to.equal("Internal server error");
    });

    it("returns 500 when MeiliSearch client is not initialised", async () => {
      // Arrange
      const getMeiliClientStub = sandbox
        .stub()
        .throws(new Error("MeiliSearch client not initialised"));

      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest();
      const h = buildH();

      // Act
      const result = await getProprietors(request, h);

      // Assert
      expect(result.statusCode).to.equal(500);
      expect(result.payload).to.equal("Internal server error");
    });
  });

  describe("abort handling", () => {
    it("returns 499 when the request is aborted", async () => {
      // Arrange
      const req = new EventEmitter();
      let rejectSearch!: (err: Error) => void;
      const searchPromise = new Promise<never>((_, reject) => {
        rejectSearch = reject;
      });
      const searchStub = sandbox.stub().returns(searchPromise);
      const indexStub = sandbox.stub().returns({ search: searchStub });
      const getMeiliClientStub = sandbox.stub().returns({ index: indexStub });

      const { getProprietors } = await esmock("./proprietors.js", {
        "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      });

      const request = buildRequest({}, req);
      const h = buildH();

      // Start the handler so the close listener is registered, then abort and reject
      //Act
      const resultPromise = getProprietors(request, h);
      req.emit("close");
      rejectSearch(new Error("connection reset"));
      // Assert
      const result = await resultPromise;

      expect(result.statusCode).to.equal(499);
      expect(result.payload).to.equal("Request aborted");
    });
  });
});
