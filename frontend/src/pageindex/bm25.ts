import type { BM25Data } from "./book-types.js";

/**
 * Tokenize text for BM25 indexing
 * - CJK text: bigrams + full words
 * - English/numbers: space tokenization
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  
  const cjkParts = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const cjk of cjkParts) {
    if (cjk.length >= 2) {
      tokens.push(cjk);
      for (let i = 0; i < cjk.length - 1; i++) {
        tokens.push(cjk.slice(i, i + 2));
      }
    }
  }
  
  const nonCJK = text.replace(/[\u4e00-\u9fff]/g, " ");
  const parts = nonCJK
    .toLowerCase()
    .replace(/[^\w]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  
  tokens.push(...parts);
  
  return [...new Set(tokens)];
}

/**
 * Build BM25 index from nodes
 */
export function buildBM25Index(
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): BM25Data {
  const nodesMap: BM25Data["nodes"] = {};
  const invertedIndex: BM25Data["invertedIndex"] = {};
  let totalLength = 0;
  const df: Record<string, number> = {};

  for (const node of nodes) {
    const tokens = tokenize(node.text);
    const length = tokens.length;
    totalLength += length;

    nodesMap[node.id] = {
      text: node.text,
      length,
      level: node.level,
    };

    const tf: Record<string, number> = {};
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1;
    }

    for (const [token, count] of Object.entries(tf)) {
      if (!invertedIndex[token]) {
        invertedIndex[token] = [];
      }
      invertedIndex[token].push({ nodeId: node.id, tf: count });
    }

    for (const token of Object.keys(tf)) {
      df[token] = (df[token] || 0) + 1;
    }
  }

  const avgDocLength = nodes.length > 0 ? totalLength / nodes.length : 0;

  return {
    nodes: nodesMap,
    invertedIndex,
    stats: {
      totalDocs: nodes.length,
      avgDocLength,
      df,
    },
    params: {
      k1: 1.5,
      b: 0.75,
    },
  };
}

/**
 * Search BM25 index
 */
export function searchBM25(
  query: string,
  index: BM25Data,
  topK: number
): Array<{ nodeId: string; score: number }> {
  const queryTokens = tokenize(query);
  const scores: Record<string, number> = {};

  const { totalDocs, avgDocLength, df } = index.stats;
  const { k1, b } = index.params;

  for (const token of queryTokens) {
    const postings = index.invertedIndex[token];
    if (!postings) continue;

    const docFreq = df[token] || 0;
    const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5));

    for (const { nodeId, tf } of postings) {
      const docLength = index.nodes[nodeId]?.length || 0;
      
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
      const bm25Score = idf * (numerator / denominator);

      scores[nodeId] = (scores[nodeId] || 0) + bm25Score;
    }
  }

  const results = Object.entries(scores)
    .map(([nodeId, score]) => ({ nodeId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return results;
}