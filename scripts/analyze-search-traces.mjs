#!/usr/bin/env node
/**
 * 搜索质量分析脚本
 *
 * 读取 `.obsidian/plugins/{pluginId}/pageindex/search-traces/` 下的搜索 trace JSON 文件，
 * 输出搜索质量和效率的汇总报告。
 *
 * 用法:
 *   node scripts/analyze-search-traces.mjs <vault-path> [pluginId]
 *
 * 示例:
 *   node scripts/analyze-search-traces.mjs /Users/lizhao/test-vault deepreader-dev
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const args = process.argv.slice(2);
const vaultPath = args[0];
const pluginId = args[1] || "deepreader";

if (!vaultPath) {
  console.error("用法: node scripts/analyze-search-traces.mjs <vault-path> [pluginId]");
  process.exit(1);
}

const traceDir = path.join(vaultPath, ".obsidian", "plugins", pluginId, "pageindex", "search-traces");

async function main() {
  let entries = [];
  try {
    entries = await fs.readdir(traceDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") {
      console.log(`尚未生成搜索 trace: ${traceDir}`);
      return;
    }
    throw e;
  }

  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
  if (files.length === 0) {
    console.log("未找到搜索 trace 文件");
    return;
  }

  const traces = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(traceDir, file.name), "utf-8");
      traces.push(JSON.parse(content));
    } catch (e) {
      console.error(`解析失败 ${file.name}:`, e.message);
    }
  }

  if (traces.length === 0) {
    console.log("没有可解析的 trace 文件");
    return;
  }

  console.log(`\n=== 搜索质量汇总 (${traces.length} 次搜索) ===\n`);

  // 整体成功率与延迟
  const successCount = traces.filter((t) => t.success).length;
  const totalLatency = traces.map((t) => t.totalDurationMs || 0);
  const avgLatency = totalLatency.reduce((a, b) => a + b, 0) / totalLatency.length;
  const maxLatency = Math.max(...totalLatency);
  const minLatency = Math.min(...totalLatency);

  console.log(`成功率: ${successCount}/${traces.length} (${((successCount / traces.length) * 100).toFixed(1)}%)`);
  console.log(`平均延迟: ${avgLatency.toFixed(1)} ms`);
  console.log(`最大延迟: ${maxLatency} ms`);
  console.log(`最小延迟: ${minLatency} ms`);
  console.log();

  // 各阶段平均延迟
  const stageTimes = {};
  const stageCounts = {};
  for (const t of traces) {
    for (const s of t.stages || []) {
      stageTimes[s.name] = (stageTimes[s.name] || 0) + s.durationMs;
      stageCounts[s.name] = (stageCounts[s.name] || 0) + 1;
    }
  }

  console.log("--- 各阶段平均延迟 ---");
  for (const [name, totalMs] of Object.entries(stageTimes)) {
    const count = stageCounts[name];
    console.log(`  ${name}: ${(totalMs / count).toFixed(1)} ms (${count} 次)`);
  }
  console.log();

  // 信号统计
  const signalTotals = {
    bm25Recalled: 0,
    vectorRecalled: 0,
    propositionRecalled: 0,
    scopeFallback: 0,
    reranked: 0,
  };
  for (const t of traces) {
    const s = t.signals || {};
    signalTotals.bm25Recalled += s.bm25Recalled || 0;
    signalTotals.vectorRecalled += s.vectorRecalled || 0;
    signalTotals.propositionRecalled += s.propositionRecalled || 0;
    signalTotals.scopeFallback += s.scopeFallback || 0;
    signalTotals.reranked += s.reranked || 0;
  }

  console.log("--- 信号平均召回数 ---");
  for (const [name, total] of Object.entries(signalTotals)) {
    console.log(`  ${name}: ${(total / traces.length).toFixed(2)}`);
  }
  console.log();

  // 分数分布
  function scoreStats(label, stats) {
    if (!stats || stats.count === 0) return;
    console.log(`  ${label}: min=${stats.min.toFixed(3)}, max=${stats.max.toFixed(3)}, mean=${stats.mean.toFixed(3)}, count=${stats.count}`);
  }

  console.log("--- 分数分布（聚合） ---");
  const signals = ["fused", "bm25", "vector", "reranked"];
  const agg = {};
  for (const sig of signals) agg[sig] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  for (const t of traces) {
    if (!t.scoreStats) continue;
    for (const sig of signals) {
      const s = t.scoreStats[sig];
      if (!s || s.count === 0) continue;
      agg[sig].min = Math.min(agg[sig].min, s.min);
      agg[sig].max = Math.max(agg[sig].max, s.max);
      agg[sig].sum += s.mean * s.count;
      agg[sig].count += s.count;
    }
  }
  for (const sig of signals) {
    const a = agg[sig];
    if (a.count === 0) continue;
    scoreStats(sig, { min: a.min, max: a.max, mean: a.sum / a.count, count: a.count });
  }
  console.log();

  // 失败查询
  const failures = traces.filter((t) => !t.success);
  if (failures.length > 0) {
    console.log(`--- 失败查询 (${failures.length}) ---`);
    for (const t of failures.slice(0, 5)) {
      console.log(`  [${t.bookId}] "${t.query}": ${t.error || "unknown"}`);
    }
    console.log();
  }

  // 最慢查询
  console.log("--- 最慢 3 次查询 ---");
  traces
    .sort((a, b) => (b.totalDurationMs || 0) - (a.totalDurationMs || 0))
    .slice(0, 3)
    .forEach((t) => {
      console.log(`  ${t.totalDurationMs} ms [${t.bookId}] "${t.query}"`);
    });
  console.log();
}

main().catch((e) => {
  console.error("分析失败:", e.message);
  process.exit(1);
});
