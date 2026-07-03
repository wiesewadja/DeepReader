import type { BM25Data } from "./book-types.js";
import { CJK_STOPWORDS } from "../utils/text-utils.js";

/**
 * Tokenize text for BM25 indexing
 * - CJK text: unigrams + bigrams + full words (preserve duplicates for correct TF)
 * - English/numbers: space tokenization
 *
 * NOTE: We intentionally do NOT deduplicate tokens here.
 * BM25 relies on term frequency (TF) — deduplication would make TF always 1,
 * turning BM25 into a binary match model.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  // CJK: covers Unified Ideographs + Extension A + Compatibility
  const cjkParts = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) || [];
  for (const cjk of cjkParts) {
    // Always add full CJK run for exact phrase matching
    if (cjk.length >= 2) {
      tokens.push(cjk);
    }
    // Add unigrams for single-character query support
    for (let i = 0; i < cjk.length; i++) {
      tokens.push(cjk[i]);
    }
    // Add bigrams for fuzzy Chinese matching
    for (let i = 0; i < cjk.length - 1; i++) {
      tokens.push(cjk.slice(i, i + 2));
    }
  }

  const nonCJK = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, " ");
  const parts = nonCJK
    .toLowerCase()
    .replace(/[^\w]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  tokens.push(...parts);

  // Intentionally NOT deduplicating — BM25 needs TF counts
  return tokens;
}

/**
 * Build BM25 index from nodes
 */
export function buildBM25Index(
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): BM25Data {
  const nodesMap: BM25Data["nodes"] = Object.create(null);
  const invertedIndex: BM25Data["invertedIndex"] = Object.create(null);
  let totalLength = 0;
  const df: Record<string, number> = Object.create(null);

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
 * Filter query tokens: remove stopwords and deduplicate for search efficiency
 */
function filterQueryTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  return tokens.filter(t => {
    if (seen.has(t) || CJK_STOPWORDS.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/**
 * Search BM25 index
 */
export function searchBM25(
  query: string,
  index: BM25Data,
  topK: number
): Array<{ nodeId: string; score: number }> {
  const queryTokens = filterQueryTokens(tokenize(query));
  const scores: Record<string, number> = Object.create(null);

  const { totalDocs, avgDocLength, df } = index.stats;
  const { k1, b } = index.params;

  for (const token of queryTokens) {
    const postings = index.invertedIndex[token];
    if (!postings) continue;

    const docFreq = df[token] || 0;
    // Use Lucene BM25 IDF formula to ensure positive IDF for common terms
    // that are still highly descriptive in books with a small number of chapters
    const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));

    for (const { nodeId, tf } of postings) {
      const docLength = index.nodes[nodeId]?.length || 0;
      
      const numerator = tf * (k1 + 1);
      const denominator = avgDocLength > 0
        ? tf + k1 * (1 - b + b * (docLength / avgDocLength))
        : tf + k1 * (1 - b);  // Fallback when avgDocLength is 0
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