/**
 * bun-pageindex: Obsidian Vault Hybrid Search
 * Combines vector semantic search, keyword exact match, level weighting, and cross-encoder re-ranking
 */

import type { TreeNode } from "../core/types";
import type {
  SearchResult,
  SearchOptions,
  VaultIndexResult,
  RerankerOptions,
  TreeSearchOptions,
} from "./types";
import { generateEmbeddings, cosineSearch, loadVectorStore } from "./vectors";
import { findNodeById, cosineSimilarity } from "../core/utils";
import { chatGPT } from "../llm/client";
import { extractJson } from "../core/utils";
import { treeSearchPrompt } from "../core/prompts";

export async function searchVault(
  query: string,
  index: VaultIndexResult,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const topK = options.topK || 10;
  // When no embedding is configured, fall back to keyword-only search
  const vectorWeight = options.embedding ? (options.vectorWeight ?? 0.7) : 0;
  const keywordWeight = options.embedding ? (options.keywordWeight ?? 0.3) : 1;
  const useDynamicRecall = options.dynamicRecall ?? true;
  const useLevelWeight = options.levelWeighting ?? true;

  // 1. Determine recall size
  const recallK = useDynamicRecall ? getDynamicTopK(query) : topK * 2;

  // 2. Vector search
  let vectorResults: Array<{ nodeId: string; score: number }> = [];
  if (options.embedding && vectorWeight > 0) {
    const queryVectors = await generateEmbeddings([query], options.embedding);
    const vectorStore = await loadVectorStore(index.meta.vaultPath + "/.pageindex");
    if (vectorStore) {
      vectorResults = await cosineSearch(queryVectors[0], vectorStore, recallK);
    }
  }

  // 3. Keyword search
  let keywordResults: Array<{ nodeId: string; score: number }> = [];
  if (keywordWeight > 0) {
    keywordResults = keywordSearch(query, index, recallK);
  }

  // 4. Apply directory filter
  if (options.directoryFilter && options.directoryFilter.length > 0) {
    vectorResults = vectorResults.filter((r) => {
      const file = index.searchIndex.nodeMap[r.nodeId]?.file;
      return file && options.directoryFilter!.some((d) => file.startsWith(d));
    });
    keywordResults = keywordResults.filter((r) => {
      const file = index.searchIndex.nodeMap[r.nodeId]?.file;
      return file && options.directoryFilter!.some((d) => file.startsWith(d));
    });
  }

  // 5. Merge results with level weighting
  const merged = mergeResults(vectorResults, keywordResults, index, {
    vectorWeight,
    keywordWeight,
    useLevelWeight,
  });

  // 6. LLM tree search (if configured) — merge into scores
  let finalResults = merged;
  if (options.treeSearch) {
    const treeResults = await llmTreeSearch(query, index, options.treeSearch);
    finalResults = mergeTreeSearchResults(merged, treeResults, options.treeSearch.weight ?? 0.6);
  }

  // 7. Re-rank with cross-encoder (if configured)
  if (options.reranker && finalResults.length > 0) {
    finalResults = await rerankResults(query, finalResults, index, options.reranker);
  }

  // 8. Enrich with context
  const enriched = finalResults.map((r) => enrichWithContext(r, index));

  return enriched.slice(0, topK);
}

// ─── Dynamic Recall ─────────────────────────────────────────────────────────

function getDynamicTopK(query: string): number {
  const length = query.length;
  if (length < 5) return 50;
  if (length < 15) return 30;
  return 10;
}

// ─── Keyword Search ─────────────────────────────────────────────────────────

function keywordSearch(
  query: string,
  index: VaultIndexResult,
  topK: number
): Array<{ nodeId: string; score: number }> {
  const tokens = tokenizeQuery(query);
  const scores: Record<string, number> = {};

  for (const token of tokens) {
    const matched = index.searchIndex.invertedIndex[token];
    if (matched) {
      for (const nodeId of matched) {
        scores[nodeId] = (scores[nodeId] || 0) + 1;
      }
    }
  }

  const maxScore = Math.max(...Object.values(scores), 1);

  return Object.entries(scores)
    .map(([nodeId, score]) => ({
      nodeId,
      score: score / maxScore,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function tokenizeQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const tokens = lower
    .replace(/([^\w\s\u4e00-\u9fff])/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const cjkParts = lower.match(/[\u4e00-\u9fff]+/g) || [];
  for (const cjk of cjkParts) {
    if (cjk.length >= 2) {
      tokens.push(cjk);
      for (let i = 0; i < cjk.length - 1; i++) {
        tokens.push(cjk.slice(i, i + 2));
      }
    }
  }

  return [...new Set(tokens)];
}

// ─── Merge Results with Level Weighting ─────────────────────────────────────

function mergeResults(
  vectorResults: Array<{ nodeId: string; score: number }>,
  keywordResults: Array<{ nodeId: string; score: number }>,
  index: VaultIndexResult,
  weights: { vectorWeight: number; keywordWeight: number; useLevelWeight: boolean }
): Array<{ nodeId: string; vectorScore: number; keywordScore: number; levelWeight: number; score: number }> {
  const allNodeIds = new Set([
    ...vectorResults.map((r) => r.nodeId),
    ...keywordResults.map((r) => r.nodeId),
  ]);

  const vectorMap = new Map(vectorResults.map((r) => [r.nodeId, r.score]));
  const keywordMap = new Map(keywordResults.map((r) => [r.nodeId, r.score]));

  const merged = Array.from(allNodeIds).map((nodeId) => {
    const vectorScore = vectorMap.get(nodeId) || 0;
    const keywordScore = keywordMap.get(nodeId) || 0;
    const levelWeight = weights.useLevelWeight ? getNodeLevelWeight(nodeId, index) : 1.0;

    const score =
      (vectorScore * weights.vectorWeight + keywordScore * weights.keywordWeight) * levelWeight;

    return { nodeId, vectorScore, keywordScore, levelWeight, score };
  });

  return merged.sort((a, b) => b.score - a.score);
}

function getNodeLevelWeight(nodeId: string, index: VaultIndexResult): number {
  const nodeMeta = index.searchIndex.nodeMap[nodeId];
  if (!nodeMeta) return 0.5;

  const fileMeta = index.files[nodeMeta.file];
  if (!fileMeta) return 0.5;

  const node = findNodeById(fileMeta.result.structure, nodeMeta.localNodeId || nodeId);
  if (!node) return 0.5;

  return computeLevelWeight(node, fileMeta.result.structure);
}

function computeLevelWeight(node: TreeNode, allNodes: TreeNode[]): number {
  const depth = findNodeDepth(node, allNodes);
  const childCount = countDescendants(node);

  if (depth === 0 && childCount > 2) return 1.0;
  if (depth === 0) return 0.8;
  if (depth === 1) return 0.7;
  if (depth === 2) return 0.5;
  return 0.3;
}

function findNodeDepth(target: TreeNode, nodes: TreeNode[], depth: number = 0): number {
  for (const node of nodes) {
    if (node.nodeId === target.nodeId) return depth;
    if (node.nodes) {
      const found = findNodeDepth(target, node.nodes, depth + 1);
      if (found >= 0) return found;
    }
  }
  return -1;
}

function countDescendants(node: TreeNode): number {
  if (!node.nodes) return 0;
  let count = node.nodes.length;
  for (const child of node.nodes) {
    count += countDescendants(child);
  }
  return count;
}

// ─── Cross-Encoder Re-ranking ───────────────────────────────────────────────

async function rerankResults(
  query: string,
  candidates: Array<{ nodeId: string; vectorScore: number; keywordScore: number; levelWeight: number; score: number }>,
  index: VaultIndexResult,
  options: RerankerOptions
): Promise<Array<{ nodeId: string; vectorScore: number; keywordScore: number; levelWeight: number; rerankScore: number; score: number }>> {
  const maxCandidates = options.maxCandidates || 50;
  const topCandidates = candidates.slice(0, maxCandidates);

  const pairs: Array<{ nodeId: string; text: string; prevScore: number }> = [];

  for (const c of topCandidates) {
    const nodeMeta = index.searchIndex.nodeMap[c.nodeId];
    if (!nodeMeta) continue;

    const fileMeta = index.files[nodeMeta.file];
    if (!fileMeta) continue;

    const node = findNodeById(fileMeta.result.structure, nodeMeta.localNodeId || c.nodeId);
    if (!node) continue;

    const text = `${node.title}. ${node.summary || ""}`;
    pairs.push({ nodeId: c.nodeId, text, prevScore: c.score });
  }

  if (pairs.length === 0) {
    return candidates.map((c) => ({ ...c, rerankScore: 0, score: c.score }));
  }

  const rerankScores = await generateRerankScores(query, pairs.map((p) => p.text), options);

  const rerankWeight = options.weight ?? 0.7;
  const recallWeight = 1 - rerankWeight;

  const reranked = pairs.map((p, i) => {
    const rerankScore = rerankScores[i];
    const candidate = candidates.find((c) => c.nodeId === p.nodeId)!;
    const score = candidate.score * recallWeight + rerankScore * rerankWeight;

    return {
      nodeId: p.nodeId,
      vectorScore: candidate.vectorScore,
      keywordScore: candidate.keywordScore,
      levelWeight: candidate.levelWeight,
      rerankScore,
      score,
    };
  });

  reranked.sort((a, b) => b.score - a.score);
  return reranked;
}

async function generateRerankScores(
  query: string,
  documents: string[],
  options: RerankerOptions
): Promise<number[]> {
  if (options.provider === "lmstudio" || options.provider === "local") {
    const baseUrl = options.baseUrl || "http://localhost:1234/v1";
    const model = options.model || "BAAI/bge-reranker-v2-m3";
    const apiKey = options.apiKey || "lm-studio";

    // Try dedicated /rerank endpoint first
    try {
      const scores = await rerankViaApi(query, documents, { baseUrl, model, apiKey });
      if (scores.some((s) => s !== 0.5)) return scores;
    } catch {
      // Fall through
    }

    // Fallback: use embeddings endpoint with query-doc concatenation
    try {
      return rerankViaEmbeddings(query, documents, { baseUrl, model, apiKey });
    } catch {
      // Final fallback
      return documents.map(() => 0.5);
    }
  }

  if (options.provider === "openai") {
    return rerankViaApi(query, documents, {
      baseUrl: options.baseUrl || "https://api.openai.com/v1",
      model: options.model || "text-embedding-3-small",
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  throw new Error(`Unsupported reranker provider: ${options.provider}`);
}

async function rerankViaApi(
  query: string,
  documents: string[],
  config: { baseUrl: string; model: string; apiKey?: string }
): Promise<number[]> {
  const response = await fetch(`${config.baseUrl}/rerank`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, query, documents }),
  });

  if (!response.ok) throw new Error(`Rerank API error: ${response.status}`);

  const data = await response.json() as { results: Array<{ index: number; relevance_score: number }> };

  if (data.results && data.results.length > 0) {
    const scores = new Array(documents.length).fill(0.5);
    for (const result of data.results) {
      scores[result.index] = result.relevance_score;
    }
    return scores;
  }

  return documents.map(() => 0.5);
}

async function rerankViaEmbeddings(
  query: string,
  documents: string[],
  config: { baseUrl: string; model: string; apiKey?: string }
): Promise<number[]> {
  // Encode query
  const queryResp = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, input: query }),
  });

  if (!queryResp.ok) throw new Error(`Embeddings API error: ${queryResp.status}`);

  const queryData = await queryResp.json() as { data: Array<{ embedding: number[] }> };
  const queryVec = new Float32Array(queryData.data[0].embedding);

  // Encode each document and compute cosine similarity
  const scores: number[] = [];

  for (const doc of documents) {
    const docResp = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: doc }),
    });

    if (docResp.ok) {
      const docData = await docResp.json() as { data: Array<{ embedding: number[] }> };
      const docVec = new Float32Array(docData.data[0].embedding);
      scores.push(cosineSimilarity(queryVec, docVec));
    } else {
      scores.push(0.5);
    }
  }

  return scores;
}

// ─── Context Enrichment ─────────────────────────────────────────────────────

function enrichWithContext(
  result: { nodeId: string; vectorScore: number; keywordScore: number; levelWeight: number; rerankScore?: number; treeScore?: number; score: number },
  index: VaultIndexResult
): SearchResult {
  const nodeMeta = index.searchIndex.nodeMap[result.nodeId];
  if (!nodeMeta) {
    return {
      nodeId: result.nodeId,
      title: "",
      summary: "",
      file: "",
      directory: "",
      score: result.score,
      vectorScore: result.vectorScore,
      keywordScore: result.keywordScore,
      levelWeight: result.levelWeight,
      rerankScore: result.rerankScore,
      treeScore: result.treeScore,
      context: {},
    };
  }

  const fileMeta = index.files[nodeMeta.file];
  if (!fileMeta) {
    return {
      nodeId: result.nodeId,
      title: "",
      summary: "",
      file: nodeMeta.file,
      directory: getDirectory(nodeMeta.file),
      lineNum: nodeMeta.lineNum,
      score: result.score,
      vectorScore: result.vectorScore,
      keywordScore: result.keywordScore,
      levelWeight: result.levelWeight,
      rerankScore: result.rerankScore,
      treeScore: result.treeScore,
      context: {},
    };
  }

  const node = findNodeById(fileMeta.result.structure, nodeMeta.localNodeId || result.nodeId);

  return {
    nodeId: result.nodeId,
    title: node?.title || "",
    summary: node?.summary || "",
    file: nodeMeta.file,
    directory: getDirectory(nodeMeta.file),
    lineNum: nodeMeta.lineNum,
    score: result.score,
    vectorScore: result.vectorScore,
    keywordScore: result.keywordScore,
    levelWeight: result.levelWeight,
    rerankScore: result.rerankScore,
    treeScore: result.treeScore,
    context: getNodeContext(fileMeta.result.structure, result.nodeId),
  };
}

// ─── Tree Helpers ───────────────────────────────────────────────────────────

function getNodeContext(
  nodes: TreeNode[],
  nodeId: string,
  parent?: string
): { parent?: string; siblings?: string[] } {
  for (const node of nodes) {
    if (node.nodeId === nodeId) {
      const siblings = nodes
        .filter((n) => n.nodeId !== nodeId)
        .map((n) => n.title);
      return { parent, siblings };
    }
    if (node.nodes) {
      const found = getNodeContext(node.nodes, nodeId, node.title);
      if (found.parent || found.siblings) return found;
    }
  }
  return {};
}

function getDirectory(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

// ─── LLM Tree Search ─────────────────────────────────────────────────────────

/**
 * Serialize the vault index tree into a compact string for the LLM prompt.
 * Each node is rendered as: [nodeId] title (summary?)
 * with indentation reflecting hierarchy.
 */
function serializeTreeForPrompt(index: VaultIndexResult, maxNodes = 200): string {
  const lines: string[] = [];
  let count = 0;

  for (const [, fileMeta] of Object.entries(index.files)) {
    if (count >= maxNodes) break;
    lines.push(`## ${fileMeta.result.docName}`);
    serializeNodes(fileMeta.result.structure, lines, 0, () => {
      if (count >= maxNodes) return false;
      count++;
      return true;
    });
    lines.push("");
  }

  if (count >= maxNodes) lines.push("... (truncated)");
  return lines.join("\n");
}

function serializeNodes(
  nodes: TreeNode[],
  lines: string[],
  depth: number,
  canAdd: () => boolean
): void {
  for (const node of nodes) {
    if (!node.nodeId) continue;
    if (!canAdd()) return;
    const indent = "  ".repeat(depth);
    const summary = node.summary ? ` — ${node.summary}` : "";
    lines.push(`${indent}[${node.nodeId}] ${node.title}${summary}`);
    if (node.nodes?.length) {
      serializeNodes(node.nodes, lines, depth + 1, canAdd);
    }
  }
}

/**
 * Use LLM to identify relevant nodes from the document tree given a query.
 * Returns a map of nodeId → score (1.0 for all LLM-selected nodes).
 */
async function llmTreeSearch(
  query: string,
  index: VaultIndexResult,
  options: TreeSearchOptions
): Promise<Map<string, number>> {
  try {
    const treeText = serializeTreeForPrompt(index);
    const prompt = treeSearchPrompt(query, treeText);

    const response = await chatGPT({
      model: options.model,
      prompt,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });

    const json = extractJson<{ node_list: string[] }>(response);
    const nodeList = json?.node_list ?? [];

    // Build a local nodeId → globalId map from the search index
    const localToGlobal = new Map<string, string>();
    for (const [globalId, meta] of Object.entries(index.searchIndex.nodeMap)) {
      if (meta.localNodeId) {
        localToGlobal.set(meta.localNodeId, globalId);
      }
    }

    const result = new Map<string, number>();
    for (let i = 0; i < nodeList.length; i++) {
      const globalId = localToGlobal.get(nodeList[i]);
      if (globalId) {
        // Exponential decay: nodes listed first are more relevant
        const score = Math.exp(-0.2 * i);
        result.set(globalId, score);
      }
    }

    return result;
  } catch (err) {
    console.warn(`Tree search failed: ${err}`);
    return new Map();
  }
}

/**
 * Merge LLM tree search results into the existing scored candidates.
 * Nodes selected by LLM get a bonus; nodes not in the existing list are added.
 */
function mergeTreeSearchResults(
  existing: Array<{ nodeId: string; vectorScore: number; keywordScore: number; levelWeight: number; score: number }>,
  treeResults: Map<string, number>,
  treeWeight: number
): Array<{ nodeId: string; vectorScore: number; keywordScore: number; levelWeight: number; score: number; treeScore: number }> {
  if (treeResults.size === 0) {
    return existing.map((r) => ({ ...r, treeScore: 0 }));
  }

  const recallWeight = 1 - treeWeight;
  const existingMap = new Map(existing.map((r) => [r.nodeId, r]));

  // Boost existing nodes that appear in tree results
  const merged = existing.map((r) => {
    const treeScore = treeResults.get(r.nodeId) ?? 0;
    return {
      ...r,
      treeScore,
      score: r.score * recallWeight + treeScore * treeWeight,
    };
  });

  // Add nodes found by tree search but not in existing results
  for (const [nodeId, treeScore] of treeResults) {
    if (!existingMap.has(nodeId)) {
      merged.push({
        nodeId,
        vectorScore: 0,
        keywordScore: 0,
        levelWeight: 1.0,
        treeScore,
        score: treeScore * treeWeight,
      });
    }
  }

  return merged.sort((a, b) => b.score - a.score);
}
