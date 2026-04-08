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
  ParagraphMeta,
  IndexErrorCode,
  BM25Data,
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

  // Step 1: Document parsing
  options.onProgress?.({
    percent: 5,
    step: "parse_document",
    stepLabel: "解析文档",
  });

  const pageIndex = new PageIndex({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    addNodeText: true,
    addNodeSummary: true,
  });

  let parseResult;
  try {
    if (options.fileType === "pdf") {
      parseResult = await pageIndex.fromPdf(options.filePath);
    } else {
      parseResult = await pageIndex.fromEpub(options.filePath);
    }
  } catch (error) {
    throw new IndexError(
      `Document parsing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ErrorCode.FILE_NOT_FOUND,
      "文档解析失败",
      "请检查文件格式是否正确"
    );
  }

  options.onProgress?.({
    percent: 15,
    step: "parse_complete",
    stepLabel: "文档解析完成",
  });

  const rootTitle = parseResult.structure[0]?.title || parseResult.docName || "Unknown";
  const bookDir = path.join(options.outputDir, rootTitle);

  // Step 2: Markdown export
  options.onProgress?.({
    percent: 40,
    step: "export_markdown",
    stepLabel: "导出 Markdown",
  });

  try {
    if (options.fileType === "pdf") {
      const { exportPdfToObsidian } = await import("./exporters/pdf-to-obsidian.js");
      await exportPdfToObsidian(options.filePath, {
        outputDir: options.outputDir,
        pageOptions: {
          model: options.model,
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
        },
        sourcePdf: options.filePath,
      });
    } else {
      const { exportToObsidian } = await import("./exporters/epub-to-obsidian.js");
      await exportToObsidian(options.filePath, {
        outputDir: options.outputDir,
      });
    }
  } catch (error) {
    throw new IndexError(
      `Markdown export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ErrorCode.MD_PARSE_ERROR,
      "Markdown 导出失败",
      "请检查输出目录是否有写入权限"
    );
  }

  options.onProgress?.({
    percent: 75,
    step: "export_complete",
    stepLabel: "Markdown 导出完成",
  });

  // Step 3: Build book-meta.json
  options.onProgress?.({
    percent: 80,
    step: "build_meta",
    stepLabel: "构建元数据",
  });

  const bookMeta = await buildBookMeta(
    parseResult,
    bookId,
    bookDir,
    options.filePath,
    options.fileType,
    options.embedding
  );

  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(
    path.join(indexDir, "book-meta.json"),
    JSON.stringify(bookMeta, null, 2)
  );

  options.onProgress?.({
    percent: 85,
    step: "meta_complete",
    stepLabel: "元数据构建完成",
  });

  // Step 4: L0/L1 Vectorization (optional)
  let vectorizationSuccess = false;
  if (options.embedding) {
    options.onProgress?.({
      percent: 87,
      step: "vectorize",
      stepLabel: "向量索引",
    });

    try {
      await vectorizeL0L1Nodes(parseResult, indexDir, options.embedding);
      vectorizationSuccess = true;
      
      options.onProgress?.({
        percent: 92,
        step: "vectorize_complete",
        stepLabel: "向量索引完成",
      });
    } catch (error) {
      console.warn("[book-indexer] Vectorization failed, continuing with pure BM25:", error);
      
      bookMeta.embedding = undefined;
      await fs.writeFile(
        path.join(indexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      options.onProgress?.({
        percent: 92,
        step: "vectorize_skipped",
        stepLabel: "向量索引跳过（使用纯 BM25）",
        message: error instanceof Error ? error.message : "Embedding API failed",
      });
    }
  }

  // Step 5: BM25 index building
  options.onProgress?.({
    percent: 94,
    step: "build_bm25",
    stepLabel: "构建 BM25 索引",
  });

  const bm25Data = buildBM25IndexFromParseResult(parseResult);
  await fs.writeFile(
    path.join(indexDir, "bm25.json"),
    JSON.stringify(bm25Data, null, 2)
  );

  options.onProgress?.({
    percent: 97,
    step: "bm25_complete",
    stepLabel: "BM25 索引构建完成",
  });

  // Step 6: Finalize
  options.onProgress?.({
    percent: 100,
    step: "complete",
    stepLabel: "索引完成",
  });

  return {
    bookId,
    title: rootTitle,
    fileType: options.fileType,
    chaptersCount: bookMeta.chapters.length,
    indexDir,
  };
}

/**
 * Build book metadata from parse result
 */
async function buildBookMeta(
  parseResult: any,
  bookId: string,
  bookDir: string,
  filePath: string,
  fileType: "pdf" | "epub",
  embedding?: any
): Promise<BookMeta> {
  const root = parseResult.structure[0];
  const title = root?.title || parseResult.docName || "Unknown";

  const chapters: ChapterMeta[] = [];
  let sortOrder = 0;

  for (const node of root?.nodes || []) {
    const mdFileName = `${node.title}.md`;
    const mdFilePath = path.join(bookDir, mdFileName);

    const paragraphs: ParagraphMeta[] = [];
    try {
      const mdContent = await fs.readFile(mdFilePath, "utf-8");
      const blockIdMatches = mdContent.matchAll(/\^([\w-]+)/g);
      for (const match of blockIdMatches) {
        const blockId = match[1];
        const beforeText = mdContent.substring(0, match.index);
        const lastParagraphEnd = beforeText.lastIndexOf("\n\n");
        const paragraphStart = lastParagraphEnd >= 0 ? lastParagraphEnd + 2 : 0;
        const paragraphText = mdContent.substring(paragraphStart, match.index).trim().slice(0, 50);
        
        paragraphs.push({
          blockId,
          text: paragraphText,
        });
      }
    } catch (e) {
      console.warn(`[book-indexer] Failed to read MD file: ${mdFilePath}`);
    }

    chapters.push({
      id: node.nodeId || `ch${sortOrder}`,
      title: node.title,
      summary: node.summary || "",
      mdFilePath: path.relative(bookDir, mdFilePath),
      sortOrder: sortOrder++,
      mdFileHash: "",
      paragraphs,
    });
  }

  return {
    version: 1,
    bookId,
    title,
    description: root?.summary || parseResult.docDescription || "",
    filePath,
    fileType,
    indexedAt: new Date().toISOString(),
    embedding: embedding ? {
      provider: embedding.provider,
      model: embedding.model || "text-embedding-3-small",
      dimensions: embedding.dimensions || 1536,
    } : undefined,
    chapters,
  };
}

/**
 * Vectorize L0/L1 nodes from parse result
 */
async function vectorizeL0L1Nodes(
  parseResult: any,
  indexDir: string,
  embedding: any
): Promise<void> {
  const { initVectorStore, generateEmbeddings, appendVector } = await import("./vault/vectors.js");

  const store = await initVectorStore(indexDir, embedding.dimensions || 1536);
  store.meta.model = embedding.model || "text-embedding-3-small";

  const nodes: Array<{ id: string; text: string; level: "L0" | "L1" }> = [];

  const root = parseResult.structure[0];
  if (root) {
    nodes.push({
      id: root.nodeId || "L0-root",
      text: `${root.title}\n${root.summary || ""}\n${root.text || ""}`,
      level: "L0",
    });

    for (const node of root.nodes || []) {
      nodes.push({
        id: node.nodeId || `L1-${nodes.length}`,
        text: `${node.title}\n${node.summary || ""}\n${node.text || ""}`,
        level: "L1",
      });
    }
  }

  const texts = nodes.map(n => n.text);
  const vectors = await generateEmbeddings(texts, embedding);

  for (let i = 0; i < nodes.length; i++) {
    await appendVector(store, nodes[i].id, vectors[i]);
  }
}

/**
 * Build BM25 index from parse result
 */
function buildBM25IndexFromParseResult(parseResult: any): BM25Data {
  const nodes: Array<{ id: string; text: string; level: "L0" | "L1" }> = [];

  const root = parseResult.structure[0];
  if (root) {
    nodes.push({
      id: root.nodeId || "L0-root",
      text: `${root.title}\n${root.summary || ""}\n${root.text || ""}`,
      level: "L0",
    });

    for (const node of root.nodes || []) {
      nodes.push({
        id: node.nodeId || `L1-${nodes.length}`,
        text: `${node.title}\n${node.summary || ""}\n${node.text || ""}`,
        level: "L1",
      });
    }
  }

  return buildBM25Index(nodes);
}