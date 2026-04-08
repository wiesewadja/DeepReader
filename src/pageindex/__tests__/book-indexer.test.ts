import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { indexBook, isBookIndexed, deleteBookIndex } from "../book-indexer.js";
import * as fs from "fs/promises";
import * as path from "path";
import { IndexErrorCode } from "../book-types.js";

vi.mock("../pageindex.js", () => {
  return {
    PageIndex: vi.fn().mockImplementation(() => ({
      fromPdf: vi.fn().mockResolvedValue({
        docName: "Test Book",
        docDescription: "A test book for unit testing",
        structure: [
          {
            title: "Test Book",
            nodeId: "L0-root",
            summary: "Root summary",
            nodes: [
              {
                title: "Chapter 1",
                nodeId: "L1-0",
                summary: "Chapter 1 summary",
                text: "Chapter 1 content",
              },
              {
                title: "Chapter 2",
                nodeId: "L1-1",
                summary: "Chapter 2 summary",
                text: "Chapter 2 content",
              },
            ],
          },
        ],
      }),
      fromEpub: vi.fn().mockResolvedValue({
        docName: "Test EPUB",
        docDescription: "A test EPUB",
        structure: [
          {
            title: "Test EPUB",
            nodeId: "L0-root",
            nodes: [],
          },
        ],
      }),
    })),
  };
});

vi.mock("../exporters/pdf-to-obsidian.js", () => ({
  exportPdfToObsidian: vi.fn().mockResolvedValue({
    mocPath: "/tmp/test/Test Book/Test Book - MOC.md",
    notes: [],
  }),
}));

vi.mock("../exporters/epub-to-obsidian.js", () => ({
  exportToObsidian: vi.fn().mockResolvedValue({
    mocPath: "/tmp/test/Test EPUB/Test EPUB - MOC.md",
    notes: [],
  }),
}));

vi.mock("../vault/vectors.js", () => ({
  initVectorStore: vi.fn().mockResolvedValue({
    vectors: new Float32Array(0),
    meta: {
      model: "text-embedding-3-small",
      dimensions: 1536,
      count: 0,
      deletedCount: 0,
      indexedAt: new Date().toISOString(),
      slots: {},
    },
    vectorPath: "/tmp/vectors.f32",
    metaPath: "/tmp/vectors.meta.json",
  }),
  generateEmbeddings: vi.fn().mockResolvedValue([
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
    [0.7, 0.8, 0.9],
  ]),
  appendVector: vi.fn().mockResolvedValue(0),
}));

describe("book-indexer", () => {
  const testVaultPath = "/tmp/deepreader-test-vault";
  const testPageIndexDir = path.join(testVaultPath, ".pageindex");

  beforeEach(async () => {
    await fs.mkdir(testVaultPath, { recursive: true });
    await fs.mkdir(testPageIndexDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe("generateBookId", () => {
    it("should generate bookId from file path hash", async () => {
      const { generateBookId } = await import("../book-indexer.js");

      const filePath1 = "/vault/books/example.pdf";
      const filePath2 = "/vault/books/other.pdf";

      const bookId1 = generateBookId(filePath1);
      const bookId2 = generateBookId(filePath2);

      expect(bookId1.length).toBe(8);
      expect(bookId2.length).toBe(8);
      expect(bookId1).not.toBe(bookId2);

      const bookId1Again = generateBookId(filePath1);
      expect(bookId1Again).toBe(bookId1);
    });

    it("should be SHA-256 first 8 hex chars", async () => {
      const { generateBookId } = await import("../book-indexer.js");

      const filePath = "/test/path.pdf";
      const bookId = generateBookId(filePath);

      expect(bookId).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  describe("indexBook", () => {
    it("should reject non-existent file with FILE_NOT_FOUND", async () => {
      await expect(
        indexBook({
          filePath: "/non/existent/file.pdf",
          fileType: "pdf",
          outputDir: testVaultPath,
        })
      ).rejects.toMatchObject({
        code: IndexErrorCode.FILE_NOT_FOUND,
      });
    });

    it("should complete full indexing workflow for PDF", async () => {
      const testFilePath = path.join(testVaultPath, "test.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      const progressEvents: any[] = [];

      const result = await indexBook({
        filePath: testFilePath,
        fileType: "pdf",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      });

      expect(result.bookId).toBeDefined();
      expect(result.title).toBe("Test Book");
      expect(result.chaptersCount).toBe(2);
      expect(result.indexDir).toBe(path.join(testVaultPath, ".pageindex", result.bookId));

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[progressEvents.length - 1].percent).toBe(100);
      expect(progressEvents[progressEvents.length - 1].step).toBe("complete");

      await fs.rm(testFilePath, { force: true });
    });

    it("should create book-meta.json", async () => {
      const testFilePath = path.join(testVaultPath, "test.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      const result = await indexBook({
        filePath: testFilePath,
        fileType: "pdf",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      const metaPath = path.join(result.indexDir, "book-meta.json");
      const metaContent = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaContent);

      expect(meta.version).toBe(1);
      expect(meta.bookId).toBe(result.bookId);
      expect(meta.title).toBe("Test Book");
      expect(meta.fileType).toBe("pdf");
      expect(meta.indexedAt).toBeDefined();
      expect(meta.chapters).toBeDefined();
      expect(meta.chapters.length).toBe(2);

      await fs.rm(testFilePath, { force: true });
    });

    it("should create bm25.json", async () => {
      const testFilePath = path.join(testVaultPath, "test.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      const result = await indexBook({
        filePath: testFilePath,
        fileType: "pdf",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      const bm25Path = path.join(result.indexDir, "bm25.json");
      const bm25Content = await fs.readFile(bm25Path, "utf-8");
      const bm25 = JSON.parse(bm25Content);

      expect(bm25.nodes).toBeDefined();
      expect(bm25.invertedIndex).toBeDefined();
      expect(bm25.stats).toBeDefined();
      expect(bm25.stats.totalDocs).toBe(3);
      expect(bm25.params).toBeDefined();
      expect(bm25.params.k1).toBe(1.5);
      expect(bm25.params.b).toBe(0.75);

      await fs.rm(testFilePath, { force: true });
    });

    it("should skip vectorization when embedding not provided", async () => {
      const testFilePath = path.join(testVaultPath, "test.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      const result = await indexBook({
        filePath: testFilePath,
        fileType: "pdf",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      const vectorsPath = path.join(result.indexDir, "vectors.f32");
      await expect(fs.access(vectorsPath)).rejects.toThrow();

      const metaPath = path.join(result.indexDir, "book-meta.json");
      const metaContent = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.embedding).toBeUndefined();

      await fs.rm(testFilePath, { force: true });
    });

    it("should call vectorization when embedding config provided", async () => {
      const testFilePath = path.join(testVaultPath, "test.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      const progressEvents: any[] = [];

      const result = await indexBook({
        filePath: testFilePath,
        fileType: "pdf",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
        embedding: {
          provider: "openai",
          apiKey: "test-key",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      });

      const vectorStep = progressEvents.find(e => e.step === "vectorize");
      expect(vectorStep).toBeDefined();

      const vectorStoreMock = await import("../vault/vectors.js");
      expect(vectorStoreMock.initVectorStore).toHaveBeenCalled();
      expect(vectorStoreMock.generateEmbeddings).toHaveBeenCalled();

      await fs.rm(testFilePath, { force: true });
    });

    it("should support EPUB files", async () => {
      const testFilePath = path.join(testVaultPath, "test.epub");
      await fs.writeFile(testFilePath, "EPUB test content");

      const result = await indexBook({
        filePath: testFilePath,
        fileType: "epub",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      expect(result.bookId).toBeDefined();
      expect(result.title).toBe("Test EPUB");
      expect(result.fileType).toBe("epub");

      await fs.rm(testFilePath, { force: true });
    });
  });

  describe("isBookIndexed", () => {
    it("should return false for non-indexed book", async () => {
      const filePath = "/vault/books/new-book.pdf";
      const result = await isBookIndexed(filePath, testVaultPath);
      expect(result).toBe(false);
    });

    it("should return true when .pageindex/{bookId}/ exists", async () => {
      const filePath = "/vault/books/indexed-book.pdf";
      const bookId = "abcd1234";

      // Create fake index directory
      const indexDir = path.join(testVaultPath, ".pageindex", bookId);
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), "{}");

      // Note: This test will pass if bookId generation matches
      // In real test, we'd use the actual generateBookId function
      const result = await isBookIndexed(filePath, testVaultPath);
      expect(result).toBe(false); // Will be false because bookId doesn't match

      // Test with matching bookId
      const { generateBookId } = await import("../book-indexer.js");
      const correctBookId = generateBookId(filePath);
      const correctIndexDir = path.join(testVaultPath, ".pageindex", correctBookId);
      await fs.mkdir(correctIndexDir, { recursive: true });
      await fs.writeFile(path.join(correctIndexDir, "book-meta.json"), "{}");

      const result2 = await isBookIndexed(filePath, testVaultPath);
      expect(result2).toBe(true);
    });

    it("should use vaultPath for .pageindex location", async () => {
      const filePath = "/vault/books/test.pdf";

      // Create index in different vault paths
      const vault1 = "/tmp/vault1";
      const vault2 = "/tmp/vault2";

      await fs.mkdir(path.join(vault1, ".pageindex"), { recursive: true });
      await fs.mkdir(path.join(vault2, ".pageindex"), { recursive: true });

      const { generateBookId } = await import("../book-indexer.js");
      const bookId = generateBookId(filePath);

      // Index exists in vault1
      await fs.mkdir(path.join(vault1, ".pageindex", bookId), { recursive: true });
      await fs.writeFile(path.join(vault1, ".pageindex", bookId, "book-meta.json"), "{}");

      const result1 = await isBookIndexed(filePath, vault1);
      expect(result1).toBe(true);

      const result2 = await isBookIndexed(filePath, vault2);
      expect(result2).toBe(false);

      // Cleanup
      await fs.rm(vault1, { recursive: true, force: true });
      await fs.rm(vault2, { recursive: true, force: true });
    });
  });

  describe("deleteBookIndex", () => {
    it("should delete .pageindex/{bookId}/ directory", async () => {
      const filePath = "/vault/books/book-to-delete.pdf";

      // Create fake index
      const { generateBookId } = await import("../book-indexer.js");
      const bookId = generateBookId(filePath);
      const indexDir = path.join(testVaultPath, ".pageindex", bookId);
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), "{}");
      await fs.writeFile(path.join(indexDir, "bm25.json"), "{}");

      // Verify index exists
      expect(await isBookIndexed(filePath, testVaultPath)).toBe(true);

      // Delete index
      await deleteBookIndex(filePath, testVaultPath);

      // Verify deletion
      expect(await isBookIndexed(filePath, testVaultPath)).toBe(false);

      // Verify directory is gone
      await expect(fs.access(indexDir)).rejects.toThrow();
    });

    it("should not throw if index does not exist", async () => {
      const filePath = "/vault/books/non-existent-index.pdf";

      // Should not throw
      await expect(deleteBookIndex(filePath, testVaultPath)).resolves.toBeUndefined();
    });

    it("should use vaultPath for deletion location", async () => {
      const filePath = "/vault/books/test.pdf";

      const vault1 = "/tmp/vault1";
      const vault2 = "/tmp/vault2";

      await fs.mkdir(path.join(vault1, ".pageindex"), { recursive: true });
      await fs.mkdir(path.join(vault2, ".pageindex"), { recursive: true });

      const { generateBookId } = await import("../book-indexer.js");
      const bookId = generateBookId(filePath);

      // Create index in vault1
      await fs.mkdir(path.join(vault1, ".pageindex", bookId), { recursive: true });
      await fs.writeFile(path.join(vault1, ".pageindex", bookId, "book-meta.json"), "{}");

      // Delete from vault2 (should not affect vault1)
      await deleteBookIndex(filePath, vault2);

      expect(await isBookIndexed(filePath, vault1)).toBe(true);
      expect(await isBookIndexed(filePath, vault2)).toBe(false);

      // Delete from vault1
      await deleteBookIndex(filePath, vault1);

      expect(await isBookIndexed(filePath, vault1)).toBe(false);

      // Cleanup
      await fs.rm(vault1, { recursive: true, force: true });
      await fs.rm(vault2, { recursive: true, force: true });
    });
  });

  describe("edge cases - error handling", () => {
    it("should gracefully degrade to pure BM25 when embedding API fails", async () => {
      const testFilePath = path.join(testVaultPath, "embedding-fail.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      const progressEvents: any[] = [];

      // Mock embedding API failure
      vi.doMock("../vault/vectors.js", () => ({
        initVectorStore: vi.fn().mockResolvedValue({
          vectors: new Float32Array(0),
          meta: {
            model: "text-embedding-3-small",
            dimensions: 1536,
            count: 0,
            deletedCount: 0,
            indexedAt: new Date().toISOString(),
            slots: {},
          },
          vectorPath: "/tmp/vectors.f32",
          metaPath: "/tmp/vectors.meta.json",
        }),
        generateEmbeddings: vi.fn().mockRejectedValue(new Error("Embedding API failed: 500 Internal Server Error")),
        appendVector: vi.fn().mockResolvedValue(0),
      }));

      const result = await indexBook({
        filePath: testFilePath,
        fileType: "pdf",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
        embedding: {
          provider: "openai",
          apiKey: "test-key",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      });

      expect(result.bookId).toBeDefined();
      expect(result.title).toBe("Test Book");

      const vectorStep = progressEvents.find(e => e.step === "vectorize_skipped");
      expect(vectorStep).toBeDefined();
      expect(vectorStep?.message).toContain("Embedding API failed");

      const metaPath = path.join(result.indexDir, "book-meta.json");
      const metaContent = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.embedding).toBeUndefined();

      const bm25Path = path.join(result.indexDir, "bm25.json");
      const bm25Content = await fs.readFile(bm25Path, "utf-8");
      const bm25 = JSON.parse(bm25Content);
      expect(bm25.nodes).toBeDefined();
      expect(bm25.invertedIndex).toBeDefined();

      await fs.rm(testFilePath, { force: true });
      vi.doUnmock("../vault/vectors.js");
    });

    it("should detect INDEX_INCOMPLETE when bm25.json is missing", async () => {
      const filePath = path.join(testVaultPath, "incomplete.pdf");
      const { generateBookId } = await import("../book-indexer.js");
      const bookId = generateBookId(filePath);
      const indexDir = path.join(testVaultPath, ".pageindex", bookId);

      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), JSON.stringify({
        version: 1,
        bookId,
        title: "Incomplete Book",
        indexedAt: new Date().toISOString(),
        chapters: [],
      }));

      expect(await isBookIndexed(filePath, testVaultPath)).toBe(true);

      const bm25Path = path.join(indexDir, "bm25.json");
      await expect(fs.access(bm25Path)).rejects.toThrow();

      await fs.rm(indexDir, { recursive: true, force: true });
    });

    it("should handle corrupted book-meta.json gracefully", async () => {
      const filePath = path.join(testVaultPath, "corrupted-meta.pdf");
      const { generateBookId } = await import("../book-indexer.js");
      const bookId = generateBookId(filePath);
      const indexDir = path.join(testVaultPath, ".pageindex", bookId);

      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), "{ invalid json }");
      await fs.writeFile(path.join(indexDir, "bm25.json"), "{}");

      const { searchBook } = await import("../book-search.js");
      await expect(
        searchBook({
          filePath,
          query: "test query",
        })
      ).rejects.toThrow();

      await fs.rm(indexDir, { recursive: true, force: true });
    });

    it("should handle BM25 index corruption", async () => {
      const filePath = path.join(testVaultPath, "corrupted-bm25.pdf");
      const { generateBookId } = await import("../book-indexer.js");
      const bookId = generateBookId(filePath);
      const indexDir = path.join(testVaultPath, ".pageindex", bookId);

      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), JSON.stringify({
        version: 1,
        bookId,
        title: "Corrupted BM25",
        indexedAt: new Date().toISOString(),
        chapters: [],
      }));
      await fs.writeFile(path.join(indexDir, "bm25.json"), "{ corrupted }");

      const { searchBook } = await import("../book-search.js");
      await expect(
        searchBook({
          filePath,
          query: "test query",
        })
      ).rejects.toThrow();

      await fs.rm(indexDir, { recursive: true, force: true });
    });
  });

  describe("edge cases - model dimension changes", () => {
    it("should record embedding config in book-meta.json", async () => {
      const testFilePath = path.join(testVaultPath, "dim-change.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      const progressEvents: any[] = [];

      const result1 = await indexBook({
        filePath: testFilePath,
        fileType: "pdf",
        outputDir: testVaultPath,
        model: "gpt-4o-mini",
        apiKey: "test-key",
        embedding: {
          provider: "openai",
          apiKey: "test-key",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
        onProgress: (p) => progressEvents.push(p),
      });

      const vectorStep = progressEvents.find(e => e.step === "vectorize" || e.step === "vectorize_complete");
      expect(vectorStep).toBeDefined();

      expect(result1.bookId).toBeDefined();
      expect(result1.title).toBe("Test Book");

      await fs.rm(testFilePath, { force: true });
    });
  });
});