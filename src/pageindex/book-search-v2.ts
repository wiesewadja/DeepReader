/**
 * Book Search v2 — 8-stage hybrid search pipeline
 *
 * Stage 1: Dynamic recall K
 * Stage 2: BM25 search
 * Stage 3: Vector semantic search (optional)
 * Stage 3.5: Proposition cards search (optional)
 * Stage 4: Scope filter
 * Stage 5: Score fusion + level weighting
 * Stage 6: LLM tree search (optional)
 * Stage 7: Cross-encoder rerank (optional)
 * Stage 8: Matched block location (block_id level)
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import type {
  BookSearchOptionsV2,
  BookSearchResultV2,
  MatchedBlock,
  BM25Data,
  TreeData,
  TreeNode,
  PropositionCard,
} from "./book-types.js";
import { IndexErrorCode, IndexError } from "./book-types.js";
import { searchBM25, tokenize } from "./bm25.js";
import {
  loadVectorStore,
  generateEmbedding,
  generateEmbeddings,
  cosineSearch,
} from "./vault/vectors.js";
import type { EmbeddingOptions } from "./vault/types.js";
import { log as piLog } from "./core/logger";
import {
  loadPropositions,
  loadPropVectorStore,
} from "./proposition-search.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateBookId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ─── Main entry ─────────────────────────────────────────────────────────────

/**
 * Search a book using the 8-stage pipeline
 */
export async function searchBookV2(
  options: BookSearchOptionsV2
): Promise<BookSearchResultV2[]> {
  const bookId = options.bookId || generateBookId(options.filePath);
  const vaultPath = options.vaultPath || path.dirname(options.filePath);
  const indexDir = path.join(vaultPath, ".pageindex", bookId);
  const topK = options.topK || 5;

  // Validate index exists
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

  // Load tree.json
  const treeData = await loadTreeJson(indexDir);
  if (!treeData) {
    throw new IndexError(
      "tree.json not found",
      IndexErrorCode.INDEX_INCOMPLETE,
      "索引数据不完整",
      "请重新索引此书籍"
    );
  }

  // Load BM25 index
  const bm25Path = path.join(indexDir, "bm25.json");
  const bm25Content = await fs.readFile(bm25Path, "utf-8");
  const bm25Index = JSON.parse(bm25Content) as BM25Data;

  // ── Stage 1: Dynamic recall K ──────────────────────────────────────────
  const recallK = computeDynamicRecallK(options.query);
  const expandedK = options.scopeNodeIds && options.scopeNodeIds.length > 0
    ? recallK * 5   // Expand for scope filtering
    : recallK;

  // ── Stage 2: BM25 search ───────────────────────────────────────────────
  const bm25Results = searchBM25(options.query, bm25Index, expandedK);
  const bm25Scores = new Map<string, number>();
  for (const r of bm25Results) {
    bm25Scores.set(r.nodeId, r.score);
  }

  // ── Stage 3: Vector semantic search (optional) ─────────────────────────
  let vectorScores = new Map<string, number>();
  let queryVector: number[] | null = null;

  if (options.embedding) {
    try {
      const vectorStore = await loadVectorStore(indexDir);
      if (vectorStore && vectorStore.meta.count > 0) {
        queryVector = await generateEmbedding(options.query, options.embedding);
        const vectorResults = await cosineSearch(queryVector, vectorStore, expandedK);
        for (const r of vectorResults) {
          vectorScores.set(r.nodeId, r.score);
        }
      }
    } catch (error) {
      piLog(`[book-search-v2] Vector search failed: ${error}`);
      vectorScores = new Map();
    }
  }

  // ── Stage 3.5: Proposition cards search (optional) ────────────────────
  const propositionMatches = new Map<string, PropositionCard[]>();

  if (options.embedding) {
    try {
      const propositionsData = await loadPropositions(indexDir);
      const propVectorStore = await loadPropVectorStore(indexDir);

      if (propositionsData && propVectorStore && propositionsData.totalCards > 0) {
        const queryVec = await generateEmbedding(options.query, options.embedding);
        const queryFloat32 = new Float32Array(queryVec);

        const scores: Array<{ cardId: string; score: number }> = [];
        for (const [cardId, slot] of Object.entries(propVectorStore.meta.slots)) {
          if (slot.deleted) continue;

          const offset = slot.slotIndex * propVectorStore.meta.dimensions;
          const cardVector = propVectorStore.vectors.subarray(
            offset,
            offset + propVectorStore.meta.dimensions
          );

          const score = cosineSimilarity(queryFloat32, cardVector);
          scores.push({ cardId, score });
        }

        const topScores = scores.sort((a, b) => b.score - a.score).slice(0, topK * 3);

        for (const s of topScores) {
          const card = propositionsData.cards.find(c => c.id === s.cardId);
          if (card && s.score > 0.5) {
            const nodeId = card.sourceNodeId;
            if (!propositionMatches.has(nodeId)) {
              propositionMatches.set(nodeId, []);
            }
            propositionMatches.get(nodeId)!.push(card);
          }
        }

        piLog(`[book-search-v2] Proposition search: ${propositionMatches.size} nodes with matches`);
      }
    } catch (error) {
      piLog(`[book-search-v2] Proposition search failed: ${error}`);
    }
  }

  // ── Stage 4: Scope filter ──────────────────────────────────────────────
  const hasVectors = vectorScores.size > 0;
  const allNodeIds = new Set([...vectorScores.keys(), ...bm25Scores.keys()]);

  let candidateNodeIds = allNodeIds;
  if (options.scopeNodeIds && options.scopeNodeIds.length > 0) {
    const scopeSet = new Set(options.scopeNodeIds);
    candidateNodeIds = new Set([...allNodeIds].filter(id => scopeSet.has(id)));
  }

  // ── Stage 5: Score fusion + level weighting ────────────────────────────
  const w_v = hasVectors ? 0.7 : 0;
  const w_b = hasVectors ? 0.3 : 1.0;

  // Normalize BM25 scores
  const bm25Values = Array.from(bm25Scores.values());
  const bm25Max = Math.max(...bm25Values, 0);
  const bm25Min = Math.min(...bm25Values, 0);
  const bm25Range = bm25Max - bm25Min;

  type ScoredResult = {
    nodeId: string;
    fusedScore: number;
    vectorScore: number;
    bm25Score: number;
    levelWeight: number;
  };

  const scoredResults: ScoredResult[] = [];

  for (const nodeId of candidateNodeIds) {
    const vs = vectorScores.get(nodeId) || 0;
    const bs = bm25Scores.get(nodeId) || 0;
    const normalizedBM25 = bm25Range > 0 ? (bs - bm25Min) / bm25Range : 0;
    const fusedScore = w_v * vs + w_b * normalizedBM25;
    const levelWeight = computeLevelWeight(nodeId, treeData.structure);

    scoredResults.push({
      nodeId,
      fusedScore: fusedScore * levelWeight,
      vectorScore: vs,
      bm25Score: bs,
      levelWeight,
    });
  }

  scoredResults.sort((a, b) => b.fusedScore - a.fusedScore);
  const topResults = scoredResults.slice(0, topK);

  // ── Stage 6: LLM tree search (optional, not yet implemented) ───────────
  // TODO: implement when llmClient is available

  // ── Stage 7: Cross-encoder rerank (optional, not yet implemented) ──────
  // TODO: implement when reranker is available

  // ── Stage 8: Matched block location ────────────────────────────────────
  const cacheDir = path.join(indexDir, "paragraph-vectors");
  const queryTokens = tokenize(options.query);

  const results: BookSearchResultV2[] = [];

  for (const r of topResults) {
    const hierarchyPath = findHierarchyPath(r.nodeId, treeData.structure);
    const title = findNodeTitle(r.nodeId, treeData.structure) || r.nodeId;

    // 优先使用命题卡片作为 matchedBlocks
    const matchedCards = propositionMatches.get(r.nodeId) || [];
    let matchedBlocks: MatchedBlock[];

    if (matchedCards.length > 0) {
      matchedBlocks = matchedCards.slice(0, 3).map(card => ({
        blockId: card.id,
        content: `${card.context} ^${card.id}\n\n【${card.type}】${card.answer}`,
      }));
      piLog(`[book-search-v2] Using ${matchedCards.length} proposition cards for ${r.nodeId}`);
    } else {
      matchedBlocks = await locateMatchedBlocks(
        r.nodeId,
        options.query,
        queryTokens,
        treeData,
        vaultPath,
        {
          embedding: options.embedding,
          queryVector: queryVector ? new Float32Array(queryVector) : undefined,
          cacheDir,
          maxBlocksPerNode: 3,
          blockSize: 500,
        }
      );
    }

    results.push({
      nodeId: r.nodeId,
      title,
      fileName: (treeData.nodeFileMap?.[r.nodeId] || '').replace(/\.md$/i, ''),
      hierarchyPath,
      matchedBlocks,
      score: r.fusedScore,
      bm25Score: r.bm25Score,
      vectorScore: r.vectorScore,
    });
  }

  return results;
}

// ─── Load tree.json ─────────────────────────────────────────────────────────

export async function loadTreeJson(indexDir: string): Promise<TreeData | null> {
  try {
    const treePath = path.join(indexDir, "tree.json");
    const content = await fs.readFile(treePath, "utf-8");
    return JSON.parse(content) as TreeData;
  } catch {
    return null;
  }
}

// ─── Stage 1: Dynamic recall K ──────────────────────────────────────────────

function computeDynamicRecallK(query: string): number {
  const len = query.length;
  if (len < 5) return 50;
  if (len <= 15) return 30;
  return 15;
}

// ─── Stage 5: Level weighting ───────────────────────────────────────────────

function computeLevelWeight(nodeId: string, structure: TreeNode[]): number {
  const node = findNodeInTree(nodeId, structure);
  if (!node) return 0.5;

  // Check if it has children
  const hasChildren = node.nodes && node.nodes.length > 0;
  const depth = findDepth(nodeId, structure);

  if (depth === 0) return 1.0;     // L0 book-level
  if (hasChildren) return 0.7;     // L1 chapter-level (has subsections)
  return 0.5;                       // L1 section-level (leaf)
}

function findNodeInTree(nodeId: string, nodes: TreeNode[]): TreeNode | null {
  for (const node of nodes) {
    if (node.nodeId === nodeId) return node;
    if (node.nodes) {
      const found = findNodeInTree(nodeId, node.nodes);
      if (found) return found;
    }
  }
  return null;
}

function findDepth(nodeId: string, nodes: TreeNode[], depth: number = 0): number {
  for (const node of nodes) {
    if (node.nodeId === nodeId) return depth;
    if (node.nodes) {
      const d = findDepth(nodeId, node.nodes, depth + 1);
      if (d >= 0) return d;
    }
  }
  return -1;
}

// ─── Hierarchy path ─────────────────────────────────────────────────────────

function findHierarchyPath(nodeId: string, nodes: TreeNode[], path: string[] = []): string[] {
  for (const node of nodes) {
    const currentPath = [...path, node.title];
    if (node.nodeId === nodeId) return currentPath;
    if (node.nodes) {
      const found = findHierarchyPath(nodeId, node.nodes, currentPath);
      if (found.length > 0) return found;
    }
  }
  return [];
}

function findNodeTitle(nodeId: string, nodes: TreeNode[]): string | null {
  const node = findNodeInTree(nodeId, nodes);
  return node?.title || null;
}

// ─── Stage 8: Matched block location ────────────────────────────────────────

interface Paragraph {
  blockId: string;
  text: string;
  start: number;
  end: number;
}

async function locateMatchedBlocks(
  nodeId: string,
  _query: string,
  queryTokens: string[],
  tree: TreeData,
  vaultPath: string,
  options: {
    embedding?: EmbeddingOptions;
    queryVector?: Float32Array;
    cacheDir?: string;
    maxBlocksPerNode?: number;
    blockSize?: number;
  }
): Promise<MatchedBlock[]> {
  const fileName = tree.nodeFileMap[nodeId];
  if (!fileName) return [];

  const dirName = tree.exportName || tree.title;
  const fullPath = path.join(vaultPath, "DeepReader", dirName, fileName);

  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch {
    return [];
  }

  // Remove frontmatter
  content = content.replace(/^---[\s\S]*?---\n/, "");

  // Split by ^block_id markers
  const paragraphs = splitByBlockIds(content);
  if (paragraphs.length === 0) return [];

  // Score paragraphs: vector similarity or token density
  let scored: Array<Paragraph & { score: number }>;

  if (options.queryVector && options.embedding && options.cacheDir) {
    scored = await scoreByVectorSimilarity(
      nodeId, paragraphs, options.queryVector, options.embedding, options.cacheDir
    );
  } else {
    scored = scoreByTokenDensity(paragraphs, queryTokens);
  }

  // Take top N
  const maxBlocks = options.maxBlocksPerNode ?? 3;
  const blockSize = options.blockSize ?? 500;
  const topMatches = scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxBlocks);

  // Build matched blocks with context
  return topMatches.map(m => ({
    blockId: m.blockId,
    content: expandToContext(m, paragraphs, blockSize),
  }));
}

// ─── Paragraph splitting ────────────────────────────────────────────────────

function splitByBlockIds(content: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const regex = /\^([\w-]+)/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    // ^block_id 标记在段落末尾，它引用的是前面的文本
    const blockId = `^${match[1]}`;
    const text = content.slice(lastEnd, match.index).trim();
    if (text) {
      paragraphs.push({ blockId, text, start: lastEnd, end: match.index });
    }
    lastEnd = match.index + match[0].length;
  }
  // Last paragraph (no block_id marker)
  const remaining = content.slice(lastEnd).trim();
  if (remaining) {
    paragraphs.push({ blockId: "", text: remaining, start: lastEnd, end: content.length });
  }

  return paragraphs;
}

// ─── Stage 8 scoring: vector similarity (path A) ────────────────────────────

async function scoreByVectorSimilarity(
  nodeId: string,
  paragraphs: Paragraph[],
  queryVector: Float32Array,
  embedding: EmbeddingOptions,
  cacheDir: string
): Promise<Array<Paragraph & { score: number }>> {
  // Try loading from cache
  let paragraphVectors = await loadParagraphVectors(nodeId, cacheDir, embedding);

  if (!paragraphVectors) {
    // Cache miss: compute embeddings
    try {
      const texts = paragraphs.map(p => p.text);
      const rawVectors = await generateEmbeddings(texts, embedding);
      paragraphVectors = rawVectors.map(v => new Float32Array(v));

      // Async save to cache
      saveParagraphVectors(nodeId, paragraphVectors, cacheDir, embedding).catch(() => {});
    } catch (err) {
      piLog(`[book-search-v2] Paragraph embedding failed, falling back to token density: ${err}`);
      return paragraphs.map(p => ({ ...p, score: 0 }));
    }
  }

  return paragraphs.map((p, i) => ({
    ...p,
    score: cosineSimilarity(queryVector, paragraphVectors[i]),
  }));
}

// ─── Stage 8 scoring: token density (path B, fallback) ──────────────────────

function scoreByTokenDensity(
  paragraphs: Paragraph[],
  queryTokens: string[]
): Array<Paragraph & { score: number }> {
  return paragraphs.map(p => ({
    ...p,
    score: countTokenHits(p.text, queryTokens),
  }));
}

function countTokenHits(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  return tokens.reduce((count, token) => {
    let pos = 0;
    while ((pos = lower.indexOf(token.toLowerCase(), pos)) !== -1) {
      count++;
      pos += token.length;
    }
    return count;
  }, 0);
}

// ─── Context expansion ──────────────────────────────────────────────────────

function expandToContext(
  match: Paragraph & { score: number },
  paragraphs: Paragraph[],
  blockSize: number
): string {
  // Find the paragraph index
  const idx = paragraphs.indexOf(match);
  if (idx === -1) return match.text;

  // Accumulate text around the match until we reach blockSize
  let result = match.text;
  let before = idx - 1;
  let after = idx + 1;

  while (result.length < blockSize && (before >= 0 || after < paragraphs.length)) {
    if (after < paragraphs.length) {
      result += "\n\n" + paragraphs[after].text;
      if (paragraphs[after].blockId) result += " " + paragraphs[after].blockId;
      after++;
    }
    if (result.length >= blockSize) break;
    if (before >= 0) {
      const beforeText = paragraphs[before].text + (paragraphs[before].blockId ? " " + paragraphs[before].blockId : "");
      result = beforeText + "\n\n" + result;
      before--;
    }
  }

  return result.slice(0, blockSize);
}

// ─── Paragraph vector cache ─────────────────────────────────────────────────

async function loadParagraphVectors(
  nodeId: string,
  cacheDir: string,
  embedding: EmbeddingOptions
): Promise<Float32Array[] | null> {
  const vecsPath = path.join(cacheDir, `${nodeId}.vecs`);
  const metaPath = path.join(cacheDir, "meta.json");

  try {
    // Check meta for embedding config match
    if (fsSync.existsSync(metaPath)) {
      const cacheMeta = JSON.parse(fsSync.readFileSync(metaPath, "utf-8"));
      if (cacheMeta.embeddingModel !== (embedding.model || "text-embedding-3-small") ||
          cacheMeta.embeddingProvider !== embedding.provider) {
        return null; // Config changed, cache invalid
      }
    }

    if (!fsSync.existsSync(vecsPath)) return null;

    const buf = fsSync.readFileSync(vecsPath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const count = view.getUint32(0, true);
    const dim = view.getUint32(4, true);

    const vectors: Float32Array[] = [];
    let offset = 8;
    for (let i = 0; i < count; i++) {
      const vec = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        vec[j] = view.getFloat32(offset, true);
        offset += 4;
      }
      vectors.push(vec);
    }

    return vectors;
  } catch {
    return null;
  }
}

async function saveParagraphVectors(
  nodeId: string,
  vectors: Float32Array[],
  cacheDir: string,
  embedding: EmbeddingOptions
): Promise<void> {
  try {
    fsSync.mkdirSync(cacheDir, { recursive: true });

    // Write meta.json (once)
    const metaPath = path.join(cacheDir, "meta.json");
    if (!fsSync.existsSync(metaPath)) {
      fsSync.writeFileSync(metaPath, JSON.stringify({
        version: 1,
        embeddingProvider: embedding.provider,
        embeddingModel: embedding.model || "text-embedding-3-small",
        totalParagraphs: vectors.length,
      }));
    }

    // Write binary vectors
    const dim = vectors[0]?.length || 0;
    if (dim === 0) return;

    const headerSize = 8;
    const vecsSize = vectors.length * dim * 4;
    const buf = Buffer.alloc(headerSize + vecsSize);

    buf.writeUInt32LE(vectors.length, 0);
    buf.writeUInt32LE(dim, 4);

    let offset = headerSize;
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        buf.writeFloatLE(vec[i], offset);
        offset += 4;
      }
    }

    fsSync.writeFileSync(path.join(cacheDir, `${nodeId}.vecs`), buf);
  } catch (err) {
    piLog(`[book-search-v2] Failed to save paragraph vectors: ${err}`);
  }
}
