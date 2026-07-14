#!/usr/bin/env node
/**
 * 搜索质量评估脚本（使用 searchBookV2 生产管线）
 *
 * 读取 tests/golden-queries.json，对每个查询执行 searchBookV2（8 阶段管线），
 * 计算 MRR、Hit@5、Hit@10、NDCG@5 等指标。
 *
 * 用法:
 *   node scripts/eval-search-quality.mjs [vault-path] [pluginId]
 *
 * 示例:
 *   node scripts/eval-search-quality.mjs test-vault deepreader-dev
 *
 * 前置条件:
 *   - 先运行 npm run build-eval（构建 search-bundle.cjs）
 *   - 或手动: node scripts/build-eval-entry.mjs
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const bm25Only = args.includes("--bm25-only");
const filteredArgs = args.filter(a => a !== "--bm25-only");
const vaultPath = filteredArgs[0] || "test-vault";
const pluginId = filteredArgs[1] || "deepreader-dev";

const GOLDEN_QUERIES_PATH = path.resolve("tests/golden-queries.json");
const PAGEINDEX_DIR = path.join(vaultPath, ".obsidian", "plugins", pluginId, "pageindex");
const DATA_JSON_PATH = path.join(vaultPath, ".obsidian", "plugins", pluginId, "data.json");

// ── Load searchBookV2 from eval bundle ──────────────────────────────────────

const BUNDLE_PATH = path.resolve("scripts/eval/search-bundle.cjs");

let searchBookV2, setActivePluginId;
try {
  ({ searchBookV2, setActivePluginId } = require(BUNDLE_PATH));
} catch (e) {
  console.error(`无法加载 search-bundle.cjs: ${e.message}`);
  console.error("请先运行: node scripts/build-eval-entry.mjs");
  process.exit(1);
}

// ── Metrics ─────────────────────────────────────────────────────────────────

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
  let dcg = 0;
  for (let i = 0; i < Math.min(k, results.length); i++) {
    const rel = relevantSet.has(results[i].nodeId) ? 1 : 0;
    dcg += rel / Math.log2(i + 2);
  }
  const idealCount = Math.min(relevantNodeIds.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg > 0 ? dcg / idcg : 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Set plugin ID for path resolution
  setActivePluginId(pluginId);

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
  const modeLabel = bm25Only ? "BM25-only" : "searchBookV2 管线";
  console.log(`\n=== 搜索质量评估（${modeLabel}）===`);
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

  // Built-in provider base URLs (mirrors src/config/providers.ts PROVIDER_CONFIGS)
  const PROVIDER_BASE_URLS = {
    siliconflow: 'https://api.siliconflow.cn/v1',
    openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com',
    minimax: 'https://api.minimaxi.com/v1',
    kimi: 'https://api.moonshot.cn/v1',
    xiaomi: 'https://token-plan-cn.xiaomimimo.com/v1',
    sensenova: 'https://token.sensenova.cn/v1',
  };

  /** Resolve baseUrl: provider account override → built-in default */
  function resolveBaseUrl(providerName, providerCfg) {
    return providerCfg?.baseUrl || PROVIDER_BASE_URLS[providerName] || '';
  }

  // Load data.json for embedding/reranker config
  let embeddingConfig = undefined;
  let rerankerConfig = undefined;

  if (bm25Only) {
    console.log("BM25-only 模式: 跳过 embedding/reranker 配置\n");
  } else {
  try {
    const dataRaw = await fs.readFile(DATA_JSON_PATH, "utf-8");
    const data = JSON.parse(dataRaw);

    // Build embedding config from roles.embedding + providers
    if (data.roles?.embedding && data.providers) {
      const providerName = data.roles.embedding.provider;
      const providerCfg = data.providers[providerName];
      if (providerCfg?.apiKey) {
        embeddingConfig = {
          provider: providerName,
          model: data.roles.embedding.model,
          apiKey: providerCfg.apiKey,
          baseUrl: resolveBaseUrl(providerName, providerCfg),
        };
        console.log(`Embedding: ${embeddingConfig.provider} / ${embeddingConfig.model} @ ${embeddingConfig.baseUrl}`);
      }
    }

    // Build reranker config from roles.reranker + providers
    if (data.roles?.reranker && data.providers) {
      const providerName = data.roles.reranker.provider;
      const providerCfg = data.providers[providerName];
      if (providerCfg?.apiKey) {
        rerankerConfig = {
          provider: providerName,
          model: data.roles.reranker.model,
          apiKey: providerCfg.apiKey,
          baseUrl: resolveBaseUrl(providerName, providerCfg),
          weight: data.rerankerWeight || 0.7,
        };
        console.log(`Reranker: ${rerankerConfig.provider} / ${rerankerConfig.model} @ ${rerankerConfig.baseUrl}`);
      }
    }
  } catch (e) {
    console.log(`未找到 data.json，降级为 BM25-only 模式: ${e.message}`);
  }
  }

  if (!embeddingConfig) console.log("Embedding: 未配置（BM25-only 模式）");
  if (!rerankerConfig) console.log("Reranker: 未配置");

  // Cache loaded book-meta (filePath lookup)
  const bookMetaCache = new Map();

  async function loadBookMeta(bookId) {
    if (bookMetaCache.has(bookId)) return bookMetaCache.get(bookId);
    const metaPath = path.join(PAGEINDEX_DIR, bookId, "book-meta.json");
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      const data = JSON.parse(raw);
      bookMetaCache.set(bookId, data);
      return data;
    } catch {
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

    const bookMeta = await loadBookMeta(q.bookId);
    if (!bookMeta?.filePath) {
      console.log(`  SKIP ${q.id}: book-meta.json not found for ${q.bookId}`);
      skipped++;
      continue;
    }

    // Search with topK=20 to have enough results for evaluation
    let searchResults;
    try {
      const v2Results = await searchBookV2({
        filePath: bookMeta.filePath,
        bookId: q.bookId,
        query: q.query,
        topK: 20,
        embedding: embeddingConfig,
        reranker: rerankerConfig,
        vaultPath: vaultPath,
      });
      // Convert BookSearchResultV2[] to format compatible with metrics
      searchResults = v2Results.map(r => ({ nodeId: r.nodeId, score: r.score }));
    } catch (e) {
      console.log(`  SKIP ${q.id}: search failed: ${e.message}`);
      skipped++;
      continue;
    }

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
