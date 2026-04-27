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
  cosineSearchJsonl,
} from "./vault/vectors.js";
import type { RerankerOptions } from "./vault/types.js";
import { log as piLog } from "./core/logger";
import {
  loadPropositions,
  loadPropVectorStore,
} from "./proposition-search.js";
import { getOrGenerateEmbedding } from "../agent/utils/embedding-cache.js";
import { safeRequest } from "../utils/safe-request.js";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ChunkHit {
  chunkId: string;
  blockIds: string[];
  score: number;
}

// ─── Index file cache (avoids redundant disk reads in multi-keyword RRF) ─────

const indexCache = new Map<string, { data: any; ts: number }>();
const INDEX_CACHE_TTL = 60_000; // 1 minute

function getCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = indexCache.get(key);
  if (cached && Date.now() - cached.ts < INDEX_CACHE_TTL) {
    return cached.data as Promise<T>;
  }
  const promise = loader();
  promise.catch(() => indexCache.delete(key)); // Remove on failure
  indexCache.set(key, { data: promise, ts: Date.now() });
  return promise;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateBookId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
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

  // Load tree.json (cached to avoid redundant reads in multi-keyword searches)
  const treeData = await getCached(`tree:${indexDir}`, () => loadTreeJson(indexDir));
  if (!treeData) {
    throw new IndexError(
      "tree.json not found",
      IndexErrorCode.INDEX_INCOMPLETE,
      "索引数据不完整",
      "请重新索引此书籍"
    );
  }

  // Load BM25 index (cached)
  const bm25Index = await getCached(`bm25:${indexDir}`, async () => {
    const bm25Path = path.join(indexDir, "bm25.json");
    const bm25Content = await fs.readFile(bm25Path, "utf-8");
    return JSON.parse(bm25Content) as BM25Data;
  });

  // ── Stage 1: Dynamic recall K ──────────────────────────────────────────
  const recallK = computeDynamicRecallK(options.query);
  const expandedK = options.scopeNodeIds && options.scopeNodeIds.length > 0
    ? recallK * 5
    : recallK;

  // ── Pre-compute query embedding (避免重复调用) ──────────────────────
  let precomputedEmbedding: number[] | null = null;
  if (options.embedding && options.embedding.provider !== 'local') {
    try {
      precomputedEmbedding = await getOrGenerateEmbedding(options.query, options.embedding);
    } catch (error) {
      piLog(`[book-search-v2] Query embedding failed: ${error}`);
    }
  }

  // ── Stage 2-3.5: Multi-path parallel recall ───────────────────────────
  const [bm25Results, vectorSearchResult, propSearchResult] = await Promise.all([
    searchBM25(options.query, bm25Index, expandedK),
    precomputedEmbedding
      ? asyncVectorSearch(indexDir, precomputedEmbedding, expandedK)
      : Promise.resolve({ scores: new Map<string, number>(), chunkHits: new Map<string, ChunkHit[]>(), vector: null as number[] | null }),
    precomputedEmbedding 
      ? asyncPropositionSearch(indexDir, precomputedEmbedding, expandedK) 
      : Promise.resolve(new Map()),
  ]);

  // Extract BM25 scores
  const bm25Scores = new Map<string, number>();
  for (const r of bm25Results) {
    bm25Scores.set(r.nodeId, r.score);
  }

  // Extract Vector scores
  const vectorScores = vectorSearchResult.scores;
  const chunkHits = vectorSearchResult.chunkHits;
  const queryVector = vectorSearchResult.vector;

  // Proposition matches already in map
  const propositionMatches = propSearchResult;

  piLog(`[book-search-v2] Parallel recall: BM25=${bm25Results.length}, Vector=${vectorScores.size}, Proposition=${propositionMatches.size} nodes`);

  // ── Stage 4: Scope filter ──────────────────────────────────────────────
  const hasVectors = vectorScores.size > 0;
  const allNodeIds = new Set([...vectorScores.keys(), ...bm25Scores.keys()]);

  let candidateNodeIds = allNodeIds;
  if (options.scopeNodeIds && options.scopeNodeIds.length > 0) {
    const scopeSet = new Set(options.scopeNodeIds);
    const scopedCandidates = new Set([...allNodeIds].filter(id => scopeSet.has(id)));
    // Only apply scope filter if it produces results; otherwise fall back to all candidates
    // to avoid zero-recall when scope IDs don't match any recalled nodes
    if (scopedCandidates.size > 0) {
      candidateNodeIds = scopedCandidates;
    } else {
      piLog(`[book-search-v2] Scope filter produced 0 results from ${allNodeIds.size} candidates, using unscoped fallback`);
    }
  }

  // ── Stage 5: Score fusion + level weighting + proposition ─────────────
  const hasPropositions = propositionMatches.size > 0;

  // Adjust weights based on available signals
  const w_v = hasVectors ? (hasPropositions ? 0.5 : 0.7) : 0;
  const w_b = hasVectors ? (hasPropositions ? 0.25 : 0.3) : 1.0;
  const w_p = hasPropositions ? (hasVectors ? 0.25 : 0) : 0;

  piLog(`[book-search-v2] Fusion weights: v=${w_v}, b=${w_b}, p=${w_p}`);

  // Normalize BM25 scores
  const bm25Values = Array.from(bm25Scores.values());
  const bm25Max = Math.max(...bm25Values, 0);
  const bm25Min = Math.min(...bm25Values, 0);
  const bm25Range = bm25Max - bm25Min;

  // Normalize vector scores (cosine similarity can be negative and has different scale)
  const vecValues = Array.from(vectorScores.values());
  const vecMax = Math.max(...vecValues, 0);
  const vecMin = Math.min(...vecValues, 0);
  const vecRange = vecMax - vecMin;

  // Compute proposition scores per nodeId
  const propositionScores = new Map<string, number>();
  for (const [nodeId, cards] of propositionMatches) {
    if (cards.length > 0) {
      const maxScore = Math.max(...cards.map((c: PropositionCard) => c.matchScore || 0));
      propositionScores.set(nodeId, maxScore);
    }
  }

  // Normalize proposition scores
  const propValues = Array.from(propositionScores.values());
  const propMax = Math.max(...propValues, 0);
  const propMin = Math.min(...propValues, 0);
  const propRange = propMax - propMin;

  type ScoredResult = {
    nodeId: string;
    fusedScore: number;
    vectorScore: number;
    bm25Score: number;
    propositionScore: number;
    levelWeight: number;
  };

  const scoredResults: ScoredResult[] = [];

  // Pre-build tree index for O(1) level weight lookups
  const treeIndex = buildTreeIndex(treeData.structure);

  for (const nodeId of candidateNodeIds) {
    const vs = vectorScores.get(nodeId) || 0;
    const bs = bm25Scores.get(nodeId) || 0;
    const ps = propositionScores.get(nodeId) || 0;

    const normalizedBM25 = bm25Range > 0 ? (bs - bm25Min) / bm25Range : 0;
    const normalizedVec = vecRange > 0 ? (vs - vecMin) / vecRange : (vs > 0 ? 1 : 0);
    const normalizedProp = propRange > 0 ? (ps - propMin) / propRange : ps;

    const fusedScore = w_v * normalizedVec + w_b * normalizedBM25 + w_p * normalizedProp;
    const levelWeight = computeLevelWeightFast(nodeId, treeIndex);

    scoredResults.push({
      nodeId,
      fusedScore: fusedScore * levelWeight,
      vectorScore: vs,
      bm25Score: bs,
      propositionScore: ps,
      levelWeight,
    });
  }

  scoredResults.sort((a, b) => b.fusedScore - a.fusedScore);
  
  // ── Stage 6: LLM tree search (optional) ────────────────────────────────
  // TODO: implement when llmClient is available

  // ── Stage 7: Cross-encoder rerank (optional) ───────────────────────────
  if (options.reranker && scoredResults.length > 0) {
    try {
      const rerankCandidates = scoredResults.slice(0, Math.min(scoredResults.length, options.reranker.maxCandidates || 20));
      const rerankScores = await crossEncoderRerank(
        options.query,
        rerankCandidates,
        treeData,
        vaultPath,
        options.reranker
      );

      const rerankWeight = options.reranker.weight || 0.7;
      const rerankedNodeIds = new Set(rerankScores.keys());
      
      for (const r of scoredResults) {
        if (rerankedNodeIds.has(r.nodeId)) {
          const rerankScore = rerankScores.get(r.nodeId) || 0;
          r.fusedScore = rerankWeight * rerankScore + (1 - rerankWeight) * r.fusedScore;
        }
      }

      scoredResults.sort((a, b) => b.fusedScore - a.fusedScore);
      
      piLog(`[book-search-v2] Reranked ${rerankScores.size} results`);
    } catch (error) {
      piLog(`[book-search-v2] Rerank failed: ${error}`);
    }
  }

  const topResults = scoredResults.slice(0, topK);

  // ── Stage 8: Matched block location ────────────────────────────────────
  const results: BookSearchResultV2[] = [];

  // Load chunk texts for matchedBlocks content
  let chunkTextMap = new Map<string, string>();
  if (chunkHits.size > 0) {
    try {
      const { readChunkTexts } = await import("./vault/vectors.js");
      const chunkTexts = await readChunkTexts(path.join(indexDir, "chunks.jsonl"));
      chunkTextMap = new Map(chunkTexts.map(c => [c.chunkId, c.text]));
    } catch {
      piLog("[book-search-v2] Failed to load chunks.jsonl");
    }
  }

  for (const r of topResults) {
    const hierarchyPath = findHierarchyPath(r.nodeId, treeData.structure);
    const title = findNodeTitle(r.nodeId, treeData.structure) || r.nodeId;

    // Priority: proposition cards > vector chunk hits
    const matchedCards = propositionMatches.get(r.nodeId) || [];
    let matchedBlocks: MatchedBlock[];

    if (matchedCards.length > 0) {
      matchedBlocks = matchedCards.slice(0, 3).map((card: PropositionCard) => ({
        blockId: card.id,
        content: `${card.context} ^${card.id}\n\n【${card.type}】${card.answer}`,
      }));
    } else if (chunkHits.has(r.nodeId)) {
      const chunks = chunkHits.get(r.nodeId)!.slice(0, 3);
      matchedBlocks = chunks.map(c => ({
        blockId: c.blockIds[0] ? `^${c.blockIds[0]}` : "",
        content: chunkTextMap.get(c.chunkId) || "",
      }));
    } else {
      // No proposition or chunk hits — provide minimal block with nodeId reference
      matchedBlocks = [{ blockId: "", content: `[${title}]` }];
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

export function computeDynamicRecallK(query: string): number {
  const len = query.length;
  if (len < 5) return 50;
  if (len <= 15) return 30;
  return 15;
}

// ─── Stage 5: Level weighting ───────────────────────────────────────────────

export function computeLevelWeight(nodeId: string, structure: TreeNode[]): number {
  const node = findNodeInTree(nodeId, structure);
  if (!node) return 0.5;

  // Check if it has children
  const hasChildren = node.nodes && node.nodes.length > 0;
  const depth = findDepth(nodeId, structure);

  if (depth === 0) return 1.0;     // L0 book-level
  if (hasChildren) return 0.9;     // L1 chapter-level (has subsections)
  return 0.7;                       // L1 section-level (leaf)
}

/** Pre-build nodeId → {node, depth} map for O(1) lookups */
function buildTreeIndex(nodes: TreeNode[], depth = 0, map = new Map<string, {node: TreeNode, depth: number}>()): Map<string, {node: TreeNode, depth: number}> {
  for (const node of nodes) {
    if (node.nodeId) map.set(node.nodeId, { node, depth });
    if (node.nodes) buildTreeIndex(node.nodes, depth + 1, map);
  }
  return map;
}

/** Fast level weight using pre-built index */
export function computeLevelWeightFast(nodeId: string, treeIndex: Map<string, {node: TreeNode, depth: number}>): number {
  const entry = treeIndex.get(nodeId);
  if (!entry) return 0.5;
  const { node, depth } = entry;
  if (depth === 0) return 1.0;
  if (node.nodes && node.nodes.length > 0) return 0.9;
  return 0.7;
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

// ─── Multi-path parallel recall helpers ───────────────────────────────────

async function asyncVectorSearch(
  indexDir: string,
  queryVector: number[],
  topK: number
): Promise<{
  scores: Map<string, number>;
  chunkHits: Map<string, ChunkHit[]>;
  vector: number[] | null;
}> {
  try {
    const vectorResults = await cosineSearchJsonl(
      path.join(indexDir, "vectors.jsonl"),
      queryVector,
      topK * 3,  // over-recall since multiple chunks map to same nodeId
      { level: "L2" }
    );

    // Fallback to L1 if no L2 results (old index format)
    let results = vectorResults;
    if (results.length === 0) {
      const l1Results = await cosineSearchJsonl(
        path.join(indexDir, "vectors.jsonl"),
        queryVector,
        topK,
        { level: "L1" }
      );
      results = l1Results.map(r => ({ ...r, blockIds: [] }));
    }

    const scores = new Map<string, number>();
    const chunkHits = new Map<string, ChunkHit[]>();

    for (const r of results) {
      const prev = scores.get(r.nodeId) || 0;
      scores.set(r.nodeId, Math.max(prev, r.score));

      if (r.blockIds.length > 0) {
        if (!chunkHits.has(r.nodeId)) chunkHits.set(r.nodeId, []);
        chunkHits.get(r.nodeId)!.push({
          chunkId: r.chunkId,
          blockIds: r.blockIds,
          score: r.score,
        });
      }
    }

    return { scores, chunkHits, vector: queryVector };
  } catch (error) {
    piLog(`[book-search-v2] Vector search failed: ${error}`);
    return { scores: new Map<string, number>(), chunkHits: new Map<string, ChunkHit[]>(), vector: null };
  }
}

async function asyncPropositionSearch(
  indexDir: string,
  queryVector: number[],
  recallK: number
): Promise<Map<string, PropositionCard[]>> {
  const propositionMatches = new Map<string, PropositionCard[]>();

  try {
    const propositionsData = await loadPropositions(indexDir);
    const propVectorMap = await loadPropVectorStore(indexDir);

    if (!propositionsData || !propVectorMap || propositionsData.totalCards === 0) {
      return propositionMatches;
    }

    const queryFloat32 = new Float32Array(queryVector);

    const scores: Array<{ cardId: string; score: number }> = [];
    for (const [cardId, vector] of propVectorMap) {
      const cardVector = new Float32Array(vector);
      const score = cosineSimilarity(queryFloat32, cardVector);
      scores.push({ cardId, score });
    }

    const topScores = scores.sort((a, b) => b.score - a.score).slice(0, recallK);

    // Pre-build card map for O(1) lookup
    const cardMap = new Map(propositionsData.cards.map(c => [c.id, c] as const));

    for (const s of topScores) {
      const card = cardMap.get(s.cardId);
      if (card && s.score > 0.3) {
        const nodeId = card.sourceNodeId;
        if (!propositionMatches.has(nodeId)) {
          propositionMatches.set(nodeId, []);
        }
        propositionMatches.get(nodeId)!.push({ ...card, matchScore: s.score });
      }
    }
  } catch (error) {
    piLog(`[book-search-v2] Proposition search failed: ${error}`);
  }

  return propositionMatches;
}

// ─── Stage 7: Cross-encoder rerank ────────────────────────────────────────

/**
 * 通过扫描 Vault 目录找到 tree.json 对应的实际导出目录名
 * 用户可能重命名了目录，因此不能仅依赖 treeData.exportName
 */
async function resolveExportDirName(
  treeData: TreeData,
  vaultPath: string
): Promise<string | null> {
  const staticName = treeData.exportName || treeData.title;
  const deepReaderPath = path.join(vaultPath, "DeepReader");

  // 先用静态名称尝试
  if (staticName) {
    const staticPath = path.join(deepReaderPath, staticName);
    try {
      await fs.access(staticPath);
      return staticName;
    } catch { /* 目录不存在或被重命名，继续扫描 */ }
  }

  // 扫描 DeepReader/ 下的所有目录，用 nodeFileMap 中的文件名匹配
  const sampleFileName = Object.values(treeData.nodeFileMap || {})[0];
  if (!sampleFileName) return null;

  try {
    const entries = await fs.readdir(deepReaderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidatePath = path.join(deepReaderPath, entry.name, sampleFileName);
      try {
        await fs.access(candidatePath);
        piLog(`[book-search-v2] 目录重命名检测: "${staticName}" → "${entry.name}"`);
        return entry.name;
      } catch { /* 该目录不包含目标文件 */ }
    }
  } catch {
    piLog(`[book-search-v2] Failed to scan ${deepReaderPath}`);
  }

  return null;
}

async function crossEncoderRerank(
  query: string,
  results: Array<{ nodeId: string; fusedScore: number }>,
  treeData: TreeData,
  vaultPath: string,
  reranker: RerankerOptions
): Promise<Map<string, number>> {
  const rerankScores = new Map<string, number>();

  if (results.length === 0) return rerankScores;

  // 解析实际目录名（处理用户重命名的情况）
  const actualDirName = await resolveExportDirName(treeData, vaultPath);
  const exportDir = actualDirName || treeData.exportName || treeData.title;

  const texts: string[] = [];
  const nodeIds: string[] = [];

  for (const r of results) {
    const fileName = treeData.nodeFileMap?.[r.nodeId];
    if (!fileName) continue;

    const fullPath = path.join(vaultPath, "DeepReader", exportDir, fileName);

    try {
      let content = await fs.readFile(fullPath, "utf-8");
      content = content.replace(/---[\s\S]*?---\n/, "").slice(0, 1500);
      if (content.trim()) {
        texts.push(content);
        nodeIds.push(r.nodeId);
      }
    } catch {
      piLog(`[book-search-v2] Failed to read ${fullPath}`);
    }
  }

  if (texts.length === 0) return rerankScores;

  const provider = reranker.provider || "lmstudio";
  const baseUrl = reranker.baseUrl || (provider === "lmstudio" ? "http://localhost:1234/v1" : provider === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1");
  const model = reranker.model || "BAAI/bge-reranker-v2-m3";
  const apiKey = reranker.apiKey || (provider === "lmstudio" ? "lm-studio" : "");

  try {
    const response = await safeRequest({
      url: `${baseUrl}/rerank`,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        query,
        documents: texts,
        top_n: texts.length,
      }),
    });

    if (response.status >= 400) {
      throw new Error(`Rerank API error: ${response.status} - ${response.text}`);
    }

    const data = response.json as { results: Array<{ index: number; relevance_score: number }> };
    
    for (const r of data.results) {
      if (r.index >= 0 && r.index < nodeIds.length) {
        rerankScores.set(nodeIds[r.index], r.relevance_score);
      }
    }
  } catch (error) {
    piLog(`[book-search-v2] Reranker unavailable: ${error}`);
    
    for (let i = 0; i < nodeIds.length; i++) {
      rerankScores.set(nodeIds[i], results.find(r => r.nodeId === nodeIds[i])?.fusedScore || 0);
    }
  }

  return rerankScores;
}
