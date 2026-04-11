/**
 * Book indexer - orchestrates PDF/EPUB indexing workflow
 */

import * as crypto from "crypto";
import { log as piLog } from "./core/logger";
import * as path from "path";
import * as fs from "fs/promises";
import {
  DEFAULT_ADD_NODE_TEXT,
  DEFAULT_ADD_NODE_SUMMARY,
  DEFAULT_ADD_DOC_DESCRIPTION,
  DEFAULT_EXPORT_DIR,
  DEFAULT_COVERS_PATH,
  DEFAULT_INCLUDE_INDEX,
  DEFAULT_ASSETS_PATH,
} from "./defaults.js";
import { PageIndex } from "./pageindex.js";
import type {
  BookIndexOptions,
  BookIndexResult,
  BookMeta,
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
      `File not found: ${options.filePath}`,
      ErrorCode.FILE_NOT_FOUND,
      `文件不存在: ${options.filePath}`,
      "请确认文件路径是否正确，或重新选择文件"
    );
  }

  const bookId = generateBookId(options.filePath);
  const indexDir = path.join(options.outputDir, ".pageindex", bookId);

  // Create indexing status file so progress survives modal close/reopen
  await fs.mkdir(indexDir, { recursive: true });
  const indexingStatusPath = path.join(indexDir, ".indexing.json");

  const reportProgress = (progress: { percent: number; step: string; stepLabel: string; message?: string }) => {
    options.onProgress?.(progress);
    // Persist to file (fire-and-forget)
    fs.writeFile(indexingStatusPath, JSON.stringify({
      bookId,
      filePath: options.filePath,
      fileType: options.fileType,
      title: path.basename(options.filePath, path.extname(options.filePath)),
      ...progress,
    })).catch(() => {});
  };

  // Clean up indexing status file on completion or failure
  const cleanupStatus = () => {
    fs.unlink(indexingStatusPath).catch(() => {});
  };

  // Step 1: Document parsing + LLM indexing (most time-consuming, 5%-70%)
  reportProgress({
    percent: 5,
    step: "parse_document",
    stepLabel: "解析文档",
  });

  // Map PageIndex internal progress to book-indexer range (5%-70%)
  // PageIndex goes through: parsing → tree building → summary generation
  const onParseProgress = (progress: { percent: number; message: string; stage: string }) => {
    const mappedPercent = 5 + Math.round(progress.percent * 0.65);
    reportProgress({
      percent: Math.min(mappedPercent, 70),
      step: progress.stage || "parse_document",
      stepLabel: progress.message || "处理文档",
    });
  };

  const pageIndex = new PageIndex({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    addNodeText: DEFAULT_ADD_NODE_TEXT,
    addNodeSummary: options.addNodeSummary ?? DEFAULT_ADD_NODE_SUMMARY,
    addDocDescription: options.addDocDescription ?? DEFAULT_ADD_DOC_DESCRIPTION,
    onProgress: onParseProgress,
  });

  let parseResult;
  try {
    if (options.fileType === "pdf") {
      parseResult = await pageIndex.fromPdf(options.filePath);
    } else {
      parseResult = await pageIndex.fromEpub(options.filePath);
    }
  } catch (error) {
    // Write failed status so modal can show retry button on reopen
    fs.writeFile(indexingStatusPath, JSON.stringify({
      bookId,
      filePath: options.filePath,
      fileType: options.fileType,
      title: path.basename(options.filePath, path.extname(options.filePath)),
      percent: 0,
      step: "failed",
      stepLabel: "索引失败",
      error: error instanceof Error ? error.message : "Unknown error",
    })).catch(() => {});
    throw new IndexError(
      `Document parsing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ErrorCode.FILE_NOT_FOUND,
      "文档解析失败",
      "请检查文件格式是否正确"
    );
  }

  reportProgress({
    percent: 70,
    step: "parse_complete",
    stepLabel: "文档索引完成",
  });

  const rootTitle = parseResult.docName || parseResult.structure[0]?.title || "Unknown";
  // Simplify export name: strip subtitles after separators for cleaner directory names
  const exportName = simplifyTitle(rootTitle);
  const deepReaderDir = path.join(options.outputDir, DEFAULT_EXPORT_DIR);
  const bookDir = path.join(deepReaderDir, exportName);

  // Ensure DeepReader directory exists
  await fs.mkdir(deepReaderDir, { recursive: true });

  // Save cover image
  const coversDir = path.join(deepReaderDir, DEFAULT_COVERS_PATH);
  await fs.mkdir(coversDir, { recursive: true });

  // Track cover relative path for frontmatter
  let coverRelPath = "";
  if (parseResult.coverImage) {
    // EPUB: save extracted cover image
    try {
      const ext = path.extname(parseResult.coverImage.name) || ".jpg";
      const coverPath = path.join(coversDir, `${exportName}${ext}`);
      await fs.writeFile(coverPath, parseResult.coverImage.data);
      coverRelPath = `DeepReader/${DEFAULT_COVERS_PATH}${exportName}${ext}`;
      piLog(`[book-indexer] Cover saved: ${coverPath}`);
    } catch (err) {
      console.warn("[book-indexer] Failed to save cover:", err);
    }
  } else if (parseResult.coverPng && parseResult.coverPng.length > 100) {
    // PDF: save rendered first page as PNG (only if valid, >100 bytes)
    try {
      const coverPath = path.join(coversDir, `${exportName}.png`);
      await fs.writeFile(coverPath, parseResult.coverPng);
      coverRelPath = `DeepReader/${DEFAULT_COVERS_PATH}${exportName}.png`;
      piLog(`[book-indexer] PDF cover saved: ${coverPath} (${parseResult.coverPng.length} bytes)`);
    } catch (err) {
      console.warn("[book-indexer] Failed to save PDF cover:", err);
    }
  } else {
    // No cover available: generate text-based SVG cover
    try {
      const svgCover = generateTextCover(exportName, options.fileType);
      const coverPath = path.join(coversDir, `${exportName}.svg`);
      await fs.writeFile(coverPath, svgCover, "utf-8");
      coverRelPath = `DeepReader/${DEFAULT_COVERS_PATH}${exportName}.svg`;
      piLog(`[book-indexer] Text cover generated: ${coverPath}`);
    } catch (err) {
      console.warn("[book-indexer] Failed to generate text cover:", err);
    }
  }

  // Step 2: Markdown export (70%-80%)
  reportProgress({
    percent: 70,
    step: "export_markdown",
    stepLabel: "导出 Markdown",
  });

  try {
    if (options.fileType === "pdf") {
      const { exportPdfToObsidian } = await import("./exporters/pdf-to-obsidian.js");
      const exportResult = await exportPdfToObsidian({
        outputDir: deepReaderDir,
        parseResult,
        includeIndex: DEFAULT_INCLUDE_INDEX,
        sourcePdf: options.filePath,
        exportName,
        author: parseResult.author,
        coverPath: coverRelPath || undefined,
      });
      // Store nodeFileMap for tree.json
      (parseResult as any)._nodeFileMap = exportResult.nodeFileMap;
    } else {
      const { exportToObsidian } = await import("./exporters/epub-to-obsidian.js");
      const exportResult = await exportToObsidian(options.filePath, {
        outputDir: deepReaderDir,
        includeIndex: DEFAULT_INCLUDE_INDEX,
        assetsPath: DEFAULT_ASSETS_PATH,
        docDescription: parseResult.docDescription,
        nodeSummaries: collectNodeSummaries(parseResult.structure),
        exportName,
        coverPath: coverRelPath || undefined,
      });
      (parseResult as any)._nodeFileMap = exportResult.nodeFileMap;
    }
  } catch (error) {
    throw new IndexError(
      `Markdown export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ErrorCode.MD_PARSE_ERROR,
      "Markdown 导出失败",
      "请检查输出目录是否有写入权限"
    );
  }

  reportProgress({
    percent: 80,
    step: "export_complete",
    stepLabel: "Markdown 导出完成",
  });

  // Step 3: Build book-meta.json
  reportProgress({
    percent: 82,
    step: "build_meta",
    stepLabel: "构建元数据",
  });

  const bookMeta = await buildBookMeta(
    parseResult,
    bookId,
    bookDir,
    options.filePath,
    options.fileType,
    options.embedding,
    parseResult.author
  );

  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(
    path.join(indexDir, "book-meta.json"),
    JSON.stringify(bookMeta, null, 2)
  );

  // Step 3.5: Write tree.json to .pageindex/{bookId}/ (single data source)
  try {
    const nodeFileMap = (parseResult as any)._nodeFileMap || {};
    const treeData = {
      title: rootTitle,
      exportName,
      docDescription: parseResult.docDescription,
      source: options.filePath,
      nodeFileMap,
      structure: parseResult.structure,
    };
    await fs.writeFile(
      path.join(indexDir, "tree.json"),
      JSON.stringify(treeData, null, 2)
    );
    piLog(`[book-indexer] tree.json written to ${indexDir}`);
  } catch (err) {
    piLog(`[book-indexer] Warning: tree.json write failed: ${err}`);
  }

  reportProgress({
    percent: 85,
    step: "meta_complete",
    stepLabel: "元数据构建完成",
  });

  // Step 4: L0/L1 Vectorization (optional)
  let vectorizationSuccess = false;
  // Skip vectorization if provider is 'local' (means no vector index)
  const shouldVectorize = options.embedding && options.embedding.provider !== 'local';
  
  if (shouldVectorize) {
    reportProgress({
    percent: 87,
      step: "vectorize",
      stepLabel: "向量索引",
    });

    try {
      const detectedDimensions = await vectorizeL0L1Nodes(parseResult, indexDir, options.embedding);
      vectorizationSuccess = true;
      
      // Update book-meta with detected dimensions
      if (detectedDimensions && options.embedding) {
        bookMeta.embedding = {
          provider: options.embedding.provider,
          model: options.embedding.model || "text-embedding-3-small",
          dimensions: detectedDimensions,
        };
        await fs.writeFile(
          path.join(indexDir, "book-meta.json"),
          JSON.stringify(bookMeta, null, 2)
        );
      }
      
      reportProgress({
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

      reportProgress({
        percent: 92,
        step: "vectorize_skipped",
        stepLabel: "向量索引跳过（使用纯 BM25）",
        message: error instanceof Error ? error.message : "Embedding API failed",
      });
    }
  }

  // Step 5: BM25 index building
  reportProgress({
    percent: 94,
    step: "build_bm25",
    stepLabel: "构建 BM25 索引",
  });

  const bm25Data = buildBM25IndexFromParseResult(parseResult);
  await fs.writeFile(
    path.join(indexDir, "bm25.json"),
    JSON.stringify(bm25Data, null, 2)
  );

  reportProgress({
    percent: 97,
    step: "bm25_complete",
    stepLabel: "BM25 索引构建完成",
  });

  // Step 6: Finalize — clean up indexing status
  cleanupStatus();

  reportProgress({
    percent: 100,
    step: "complete",
    stepLabel: "索引完成",
  });

  return {
    bookId,
    title: rootTitle,
    fileType: options.fileType,
    chaptersCount: parseResult.structure.length,
    indexDir,
  };
}

/**
 * Build book metadata v2 from parse result
 * Simplified: no chapters[] (chapters info is in tree.json)
 */
async function buildBookMeta(
  parseResult: any,
  bookId: string,
  bookDir: string,
  filePath: string,
  fileType: "pdf" | "epub",
  embedding?: any,
  author?: string
): Promise<BookMeta> {
  const title = parseResult.docName || parseResult.structure[0]?.title || "Unknown";
  // Extract the export directory name from bookDir (last path segment)
  const exportName = path.basename(bookDir);

  return {
    version: 2,
    bookId,
    title,
    exportName,
    description: parseResult.docDescription || parseResult.structure[0]?.summary || "",
    author,
    filePath,
    fileType,
    indexedAt: new Date().toISOString(),
    embedding: embedding ? {
      provider: embedding.provider,
      model: embedding.model || "text-embedding-3-small",
      // dimensions will be updated after vectorization
    } : undefined,
    chapters: [],  // v2: chapters info is in tree.json
  };
}

/**
 * Vectorize L0/L1 nodes from parse result
 * Fix: iterate entire structure array (not just structure[0])
 * Returns detected dimensions
 */
async function vectorizeL0L1Nodes(
  parseResult: any,
  indexDir: string,
  embedding: any
): Promise<number | undefined> {
  const { initVectorStore, generateEmbedding, generateEmbeddings, appendVector } = await import("./vault/vectors.js");

  // Auto-detect dimensions from first embedding
  let dimensions = embedding.dimensions;
  if (!dimensions) {
    const testEmbedding = await generateEmbedding("test", embedding);
    dimensions = testEmbedding.length;
    piLog(`[vectorize] Auto-detected embedding dimensions: ${dimensions}`);
  }

  const store = await initVectorStore(indexDir, dimensions);
  store.meta.model = embedding.model || "text-embedding-3-small";

  const nodes: Array<{ id: string; text: string; level: "L0" | "L1" }> = [];

  for (const rootNode of parseResult.structure || []) {
    nodes.push({
      id: rootNode.nodeId || `L0-${nodes.length}`,
      text: `${rootNode.title}\n${rootNode.summary || ""}\n${rootNode.text || ""}`,
      level: "L0",
    });
    collectIndexLeafNodes(rootNode, nodes);
  }

  const texts = nodes.map(n => n.text);
  const vectors = await generateEmbeddings(texts, embedding);

  for (let i = 0; i < nodes.length; i++) {
    await appendVector(store, nodes[i].id, vectors[i]);
  }
  
  return dimensions;
}

/**
 * Build BM25 index from parse result
 * Fix: iterate entire structure array (not just structure[0])
 */
function buildBM25IndexFromParseResult(parseResult: any): BM25Data {
  const nodes: Array<{ id: string; text: string; level: "L0" | "L1" }> = [];

  for (const rootNode of parseResult.structure || []) {
    // Each top-level element as L0
    nodes.push({
      id: rootNode.nodeId || `L0-${nodes.length}`,
      text: `${rootNode.title}\n${rootNode.summary || ""}\n${rootNode.text || ""}`,
      level: "L0",
    });

    // Recursively collect all child nodes as L1
    collectIndexLeafNodes(rootNode, nodes);
  }

  return buildBM25Index(nodes);
}

/**
 * Recursively collect all child nodes for BM25/vector indexing
 */
function collectIndexLeafNodes(
  node: any,
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): void {
  if (!node.nodes || node.nodes.length === 0) return;

  for (const child of node.nodes) {
    nodes.push({
      id: child.nodeId || `L1-${nodes.length}`,
      text: `${child.title}\n${child.summary || ""}\n${child.text || ""}`,
      level: "L1",
    });
    collectIndexLeafNodes(child, nodes);
  }
}

/**
 * Collect node summaries from parse result structure
 * Returns a plain object of chapter title → summary
 */
function collectNodeSummaries(structure: any[]): Record<string, string> {
  if (!structure) return {};

  const summaries: Record<string, string> = {};

  for (const root of structure) {
    // Root level
    if (root.summary && root.title) {
      summaries[root.title] = root.summary;
    }
    // L1 nodes (chapters)
    for (const node of root?.nodes || []) {
      if (node.summary && node.title) {
        summaries[node.title] = node.summary;
      }
    }
  }

  return summaries;
}

/**
 * Generate a text-based SVG cover image
 * Used when no cover image is available (e.g., PDF without embedded cover)
 */
function generateTextCover(title: string, fileType: string): string {
  // Truncate title for display
  const maxLineChars = 14;
  const lines: string[] = [];
  for (let i = 0; i < title.length; i += maxLineChars) {
    lines.push(title.slice(i, i + maxLineChars));
  }
  // Keep max 4 lines
  const displayLines = lines.slice(0, 4);

  const typeLabel = fileType.toUpperCase();

  // Color palette based on title hash for variety
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash % 360);

  // Escape XML special characters
  const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const textLines = displayLines.map((line, i) => {
    const y = 130 + i * 36;
    const isLast = i === displayLines.length - 1 && displayLines.length > 1;
    const fontSize = isLast && line.length > maxLineChars - 2 ? 22 : 26;
    return `<text x="140" y="${y}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="600" fill="#fff">${escapeXml(line)}</text>`;
  }).join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="380" viewBox="0 0 280 380">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue}, 45%, 35%)" />
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360}, 50%, 25%)" />
    </linearGradient>
  </defs>
  <rect width="280" height="380" rx="8" fill="url(#bg)" />
  <rect x="20" y="20" width="240" height="340" rx="4" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
  ${textLines}
  <text x="140" y="310" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.6)" text-anchor="middle">${escapeXml(typeLabel)}</text>
</svg>`;
}

/**
 * Simplify title by stripping subtitles after common separators
 * e.g. "遥远的救世主：根据本书改编..." → "遥远的救世主"
 */
function simplifyTitle(title: string): string {
  const separators = ['：', ':', '—', '-', '｜', '|'];
  for (const sep of separators) {
    if (title.includes(sep)) {
      return title.split(sep)[0].trim();
    }
  }
  return title;
}