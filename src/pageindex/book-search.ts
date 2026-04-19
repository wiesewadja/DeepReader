/**
 * Book search - hybrid vector + BM25 search with L2 context reading
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import type {
  BookSearchOptions,
  BookSearchResult,
  BookMeta,
  BM25Data,
} from "./book-types.js";
import { IndexErrorCode, IndexError } from "./book-types.js";
import { searchBM25 } from "./bm25.js";
import {
  generateEmbedding,
  cosineSearchJsonl,
} from "./vault/vectors.js";
import { existsSync } from "node:fs";

/**
 * Generate bookId from file path (SHA-256 first 8 chars)
 */
function generateBookId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

/**
 * Search a single book using hybrid vector + BM25 search
 * @param options - Book search options
 * @returns Search results with L2 context (chapter content)
 */
export async function searchBook(
  options: BookSearchOptions
): Promise<BookSearchResult[]> {
  const bookId = generateBookId(options.filePath);
  const vaultPath = path.dirname(options.filePath);
  const indexDir = path.join(vaultPath, ".pageindex", bookId);
  const topK = options.topK || 5;

  // Step 0: Validate index exists
  try {
    await fs.access(indexDir);
  } catch {
    throw new IndexError(
      "Index not found",
      IndexErrorCode.INDEX_INCOMPLETE,
      "书籍尚未索引，请先进行索引",
      "请在 Library 中添加此书籍"
    );
  }

  // Load book-meta.json
  const metaPath = path.join(indexDir, "book-meta.json");
  const metaContent = await fs.readFile(metaPath, "utf-8");
  const bookMeta = JSON.parse(metaContent) as BookMeta;

  // Load BM25 index
  const bm25Path = path.join(indexDir, "bm25.json");
  const bm25Content = await fs.readFile(bm25Path, "utf-8");
  const bm25Index = JSON.parse(bm25Content) as BM25Data;

  // Step 1: BM25 search
  const bm25Results = searchBM25(options.query, bm25Index, topK * 3);
  const bm25Scores: Map<string, number> = new Map();
  for (const result of bm25Results) {
    bm25Scores.set(result.nodeId, result.score);
  }

  // Step 2: Vector search (optional)
  let vectorScores: Map<string, number> = new Map();

  if (options.embedding) {
    try {
      const jsonlPath = path.join(indexDir, "vectors.jsonl");
      if (existsSync(jsonlPath)) {
        const queryVector = await generateEmbedding(
          options.query,
          options.embedding
        );
        const vectorResults = await cosineSearchJsonl(jsonlPath, queryVector, topK * 3);
        for (const result of vectorResults) {
          vectorScores.set(result.nodeId, result.score);
        }
      }
    } catch (error) {
      console.warn("[book-search] Vector search failed:", error);
      vectorScores = new Map();
    }
  }

  // Step 3: Fuse scores
  const fusedResults = fuseScores(
    vectorScores,
    bm25Scores,
    vectorScores.size > 0 ? 0.7 : 0,
    vectorScores.size > 0 ? 0.3 : 1.0
  );

  // Sort by fused score and take topK
  const sortedResults = Array.from(fusedResults.entries())
    .map(([nodeId, data]) => ({
      nodeId,
      score: data.fusedScore,
      vectorScore: data.vectorScore,
      bm25Score: data.bm25Score,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Step 4: L2 context reading
  const finalResults: BookSearchResult[] = [];

  for (const result of sortedResults) {
    const nodeId = result.nodeId;

    // Find chapter metadata
    const chapter = bookMeta.chapters.find((ch) => ch.id === nodeId);
    if (!chapter) {
      // L0 node (book root) - use description as context
      if (nodeId === "BOOK" || nodeId.startsWith("L0-") || nodeId === "book_" + bookId) {
        const mdFilePath = path.join(vaultPath, bookMeta.title + ".md");
        try {
          const { rawText, truncated } = await readChapterContent(
            mdFilePath,
            options.maxContextLength
          );
          finalResults.push({
            nodeId,
            level: "L0",
            bookTitle: bookMeta.title,
            chapterTitle: bookMeta.title,
            chapterSummary: bookMeta.description,
            rawText,
            mdFilePath: path.basename(mdFilePath),
            truncated,
            score: result.score,
            vectorScore: result.vectorScore,
            bm25Score: result.bm25Score,
          });
        } catch {
          // Skip if file not found
        }
      }
      continue;
    }

    // L1 node (chapter)
    const mdFilePath = path.join(vaultPath, chapter.mdFilePath);
    try {
      const { rawText, truncated } = await readChapterContent(
        mdFilePath,
        options.maxContextLength
      );
      finalResults.push({
        nodeId,
        level: "L1",
        bookTitle: bookMeta.title,
        chapterTitle: chapter.title,
        chapterSummary: chapter.summary,
        rawText,
        mdFilePath: chapter.mdFilePath,
        truncated,
        score: result.score,
        vectorScore: result.vectorScore,
        bm25Score: result.bm25Score,
      });
    } catch {
      // Skip if file not found
    }
  }

  return finalResults;
}

/**
 * Fuse vector and BM25 scores
 * @param vectorScores - Vector similarity scores (Map<nodeId, score>)
 * @param bm25Scores - BM25 scores (Map<nodeId, score>)
 * @param w_v - Vector weight (0-1)
 * @param w_b - BM25 weight (0-1)
 * @returns Map<nodeId, {fusedScore, vectorScore, bm25Score}>
 */
function fuseScores(
  vectorScores: Map<string, number>,
  bm25Scores: Map<string, number>,
  w_v: number,
  w_b: number
): Map<string, { fusedScore: number; vectorScore: number; bm25Score: number }> {
  const fusedResults = new Map<
    string,
    { fusedScore: number; vectorScore: number; bm25Score: number }
  >();

  // Normalize BM25 scores (BM25 can have negative values)
  const bm25Max = Math.max(...Array.from(bm25Scores.values()), 0);
  const bm25Min = Math.min(...Array.from(bm25Scores.values()), 0);
  const bm25Range = bm25Max - bm25Min;

  // Collect all node IDs
  const allNodeIds = new Set([
    ...vectorScores.keys(),
    ...bm25Scores.keys(),
  ]);

  for (const nodeId of allNodeIds) {
    const vs = vectorScores.get(nodeId) || 0;
    const bs = bm25Scores.get(nodeId) || 0;

    // Normalize BM25 to [0, 1]
    const normalizedBM25 = bm25Range > 0 ? (bs - bm25Min) / bm25Range : 0;

    // Calculate fused score
    const fusedScore = w_v * vs + w_b * normalizedBM25;

    fusedResults.set(nodeId, {
      fusedScore,
      vectorScore: vs,
      bm25Score: bs,
    });
  }

  return fusedResults;
}

/**
 * Read chapter content from Markdown file
 * Removes frontmatter, navigation markers, and callouts
 * Preserves block IDs (^block-id) for FrontendAgent
 */
async function readChapterContent(
  mdFilePath: string,
  maxContextLength?: number
): Promise<{ rawText: string; truncated: boolean }> {
  const content = await fs.readFile(mdFilePath, "utf-8");

  // Remove frontmatter
  let cleaned = content.replace(/^---[\s\S]*?---\n/, "");

  // Remove navigation markers (wiki links)
  cleaned = cleaned.replace(/\[\[.*?\]\]/g, "");

  // Remove callout blocks (Obsidian callouts like > [!note])
  cleaned = cleaned.replace(/> \[!.*?\][^\n]*\n(> .*\n)*/g, "");

  // Remove Obsidian comment markers
  cleaned = cleaned.replace(/%%.*?%%/g, "");

  // Trim whitespace
  cleaned = cleaned.trim();

  // Truncate if needed
  const maxLen = maxContextLength || 10000;
  const truncated = cleaned.length > maxLen;
  const rawText = truncated
    ? cleaned.slice(0, maxLen) + "\n... (truncated)"
    : cleaned;

  return { rawText, truncated };
}