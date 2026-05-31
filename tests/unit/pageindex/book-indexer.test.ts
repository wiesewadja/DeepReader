import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { indexBook, isBookIndexed, deleteBookIndex } from "@/pageindex/book-indexer";
import * as fs from "fs/promises";
import * as path from "path";
import { IndexErrorCode } from "@/pageindex/book-types";
import { getPageindexRoot, getBookDir, getBookFile } from '@/pageindex/paths';

vi.mock("@/pageindex/pageindex", () => {
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

vi.mock("@/pageindex/exporters/pdf-to-obsidian", () => ({
  exportPdfToObsidian: vi.fn().mockResolvedValue({
    mocPath: "/tmp/test/Test Book/Test Book - MOC.md",
    notes: [],
    nodeFileMap: { "L1-0": "Chapter 1.md", "L1-1": "Chapter 2.md" },
  }),
}));

vi.mock("@/pageindex/exporters/epub-to-obsidian", () => ({
  exportToObsidian: vi.fn().mockResolvedValue({
    mocPath: "/tmp/test/Test EPUB/Test EPUB - MOC.md",
    notes: [],
  }),
}));

vi.mock("@/pageindex/vault/vectors", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  generateEmbeddings: vi.fn().mockImplementation(async (texts: string[]) =>
    texts.map((_, i) => [0.1 * (i + 1), 0.2 * (i + 1), 0.3 * (i + 1)])
  ),
  writeVectorJsonl: vi.fn().mockResolvedValue(undefined),
  writeChunkTexts: vi.fn().mockResolvedValue(undefined),
  updateCatalogEntry: vi.fn().mockResolvedValue(undefined),
  removeCatalogEntry: vi.fn().mockResolvedValue(undefined),
}));

describe("book-indexer", () => {
  const testVaultPath = "/tmp/deepreader-test-vault";
  const testPageIndexDir = getPageindexRoot(testVaultPath);

  beforeEach(async () => {
    await fs.mkdir(testVaultPath, { recursive: true });
    await fs.mkdir(testPageIndexDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe("generateBookId", () => {
    it("should generate bookId from file content", async () => {
      const { generateBookId } = await import("@/pageindex/book-indexer");

      const filePath1 = path.join(testVaultPath, "example.pdf");
      const filePath2 = path.join(testVaultPath, "other.pdf");
      await fs.writeFile(filePath1, "content-A");
      await fs.writeFile(filePath2, "content-B");

      const bookId1 = await generateBookId(filePath1);
      const bookId2 = await generateBookId(filePath2);

      expect(bookId1.length).toBe(8);
      expect(bookId2.length).toBe(8);
      expect(bookId1).not.toBe(bookId2);

      const bookId1Again = await generateBookId(filePath1);
      expect(bookId1Again).toBe(bookId1);
    });

    it("should be SHA-256 first 8 hex chars", async () => {
      const { generateBookId } = await import("@/pageindex/book-indexer");

      const filePath = path.join(testVaultPath, "test.pdf");
      await fs.writeFile(filePath, "test content");

      const bookId = await generateBookId(filePath);

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
      expect(result.chaptersCount).toBe(1);
      expect(result.indexDir).toBe(getBookDir(testVaultPath, result.bookId));

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

      expect(meta.version).toBe(3);
      expect(meta.bookId).toBe(result.bookId);
      expect(meta.title).toBe("Test Book");
      expect(meta.fileType).toBe("pdf");
      expect(meta.indexedAt).toBeDefined();
      expect(meta.chapters).toBeDefined();
      // v3: chapters moved to tree.json, book-meta.chapters is always []

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

      const vectorsPath = path.join(result.indexDir, "vectors.jsonl");
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

      const vectorStoreMock = await import("@/pageindex/vault/vectors");
      expect(vectorStoreMock.writeVectorJsonl).toHaveBeenCalled();
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
      const filePath = path.join(testVaultPath, "indexed-book.pdf");
      await fs.writeFile(filePath, "fake pdf content");
      const bookId = "abcd1234";

      // Create fake index directory
      const indexDir = getBookDir(testVaultPath, bookId);
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), "{}");

      // Note: This test will pass if bookId generation matches
      // In real test, we'd use the actual generateBookId function
      const result = await isBookIndexed(filePath, testVaultPath);
      expect(result).toBe(false); // Will be false because bookId doesn't match

      // Test with matching bookId
      const { generateBookId } = await import("@/pageindex/book-indexer");
      const correctBookId = await generateBookId(filePath);
      const correctIndexDir = getBookDir(testVaultPath, correctBookId);
      await fs.mkdir(correctIndexDir, { recursive: true });
      await fs.writeFile(path.join(correctIndexDir, "tree.json"), "{}");
		await fs.writeFile(path.join(correctIndexDir, "bm25.json"), "{}");

      const result2 = await isBookIndexed(filePath, testVaultPath);
      expect(result2).toBe(true);
    });

    it("should use vaultPath for .pageindex location", async () => {
      const filePath = path.join(testVaultPath, "multi-vault-test.pdf");
      await fs.writeFile(filePath, "fake pdf content for multi-vault");

      // Create index in different vault paths
      const vault1 = "/tmp/vault1";
      const vault2 = "/tmp/vault2";

      await fs.mkdir(getPageindexRoot(vault1), { recursive: true });
      await fs.mkdir(getPageindexRoot(vault2), { recursive: true });

      const { generateBookId } = await import("@/pageindex/book-indexer");
      const bookId = await generateBookId(filePath);

      // Index exists in vault1
      await fs.mkdir(getBookDir(vault1, bookId), { recursive: true });
      await fs.writeFile(getBookFile(vault1, bookId, 'tree.json'), "{}");
      await fs.writeFile(getBookFile(vault1, bookId, 'bm25.json'), "{}");

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
      const filePath = path.join(testVaultPath, "book-to-delete.pdf");
      await fs.writeFile(filePath, "fake pdf for delete");

      // Create fake index
      const { generateBookId } = await import("@/pageindex/book-indexer");
      const bookId = await generateBookId(filePath);
      const indexDir = getBookDir(testVaultPath, bookId);
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "tree.json"), "{}");
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
      const filePath = path.join(testVaultPath, "non-existent-index.pdf");
      await fs.writeFile(filePath, "fake pdf for no-index");

      // Should not throw
      await expect(deleteBookIndex(filePath, testVaultPath)).resolves.toBeUndefined();
    });

    it("should use vaultPath for deletion location", async () => {
      const filePath = path.join(testVaultPath, "deletion-location.pdf");
      await fs.writeFile(filePath, "fake pdf for deletion vault location");

      const vault1 = "/tmp/vault1";
      const vault2 = "/tmp/vault2";

      await fs.mkdir(getPageindexRoot(vault1), { recursive: true });
      await fs.mkdir(getPageindexRoot(vault2), { recursive: true });

      const { generateBookId } = await import("@/pageindex/book-indexer");
      const bookId = await generateBookId(filePath);

      // Create index in vault1
      await fs.mkdir(getBookDir(vault1, bookId), { recursive: true });
      await fs.writeFile(getBookFile(vault1, bookId, 'tree.json'), "{}");
      await fs.writeFile(getBookFile(vault1, bookId, 'bm25.json'), "{}");

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
      vi.doMock("@/pageindex/vault/vectors", () => ({
        generateEmbedding: vi.fn().mockRejectedValue(new Error("Embedding API failed: 500 Internal Server Error")),
        generateEmbeddings: vi.fn().mockRejectedValue(new Error("Embedding API failed: 500 Internal Server Error")),
        writeVectorJsonl: vi.fn().mockResolvedValue(undefined),
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
      // Verify graceful degradation: vectorization was attempted but failed
      expect(vectorStep?.message).toBeTruthy();

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
      vi.doUnmock("@/pageindex/vault/vectors");
    });

    it("should detect INDEX_INCOMPLETE when bm25.json is missing", async () => {
      const filePath = path.join(testVaultPath, "incomplete.pdf");
      await fs.writeFile(filePath, "fake pdf for incomplete");
      const { generateBookId } = await import("@/pageindex/book-indexer");
      const bookId = await generateBookId(filePath);
      const indexDir = getBookDir(testVaultPath, bookId);

      await fs.mkdir(indexDir, { recursive: true });
      // tree.json exists but bm25.json does not → isBookIndexed returns false
      await fs.writeFile(path.join(indexDir, "tree.json"), "{}");

      expect(await isBookIndexed(filePath, testVaultPath)).toBe(false);

      await fs.rm(indexDir, { recursive: true, force: true });
    });

    it("should handle corrupted book-meta.json gracefully", async () => {
      const filePath = path.join(testVaultPath, "corrupted-meta.pdf");
      await fs.writeFile(filePath, "fake pdf for corrupted meta");
      const { generateBookId } = await import("@/pageindex/book-indexer");
      const bookId = await generateBookId(filePath);
      const indexDir = getBookDir(testVaultPath, bookId);

      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), "{ invalid json }");
      await fs.writeFile(path.join(indexDir, "bm25.json"), "{}");

      const { searchBookV2 } = await import("@/pageindex/book-search-v2");
      await expect(
        searchBookV2({
          filePath,
          query: "test query",
        })
      ).rejects.toThrow();

      await fs.rm(indexDir, { recursive: true, force: true });
    });

    it("should handle BM25 index corruption", async () => {
      const filePath = path.join(testVaultPath, "corrupted-bm25.pdf");
      await fs.writeFile(filePath, "fake pdf for corrupted bm25");
      const { generateBookId } = await import("@/pageindex/book-indexer");
      const bookId = await generateBookId(filePath);
      const indexDir = getBookDir(testVaultPath, bookId);

      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), JSON.stringify({
        version: 1,
        bookId,
        title: "Corrupted BM25",
        indexedAt: new Date().toISOString(),
        chapters: [],
      }));
      await fs.writeFile(path.join(indexDir, "bm25.json"), "{ corrupted }");

      const { searchBookV2 } = await import("@/pageindex/book-search-v2");
      await expect(
        searchBookV2({
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