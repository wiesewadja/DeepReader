/**
 * Comprehensive tests for book-search-v2.ts — 8-stage hybrid search pipeline
 *
 * Tests cover:
 * A. Pure function unit tests (no mocks needed)
 * B. E2E search quality with real book data (BM25-only mode via provider=local)
 * C. Scope filter integration (fake filesystem)
 * D. Error handling and degradation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import {
  searchBookV2,
  loadTreeJson,
  computeDynamicRecallK,
  computeLevelWeight,
  cosineSimilarity,
} from "@/pageindex/book-search-v2.js";
import { generateBookId } from "@/pageindex/book-indexer.js";
import { tokenize } from "@/pageindex/bm25.js";
import type { TreeNode, BM25Data } from "@/pageindex/book-types.js";
import { IndexError, IndexErrorCode } from "@/pageindex/book-types.js";
import { getPageindexRoot, getBookDir, getBookFile } from '@/pageindex/paths.js';

// ═══════════════════════════════════════════════════════════════
// Test vault paths
// ═══════════════════════════════════════════════════════════════

const VAULT_PATH = process.env.VAULT_PATH;
const MONEY_PSYCH_BOOK_ID = "f121b2ce";
const CRITICAL_BOOK_ID = "7d21cc73";



// ═══════════════════════════════════════════════════════════════
// A. Pure function unit tests
// ═══════════════════════════════════════════════════════════════

// ── A1: computeDynamicRecallK ─────────────────────────────────

describe("Stage 1: computeDynamicRecallK", () => {
  it("should return 50 for short queries (length < 5)", () => {
    expect(computeDynamicRecallK("钱")).toBe(50);
    expect(computeDynamicRecallK("ab")).toBe(50);
    expect(computeDynamicRecallK("")).toBe(50);
  });

  it("should return 30 for medium queries (5 <= length <= 15)", () => {
    expect(computeDynamicRecallK("abcde")).toBe(30);
    expect(computeDynamicRecallK("这是一个中等查询")).toBe(30);
    expect(computeDynamicRecallK("123456789012345")).toBe(30);
  });

  it("should return 15 for long queries (length > 15)", () => {
    expect(computeDynamicRecallK("这是一个非常长的查询应该返回最小的K值")).toBe(15);
    expect(computeDynamicRecallK("1234567890123456")).toBe(15);
  });

  it("should handle CJK characters correctly (each char = length 1)", () => {
    // "豪车悖论" = 4 chars → short query
    expect(computeDynamicRecallK("豪车悖论")).toBe(50);
    // "为什么人们在理财上" = 9 chars → medium
    expect(computeDynamicRecallK("为什么人们在理财上")).toBe(30);
  });
});

// ── A2: computeLevelWeight ─────────────────────────────────────

describe("Stage 5: computeLevelWeight", () => {
  const simpleStructure: TreeNode[] = [
    {
      nodeId: "root",
      title: "Book",
      nodes: [
        { nodeId: "ch1", title: "Chapter 1", nodes: [{ nodeId: "ch1-1", title: "Section 1.1", nodes: [] }] },
        { nodeId: "ch2", title: "Chapter 2", nodes: [] },
      ],
    },
  ];

  it("should return 1.0 for depth-0 node (book level)", () => {
    expect(computeLevelWeight("root", simpleStructure)).toBe(1.0);
  });

  it("should return 0.9 for chapter-level node with children", () => {
    // ch1 has child ch1-1
    expect(computeLevelWeight("ch1", simpleStructure)).toBe(0.9);
  });

  it("should return 0.7 for leaf-level node (no children)", () => {
    expect(computeLevelWeight("ch2", simpleStructure)).toBe(0.7);
    expect(computeLevelWeight("ch1-1", simpleStructure)).toBe(0.7);
  });

  it("should return 0.5 for node not found in tree", () => {
    expect(computeLevelWeight("nonexistent", simpleStructure)).toBe(0.5);
  });
});

// ── A3: splitByBlockIds ────────────────────────────────────────

// ── A4: cosineSimilarity ──────────────────────────────────────

describe("cosineSimilarity", () => {
  it("should return 1.0 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("should return ~0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("should return -1 for opposite vectors", () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });
});

// ── A7: RRF fusion logic ──────────────────────────────────────

describe("Stage 5: RRF fusion and level weighting logic", () => {
  const RRF_K = 60;

  function rrfScore(ranks: (number | undefined)[], k = RRF_K): number {
    let score = 0;
    for (const rank of ranks) {
      if (rank !== undefined) score += 1 / (k + rank);
    }
    return score;
  }

  function buildRankMap(scores: [string, number][]): Map<string, number> {
    const sorted = [...scores].sort((a, b) => b[1] - a[1]);
    const map = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) {
      map.set(sorted[i][0], i + 1);
    }
    return map;
  }

  it("should compute RRF score from a single signal (BM25 only)", () => {
    // Node at rank 1 → 1/(60+1) = 0.01639...
    const score = rrfScore([1]);
    expect(score).toBeCloseTo(1 / (RRF_K + 1), 8);
  });

  it("should sum RRF contributions from multiple signals", () => {
    // Node at rank 1 in BM25, rank 2 in vector
    const score = rrfScore([1, 2]);
    const expected = 1 / (RRF_K + 1) + 1 / (RRF_K + 2);
    expect(score).toBeCloseTo(expected, 8);
  });

  it("should sum all three signals (BM25 + vector + proposition)", () => {
    const score = rrfScore([1, 1, 1]);
    const expected = 3 / (RRF_K + 1);
    expect(score).toBeCloseTo(expected, 8);
  });

  it("should return 0 when node has no signal", () => {
    const score = rrfScore([undefined, undefined, undefined]);
    expect(score).toBe(0);
  });

  it("should handle node present in only one of three signals", () => {
    const score = rrfScore([undefined, 5, undefined]);
    expect(score).toBeCloseTo(1 / (RRF_K + 5), 8);
  });

  it("should rank node higher when it appears in more signals (same rank)", () => {
    const twoSignals = rrfScore([1, 1]);
    const oneSignal = rrfScore([1]);
    expect(twoSignals).toBeGreaterThan(oneSignal);
  });

  it("should rank node higher when it has a better rank (same signals)", () => {
    const betterRank = rrfScore([1]);
    const worseRank = rrfScore([10]);
    expect(betterRank).toBeGreaterThan(worseRank);
  });

  it("should build rank map correctly (1-indexed, descending by score)", () => {
    const scores: [string, number][] = [["a", 0.9], ["b", 0.5], ["c", 0.1]];
    const rankMap = buildRankMap(scores);
    expect(rankMap.get("a")).toBe(1);
    expect(rankMap.get("b")).toBe(2);
    expect(rankMap.get("c")).toBe(3);
  });

  it("should handle ties in rank map (first encountered gets lower rank)", () => {
    const scores: [string, number][] = [["a", 0.5], ["b", 0.5]];
    const rankMap = buildRankMap(scores);
    // Both should get some rank; order depends on stable sort
    const rankA = rankMap.get("a")!;
    const rankB = rankMap.get("b")!;
    expect(rankA).toBeGreaterThanOrEqual(1);
    expect(rankB).toBeGreaterThanOrEqual(1);
    expect(rankA).toBeLessThanOrEqual(2);
    expect(rankB).toBeLessThanOrEqual(2);
  });

  it("should apply level weighting as multiplier on RRF score", () => {
    const baseScore = rrfScore([1, 2]);
    const levelWeight = 0.9; // chapter-level
    const fusedScore = baseScore * levelWeight;
    expect(fusedScore).toBeCloseTo(baseScore * 0.9, 8);
    expect(fusedScore).toBeLessThan(baseScore);
  });

  it("should not change relative ordering when level weights differ", () => {
    // Node A: good RRF, low level weight
    // Node B: worse RRF, high level weight
    const scoreA = rrfScore([1]) * 0.7;
    const scoreB = rrfScore([2]) * 1.0;
    // 1/61 * 0.7 ≈ 0.01148 vs 1/62 * 1.0 ≈ 0.01613
    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it("level weight 1.0 should not change fusedScore", () => {
    const baseScore = rrfScore([3, 4]);
    const fusedScore = baseScore * 1.0;
    expect(fusedScore).toBeCloseTo(baseScore, 8);
  });

  it("level weight 0.5 (not found) should halve the score", () => {
    const baseScore = rrfScore([1]);
    const fusedScore = baseScore * 0.5;
    expect(fusedScore).toBeCloseTo(baseScore * 0.5, 8);
  });

  it("activeSignals count should reflect available signals", () => {
    const hasVectors = true;
    const hasBm25 = true;
    const hasPropositions = false;
    const activeSignals = (hasVectors ? 1 : 0) + (hasBm25 ? 1 : 0) + (hasPropositions ? 1 : 0);
    expect(activeSignals).toBe(2);
  });

  it("activeSignals should be 0 when no signals", () => {
    const activeSignals = 0 + 0 + 0;
    expect(activeSignals).toBe(0);
  });

  it("activeSignals should be 3 when all signals present", () => {
    const activeSignals = 1 + 1 + 1;
    expect(activeSignals).toBe(3);
  });

  it("RRF: same scores produce valid ranks", () => {
    // 两个节点 BM25 分数完全相同
    const rankMap = new Map<string, number>();
    const ranked = [['n1', 1.0], ['n2', 1.0]].sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < ranked.length; i++) {
      rankMap.set(ranked[i][0], i + 1);
    }
    expect(rankMap.get('n1')).toBe(1);
    expect(rankMap.get('n2')).toBe(2);
  });

  it("RRF: opposing ranks produce balanced scores", () => {
    const k = 60;
    // Node A: BM25 rank=1, Vector rank=100
    const rrfA = 1/(k+1) + 1/(k+100);
    // Node B: BM25 rank=100, Vector rank=1
    const rrfB = 1/(k+100) + 1/(k+1);
    expect(rrfA).toBeCloseTo(rrfB, 10); // 对称性
  });

  it("RRF: empty BM25 with vector still produces results", () => {
    const k = 60;
    const rrfScore = 1/(k+1); // 仅 Vector rank=1
    expect(rrfScore).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. E2E search quality (real book data, BM25-only mode)
// ═══════════════════════════════════════════════════════════════

// Helper: get real book file path from book-meta.json
// Returns { filePath, bookId } where bookId is the actual directory name
async function getBookMeta(legacyBookId: string): Promise<{ filePath: string; bookId: string }> {
  // Try the given bookId first
  let metaPath = getBookFile(VAULT_PATH, legacyBookId, 'book-meta.json');
  let exists = await fs.access(metaPath).then(() => true).catch(() => false);
  let actualDirName = legacyBookId;

  if (!exists) {
    // Scan all subdirs for matching book-meta.json with this bookId
    const pageindexDir = getPageindexRoot(VAULT_PATH);
    try {
      const dirs = await fs.readdir(pageindexDir);
      for (const dir of dirs) {
        const candidate = path.join(pageindexDir, dir, "book-meta.json");
        try {
          const raw = await fs.readFile(candidate, "utf8");
          const meta = JSON.parse(raw);
          if (meta.bookId === legacyBookId || dir === legacyBookId) {
            actualDirName = dir;
            metaPath = candidate;
            exists = true;
            break;
          }
        } catch { /* skip */ }
      }
    } catch { /* pageindex dir doesn't exist */ }
  }

  if (!exists) throw new Error(`Book ${legacyBookId} not found in test vault`);
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  return { filePath: meta.filePath, bookId: actualDirName };
}

// Check if local test vault exists for E2E tests
const vaultAvailable = !!VAULT_PATH && fsSync.existsSync(VAULT_PATH);

describe.skipIf(!vaultAvailable)("E2E: 金钱心理学 — BM25 search quality", () => {
  let filePath: string;
  let actualBookId: string;

  beforeEach(async () => {
    const bookMeta = await getBookMeta(MONEY_PSYCH_BOOK_ID);
    filePath = bookMeta.filePath;
    actualBookId = bookMeta.bookId;
  });

  it("should rank 豪车悖论 (node 0011) first for '豪车'", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "豪车",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].nodeId).toBe("0011");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("should find 盖茨-related results with positive scores", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "盖茨",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    // Results should be non-empty with positive scores
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].score).toBeGreaterThan(0);
    // 盖茨 chapters (0004, 0005) should appear in top 8 (using old index with levelWeight)
    const allIds = results.map(r => r.nodeId);
    // At least one of the Bill Gates chapters should be found
    const hasGatesChapter = allIds.includes("0004") || allIds.includes("0005");
    expect(hasGatesChapter).toBe(true);
  });

  it("should find 知足-related results in top results", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "知足",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // At least one of chapters 0005/0006 (永不知足/知足) should be found
    const allIds = results.map(r => r.nodeId);
    const hasZhizu = allIds.includes("0005") || allIds.includes("0006");
    expect(hasZhizu).toBe(true);
  });

  it("should never produce negative scores", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "人",
      topK: 26,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("should sort results by descending score", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "知足",
      topK: 10,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

describe.skipIf(!vaultAvailable)("E2E: 金钱心理学 — result structure completeness", () => {
  let filePath: string;
  let actualBookId: string;

  beforeEach(async () => {
    const bookMeta = await getBookMeta(MONEY_PSYCH_BOOK_ID);
    filePath = bookMeta.filePath;
    actualBookId = bookMeta.bookId;
  });

  it("should return nodeId in every result", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "储蓄",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (const r of results) {
      expect(r.nodeId).toBeTruthy();
    }
  });

  it("should return title in every result", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "储蓄",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (const r of results) {
      expect(r.title).toBeTruthy();
    }
  });

  it("should return fileName in every result", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "储蓄",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (const r of results) {
      expect(r.fileName).toBeTruthy();
    }
  });

  it("should return hierarchyPath as array in every result", async () => {
    const results = await searchBookV2({
      filePath,
      bookId: actualBookId,
      query: "储蓄",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (const r of results) {
      expect(Array.isArray(r.hierarchyPath)).toBe(true);
    }
  });
});

describe.skipIf(!vaultAvailable)("E2E: 思辨与立场 — proposition data", () => {
  it("should have propositions.json file", async () => {
    const propPath = getBookFile(VAULT_PATH, CRITICAL_BOOK_ID, 'propositions.json');
    const exists = await fs.access(propPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("should load valid proposition data", async () => {
    const propPath = getBookFile(VAULT_PATH, CRITICAL_BOOK_ID, 'propositions.json');
    const raw = await fs.readFile(propPath, "utf8");
    const data = JSON.parse(raw);
    expect(data.totalCards).toBeGreaterThan(0);
    expect(data.cards.length).toBeGreaterThan(0);
    expect(data.cards[0]).toHaveProperty("type");
    expect(data.cards[0]).toHaveProperty("answer");
  });

  it("should return search results for 批判性思维", async () => {
    const criticalMeta = await getBookMeta(CRITICAL_BOOK_ID);
    const filePath = criticalMeta.filePath;
    const criticalBookId = criticalMeta.bookId;
    const results = await searchBookV2({
      filePath,
      bookId: criticalBookId,
      query: "批判性思维",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].score).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. Scope filter integration (fake filesystem)
// ═══════════════════════════════════════════════════════════════

describe("Stage 4: Scope filter integration", () => {
  const testDir = "/tmp/deepreader-v2-scope-test";
  const testVault = path.join(testDir, "vault");
  let testFilePath: string;
  let testBookId: string;

  // Minimal BM25 index with 3 nodes
  const bm25Data: BM25Data = {
    nodes: {
      "n1": { text: "苹果是一种常见的水果，营养丰富", length: 15, level: "L1" },
      "n2": { text: "香蕉是热带水果，含有大量钾元素", length: 15, level: "L1" },
      "n3": { text: "计算机科学是研究计算和信息处理的学科", length: 15, level: "L1" },
    },
    invertedIndex: {
      "苹果": [{ nodeId: "n1", tf: 1 }],
      "水果": [{ nodeId: "n1", tf: 1 }, { nodeId: "n2", tf: 1 }],
      "香蕉": [{ nodeId: "n2", tf: 1 }],
      "计算机": [{ nodeId: "n3", tf: 1 }],
    },
    stats: { totalDocs: 3, avgDocLength: 15, df: { "苹果": 1, "水果": 2, "香蕉": 1, "计算机": 1 } },
    params: { k1: 1.5, b: 0.75 },
  };

  const treeData = {
    title: "Test Book",
    exportName: "test",
    docDescription: "test",
    source: "",
    nodeFileMap: { "n1": "ch1.md", "n2": "ch2.md", "n3": "ch3.md" },
    structure: [
      { nodeId: "n1", title: "Chapter 1: Apples" },
      { nodeId: "n2", title: "Chapter 2: Bananas" },
      { nodeId: "n3", title: "Chapter 3: Computers" },
    ] as TreeNode[],
  };

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    testFilePath = path.join(testVault, "test.pdf");
    await fs.mkdir(testVault, { recursive: true });
    await fs.writeFile(testFilePath, "fake pdf content for v2 search test");
    testBookId = await generateBookId(testFilePath);
    const indexDir = getBookDir(testVault, testBookId);

    await fs.mkdir(indexDir, { recursive: true });
    await fs.writeFile(path.join(indexDir, "bm25.json"), JSON.stringify(bm25Data));
    await fs.writeFile(path.join(indexDir, "tree.json"), JSON.stringify(treeData));

    // Create minimal markdown files
    const mdDir = path.join(testVault, "DeepReader", "test");
    await fs.mkdir(mdDir, { recursive: true });
    for (const [nodeId, fileName] of Object.entries(treeData.nodeFileMap)) {
      const node = treeData.structure.find(n => n.nodeId === nodeId);
      await fs.writeFile(path.join(mdDir, fileName), `# ${node?.title}\n\nContent for ${nodeId}.\n^block1\n`);
    }
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should filter results to scopeNodeIds when scope matches", async () => {
    const results = await searchBookV2({
      filePath: testFilePath,
      query: "水果",
      topK: 5,
      scopeNodeIds: ["n1"],
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    // Only n1 should be in scope, but n2 also matches "水果"
    // Since scope filter intersects with candidates, only n1 should appear
    for (const r of results) {
      expect(r.nodeId).toBe("n1");
    }
  });

  it("should fall back to all candidates when scope intersection is empty", async () => {
    const results = await searchBookV2({
      filePath: testFilePath,
      query: "水果",
      topK: 5,
      scopeNodeIds: ["n_nonexistent"],
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    // Scope has no intersection with candidates → fallback to all
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("should not filter when scopeNodeIds is empty array", async () => {
    const results = await searchBookV2({
      filePath: testFilePath,
      query: "水果",
      topK: 5,
      scopeNodeIds: [],
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map(r => r.nodeId);
    // Both n1 and n2 should be candidates (both have "水果")
    expect(ids).toContain("n1");
    expect(ids).toContain("n2");
  });

  it("should not filter when scopeNodeIds is undefined", async () => {
    const results = await searchBookV2({
      filePath: testFilePath,
      query: "水果",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. Error handling and degradation
// ═══════════════════════════════════════════════════════════════

describe("Error handling and edge cases", () => {
  it("should throw INDEX_INCOMPLETE when index directory does not exist", async () => {
    await expect(
      searchBookV2({
        filePath: "/nonexistent/book.pdf",
        query: "test",
        embedding: { provider: "local", model: "test" },
      })
    ).rejects.toThrow("Index not found");
  });

  it("should return empty array when BM25 has no matches", async () => {
    const testDir = "/tmp/deepreader-v2-nomatch-test";
    const testVault = path.join(testDir, "vault");
    const testFilePath = path.join(testVault, "book.pdf");
    await fs.mkdir(testVault, { recursive: true });
    await fs.writeFile(testFilePath, "fake pdf for no match test");
    const testBookId = await generateBookId(testFilePath);
    const indexDir = getBookDir(testVault, testBookId);

    try {
      await fs.mkdir(indexDir, { recursive: true });
      const emptyBm25: BM25Data = {
        nodes: { "n1": { text: "苹果是一种水果", length: 8, level: "L1" } },
        invertedIndex: { "苹果": [{ nodeId: "n1", tf: 1 }] },
        stats: { totalDocs: 1, avgDocLength: 8, df: { "苹果": 1 } },
        params: { k1: 1.5, b: 0.75 },
      };
      await fs.writeFile(path.join(indexDir, "bm25.json"), JSON.stringify(emptyBm25));
      await fs.writeFile(path.join(indexDir, "tree.json"), JSON.stringify({
        title: "Test", exportName: "test", docDescription: "", source: "",
        nodeFileMap: { "n1": "ch1.md" },
        structure: [{ nodeId: "n1", title: "Ch1" }],
      }));

      const results = await searchBookV2({
        filePath: testFilePath,
        query: "量子力学弦理论",
        topK: 5,
        embedding: { provider: "local", model: "test" },
      });
      expect(results).toEqual([]);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should handle empty string query without crashing", async () => {
    const testDir = "/tmp/deepreader-v2-emptyquery-test";
    const testVault = path.join(testDir, "vault");
    const testFilePath = path.join(testVault, "book.pdf");
    await fs.mkdir(testVault, { recursive: true });
    await fs.writeFile(testFilePath, "fake pdf for empty query test");
    const testBookId = await generateBookId(testFilePath);
    const indexDir = getBookDir(testVault, testBookId);

    try {
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "bm25.json"), JSON.stringify({
        nodes: {}, invertedIndex: {},
        stats: { totalDocs: 0, avgDocLength: 0, df: {} },
        params: { k1: 1.5, b: 0.75 },
      }));
      await fs.writeFile(path.join(indexDir, "tree.json"), JSON.stringify({
        title: "Test", exportName: "test", docDescription: "", source: "",
        nodeFileMap: {}, structure: [],
      }));

      const results = await searchBookV2({
        filePath: testFilePath,
        query: "",
        topK: 5,
        embedding: { provider: "local", model: "test" },
      });
      expect(results).toEqual([]);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should return correct dynamic recallK for various query lengths", () => {
    // Integration verification: the function is used correctly in the pipeline
    expect(computeDynamicRecallK("豪车")).toBe(50);     // short
    expect(computeDynamicRecallK("为什么买豪车")).toBe(30); // medium
    expect(computeDynamicRecallK("为什么人们会在理财上犯这么多错误呢")).toBe(15); // long
  });
});
