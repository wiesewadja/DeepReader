/**
 * Book indexer - orchestrates PDF/EPUB indexing workflow
 */

import { apiLog } from "../utils/logger.js";
import { nodeCrypto, nodeFsPromises, nodePath } from "../utils/node-compat.js";
import { safeRequest } from "../utils/safe-request.js";
import type {
  BookIndexOptions,
  BookIndexResult,
  BookMeta,
 TreeData } from "./book-types.js";
import { IndexError } from "./book-types.js";
import { log as piLog } from "./core/logger.js";
import type { PageIndexResult, TreeNode } from "./core/types.js";
import { DEFAULT_EXPORT_DIR } from "./defaults.js";
import { getPageindexRoot, getBookDir } from "./paths.js";
import type { MineruImage } from "./parsers/mineru-types.js";
import type { EmbeddingOptions } from "./vault/types.js";

// Pipeline executor + steps
import { executePipeline } from "./book-indexer/executor.js";
import { validateStep } from "./book-indexer/steps/validate.js";
import { parseStep } from "./book-indexer/steps/parse.js";
import { coverStep } from "./book-indexer/steps/cover.js";
import { exportStep } from "./book-indexer/steps/export.js";
import { metadataStep } from "./book-indexer/steps/metadata.js";
import { vectorizeStep } from "./book-indexer/steps/vectorize.js";
import { bm25Step } from "./book-indexer/steps/bm25.js";
import { propositionsStep } from "./book-indexer/steps/propositions.js";
import { finalizeStep } from "./book-indexer/steps/finalize.js";
import type { PipelineContext } from "./book-indexer/pipeline-types.js";

const BOOK_ID_HEAD_BYTES = 65536; // 64KB sample for content-based ID
const MIGRATION_MARKER = ".migrated-content-id-v1";

/**
 * Generate bookId from file content (SHA-256 of first 64KB + file size).
 * Content-based ID is stable regardless of file path changes.
 */
export async function generateBookId(filePath: string): Promise<string> {
  const fs = nodeFsPromises();
  const crypto = nodeCrypto();
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
  const crypto = nodeCrypto();
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

/**
 * Check if book is already indexed
 * @param filePath - Book file path
 * @param vaultPath - Vault root path (where .pageindex directory is located)
 */
export async function isBookIndexed(filePath: string, vaultPath: string): Promise<boolean> {
  const fs = nodeFsPromises();
  const path = nodePath();
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
  const fs = nodeFsPromises();
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
 * Create a minimal PipelineContext for the pipeline executor.
 * The validate step populates bookId, indexDir, tracer, reportProgress, etc.
 */
function createPipelineContext(
  options: BookIndexOptions,
  plugin?: any,
  app?: any,
): PipelineContext {
  return {
    bookId: "",
    indexDir: "",
    deepReaderDir: "",
    bookDir: "",
    exportName: "",
    rootTitle: "",
    filePath: options.filePath,
    fileType: options.fileType,
    options,
    tracer: undefined as any, // set by validate step
    reportProgress: () => {}, // set by validate step
    plugin,
    app,
  };
}

/**
 * Index a single book via pipeline executor.
 * @param options - Book index options
 * @param options.outputDir - Vault root path (where .pageindex directory will be created)
 */
export async function indexBook(options: BookIndexOptions): Promise<BookIndexResult> {
  const ctx = createPipelineContext(options);

  const steps = [
    validateStep,
    parseStep,
    coverStep,
    exportStep,
    metadataStep,
    vectorizeStep,
    bm25Step,
    propositionsStep,
    finalizeStep,
  ];

  // Wrap in try-finally to ensure status cleanup on error
  try {
    await executePipeline(steps, ctx);
    return {
      bookId: ctx.bookId,
      title: ctx.rootTitle,
      fileType: options.fileType,
      chaptersCount: ctx.parseResult?.structure?.length ?? 0,
      indexDir: ctx.indexDir,
    };
  } catch (error) {
    // On failure: finalize tracer + preserve .indexing.json with failed status
    ctx.tracer?.finalize(false, error instanceof Error ? error.message : String(error));
    const fs = nodeFsPromises();
    const path = nodePath();
    try {
      await fs.writeFile(ctx.indexingStatusPath!, JSON.stringify({
        bookId: ctx.bookId,
        filePath: options.filePath,
        fileType: options.fileType,
        title: path.basename(options.filePath, path.extname(options.filePath)),
        percent: 0,
        step: "failed",
        stepLabel: "索引失败",
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    } catch { /* best-effort */ }
    throw error;
  }
}

/**
 * Vectorize L0 (book) + L1 (chapter summaries) + L2 (paragraph chunks).
 * Returns { dimensions, nodeCount }
 */
export async function vectorizeAllLevels(
  parseResult: PageIndexResult,
  indexDir: string,
  embedding: EmbeddingOptions,
  nodeFileMap: Record<string, string>,
  treeData: TreeData,
  vaultRootPath: string,
  onProgress?: (msg: string) => void,
  onEmbedCall?: (info: { model: string; durationMs: number; inputTokens?: number; batchSize: number }) => void
): Promise<{ dimensions: number; nodeCount: number } | undefined> {
  const fs = nodeFsPromises();
  const path = nodePath();
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
  const bookTitle = parseResult.docName || "";
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
 * Collect chapter nodes into PendingChunk[] for L1 vectorization.
 */
function collectAllChapterNodesForPending(
  node: TreeNode,
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
function collectChaptersFlat(node: TreeNode): Array<{ nodeId: string; title: string }> {
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
 * Returns a nodeId-keyed object: { [nodeId]: { title, summary } }
 *
 * nodeId-keyed (not title-keyed) because multiple sibling nodes can share the
 * same title (e.g. after `splitLargeEpubPages` truncates titles to "#"/"##"),
 * which would cause key collisions in a title-keyed dict. nodeId is unique.
 */
export function collectNodeSummaries(
  structure: TreeNode[],
): Record<string, { title: string; summary: string }> {
  if (!structure) return {};

  const map: Record<string, { title: string; summary: string }> = {};

  for (const root of structure) {
    // Root level
    if (root.summary && root.nodeId) {
      map[root.nodeId] = { title: root.title, summary: root.summary };
    }
    // L1 nodes (chapters)
    for (const node of root?.nodes || []) {
      if (node.summary && node.nodeId) {
        map[node.nodeId] = { title: node.title, summary: node.summary };
      }
    }
  }

  return map;
}

/**
 * Generate a text-based SVG cover image
 * Used when no cover image is available (e.g., PDF without embedded cover)
 */
export function generateTextCover(title: string, fileType: string): string {
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

export async function downloadImages(
  images: MineruImage[],
  imagesDir: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const fs = nodeFsPromises();
  const path = nodePath();
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
  const fs = nodeFsPromises();
  const path = nodePath();
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