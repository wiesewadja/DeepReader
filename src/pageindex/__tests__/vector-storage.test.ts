import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import {
  writeVectorJsonl,
  readVectorJsonl,
  cosineSearchJsonl,
  loadCatalog,
  updateCatalogEntry,
  removeCatalogEntry,
} from "../vault/vectors.js";
import type { VectorRecord, CatalogBookEntry } from "../vault/types.js";

describe("JSONL Vector Storage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vec-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const record1: VectorRecord = {
    chunkId: "0001_summary",
    nodeId: "0001",
    blockIds: [],
    type: "summary",
    level: "L1",
    vector: [0.1, 0.2, 0.3],
  };
  const record2: VectorRecord = {
    chunkId: "0002_summary",
    nodeId: "0002",
    blockIds: [],
    type: "summary",
    level: "L1",
    vector: [0.4, 0.5, 0.6],
  };

  it("should write and read vector records", async () => {
    const filePath = path.join(tempDir, "vectors.jsonl");
    await writeVectorJsonl(filePath, [record1, record2]);

    const records = await readVectorJsonl(filePath);
    expect(records).toHaveLength(2);
    expect(records[0].nodeId).toBe("0001");
    expect(records[0].vector).toEqual([0.1, 0.2, 0.3]);
    expect(records[1].nodeId).toBe("0002");
  });

  it("should return empty array for missing file", async () => {
    const records = await readVectorJsonl(path.join(tempDir, "nope.jsonl"));
    expect(records).toEqual([]);
  });

  it("should perform cosine search on records", async () => {
    const filePath = path.join(tempDir, "vectors.jsonl");
    await writeVectorJsonl(filePath, [record1, record2]);

    const results = await cosineSearchJsonl(filePath, [0.4, 0.5, 0.6], 1);
    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe("0002");
    expect(results[0].chunkId).toBe("0002_summary");
    expect(results[0].score).toBeCloseTo(1.0, 4);
  });

  it("should return all results sorted by score", async () => {
    const filePath = path.join(tempDir, "vectors.jsonl");
    await writeVectorJsonl(filePath, [record1, record2]);

    const results = await cosineSearchJsonl(filePath, [0.4, 0.5, 0.6], 10);
    expect(results).toHaveLength(2);
    expect(results[0].nodeId).toBe("0002");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});

describe("Vector Catalog", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const entry: CatalogBookEntry = {
    title: "如何阅读一本书",
    vectorModel: "text-embedding-3-small",
    dimensions: 1536,
    nodeCount: 20,
    hasPropositions: false,
    indexedAt: "2026-04-19T00:00:00Z",
  };

  it("should create catalog on first update", async () => {
    await updateCatalogEntry(tempDir, "a1b2c3d4", entry);
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books["a1b2c3d4"]).toBeDefined();
    expect(catalog.books["a1b2c3d4"].title).toBe("如何阅读一本书");
  });

  it("should update existing entry", async () => {
    await updateCatalogEntry(tempDir, "a1b2c3d4", entry);
    await updateCatalogEntry(tempDir, "a1b2c3d4", {
      ...entry,
      nodeCount: 25,
    });
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books["a1b2c3d4"].nodeCount).toBe(25);
  });

  it("should remove entry", async () => {
    await updateCatalogEntry(tempDir, "a1b2c3d4", entry);
    await removeCatalogEntry(tempDir, "a1b2c3d4");
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books["a1b2c3d4"]).toBeUndefined();
  });

  it("should return empty catalog when file missing", async () => {
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books).toEqual({});
  });
});
