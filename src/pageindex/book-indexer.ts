/**
 * Book indexer - orchestrates PDF/EPUB indexing workflow
 */

import * as crypto from "crypto";
import { log as piLog } from "./core/logger";
import * as path from "path";
import * as fs from "fs/promises";
import { getPageindexRoot, getBookDir } from "./paths.js";
import { createTracer, type Tracer } from "./index-tracer.js";
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
import { indexPropositions } from "./proposition-indexer.js";
import { safeRequest } from "../utils/safe-request.js";
import type { MineruImage } from "./parsers/mineru-types.js";

const BOOK_ID_HEAD_BYTES = 65536; // 64KB sample for content-based ID
const MIGRATION_MARKER = ".migrated-content-id-v1";

/**
 * Generate bookId from file content (SHA-256 of first 64KB + file size).
 * Content-based ID is stable regardless of file path changes.
 */
export async function generateBookId(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size === 0) {
    throw new Error(`Cannot generate bookId: file is empty (${filePath})`);
  }
  const handle = await fs.open(filePath, "r");
  try {
    const headSize = Math.min(BOOK_ID_HEAD_BYTES, stat.size);
    const buf = Buffer.alloc(headSize);
    await handle.read(buf, 0, headSize, 0);
    const hash = crypto.createHash("sha256");
    hash.update(buf);
    hash.update(Buffer.from(String(stat.size)));
    return hash.digest("hex").slice(0, 8);
  } finally {
    await handle.close();
  }
}

/**
 * Legacy: generate bookId from file path only (SHA-256 first 8 chars).
 * Used for journal indexes and migration detection.
 */
export function generateBookIdFromPath(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

/**
 * Check if book is already indexed
 * @param filePath - Book file path
 * @param vaultPath - Vault root path (where .pageindex directory is located)
 */
export async function isBookIndexed(filePath: string, vaultPath: string): Promise<boolean> {
  let bookId: string;
  try {
    bookId = await generateBookId(filePath);
  } catch {
    return false;
  }
  const indexDir = getBookDir(vaultPath, bookId);

  try {
    // Check directory exists AND critical index files are present
    await fs.access(indexDir);
    await fs.access(path.join(indexDir, "tree.json"));
    await fs.access(path.join(indexDir, "bm25.json"));
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
  let bookId: string;
  try {
    bookId = await generateBookId(filePath);
  } catch {
    return; // Source file gone, nothing to delete
  }
  const indexDir = getBookDir(vaultPath, bookId);

  await fs.rm(indexDir, { recursive: true, force: true });

  // Remove from global catalog
  const { removeCatalogEntry } = await import("./vault/vectors.js");
  await removeCatalogEntry(getPageindexRoot(vaultPath), bookId);
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

  const bookId = await generateBookId(options.filePath);
  const indexDir = getBookDir(options.outputDir, bookId);

  // 创建追踪日志（INDEX_TRACE_ENABLED=false 时为 NoopIndexTracer，零开销）
  const tracer = createTracer(
    bookId,
    path.basename(options.filePath, path.extname(options.filePath)),
    options.filePath,
    options.fileType,
    {
      pageindexModel: options.model || "unknown",
      embeddingProvider: options.embedding?.provider,
      embeddingModel: options.embedding?.model,
      mineruUsed: !!options.mineruApiKey,
    },
    options.outputDir,
    bookId,
  );

  // Create indexing status file so progress survives modal close/reopen
  await fs.mkdir(indexDir, { recursive: true });
  const indexingStatusPath = path.join(indexDir, ".indexing.json");

  // Clean stale status from previous interrupted indexing
  try { await fs.unlink(indexingStatusPath); } catch { /* not exists */ }

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

  // Wrap entire pipeline in try-finally to ensure status cleanup on any error
  try {

  // B0 validate
  tracer.startPhase("validate");
  // (file access already checked above, record file size)
  let fileSizeBytes = 0;
  try { fileSizeBytes = (await fs.stat(options.filePath)).size; } catch {}
  tracer.endPhase({ fileSizeBytes });
  tracer.save();

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

  // B1 parse_document
  tracer.startPhase("parse_document");

  const pageIndex = new PageIndex({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    mineruApiKey: options.mineruApiKey,
    addNodeText: DEFAULT_ADD_NODE_TEXT,
    addNodeSummary: options.addNodeSummary ?? DEFAULT_ADD_NODE_SUMMARY,
    addDocDescription: options.addDocDescription ?? DEFAULT_ADD_DOC_DESCRIPTION,
    onProgress: onParseProgress,
    onLlmCall: (call) => tracer.recordLlmCall(call),
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

  tracer.endPhase({
    chaptersCount: parseResult.structure.length,
    totalNodes: parseResult.structure.reduce((acc, n) => acc + 1 + (n.nodes?.length || 0), 0),
  });
  tracer.save();

  // 记录解析路径决策
  if (options.fileType === "epub") {
    tracer.recordPathDecision({
      phase: "parse_document",
      decision: "epub_direct",
      reason: `EPUB has ${parseResult.structure.length} chapters from spine`,
    });
  } else {
    tracer.recordPathDecision({
      phase: "parse_document",
      decision: "llm_toc",
      reason: `PDF parsed via LLM, ${parseResult.structure.length} chapters extracted`,
    });
  }
  tracer.save();

  reportProgress({
    percent: 70,
    step: "parse_complete",
    stepLabel: "文档索引完成",
  });

  const rootTitle = parseResult.docName || parseResult.structure[0]?.title || "Unknown";
  // Simplify export name: strip subtitles after separators for cleaner directory names
  const exportName = simplifyTitle(rootTitle);
  tracer.setTitle(exportName);
  const deepReaderDir = path.join(options.outputDir, DEFAULT_EXPORT_DIR);
  const bookDir = path.join(deepReaderDir, exportName);

  // Ensure DeepReader directory exists
  await fs.mkdir(deepReaderDir, { recursive: true });

  // B1.5 Save cover image
  tracer.startPhase("save_cover");
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
  tracer.endPhase();
  tracer.save();

  // B1.6: Download images (PDF only)
  if (options.fileType === "pdf" && parseResult.images && parseResult.images.length > 0) {
    tracer.startPhase("download_images");
    const imagesDir = path.join(bookDir, "images");
    await fs.mkdir(imagesDir, { recursive: true });

    reportProgress({
      percent: 70,
      step: "download_images",
      stepLabel: `下载图片 (0/${parseResult.images.length})`,
    });

    await downloadImages(parseResult.images, imagesDir, (done, total) => {
      reportProgress({
        percent: 70,
        step: "download_images",
        stepLabel: `下载图片 (${done}/${total})`,
      });
    });

    piLog(`[book-indexer] Downloaded images to ${imagesDir}`);
    tracer.endPhase({ imageCount: parseResult.images.length });
    tracer.save();
  }

  // B2 export_markdown
  tracer.startPhase("export_markdown");
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
        bookId,
      });
      // Store nodeFileMap for tree.json
      (parseResult as any)._nodeFileMap = exportResult.nodeFileMap;
    } else {
      const { exportToObsidian } = await import("./exporters/epub-to-obsidian.js");
      const exportResult = await exportToObsidian(
        options.filePath,
        {
          outputDir: deepReaderDir,
          includeIndex: DEFAULT_INCLUDE_INDEX,
          assetsPath: DEFAULT_ASSETS_PATH,
          docDescription: parseResult.docDescription,
          nodeSummaries: collectNodeSummaries(parseResult.structure),
          exportName,
          coverPath: coverRelPath || undefined,
          bookId,
        },
        parseResult.epubInfo,  // reuse parsed epubInfo instead of re-parsing
      );
      (parseResult as any)._nodeFileMap = exportResult.nodeFileMap;
      (parseResult as any)._hierarchicalTree = exportResult.treeNodes;
    }
  } catch (error) {
    throw new IndexError(
      `Markdown export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ErrorCode.MD_PARSE_ERROR,
      "Markdown 导出失败",
      "请检查输出目录是否有写入权限"
    );
  }

  tracer.endPhase();
  tracer.save();

  reportProgress({
    percent: 80,
    step: "export_complete",
    stepLabel: "Markdown 导出完成",
  });

  // B3 build_meta
  tracer.startPhase("build_meta");
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
  tracer.endPhase();
  tracer.save();

  // Step 3.5: Write tree.json to .pageindex/{bookId}/ (single data source)
  let treeData: any = { title: rootTitle, exportName, structure: parseResult.structure };
  try {
    const nodeFileMap = (parseResult as any)._nodeFileMap || {};
    const hierarchicalTree = (parseResult as any)._hierarchicalTree;
    let finalStructure = parseResult.structure;

    if (hierarchicalTree && hierarchicalTree.length > 0) {
      // Build nodeId → full node data map from flat parseResult
      // parseResult has correct startIndex/endIndex/text from addNodeText()
      const summaryMap = new Map<string, { summary?: string; text?: string; startIndex?: number; endIndex?: number }>();
      for (const node of parseResult.structure || []) {
        if (node.nodeId) {
          summaryMap.set(node.nodeId, {
            summary: node.summary,
            text: node.text,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
          });
        }
      }
      // Merge parseResult data into hierarchical tree, only keep TreeNode fields
      const enrichNode = (n: any): any => {
        const data = summaryMap.get(n.nodeId);
        const result: any = {
          title: n.title,
          nodeId: n.nodeId,
          // Prefer parseResult's startIndex/endIndex (1-based, correct page range)
          // over hierarchicalTree's (0-based, single-page)
          startIndex: data?.startIndex ?? n.startIndex,
          endIndex: data?.endIndex ?? n.endIndex,
        };
        if (data?.summary || n.summary) result.summary = data?.summary || n.summary;
        if (data?.text || n.text) result.text = data?.text || n.text;
        if (n.nodes?.length) result.nodes = n.nodes.map(enrichNode);
        return result;
      };
      finalStructure = hierarchicalTree.map(enrichNode);
    }

    treeData = {
      title: rootTitle,
      exportName,
      docDescription: parseResult.docDescription,
      source: options.filePath,
      nodeFileMap,
      structure: finalStructure,
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

  if (!shouldVectorize) {
    tracer.recordPathDecision({
      phase: "vectorize",
      decision: "vectorize_skipped",
      reason: options.embedding?.provider === 'local'
        ? "embedding provider is 'local' (BM25-only)"
        : "embedding role not configured",
    });
    tracer.save();
  }

  if (shouldVectorize) {
    tracer.startPhase("vectorize");
    reportProgress({
    percent: 87,
      step: "vectorize",
      stepLabel: "向量索引",
    });

    try {
      const nodeFileMap = (parseResult as any)._nodeFileMap || {};
      const vectorResult = await vectorizeAllLevels(
        parseResult, indexDir, options.embedding, nodeFileMap, treeData, options.outputDir,
        (msg: string) => reportProgress({ percent: 84, step: "vectorize", stepLabel: msg }),
        (info) => tracer.recordLlmCall({ purpose: "generate_embedding", model: info.model, durationMs: info.durationMs }),
      );
      vectorizationSuccess = true;

      // Update book-meta with detected dimensions
      if (vectorResult && options.embedding) {
        bookMeta.embedding = {
          provider: options.embedding.provider,
          model: options.embedding.model || "text-embedding-3-small",
          dimensions: vectorResult.dimensions,
        };
        await fs.writeFile(
          path.join(indexDir, "book-meta.json"),
          JSON.stringify(bookMeta, null, 2)
        );

        // Update global catalog
        const { updateCatalogEntry } = await import("./vault/vectors.js");
        await updateCatalogEntry(getPageindexRoot(options.outputDir), bookId, {
          title: bookMeta.title || path.basename(options.filePath),
          vectorModel: options.embedding.model || "text-embedding-3-small",
          dimensions: vectorResult.dimensions,
          nodeCount: vectorResult.nodeCount,
          hasPropositions: false,
          indexedAt: new Date().toISOString(),
        });
      }

      tracer.endPhase({ totalVectors: vectorResult?.nodeCount || 0, dimensions: vectorResult?.dimensions || 0 });
      tracer.save();

      reportProgress({
        percent: 92,
        step: "vectorize_complete",
        stepLabel: "向量索引完成",
      });
    } catch (error) {
      console.warn("[book-indexer] Vectorization failed, continuing with pure BM25:", error);

      tracer.endPhase();
      tracer.save();

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

  // B5 build_bm25
  tracer.startPhase("build_bm25");
  reportProgress({
    percent: 94,
    step: "build_bm25",
    stepLabel: "构建 BM25 索引",
  });

  try {
    const bm25Data = buildBM25IndexFromParseResult(parseResult);
    await fs.writeFile(
      path.join(indexDir, "bm25.json"),
      JSON.stringify(bm25Data, null, 2)
    );
    tracer.endPhase();
    tracer.save();
  } catch (error) {
    tracer.failPhase(error instanceof Error ? error.message : String(error));
    tracer.save();
    throw error;
  }

  reportProgress({
    percent: 97,
    step: "bm25_complete",
    stepLabel: "BM25 索引构建完成",
  });

  // B6 extract_propositions
  if (options.propositions?.enabled && options.propositions.apiKey) {
    tracer.startPhase("extract_propositions");
    reportProgress({
      percent: 97,
      step: "extract_propositions",
      stepLabel: "提取命题卡片",
    });

    try {
      const treePath = path.join(indexDir, "tree.json");
      const treeContent = await fs.readFile(treePath, "utf-8");
      const treeData = JSON.parse(treeContent);

      const propResult = await indexPropositions({
        bookId,
        vaultPath: options.outputDir,
        treeData,
        embedding: options.embedding?.provider !== 'local' ? options.embedding : undefined,
        llm: {
          model: options.propositions.model || 'Qwen/Qwen3-8B',
          apiKey: options.propositions.apiKey,
          baseUrl: options.propositions.baseUrl || 'https://api.siliconflow.cn/v1',
        },
        cardsPer500Words: options.propositions.cardsPer500Words,
        onProgress: (p) => {
          reportProgress({
            percent: 97 + Math.round(p.percent * 0.02),
            step: "extract_propositions",
            stepLabel: p.message,
          });
        },
      });

      bookMeta.propositions = {
        enabled: true,
        totalCards: propResult.totalCards,
        model: options.propositions.model || 'Qwen/Qwen3-8B',
        generatedAt: new Date().toISOString(),
      };

      await fs.writeFile(
        path.join(indexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      tracer.endPhase({ totalCards: propResult.totalCards });
      tracer.save();

      piLog(`[book-indexer] Proposition cards: ${propResult.totalCards}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn("[book-indexer] Proposition extraction failed:", errorMsg);

      tracer.endPhase();
      tracer.save();

      bookMeta.propositions = {
        enabled: false,
        totalCards: 0,
        model: options.propositions.model || 'Qwen/Qwen3-8B',
        error: errorMsg.slice(0, 200),
      };

      await fs.writeFile(
        path.join(indexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      reportProgress({
        percent: 97,
        step: "propositions_failed",
        stepLabel: `命题卡片提取失败: ${errorMsg.slice(0, 50)}`,
      });
    }
  }

  // Step 8: Finalize — cleanup handled by try-finally

  reportProgress({
    percent: 100,
    step: "complete",
    stepLabel: "索引完成",
  });

  tracer.finalize(true);

  return {
    bookId,
    title: rootTitle,
    fileType: options.fileType,
    chaptersCount: parseResult.structure.length,
    indexDir,
  };

  } catch (error) {
    tracer.finalize(false, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    cleanupStatus();
  }
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
    version: 3,
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
 * Vectorize L0 (book) + L1 (chapter summaries) + L2 (paragraph chunks).
 * Returns { dimensions, nodeCount }
 */
async function vectorizeAllLevels(
  parseResult: any,
  indexDir: string,
  embedding: any,
  nodeFileMap: Record<string, string>,
  treeData: any,
  vaultRootPath: string,
  onProgress?: (msg: string) => void,
  onEmbedCall?: (info: { model: string; durationMs: number }) => void
): Promise<{ dimensions: number; nodeCount: number } | undefined> {
  const { generateEmbedding, generateEmbeddings, writeVectorJsonl, writeChunkTexts } =
    await import("./vault/vectors.js");
  const { splitByBlockIds, mergeToChunks } = await import("./chunker.js");
  const vectorPath = path.join(indexDir, "vectors.jsonl");
  const chunksPath = path.join(indexDir, "chunks.jsonl");

  // 截断保护：BGE 系列模型有 512 token 限制（~400 中文字符），
  // Qwen3-Embedding 等长上下文模型不需要截断（设为 8000 兜底即可）。
  const modelName = (embedding.model || "").toLowerCase();
  const isBGE = modelName.includes("bge");
  const MAX_EMBED_CHARS = isBGE ? 400 : 8000;
  const truncate = (text: string) =>
    text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;

  // Auto-detect dimensions
  let dimensions = embedding.dimensions;
  if (!dimensions) {
    const testEmbedding = await generateEmbedding("test", embedding);
    dimensions = testEmbedding.length;
    piLog(`[vectorize] Auto-detected embedding dimensions: ${dimensions}`);
  }

  // Intermediate type: text + metadata before embedding
  interface PendingChunk {
    chunkId: string;
    nodeId: string;
    blockIds: string[];
    type: "summary" | "heading" | "body" | "list" | "quote";
    level: "L0" | "L1" | "L2";
    text: string;
    vector?: number[];
  }

  const allPending: PendingChunk[] = [];

  // L0: book summary
  const bookTitle = parseResult.title || "";
  const bookSummary = parseResult.docDescription || "";
  allPending.push({
    chunkId: "BOOK", nodeId: "", blockIds: [], type: "summary", level: "L0",
    text: `${bookTitle}\n${bookSummary}`,
  });

  // L1: chapter summaries
  for (const node of parseResult.structure || []) {
    collectAllChapterNodesForPending(node, allPending);
  }

  // Generate embeddings for L0+L1 (truncate to model token limit)
  const l0l1Texts = allPending.map(p => truncate(p.text));
  const l0l1Vectors = await generateEmbeddings(l0l1Texts, embedding, onEmbedCall);
  for (let i = 0; i < l0l1Vectors.length; i++) {
    allPending[i].vector = l0l1Vectors[i];
  }

  // L2: chunk paragraphs from .md files
  const exportName = treeData.exportName || treeData.title;
  let totalChunks = 0;

  for (const node of parseResult.structure || []) {
    const chapters = collectChaptersFlat(node);
    for (const ch of chapters) {
      const fileName = nodeFileMap[ch.nodeId];
      if (!fileName) continue;
      const mdPath = path.join(vaultRootPath, "DeepReader", exportName, fileName);
      try {
        const content = await fs.readFile(mdPath, "utf-8");
        const cleaned = cleanMdContent(content);
        const paragraphs = splitByBlockIds(cleaned);
        const chunks = mergeToChunks(paragraphs, ch.nodeId);

        for (const chunk of chunks) {
          allPending.push({
            chunkId: chunk.chunkId,
            nodeId: ch.nodeId,
            blockIds: chunk.blockIds,
            type: chunk.type,
            level: "L2",
            text: chunk.text,
          });
          totalChunks++;
        }
      } catch {
        piLog(`[vectorize] L2: failed to read ${mdPath}`);
      }
    }
  }

  onProgress?.(`向量化段落 0/${totalChunks}`);

  // Batch embed L2 texts
  const l2Pending = allPending.filter(p => p.level === "L2");
  if (l2Pending.length > 0) {
    const batchSize = 32;
    for (let i = 0; i < l2Pending.length; i += batchSize) {
      const batch = l2Pending.slice(i, i + batchSize);
      const texts = batch.map(c => truncate(c.text));
      const vectors = await generateEmbeddings(texts, embedding, onEmbedCall);
      for (let j = 0; j < vectors.length; j++) {
        batch[j].vector = vectors[j];
      }
      onProgress?.(`向量化段落 ${Math.min(i + batchSize, totalChunks)}/${totalChunks}`);
    }
  }

  // Filter out records without vectors (embedding failure)
  const valid = allPending.filter(p => p.vector !== undefined);
  if (valid.length < allPending.length) {
    piLog(`[vectorize] Warning: ${allPending.length - valid.length} chunks had no embedding, skipping`);
  }

  const allVectorRecords: Array<import("./vault/types.js").VectorRecord> = valid.map(p => ({
    chunkId: p.chunkId,
    nodeId: p.nodeId,
    blockIds: p.blockIds,
    type: p.type,
    level: p.level,
    vector: p.vector!,
  }));
  const allChunkTexts: Array<import("./vault/types.js").ChunkTextRecord> = valid.map(p => ({
    chunkId: p.chunkId,
    nodeId: p.nodeId,
    blockIds: p.blockIds,
    text: p.text,
    type: p.type,
  }));

  await writeVectorJsonl(vectorPath, allVectorRecords);
  await writeChunkTexts(chunksPath, allChunkTexts);

  // Clean up legacy storage formats (AFTER new format written successfully)
  try {
    await fs.rm(path.join(indexDir, "paragraph-vectors"), { recursive: true, force: true });
    await fs.rm(path.join(indexDir, "vectors.f32"), { force: true });
    await fs.rm(path.join(indexDir, "vectors.meta.json"), { force: true });
  } catch { /* ignore if not exists */ }

  piLog(`[vectorize] Wrote ${allVectorRecords.length} vectors and ${allChunkTexts.length} chunk texts`);
  return { dimensions, nodeCount: allVectorRecords.length };
}

/**
 * Build BM25 index from parse result
 * Fix: iterate entire structure array (not just structure[0])
 * BM25 uses full text (title + summary + text) for keyword matching
 */
function buildBM25IndexFromParseResult(parseResult: any): BM25Data {
  const nodes: Array<{ id: string; title: string; text: string; level: "L0" | "L1" }> = [];

  for (const rootNode of parseResult.structure || []) {
    // Each top-level element as L0
    nodes.push({
      id: rootNode.nodeId || `L0-${nodes.length}`,
      title: rootNode.title || "",
      text: `${rootNode.title}\n${rootNode.summary || ""}\n${rootNode.text || ""}`,
      level: "L0",
    });

    // Recursively collect all child nodes as L1 (with full text for BM25)
    collectIndexLeafNodes(rootNode, nodes, true);
  }

  return buildBM25Index(nodes);
}

/**
 * Recursively collect all child nodes for BM25/vector indexing
 * @param includeFullText - If true, include node.text for BM25; if false, use title+summary only for vectorization
 */
function collectIndexLeafNodes(
  node: any,
  nodes: Array<{ id: string; title: string; text: string; level: "L0" | "L1" }>,
  includeFullText: boolean = false
): void {
  if (!node.nodes || node.nodes.length === 0) return;

  for (const child of node.nodes) {
    const text = includeFullText
      ? `${child.title}\n${child.summary || ""}\n${child.text || ""}`
      : `${child.title}\n${child.summary || ""}`;
    nodes.push({
      id: child.nodeId || `L1-${nodes.length}`,
      title: child.title || "",
      text,
      level: "L1",
    });
    collectIndexLeafNodes(child, nodes, includeFullText);
  }
}

/**
 * Collect chapter nodes into PendingChunk[] for L1 vectorization.
 */
function collectAllChapterNodesForPending(
  node: any,
  pending: Array<{
    chunkId: string; nodeId: string; blockIds: string[];
    type: "summary" | "heading" | "body" | "list" | "quote";
    level: "L0" | "L1" | "L2"; text: string; vector?: number[];
  }>
): void {
  if (node.nodeId && node.title) {
    pending.push({
      chunkId: `${node.nodeId}_summary`,
      nodeId: node.nodeId,
      blockIds: [],
      type: "summary",
      level: "L1",
      text: `${node.title}\n${node.summary || ""}`,
    });
  }
  for (const child of node.nodes || []) {
    collectAllChapterNodesForPending(child, pending);
  }
}

/**
 * Flat collection of all chapters with nodeId and title.
 */
function collectChaptersFlat(node: any): Array<{ nodeId: string; title: string }> {
  const result: Array<{ nodeId: string; title: string }> = [];
  if (node.nodeId && node.title) result.push({ nodeId: node.nodeId, title: node.title });
  for (const child of node.nodes || []) result.push(...collectChaptersFlat(child));
  return result;
}

/**
 * Clean markdown content for chunking: remove frontmatter and callouts.
 */
function cleanMdContent(content: string): string {
  let cleaned = content.replace(/^---[\s\S]*?---\n/, "");
  cleaned = cleaned.replace(/> \[!.*?\][^\n]*\n(> .*\n)*/g, "");
  return cleaned.trim();
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
export function simplifyTitle(title: string): string {
  const separators = ['：', ':', '—', '-', '｜', '|'];
  for (const sep of separators) {
    if (title.includes(sep)) {
      return title.split(sep)[0].trim();
    }
  }
  return title;
}

const CONCURRENT_DOWNLOADS = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_HOST = 'cdn-mineru.openxlab.org.cn';

async function downloadImages(
  images: MineruImage[],
  imagesDir: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  let completed = 0;

  for (let i = 0; i < images.length; i += CONCURRENT_DOWNLOADS) {
    const batch = images.slice(i, i + CONCURRENT_DOWNLOADS);
    await Promise.allSettled(
      batch.map(async (img) => {
        try {
          const urlObj = new URL(img.url);
          if (urlObj.hostname !== ALLOWED_IMAGE_HOST) return;

          const resp = await safeRequest({ url: img.url });
          if (resp.status >= 400) return;

          const data = resp.arrayBuffer;
          if (!data || data.byteLength > MAX_IMAGE_SIZE) return;

          await fs.writeFile(path.join(imagesDir, img.fileName), Buffer.from(data));
        } catch (err) {
          piLog(`[book-indexer] Failed to download image ${img.fileName}: ${err instanceof Error ? err.message : err}`);
        }
      })
    );
    completed += batch.length;
    onProgress(completed, images.length);
  }
}

/**
 * Migrate legacy path-based bookIds to content-based bookIds.
 * Called once on plugin load. Safe to re-run (idempotent).
 * After successful migration, writes a marker file to skip on subsequent loads.
 *
 * @returns Number of indexes migrated
 */
export async function migrateBookIndexes(vaultPath: string): Promise<number> {
  const pageindexDir = getPageindexRoot(vaultPath);
  const markerPath = path.join(pageindexDir, MIGRATION_MARKER);

  // Skip if already migrated
  try {
    await fs.access(markerPath);
    return 0;
  } catch { /* not yet migrated */ }

  let entries: string[];
  try {
    entries = await fs.readdir(pageindexDir);
  } catch {
    return 0; // .pageindex/ doesn't exist yet
  }

  let migrated = 0;

  for (const entry of entries) {
    const entryPath = path.join(pageindexDir, entry);

    // Skip non-directories and special files
    try {
      const stat = await fs.stat(entryPath);
      if (!stat.isDirectory()) continue;
    } catch { continue; }

    // Skip journal indexes and special dirs
    if (entry.startsWith("journal_")) continue;

    const metaPath = path.join(entryPath, "book-meta.json");
    let meta: BookMeta;
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      meta = JSON.parse(raw) as BookMeta;
    } catch {
      continue; // No meta file, skip
    }

    // Check if source file still exists
    const sourcePath = meta.filePath;
    if (!sourcePath) continue;

    let newId: string;
    try {
      newId = await generateBookId(sourcePath);
    } catch {
      continue; // Source file gone, keep old ID
    }

    const oldId = entry;
    if (newId === oldId) continue; // Path hash coincidentally equals content hash

    // Check if target directory already exists (collision)
    const newPath = path.join(pageindexDir, newId);
    try {
      await fs.access(newPath);
      piLog(`[migration] Collision: ${oldId} -> ${newId} (target exists). Keeping ${oldId}.`);
      continue;
    } catch { /* target doesn't exist, safe to rename */ }

    // Rename directory
    await fs.rename(entryPath, newPath);

    // Update book-meta.json
    meta.bookId = newId;
    await fs.writeFile(
      path.join(newPath, "book-meta.json"),
      JSON.stringify(meta, null, 2)
    );

    // Update catalog.json using atomic APIs
    try {
      const { loadCatalog, updateCatalogEntry, removeCatalogEntry } = await import("./vault/vectors.js");
      const catalog = await loadCatalog(pageindexDir);
      if (catalog.books[oldId]) {
        await updateCatalogEntry(pageindexDir, newId, catalog.books[oldId]);
        await removeCatalogEntry(pageindexDir, oldId);
      }
    } catch { /* catalog update is best-effort */ }

    // Update MOC frontmatter index_id
    try {
      const exportDir = path.join(vaultPath, DEFAULT_EXPORT_DIR, meta.exportName || meta.title);
      const mocFiles = (await fs.readdir(exportDir)).filter(f => f.includes("MOC"));
      for (const mocFile of mocFiles) {
        const mocPath = path.join(exportDir, mocFile);
        let content = await fs.readFile(mocPath, "utf-8");
        content = content.replace(`index_id: ${oldId}`, `index_id: ${newId}`);
        content = content.replace(`pdf_index_id: ${oldId}`, `pdf_index_id: ${newId}`);
        await fs.writeFile(mocPath, content);
      }
    } catch { /* MOC update is best-effort */ }

    migrated++;
  }

  // Write marker to skip on next load
  try {
    await fs.writeFile(markerPath, new Date().toISOString());
  } catch { /* best-effort */ }

  return migrated;
}