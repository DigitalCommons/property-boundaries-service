import { expect } from "chai";
import * as sinon from "sinon";
import { describe, it, beforeEach, afterEach } from "mocha";
import esmock from "esmock";
import { type ProprietorDocument } from "./update.js";

describe("update proprietors", () => {
  let sandbox: sinon.SinonSandbox;
  let mockMeiliClient: any;
  let mockIndex: any;
  let mockTask: any;
  let getMeiliClientStub: sinon.SinonStub;
  let notifyMatrixStub: sinon.SinonStub;
  let getDistinctProprietorNamesStub: sinon.SinonStub;
  let update: typeof import("./update.js");

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockTask = { status: "succeeded", error: null };

    mockIndex = {
      addDocuments: sandbox
        .stub()
        .returns({ waitTask: sandbox.stub().resolves(mockTask) }),
      updateSettings: sandbox
        .stub()
        .returns({ waitTask: sandbox.stub().resolves(mockTask) }),
    };

    mockMeiliClient = {
      deleteIndex: sandbox
        .stub()
        .returns({ waitTask: sandbox.stub().resolves(mockTask) }),
      createIndex: sandbox
        .stub()
        .returns({ waitTask: sandbox.stub().resolves(mockTask) }),
      swapIndexes: sandbox
        .stub()
        .returns({ waitTask: sandbox.stub().resolves(mockTask) }),
      index: sandbox.stub().returns(mockIndex),
    };

    getMeiliClientStub = sandbox.stub().returns(mockMeiliClient);
    notifyMatrixStub = sandbox.stub().resolves();
    getDistinctProprietorNamesStub = sandbox.stub().resolves([]);

    update = await esmock("./update.js", {
      "../../meilisearch/client.js": { getMeiliClient: getMeiliClientStub },
      "../../queries/proprietor-query.js": {
        getDistinctProprietorNames: getDistinctProprietorNamesStub,
      },
      "../logger.js": {
        logger: { info: sandbox.stub(), error: sandbox.stub() },
      },
      "../util.js": { notifyMatrix: notifyMatrixStub },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("hashName", () => {
    it("should return a consistent string ID for a given name", () => {
      // Act
      const hash1 = update.hashName("Proprietor A");
      const hash2 = update.hashName("Proprietor A");
      // Assert
      expect(hash1).to.equal(hash2);
      expect(typeof hash1).to.equal("string");
    });

    it("should return different hashes for different names", () => {
      // Act
      const hash1 = update.hashName("Proprietor A");
      const hash2 = update.hashName("Proprietor B");
      // Assert
      expect(hash1).to.not.equal(hash2);
    });
  });

  describe("deleteIndexIfExists", () => {
    it("should delete index successfully", async () => {
      // Act
      await update.deleteIndexIfExists("test-index");
      //Assert
      expect(mockMeiliClient.deleteIndex.calledWith("test-index")).to.be.true;
    });

    it("should handle index not found error gracefully", async () => {
      //Arrange
      mockTask.status = "failed";
      mockTask.error = { code: "index_not_found", message: "Index not found" };
      //Act
      await update.deleteIndexIfExists("test-index");
      //Assert
      expect(mockMeiliClient.deleteIndex.called).to.be.true;
    });

    it("should throw on failed deletion with non-not-found error", async () => {
      //Arrange
      mockTask.status = "failed";
      mockTask.error = { code: "other_error", message: "Some error" };
      //Act & Assert
      try {
        await update.deleteIndexIfExists("test-index");
        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("Failed to delete index 'test-index'");
      }
    });

    const cases = [
      { status: "canceled" },
      {
        status: "failed",
        error: { code: "some_other_error", message: "Deletion failed" },
      },
      { status: "processing" },
    ];

    for (const { status, error } of cases) {
      it(`should throw on ${status} deletion`, async () => {
        //Arrange
        mockTask.status = status;
        mockTask.error = error;
        //Act & Assert
        try {
          await update.deleteIndexIfExists("test-index");
          expect.fail("Should have thrown an error");
        } catch (err: any) {
          expect(err.message).to.include("Failed to delete index 'test-index'");
        }
      });
    }
  });

  describe("createIndexIfNotExists", () => {
    it("should create index successfully", async () => {
      // Act
      await update.createIndexIfNotExists("test-index");
      //Assert
      expect(
        mockMeiliClient.createIndex.calledWith("test-index", {
          primaryKey: "id",
        }),
      ).to.be.true;
    });

    it("should handle failed creation due to index already existing gracefully", async () => {
      //Arrange
      mockTask.status = "failed";
      mockTask.error = {
        code: "index_already_exists",
        message: "Index already exists",
      };
      //Act
      await update.createIndexIfNotExists("test-index");
      //Assert
      expect(mockMeiliClient.createIndex.called).to.be.true;
    });

    const cases = [
      { status: "canceled" },
      {
        status: "failed",
        error: { code: "some_other_error", message: "Creation failed" },
      },
      { status: "processing" },
    ];

    for (const { status, error } of cases) {
      it(`should throw on ${status} creation`, async () => {
        //Arrange
        mockTask.status = status;
        mockTask.error = error;
        //Act & Assert
        try {
          await update.createIndexIfNotExists("test-index");
          expect.fail("Should have thrown an error");
        } catch (err: any) {
          expect(err.message).to.include("Failed to create index 'test-index'");
        }
      });
    }
  });

  describe("swapIndexes", () => {
    it("should swap indexes successfully", async () => {
      //Act
      await update.swapIndexes("new-index", "live-index");
      //Assert
      expect(
        mockMeiliClient.swapIndexes.calledWith([
          { indexes: ["live-index", "new-index"], rename: false },
        ]),
      ).to.be.true;
    });

    const cases = [
      { status: "canceled" },
      { status: "failed", error: { message: "Swap failed" } },
      { status: "processing" },
    ];

    for (const { status, error } of cases) {
      it(`should throw on ${status} swap`, async () => {
        // Arrange
        mockTask.status = status;
        mockTask.error = error;

        // Act & Assert
        try {
          await update.swapIndexes("new-index", "live-index");
          expect.fail("Should have thrown an error");
        } catch (err: any) {
          expect(err.message).to.include(
            "Failed to swap 'new-index' into 'live-index'",
          );
        }
      });
    }
  });

  describe("batchInsertProprietorDocuments", () => {
    it("should insert documents successfully", async () => {
      //Arrange
      const documents: ProprietorDocument[] = [
        { id: "hash1", name: "Owner 1" },
        { id: "hash2", name: "Owner 2" },
      ];
      //Act
      await update.batchInsertProprietorDocuments("test-index", documents);
      //Assert
      expect(mockIndex.addDocuments.called).to.be.true;
    });

    it("should insert documents in multiple batches when count exceeds batch size", async () => {
      //Arrange
      const documents: ProprietorDocument[] = Array.from(
        { length: 10001 },
        (_, i) => ({ id: `hash${i}`, name: `Owner ${i}` }),
      );
      //Act
      await update.batchInsertProprietorDocuments("test-index", documents);
      //Assert
      expect(mockIndex.addDocuments.callCount).to.equal(2);
    });

    const cases = [
      { status: "canceled" },
      { status: "failed", error: { message: "Insert failed" } },
      { status: "processing" },
    ];

    for (const { status, error } of cases) {
      it(`should throw on ${status} insertion`, async () => {
        mockTask.status = status;
        if (error) mockTask.error = error;
        const documents: ProprietorDocument[] = [
          { id: "hash1", name: "Owner 1" },
        ];
        try {
          await update.batchInsertProprietorDocuments("test-index", documents);
          expect.fail("Should have thrown an error");
        } catch (err: any) {
          expect(err.message).to.include("Failed to insert batch 1");
        }
      });
    }
  });

  describe("updateProprietorsIndex", () => {
    it("should complete full update successfully", async () => {
      //Arrange
      getDistinctProprietorNamesStub.resolves(["Owner 1", "Owner 2"]);

      // Act
      await update.updateProprietorsIndex();

      // Assert
      expect(
        mockMeiliClient.createIndex.calledWith("proprietors", {
          primaryKey: "id",
        }),
      ).to.be.true;
      expect(mockMeiliClient.deleteIndex.calledWith("proprietors_new")).to.be
        .true;
      expect(
        mockMeiliClient.createIndex.calledWith("proprietors_new", {
          primaryKey: "id",
        }),
      ).to.be.true;
      expect(mockMeiliClient.index.calledWith("proprietors_new")).to.be.true;
      expect(mockIndex.updateSettings.called).to.be.true;
      expect(getDistinctProprietorNamesStub.called).to.be.true;
      expect(mockIndex.addDocuments.called).to.be.true;
      expect(mockMeiliClient.swapIndexes.called).to.be.true;
      expect(mockMeiliClient.deleteIndex.calledWith("proprietors_new")).to.be
        .true;
      expect(notifyMatrixStub.called).to.be.true;
    });

    it("should clean up new index on error and rethrow", async () => {
      //Arrange
      getDistinctProprietorNamesStub.rejects(new Error("Query failed"));

      //Act & Assert
      try {
        await update.updateProprietorsIndex();
        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.equal("Query failed");
        expect(mockMeiliClient.deleteIndex.called).to.be.true;
      }
    });

    it("should skip update when MEILISEARCH_ENABLED is not 'true'", async () => {
      //Arrange
      const original = process.env.MEILISEARCH_ENABLED;
      process.env.MEILISEARCH_ENABLED = "false";

      try {
        //Act
        await update.updateProprietorsIndex();
        //Assert
        expect(getMeiliClientStub.called).to.be.false;
        expect(mockMeiliClient.createIndex.called).to.be.false;
      } finally {
        process.env.MEILISEARCH_ENABLED = original;
      }
    });

    it("should clean up new index on swap failure and rethrow", async () => {
      //Arrange
      getDistinctProprietorNamesStub.resolves(["Owner 1"]);
      const failedTask = {
        status: "failed",
        error: { message: "Swap failed" },
      };
      mockMeiliClient.swapIndexes.returns({
        waitTask: sandbox.stub().resolves(failedTask),
      });

      //Act & Assert
      try {
        await update.updateProprietorsIndex();
        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("Failed to swap");
        expect(mockMeiliClient.deleteIndex.called).to.be.true;
      }
    });
  });
});
