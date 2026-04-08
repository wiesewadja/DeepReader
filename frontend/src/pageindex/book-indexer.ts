/**
 * Book indexer - orchestrates PDF/EPUB indexing workflow
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { PageIndex } from "./pageindex.js";
import type {
  BookIndexOptions,
  BookIndexResult,
  BookMeta,
  ChapterMeta,
  IndexErrorCode,
} from "./book-types.js";
import { IndexErrorCode as ErrorCode, IndexError } from "./book-types.js";
import { buildBM25Index } from "./bm25.js";

/**
 * Generate bookId from file path (SHA-256 first 8 chars)
 */
export function generateBookId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

/**
 * Check if book is already indexed
 * @param filePath - Book file path
 * @param vaultPath - Vault root path (where .pageindex directory is located)
 */
export async function isBookIndexed(filePath: string, vaultPath: string): Promise<boolean> {
  const bookId = generateBookId(filePath);
  const indexDir = path.join(vaultPath, ".pageindex", bookId);

  try {
    await fs.access(indexDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete book index
 * @param filePath - Book file path
 * @param vaultPath - Vault root path (where .pageindex directory is located)
 */
export async function deleteBookIndex(filePath: string, vaultPath: string): Promise<void> {
  const bookId = generateBookId(filePath);
  const indexDir = path.join(vaultPath, ".pageindex", bookId);

  await fs.rm(indexDir, { recursive: true, force: true });
}

/**
 * Index a single book
 * @param options - Book index options
 * @param options.outputDir - Vault root path (where .pageindex directory will be created)
 */
export async function indexBook(options: BookIndexOptions): Promise<BookIndexResult> {
  // Validate file exists
  try {
    await fs.access(options.filePath);
  } catch {
    throw new IndexError(
      "File not found",
      ErrorCode.FILE_NOT_FOUND,
      "文件不存在，请检查文件路径",
      "请确认文件路径是否正确"
    );
  }

  const bookId = generateBookId(options.filePath);
  const indexDir = path.join(options.outputDir, ".pageindex", bookId);

  // TODO: Implement full flow in Tasks 2.2-2.7
  // Step 1: Parse PDF/EPUB (PageIndex.fromPdf/fromEpub)
  // Step 2: Export to Markdown (exportToMarkdown)
  // Step 3: Generate book-meta.json
  // Step 4: Vectorize paragraphs (initVectorStore + generateEmbeddings)
  // Step 5: Build BM25 index
  // Step 6: Finalize and return result

  throw new Error("Not implemented - will be implemented in Tasks 2.2-2.7");
}