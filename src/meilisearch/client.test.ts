import { expect } from "chai";
import sinon from "sinon";
import esmock from "esmock";

describe("MeiliSearch Client", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("initMeiliSearch", () => {
    it("should initialize MeiliSearch client successfully", async () => {
      // Arrange
      const adminKey = "admin-key-123";
      const mockKeys = {
        results: [
          {
            key: adminKey,
            name: "Default Admin API Key",
          },
          {
            key: "other-key",
            name: "Other Key",
          },
        ],
      };

      const mockInstance = {
        getKeys: sandbox.stub().resolves(mockKeys),
        isHealthy: sandbox.stub().resolves(true),
      };

      const meilisearchStub = sandbox.stub().returns(mockInstance);

      // Load module with the stub injected
      const { initMeiliSearch } = await esmock("./client.js", {
        meilisearch: { MeiliSearch: meilisearchStub },
      });

      //Act
      await initMeiliSearch();

      // Assert
      expect(mockInstance.getKeys.calledOnce).to.be.true;
      expect(mockInstance.isHealthy.calledOnce).to.be.true;
    });

    it("should throw error when admin key is not found", async () => {
      // Arrange
      const mockKeys = {
        results: [{ key: "other-key", name: "Other Key" }],
      };

      const mockInstance = {
        getKeys: sandbox.stub().resolves(mockKeys),
        isHealthy: sandbox.stub().resolves(true),
      };

      const meilisearchStub = sandbox.stub().returns(mockInstance);

      // Load module with the stub injected
      const { initMeiliSearch } = await esmock("./client.js", {
        meilisearch: { MeiliSearch: meilisearchStub },
      });

      // Act & Assert
      try {
        await initMeiliSearch();
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.equal("Meilisearch admin key not found");
      }
    });

    it("should throw error when MeiliSearch is not healthy", async () => {
      // Arrange
      const mockKeys = {
        results: [{ key: "admin-key-123", name: "Default Admin API Key" }],
      };

      const mockInstance = {
        getKeys: sandbox.stub().resolves(mockKeys),
        isHealthy: sandbox.stub().resolves(false),
      };

      const meilisearchStub = sandbox.stub().returns(mockInstance);

      // Load module with the stub injected
      const { initMeiliSearch } = await esmock("./client.js", {
        meilisearch: { MeiliSearch: meilisearchStub },
      });

      // Act & Assert
      try {
        await initMeiliSearch();
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.equal("MeiliSearch is not healthy");
      }
    });
  });

  describe("getMeiliClient", () => {
    it("should return the initialized MeiliSearch client", async () => {
      // Arrange
      const mockKeys = {
        results: [{ key: "admin-key-123", name: "Default Admin API Key" }],
      };

      const mockInstance = {
        getKeys: sandbox.stub().resolves(mockKeys),
        isHealthy: sandbox.stub().resolves(true),
      };

      const meilisearchStub = sandbox.stub().returns(mockInstance);

      // Load module with the stub injected
      const { initMeiliSearch, getMeiliClient } = await esmock("./client.js", {
        meilisearch: { MeiliSearch: meilisearchStub },
      });

      // Act
      await initMeiliSearch();
      const meiliClientInstance = await getMeiliClient();

      // Assert
      expect(meiliClientInstance).to.equal(mockInstance);
    });

    it("should throw error when client is not initialized", async () => {
      // Arrange
      const mockKeys = {
        results: [{ key: "admin-key-123", name: "Default Admin API Key" }],
      };

      const mockInstance = {
        getKeys: sandbox.stub().resolves(mockKeys),
        isHealthy: sandbox.stub().resolves(true),
      };
      const meilisearchStub = sandbox.stub().returns(mockInstance);

      const { getMeiliClient } = await esmock("./client.js", {
        meilisearch: { MeiliSearch: meilisearchStub },
      });

      // Act & Assert
      expect(() => {
        getMeiliClient();
      }).to.throw("MeiliSearch client not initialised");
    });
  });
});
