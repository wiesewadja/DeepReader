import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { migrateBookIndexes } from "../book-indexer.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

vi.mock("../vault/vectors.js", () => ({
  loadCatalog: vi.fn().mockResolvedValue({ version: 1, books: {} }),
  updateCatalogEntry: vi.fn().mockResolvedValue(undefined),
  removeCatalogEntry: vi.fn().mockResolvedValue(undefined),
}));

function makeBookIdFromContent(content: string): string {
  const buf = Buffer.from(content);
  const hash = crypto.createHash("sha256");
  hash.update(buf);
  hash.update(Buffer.from(String(buf.length)));
  return hash.digest("hex").slice(0, 8);
}

describe("migrateBookIndexes", () => {
  const testDir = "/tmp/deepreader-migration-test";
  const pageindexDir = path.join(testDir, ".pageindex");

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(pageindexDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should return 0 when .pageindex/ doesn't exist", async () => {
    await fs.rm(pageindexDir, { recursive: true, force: true });
    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);
  });

  it("should return 0 for empty .pageindex/", async () => {
    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);
  });

  it("should skip entries without book-meta.json", async () => {
    await fs.mkdir(path.join(pageindexDir, "nometa"), { recursive: true });
    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);
  });

  it("should skip entries with missing source file", async () => {
    const oldId = "deadbeef";
    const dir = path.join(pageindexDir, oldId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "book-meta.json"), JSON.stringify({
      version: 3,
      bookId: oldId,
      title: "Missing File",
      filePath: "/nonexistent/file.pdf",
    }));
    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);
    // Directory should still exist (not renamed)
    await expect(fs.access(dir)).resolves.toBeUndefined();
  });

  it("should migrate a valid index to content-based bookId", async () => {
    const content = "This is a PDF file content for migration test";
    const filePath = path.join(testDir, "mybook.pdf");
    await fs.writeFile(filePath, content);
    const newId = makeBookIdFromContent(content);
    const oldId = "abcd1234";

    const dir = path.join(pageindexDir, oldId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "book-meta.json"), JSON.stringify({
      version: 3,
      bookId: oldId,
      title: "My Book",
      exportName: "My Book",
      filePath,
    }));
    await fs.writeFile(path.join(dir, "tree.json"), "{}");

    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(1);

    // Old directory should be gone
    await expect(fs.access(dir)).rejects.toThrow();

    // New directory should exist
    const newDir = path.join(pageindexDir, newId);
    await expect(fs.access(newDir)).resolves.toBeUndefined();

    // book-meta.json should have updated bookId
    const meta = JSON.parse(await fs.readFile(path.join(newDir, "book-meta.json"), "utf-8"));
    expect(meta.bookId).toBe(newId);
  });

  it("should be idempotent (running twice produces same result)", async () => {
    const content = "Idempotency test content";
    const filePath = path.join(testDir, "idempotent.pdf");
    await fs.writeFile(filePath, content);
    const oldId = "aaaa1111";

    const dir = path.join(pageindexDir, oldId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "book-meta.json"), JSON.stringify({
      version: 3,
      bookId: oldId,
      title: "Idempotent Book",
      filePath,
    }));

    const count1 = await migrateBookIndexes(testDir);
    expect(count1).toBe(1);

    const count2 = await migrateBookIndexes(testDir);
    expect(count2).toBe(0); // Marker file prevents re-scan
  });

  it("should skip journal indexes", async () => {
    const journalDir = path.join(pageindexDir, "journal_abcd1234");
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(path.join(journalDir, "book-meta.json"), JSON.stringify({
      bookId: "journal_abcd1234",
      filePath: "/some/journal",
    }));
    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);
  });

  it("should skip when already migrated (directory name matches content hash)", async () => {
    const content = "Already migrated";
    const filePath = path.join(testDir, "already.pdf");
    await fs.writeFile(filePath, content);
    const newId = makeBookIdFromContent(content);

    const dir = path.join(pageindexDir, newId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "book-meta.json"), JSON.stringify({
      version: 3,
      bookId: newId,
      title: "Already Migrated",
      filePath,
    }));

    // Run migration — newId === content hash, so it detects nothing to rename
    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);
  });

  it("should skip on collision (target directory already exists)", async () => {
    const content = "Collision test";
    const filePath = path.join(testDir, "collision.pdf");
    await fs.writeFile(filePath, content);
    const newId = makeBookIdFromContent(content);
    const oldId = "coll0001";

    // Create old index
    const oldDir = path.join(pageindexDir, oldId);
    await fs.mkdir(oldDir, { recursive: true });
    await fs.writeFile(path.join(oldDir, "book-meta.json"), JSON.stringify({
      version: 3,
      bookId: oldId,
      title: "Collision Book",
      filePath,
    }));

    // Pre-create target directory (collision)
    const newDir = path.join(pageindexDir, newId);
    await fs.mkdir(newDir, { recursive: true });
    await fs.writeFile(path.join(newDir, "book-meta.json"), JSON.stringify({
      version: 3,
      bookId: newId,
      title: "Existing Book",
    }));

    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);

    // Old directory should still exist (not renamed)
    await expect(fs.access(oldDir)).resolves.toBeUndefined();
  });

  it("should write migration marker after successful run", async () => {
    const count = await migrateBookIndexes(testDir);
    expect(count).toBe(0);

    const markerPath = path.join(pageindexDir, ".migrated-content-id-v1");
    const exists = await fs.access(markerPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
