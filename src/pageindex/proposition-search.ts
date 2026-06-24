/**
 * Proposition Search - Retrieve atomic fact cards with parallel fusion
 */

import * as path from "path";
import { nodeFs } from "../utils/node-fs.js";
import type { App } from 'obsidian';
import { vaultRead, joinPath } from '../utils/mobile-fs.js';
import { searchBM25 } from "./bm25.js";
import type {
  PropositionCard,
  PropositionsData,
  PropositionMatch,
  BM25Data,
} from "./book-types.js";
import { cosineSimilarity } from "./core/utils.js";
import { PAGEINDEX_DIR, getPageindexDir } from "./paths.js";
import type { EmbeddingOptions } from "./vault/types.js";
import { generateEmbedding } from "./vault/vectors.js";

export async function loadPropositions(
  indexDir: string,
  app?: App
): Promise<PropositionsData | null> {
  try {
    const content = app
      ? await vaultRead(app, joinPath(indexDir, 'propositions.json'))
      : await nodeFs().readFile(path.join(indexDir, "propositions.json"), "utf-8");
    return JSON.parse(content) as PropositionsData;
  } catch {
    return null;
  }
}

export async function loadPropVectorStore(
  indexDir: string,
  app?: App
): Promise<Map<string, number[]> | null> {
  try {
    const content = app
      ? await vaultRead(app, joinPath(indexDir, 'prop-vectors.jsonl'))
      : await nodeFs().readFile(path.join(indexDir, "prop-vectors.jsonl"), "utf-8");
    const map = new Map<string, number[]>();

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const record = JSON.parse(trimmed) as { cardId: string; vector: number[] };
      map.set(record.cardId, record.vector);
    }

    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

export async function searchPropositions(
  query: string,
  bookId: string,
  vaultPath: string,
  embedding: EmbeddingOptions,
  topK: number = 5,
  app?: App
): Promise<PropositionMatch[]> {
  const indexDir = app
    ? joinPath(PAGEINDEX_DIR, bookId)
    : path.join(vaultPath, getPageindexDir(), bookId);

  const propositions = await loadPropositions(indexDir, app);
  const vectorMap = await loadPropVectorStore(indexDir, app);

  if (!propositions || !vectorMap || propositions.totalCards === 0) {
    return [];
  }

  const queryVector = await generateEmbedding(query, embedding);
  const queryFloat32 = new Float32Array(queryVector);

  const scores: Array<{ cardId: string; score: number }> = [];

  for (const [cardId, vector] of vectorMap) {
    const cardVector = new Float32Array(vector);
    const score = cosineSimilarity(queryFloat32, cardVector);
    scores.push({ cardId, score });
  }

  const topScores = scores.sort((a, b) => b.score - a.score).slice(0, topK);

  return topScores.map(s => ({
    card: propositions.cards.find(c => c.id === s.cardId)!,
    score: s.score,
  }));
}

export interface FusionResult {
  nodeId: string;
  title: string;
  fileName: string;
  matchedCards: PropositionMatch[];
  bm25Score: number;
  vectorScore: number;
  fusedScore: number;
}

export async function searchWithPropositions(
  query: string,
  bookId: string,
  vaultPath: string,
  embedding: EmbeddingOptions,
  topK: number = 5,
  fusionWeights?: { prop: number; bm25: number },
  app?: App
): Promise<FusionResult[]> {
  const weights = fusionWeights || { prop: 0.6, bm25: 0.4 };

  const indexDir = app
    ? joinPath(PAGEINDEX_DIR, bookId)
    : path.join(vaultPath, getPageindexDir(), bookId);

  const [propResults, bm25Results] = await Promise.all([
    searchPropositions(query, bookId, vaultPath, embedding, topK * 2, app),
    searchBM25Light(query, indexDir, topK * 2, app),
  ]);

  const nodeMap = new Map<string, FusionResult>();

  for (const match of propResults) {
    const nodeId = match.card.sourceNodeId;
    if (!nodeMap.has(nodeId)) {
      nodeMap.set(nodeId, {
        nodeId,
        title: "",
        fileName: "",
        matchedCards: [],
        bm25Score: 0,
        vectorScore: 0,
        fusedScore: 0,
      });
    }
    const entry = nodeMap.get(nodeId)!;
    entry.matchedCards.push(match);
    entry.vectorScore = Math.max(entry.vectorScore, match.score);
  }

  for (const bm25 of bm25Results) {
    if (!nodeMap.has(bm25.nodeId)) {
      nodeMap.set(bm25.nodeId, {
        nodeId: bm25.nodeId,
        title: bm25.title,
        fileName: bm25.fileName,
        matchedCards: [],
        bm25Score: 0,
        vectorScore: 0,
        fusedScore: 0,
      });
    }
    const entry = nodeMap.get(bm25.nodeId)!;
    entry.bm25Score = Math.max(entry.bm25Score, bm25.score);
    if (!entry.title) entry.title = bm25.title;
    if (!entry.fileName) entry.fileName = bm25.fileName;
  }

  for (const entry of nodeMap.values()) {
    entry.fusedScore = weights.prop * entry.vectorScore + weights.bm25 * entry.bm25Score;
  }

  return Array.from(nodeMap.values())
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);
}

async function searchBM25Light(
  query: string,
  indexDir: string,
  topK: number,
  app?: App
): Promise<Array<{ nodeId: string; title: string; fileName: string; score: number }>> {
  try {
    const content = app
      ? await vaultRead(app, joinPath(indexDir, 'bm25.json'))
      : await nodeFs().readFile(path.join(indexDir, "bm25.json"), "utf-8");
    const bm25Data = JSON.parse(content) as BM25Data;

    const results = searchBM25(query, bm25Data, topK);

    const treeContent = app
      ? await vaultRead(app, joinPath(indexDir, 'tree.json'))
      : await nodeFs().readFile(path.join(indexDir, "tree.json"), "utf-8");
    const treeData = JSON.parse(treeContent);
    const nodeFileMap = treeData.nodeFileMap || {};

    return results.map(r => ({
      nodeId: r.nodeId,
      title: "",
      fileName: nodeFileMap[r.nodeId] || "",
      score: r.score,
    }));
  } catch {
    return [];
  }
}

export function formatPropositionResults(results: PropositionMatch[]): string {
  if (results.length === 0) return "";

  return results.map(r => `
【${r.card.type}】${r.card.answer}
原文：${r.card.context}
关键词：${r.card.tags.join("、")}
`).join("\n---\n");
}