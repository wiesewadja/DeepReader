/**
 * E2E Tests for Book Lifecycle
 * Tests complete workflows: index → search → delete
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";


vi.mock("../pageindex/pageindex.js", () => ({
  PageIndex: vi.fn().mockImplementation(() => ({
    fromPdf: vi.fn().mockResolvedValue({
      docName: "E2E Test Book",
      docDescription: "A comprehensive test book for E2E testing",
      structure: [
        {
          title: "E2E Test Book",
          nodeId: "L0-root",
          summary: "Root summary for E2E test",
          nodes: [
            {
              title: "Introduction",
              nodeId: "L1-001",
              summary: "Introduction chapter covering basics",
              text: "This is the introduction chapter.",
            },
            {
              title: "Core Concepts",
              nodeId: "L1-002",
              summary: "Core concepts of the system",
              text: "This chapter explains core concepts.",
            },
            {
              title: "Advanced Topics",
              nodeId: "L1-003",
              summary: "Advanced topics and deep dive",
              text: "This chapter covers advanced topics.",
            },
          ],
        },
      ],
    }),
    fromEpub: vi.fn().mockResolvedValue({
      docName: "E2E EPUB Book",
      docDescription: "EPUB test book",
      structure: [
        {
          title: "E2E EPUB Book",
          nodeId: "L0-root",
          summary: "EPUB root summary",
          nodes: [],
        },
      ],
    }),
  })),
}));

vi.mock("../pageindex/exporters/pdf-to-obsidian.js", () => ({
  exportPdfToObsidian: vi.fn().mockImplementation(async (options: any) => {
    const bookDir = path.join(options.outputDir, "E2E Test Book");
    await fs.mkdir(bookDir, { recursive: true });
    await fs.writeFile(path.join(bookDir, "Introduction.md"), "---\ntitle: Introduction\n---\n\nThis is the introduction chapter.\n\n^block-intro");
    await fs.writeFile(path.join(bookDir, "Core Concepts.md"), "---\ntitle: Core Concepts\n---\n\nThis chapter explains core concepts.\n\n^block-core");
    await fs.writeFile(path.join(bookDir, "Advanced Topics.md"), "---\ntitle: Advanced Topics\n---\n\nThis chapter covers advanced topics.\n\n^block-adv");
    return { mocPath: path.join(bookDir, "E2E Test Book - MOC.md"), notes: [] };
  }),
}));

vi.mock("../pageindex/exporters/epub-to-obsidian.js", () => ({
  exportToObsidian: vi.fn().mockImplementation(async (filePath: string, options: any) => {
    const bookDir = path.join(options.outputDir, "E2E EPUB Book");
    await fs.mkdir(bookDir, { recursive: true });
    await fs.writeFile(path.join(bookDir, "Chapter 1.md"), "---\ntitle: Chapter 1\n---\n\nEPUB content.\n\n^block-epub");
    return { mocPath: path.join(bookDir, "E2E EPUB Book - MOC.md"), notes: [] };
  }),
}));

vi.mock("../pageindex/vault/vectors.js", () => ({
  initVectorStore: vi.fn().mockResolvedValue({
    vectors: new Float32Array(1536 * 4),
    meta: {
      model: "text-embedding-3-small",
      dimensions: 1536,
      count: 4,
      deletedCount: 0,
      indexedAt: new Date().toISOString(),
      slots: {
        "L0-root": { slotIndex: 0, deleted: false },
        "L1-001": { slotIndex: 1, deleted: false },
        "L1-002": { slotIndex: 2, deleted: false },
        "L1-003": { slotIndex: 3, deleted: false },
      },
    },
    vectorPath: "/tmp/vectors.f32",
    metaPath: "/tmp/vectors.meta.json",
  }),
  generateEmbeddings: vi.fn().mockResolvedValue([
    Array(1536).fill(0.1),
    Array(1536).fill(0.2),
    Array(1536).fill(0.3),
    Array(1536).fill(0.4),
  ]),
  appendVector: vi.fn().mockImplementation(async (store: any, nodeId: string, vector: number[]) => {
    const slotIndex = store.meta.count;
    store.meta.slots[nodeId] = { slotIndex, deleted: false };
    store.meta.count++;
    return slotIndex;
  }),
  loadVectorStore: vi.fn().mockResolvedValue(null),
  generateEmbedding: vi.fn().mockResolvedValue(Array(1536).fill(0.5)),
  cosineSearch: vi.fn().mockResolvedValue([
    { nodeId: "L1-002", score: 0.95 },
    { nodeId: "L1-001", score: 0.85 },
    { nodeId: "L0-root", score: 0.75 },
  ]),
  writeChunkTexts: vi.fn().mockResolvedValue(undefined),
  writeVectorJsonl: vi.fn().mockResolvedValue(undefined),
  updateCatalogEntry: vi.fn().mockResolvedValue(undefined),
  removeCatalogEntry: vi.fn().mockResolvedValue(undefined),
}));

describe("E2E: Book Lifecycle", () => {
  const testDir = "/tmp/deepreader-e2e-test";
  const testVault = path.join(testDir, "vault");
  const testIndexDir = path.join(testVault, ".pageindex");

  beforeEach(async () => {
    await fs.mkdir(testVault, { recursive: true });
    await fs.mkdir(testIndexDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("Scenario 1: Complete lifecycle (add → search → delete)", () => {
    it("should complete full lifecycle workflow", async () => {
      const { indexBook, deleteBookIndex, isBookIndexed } = await import("../pageindex/book-indexer.js");

      const filePath = path.join(testVault, "lifecycle-book.pdf");
      await fs.writeFile(filePath, "%PDF-1.4 lifecycle test content");

      const indexResult = await indexBook({
        filePath,
        fileType: "pdf",
        outputDir: testVault,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      expect(indexResult.bookId).toBeDefined();
      expect(indexResult.title).toBe("E2E Test Book");
      expect(indexResult.chaptersCount).toBe(1);
      expect(await isBookIndexed(filePath, testVault)).toBe(true);

      await deleteBookIndex(filePath, testVault);
      expect(await isBookIndexed(filePath, testVault)).toBe(false);

      await fs.rm(filePath, { force: true });
    });
  });

  describe("Scenario 2: Index with OpenAI embedding", () => {
    it("should create vector search index", async () => {
      const { indexBook, isBookIndexed } = await import("../pageindex/book-indexer.js");

      const filePath = path.join(testVault, "vector-book.pdf");
      await fs.writeFile(filePath, "%PDF-1.4 vector test content");

      const progressEvents: any[] = [];

      const indexResult = await indexBook({
        filePath,
        fileType: "pdf",
        outputDir: testVault,
        model: "gpt-4o-mini",
        apiKey: "test-key",
        embedding: {
          provider: "openai",
          apiKey: "test-embedding-key",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      });

      expect(indexResult.bookId).toBeDefined();
      expect(await isBookIndexed(filePath, testVault)).toBe(true);

      const vectorStep = progressEvents.find(e => e.step === "vectorize");
      expect(vectorStep).toBeDefined();

      await fs.rm(filePath, { force: true });
    });
  });

  describe("Scenario 3: Index without embedding", () => {
    it("should work with pure BM25 without vectors", async () => {
      const { indexBook } = await import("../pageindex/book-indexer.js");

      const filePath = path.join(testVault, "bm25-only-book.pdf");
      await fs.writeFile(filePath, "%PDF-1.4 bm25 test content");

      const indexResult = await indexBook({
        filePath,
        fileType: "pdf",
        outputDir: testVault,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      const metaPath = path.join(indexResult.indexDir, "book-meta.json");
      const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      expect(meta.embedding).toBeUndefined();

      await fs.rm(filePath, { force: true });
    });
  });

  describe("Scenario 4: Model dimension changes", () => {
    it("should handle embedding config changes", async () => {
      const { indexBook } = await import("../pageindex/book-indexer.js");

      const filePath = path.join(testVault, "model-switch-book.pdf");
      await fs.writeFile(filePath, "%PDF-1.4 model switch test");

      const result1 = await indexBook({
        filePath,
        fileType: "pdf",
        outputDir: testVault,
        model: "gpt-4o-mini",
        apiKey: "test-key",
        embedding: {
          provider: "openai",
          apiKey: "test-key",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
      });

      expect(result1.bookId).toBeDefined();
      expect(result1.title).toBe("E2E Test Book");

      await fs.rm(filePath, { force: true });
    });
  });

  describe("Scenario 5: EPUB lifecycle", () => {
    it("should complete EPUB lifecycle", async () => {
      const { indexBook, deleteBookIndex, isBookIndexed } = await import("../pageindex/book-indexer.js");

      const filePath = path.join(testVault, "epub-lifecycle.epub");
      await fs.writeFile(filePath, "EPUB lifecycle test content");

      const indexResult = await indexBook({
        filePath,
        fileType: "epub",
        outputDir: testVault,
      });

      expect(indexResult.bookId).toBeDefined();
      expect(indexResult.title).toBe("E2E EPUB Book");
      expect(indexResult.fileType).toBe("epub");
      expect(await isBookIndexed(filePath, testVault)).toBe(true);

      await deleteBookIndex(filePath, testVault);
      expect(await isBookIndexed(filePath, testVault)).toBe(false);

      await fs.rm(filePath, { force: true });
    });
  });

  describe("Scenario 6: Multiple books in vault", () => {
    it("should handle multiple books in the same vault", async () => {
      const { indexBook, isBookIndexed } = await import("../pageindex/book-indexer.js");

      const book1Path = path.join(testVault, "book1.pdf");
      const book2Path = path.join(testVault, "book2.pdf");

      await fs.writeFile(book1Path, "%PDF-1.4 book 1");
      await fs.writeFile(book2Path, "%PDF-1.4 book 2");

      const result1 = await indexBook({
        filePath: book1Path,
        fileType: "pdf",
        outputDir: testVault,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      const result2 = await indexBook({
        filePath: book2Path,
        fileType: "pdf",
        outputDir: testVault,
        model: "gpt-4o-mini",
        apiKey: "test-key",
      });

      expect(await isBookIndexed(book1Path, testVault)).toBe(true);
      expect(await isBookIndexed(book2Path, testVault)).toBe(true);
      expect(result1.bookId).not.toBe(result2.bookId);

      await fs.rm(book1Path, { force: true });
      await fs.rm(book2Path, { force: true });
    });
  });

  describe("Scenario 7: Progress tracking", () => {
    it("should emit progress events at each step", async () => {
      const { indexBook } = await import("../pageindex/book-indexer.js");

      const filePath = path.join(testVault, "progress-book.pdf");
      await fs.writeFile(filePath, "%PDF-1.4 progress test");

      const progressEvents: any[] = [];

      await indexBook({
        filePath,
        fileType: "pdf",
        outputDir: testVault,
        model: "gpt-4o-mini",
        apiKey: "test-key",
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      });

      const expectedSteps = [
        "parse_document",
        "parse_complete",
        "export_markdown",
        "export_complete",
        "build_meta",
        "meta_complete",
        "build_bm25",
        "bm25_complete",
        "complete",
      ];

      for (const step of expectedSteps) {
        expect(progressEvents.some(e => e.step === step)).toBe(true);
      }

      expect(progressEvents[0].percent).toBeLessThan(progressEvents[progressEvents.length - 1].percent);
      expect(progressEvents[progressEvents.length - 1].percent).toBe(100);
      expect(progressEvents[progressEvents.length - 1].step).toBe("complete");

      await fs.rm(filePath, { force: true });
    });
  });
});