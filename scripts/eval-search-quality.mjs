#!/usr/bin/env node
/**
 * 搜索质量评估脚本
 *
 * 读取 tests/golden-queries.json，对每个查询执行 BM25 搜索，
 * 计算 MRR、Hit@5、Hit@10、NDCG@5 等指标。
 *
 * 用法:
 *   node scripts/eval-search-quality.mjs [vault-path] [pluginId]
 *
 * 示例:
 *   node scripts/eval-search-quality.mjs test-vault deepreader-dev
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const args = process.argv.slice(2);
const vaultPath = args[0] || "test-vault";
const pluginId = args[1] || "deepreader-dev";

const GOLDEN_QUERIES_PATH = path.resolve("tests/golden-queries.json");
const PAGEINDEX_DIR = path.join(vaultPath, ".obsidian", "plugins", pluginId, "pageindex");

// ── BM25 Tokenizer (replicate src/pageindex/bm25.ts logic) ────────────────

const CJK_STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这",
]);

function tokenize(text) {
  const tokens = [];
  const cjkParts = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) || [];
  for (const cjk of cjkParts) {
    if (cjk.length >= 2) tokens.push(cjk);
    for (let i = 0; i < cjk.length; i++) tokens.push(cjk[i]);
    for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk.slice(i, i + 2));
  }
  const nonCJK = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, " ");
  const parts = nonCJK.toLowerCase().replace(/[^\w]/g, " ").split(/\s+/).filter(t => t.length > 0);
  tokens.push(...parts);
  return tokens;
}

function filterQueryTokens(tokens) {
  const seen = new Set();
  return tokens.filter(t => {
    if (seen.has(t) || CJK_STOPWORDS.has(t)) return false;
    seen.add(t);
    return true;
  });
}

// ── BM25 Search ───────────────────────────────────────────────────────────

function searchBM25(query, index, topK) {
  const queryTokens = filterQueryTokens(tokenize(query));
  const scores = Object.create(null);
  const { totalDocs, avgDocLength, df } = index.stats;
  const { k1, b } = index.params;

  for (const token of queryTokens) {
    const postings = index.invertedIndex[token];
    if (!postings) continue;
    const docFreq = df[token] || 0;
    const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
    for (const { nodeId, tf } of postings) {
      const docLength = index.nodes[nodeId]?.length || 0;
      const numerator = tf * (k1 + 1);
      const denominator = avgDocLength > 0
        ? tf + k1 * (1 - b + b * (docLength / avgDocLength))
        : tf + k1 * (1 - b);
      scores[nodeId] = (scores[nodeId] || 0) + idf * (numerator / denominator);
    }
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([nodeId, score]) => ({ nodeId, score }));
}

// ── Metrics ───────────────────────────────────────────────────────────────

/**
 * Mean Reciprocal Rank: 1/rank of first relevant result
 */
function mrr(results, relevantNodeIds) {
  const relevantSet = new Set(relevantNodeIds);
  for (let i = 0; i < results.length; i++) {
    if (relevantSet.has(results[i].nodeId)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Hit@K: 1 if any of top-K results is relevant, else 0
 */
function hitAtK(results, relevantNodeIds, k) {
  const relevantSet = new Set(relevantNodeIds);
  for (let i = 0; i < Math.min(k, results.length); i++) {
    if (relevantSet.has(results[i].nodeId)) return 1;
  }
  return 0;
}

/**
 * NDCG@K: Normalized Discounted Cumulative Gain
 */
function ndcgAtK(results, relevantNodeIds, k) {
  const relevantSet = new Set(relevantNodeIds);
  // DCG: relevance is 1 for relevant docs, 0 otherwise
  let dcg = 0;
  for (let i = 0; i < Math.min(k, results.length); i++) {
    const rel = relevantSet.has(results[i].nodeId) ? 1 : 0;
    dcg += rel / Math.log2(i + 2); // i+2 because log2(1) = 0
  }
  // Ideal DCG: all relevant docs at top
  const idealCount = Math.min(relevantNodeIds.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg > 0 ? dcg / idcg : 0;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // Load golden queries
  let goldenData;
  try {
    const raw = await fs.readFile(GOLDEN_QUERIES_PATH, "utf-8");
    goldenData = JSON.parse(raw);
  } catch (e) {
    console.error(`无法读取 golden queries: ${e.message}`);
    console.error(`请确认文件存在: ${GOLDEN_QUERIES_PATH}`);
    process.exit(1);
  }

  const queries = goldenData.queries;
  console.log(`\n=== 搜索质量评估 ===`);
  console.log(`Golden queries: ${queries.length}`);
  console.log(`Vault: ${vaultPath}`);
  console.log(`Plugin: ${pluginId}\n`);

  // Load catalog to verify book availability
  let catalog;
  try {
    const catRaw = await fs.readFile(path.join(PAGEINDEX_DIR, "catalog.json"), "utf-8");
    catalog = JSON.parse(catRaw);
  } catch (e) {
    console.error(`无法读取 catalog: ${e.message}`);
    process.exit(1);
  }

  // Cache loaded BM25 indexes
  const bm25Cache = new Map();

  async function loadBM25(bookId) {
    if (bm25Cache.has(bookId)) return bm25Cache.get(bookId);
    const bm25Path = path.join(PAGEINDEX_DIR, bookId, "bm25.json");
    try {
      const raw = await fs.readFile(bm25Path, "utf-8");
      const data = JSON.parse(raw);
      bm25Cache.set(bookId, data);
      return data;
    } catch (e) {
      return null;
    }
  }

  // Run evaluation
  const results = [];
  let skipped = 0;

  for (const q of queries) {
    // Check if book is indexed
    if (!catalog.books[q.bookId]) {
      console.log(`  SKIP ${q.id}: book ${q.bookId} not in catalog`);
      skipped++;
      continue;
    }

    const bm25Index = await loadBM25(q.bookId);
    if (!bm25Index) {
      console.log(`  SKIP ${q.id}: bm25.json not found for ${q.bookId}`);
      skipped++;
      continue;
    }

    // Search with topK=20 to have enough results for evaluation
    const searchResults = searchBM25(q.query, bm25Index, 20);

    const mrrScore = mrr(searchResults, q.relevantNodeIds);
    const hit5 = hitAtK(searchResults, q.relevantNodeIds, 5);
    const hit10 = hitAtK(searchResults, q.relevantNodeIds, 10);
    const ndcg5 = ndcgAtK(searchResults, q.relevantNodeIds, 5);

    // Find rank of first relevant result
    const relevantSet = new Set(q.relevantNodeIds);
    let firstRelevantRank = -1;
    for (let i = 0; i < searchResults.length; i++) {
      if (relevantSet.has(searchResults[i].nodeId)) {
        firstRelevantRank = i + 1;
        break;
      }
    }

    results.push({
      id: q.id,
      query: q.query,
      bookId: q.bookId,
      relevantNodeIds: q.relevantNodeIds,
      mrr: mrrScore,
      hit5,
      hit10,
      ndcg5,
      firstRelevantRank,
      topResults: searchResults.slice(0, 5).map(r => ({
        nodeId: r.nodeId,
        score: r.score.toFixed(4),
        relevant: relevantSet.has(r.nodeId),
      })),
    });
  }

  // Aggregate metrics
  const n = results.length;
  if (n === 0) {
    console.log("\n没有可评估的查询（所有书籍索引均不存在）");
    return;
  }

  const avgMrr = results.reduce((s, r) => s + r.mrr, 0) / n;
  const avgHit5 = results.reduce((s, r) => s + r.hit5, 0) / n;
  const avgHit10 = results.reduce((s, r) => s + r.hit10, 0) / n;
  const avgNdcg5 = results.reduce((s, r) => s + r.ndcg5, 0) / n;

  console.log(`\n=== 汇总指标 (${n} queries, ${skipped} skipped) ===\n`);
  console.log(`  MRR:     ${avgMrr.toFixed(4)}`);
  console.log(`  Hit@5:   ${(avgHit5 * 100).toFixed(1)}% (${results.filter(r => r.hit5).length}/${n})`);
  console.log(`  Hit@10:  ${(avgHit10 * 100).toFixed(1)}% (${results.filter(r => r.hit10).length}/${n})`);
  console.log(`  NDCG@5:  ${avgNdcg5.toFixed(4)}`);
  console.log();

  // Per-query details
  console.log(`=== 逐查询详情 ===\n`);
  for (const r of results) {
    const rankStr = r.firstRelevantRank > 0 ? `rank=${r.firstRelevantRank}` : "NOT_FOUND";
    const status = r.hit5 ? "OK" : (r.hit10 ? "WEAK" : "FAIL");
    console.log(`[${status}] ${r.id} "${r.query}" [${r.bookId}]`);
    console.log(`  MRR=${r.mrr.toFixed(2)} Hit@5=${r.hit5} Hit@10=${r.hit10} NDCG@5=${r.ndcg5.toFixed(3)} ${rankStr}`);
    console.log(`  Top-5: ${r.topResults.map(t =>
      `${t.nodeId}${t.relevant ? "*" : ""}(${t.score})`
    ).join(" ")}`);
    console.log(`  Expected: [${r.relevantNodeIds.join(", ")}]`);
    console.log();
  }

  // Per-book breakdown
  console.log(`=== 按书籍分组 ===\n`);
  const byBook = {};
  for (const r of results) {
    if (!byBook[r.bookId]) byBook[r.bookId] = [];
    byBook[r.bookId].push(r);
  }
  for (const [bookId, bookResults] of Object.entries(byBook)) {
    const title = catalog.books[bookId]?.title || bookId;
    const bm = bookResults.reduce((s, r) => s + r.mrr, 0) / bookResults.length;
    const bh5 = bookResults.reduce((s, r) => s + r.hit5, 0) / bookResults.length;
    console.log(`  ${title} (${bookId}): MRR=${bm.toFixed(3)} Hit@5=${(bh5 * 100).toFixed(0)}% [${bookResults.length} queries]`);
  }
  console.log();
}

main().catch((e) => {
  console.error("评估失败:", e.message);
  process.exit(1);
});
