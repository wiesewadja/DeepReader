import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { indexBook, isBookIndexed, deleteBookIndex } from "../book-indexer.js";
import * as fs from "fs/promises";
import * as path from "path";
import { IndexErrorCode } from "../book-types.js";

describe("book-indexer", () => {
  const testVaultPath = "/tmp/deepreader-test-vault";
  const testPageIndexDir = path.join(testVaultPath, ".pageindex");

  beforeEach(async () => {
    await fs.mkdir(testVaultPath, { recursive: true });
    await fs.mkdir(testPageIndexDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe("generateBookId", () => {
    it("should generate bookId from file path hash", async () => {
      // Import the function directly for testing
      const { generateBookId } = await import("../book-indexer.js");

      const filePath1 = "/vault/books/example.pdf";
      const filePath2 = "/vault/books/other.pdf";

      const bookId1 = generateBookId(filePath1);
      const bookId2 = generateBookId(filePath2);

      // Should be 8 characters
      expect(bookId1.length).toBe(8);
      expect(bookId2.length).toBe(8);

      // Different paths should generate different bookIds
      expect(bookId1).not.toBe(bookId2);

      // Same path should always generate same bookId
      const bookId1Again = generateBookId(filePath1);
      expect(bookId1Again).toBe(bookId1);
    });

    it("should be SHA-256 first 8 hex chars", async () => {
      const { generateBookId } = await import("../book-indexer.js");

      const filePath = "/test/path.pdf";
      const bookId = generateBookId(filePath);

      // Should match regex for hex string
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

    it("should throw 'Not implemented' for valid files (skeleton)", async () => {
      // Create a test PDF file
      const testFilePath = path.join(testVaultPath, "test.pdf");
      await fs.writeFile(testFilePath, "%PDF-1.4 test content");

      await expect(
        indexBook({
          filePath: testFilePath,
          fileType: "pdf",
          outputDir: testVaultPath,
        })
      ).rejects.toThrow("Not implemented");

      // Clean up
      await fs.rm(testFilePath);
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
});