/**
 * Proposition Search - Retrieve atomic fact cards with parallel fusion
 */

import * as path from "path";
import * as fs from "fs/promises";
import { generateEmbedding } from "./vault/vectors.js";
import type {
  PropositionCard,
  PropositionsData,
  PropositionMatch,
  BM25Data,
} from "./book-types.js";
import type { EmbeddingOptions } from "./vault/types.js";
import { cosineSimilarity } from "./core/utils.js";
import { searchBM25 } from "./bm25.js";

const PROP_VECTOR_HEADER_SIZE = 24;

export async function loadPropositions(
  indexDir: string
): Promise<PropositionsData | null> {
  const propPath = path.join(indexDir, "propositions.json");

  try {
    const content = await fs.readFile(propPath, "utf-8");
    return JSON.parse(content) as PropositionsData;
  } catch {
    return null;
  }
}

export async function loadPropVectorStore(
  indexDir: string
): Promise<{ 
  vectors: Float32Array; 
  meta: { 
    dimensions: number; 
    slots: Record<string, { slotIndex: number; deleted: boolean }> 
  } 
} | null> {
  const vectorPath = path.join(indexDir, "prop_vectors.f32");
  const metaPath = path.join(indexDir, "prop_vectors.meta.json");

  try {
    const metaContent = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaContent);

    const buffer = await fs.readFile(vectorPath);
    const vectors = new Float32Array(buffer.buffer, PROP_VECTOR_HEADER_SIZE);

    return { vectors, meta };
  } catch {
    return null;
  }
}

export async function searchPropositions(
  query: string,
  bookId: string,
  vaultPath: string,
  embedding: EmbeddingOptions,
  topK: number = 5
): Promise<PropositionMatch[]> {
  const indexDir = path.join(vaultPath, ".pageindex", bookId);

  const propositions = await loadPropositions(indexDir);
  const vectorStore = await loadPropVectorStore(indexDir);

  if (!propositions || !vectorStore || propositions.totalCards === 0) {
    return [];
  }

  const queryVector = await generateEmbedding(query, embedding);
  const queryFloat32 = new Float32Array(queryVector);

  const scores: Array<{ cardId: string; score: number }> = [];

  for (const [cardId, slot] of Object.entries(vectorStore.meta.slots)) {
    if (slot.deleted) continue;

    const offset = slot.slotIndex * vectorStore.meta.dimensions;
    const cardVector = vectorStore.vectors.subarray(
      offset,
      offset + vectorStore.meta.dimensions
    );

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
  fusionWeights?: { prop: number; bm25: number }
): Promise<FusionResult[]> {
  const weights = fusionWeights || { prop: 0.6, bm25: 0.4 };

  const indexDir = path.join(vaultPath, ".pageindex", bookId);

  const [propResults, bm25Results] = await Promise.all([
    searchPropositions(query, bookId, vaultPath, embedding, topK * 2),
    searchBM25Light(query, indexDir, topK * 2),
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
  topK: number
): Promise<Array<{ nodeId: string; title: string; fileName: string; score: number }>> {
  const bm25Path = path.join(indexDir, "bm25.json");

  try {
    const content = await fs.readFile(bm25Path, "utf-8");
    const bm25Data = JSON.parse(content) as BM25Data;

    const results = searchBM25(query, bm25Data, topK);

    const treePath = path.join(indexDir, "tree.json");
    const treeContent = await fs.readFile(treePath, "utf-8");
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