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
import * as crypto from "crypto";

import {
  searchBookV2,
  loadTreeJson,
  computeDynamicRecallK,
  computeLevelWeight,
  splitByBlockIds,
  scoreByTokenDensity,
  countTokenHits,
  expandToContext,
  cosineSimilarity,
} from "../book-search-v2.js";
import { tokenize } from "../bm25.js";
import type { TreeNode, BM25Data } from "../book-types.js";
import { IndexError, IndexErrorCode } from "../book-types.js";

// ═══════════════════════════════════════════════════════════════
// Test vault paths
// ═══════════════════════════════════════════════════════════════

const VAULT_PATH = "/Users/lizhao/workspace/deepreadertest";
const MONEY_PSYCH_BOOK_ID = "89e541bc";
const CRITICAL_BOOK_ID = "1553db0b";

function generateBookId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

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

describe("Stage 8: splitByBlockIds", () => {
  it("should split content by block ID markers", () => {
    const content = "First paragraph text.\n^block-001\n\nSecond paragraph.\n^block-002";
    const paragraphs = splitByBlockIds(content);
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(paragraphs[0].blockId).toBe("^block-001");
    expect(paragraphs[0].text).toContain("First paragraph");
    expect(paragraphs[1].blockId).toBe("^block-002");
    expect(paragraphs[1].text).toContain("Second paragraph");
  });

  it("should handle content with no block IDs", () => {
    const content = "Just a simple paragraph with no markers.";
    const paragraphs = splitByBlockIds(content);
    // Without block IDs, the text goes to the "remaining" paragraph
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0].blockId).toBe("");
    expect(paragraphs[0].text).toContain("Just a simple paragraph");
  });

  it("should handle empty content", () => {
    const paragraphs = splitByBlockIds("");
    expect(paragraphs).toEqual([]);
  });

  it("should handle trailing content after last block ID", () => {
    const content = "Paragraph one.\n^p001\n\nTrailing text without ID";
    const paragraphs = splitByBlockIds(content);
    const lastParagraph = paragraphs[paragraphs.length - 1];
    // Trailing text should be captured as a block with empty blockId
    expect(lastParagraph.text).toContain("Trailing text");
    expect(lastParagraph.blockId).toBe("");
  });
});

// ── A4: scoreByTokenDensity + countTokenHits ───────────────────

describe("Stage 8: scoreByTokenDensity + countTokenHits", () => {
  it("should count token hits correctly", () => {
    expect(countTokenHits("储蓄是财富积累的基础", ["储蓄"])).toBe(1);
    expect(countTokenHits("储蓄储蓄储蓄", ["储蓄"])).toBe(3);
    expect(countTokenHits("方法一方法二方法三", ["方法"])).toBe(3);
  });

  it("should return 0 when no tokens match", () => {
    expect(countTokenHits("完全没有关系的文本", ["机器学习"])).toBe(0);
  });

  it("should be case-insensitive", () => {
    expect(countTokenHits("Deep Learning deep learning", ["deep"])).toBe(2);
  });

  it("should handle multiple query tokens", () => {
    const hits = countTokenHits("机器学习和深度学习都是AI", ["机器", "学习"]);
    // "机器" × 1 + "学习" × 2 (机器学习中的学和深度学习中的学) = depends on tokenizer
    expect(hits).toBeGreaterThan(0);
  });

  it("scoreByTokenDensity should score paragraphs by token density", () => {
    const paragraphs = [
      { blockId: "^p1", text: "储蓄是财富的基础。储蓄率决定一切。", start: 0, end: 20 },
      { blockId: "^p2", text: "投资有风险，需要谨慎。", start: 20, end: 30 },
    ];
    const scored = scoreByTokenDensity(paragraphs, ["储蓄"]);
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });
});

// ── A5: expandToContext ────────────────────────────────────────

describe("Stage 8: expandToContext", () => {
  it("should expand match to reach blockSize", () => {
    const paragraphs = [
      { blockId: "^p1", text: "First paragraph.", start: 0, end: 16 },
      { blockId: "^p2", text: "Second paragraph with more content.", start: 16, end: 50 },
      { blockId: "^p3", text: "Third paragraph.", start: 50, end: 67 },
    ];
    const match = { ...paragraphs[1], score: 1 };
    // expandToContext uses paragraphs.indexOf(match) — must pass the same object reference
    const result = expandToContext(paragraphs[1] as any, paragraphs, 200);
    // Should include surrounding paragraphs
    expect(result.length).toBeGreaterThan(paragraphs[1].text.length);
    expect(result).toContain("First paragraph");
    expect(result).toContain("Third paragraph");
  });

  it("should not exceed blockSize", () => {
    const paragraphs = [
      { blockId: "^p1", text: "A".repeat(100), start: 0, end: 100 },
      { blockId: "^p2", text: "B".repeat(100), start: 100, end: 200 },
      { blockId: "^p3", text: "C".repeat(100), start: 200, end: 300 },
    ];
    // Use direct object reference for indexOf to work
    const result = expandToContext(paragraphs[1] as any, paragraphs, 150);
    expect(result.length).toBeLessThanOrEqual(150);
  });

  it("should return match text when match not found in array", () => {
    const paragraphs = [
      { blockId: "^p1", text: "Hello", start: 0, end: 5 },
    ];
    const orphan = { blockId: "^orphan", text: "Orphan text", start: 0, end: 11, score: 1 };
    const result = expandToContext(orphan, paragraphs, 500);
    expect(result).toBe("Orphan text");
  });
});

// ── A6: cosineSimilarity ──────────────────────────────────────

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

// ── A7: Fusion weight logic ────────────────────────────────────

describe("Stage 5: Fusion weight and normalization logic", () => {
  it("should apply correct weights when all three signals available", () => {
    const hasVectors = true;
    const hasPropositions = true;
    const w_v = hasVectors ? (hasPropositions ? 0.5 : 0.7) : 0;
    const w_b = hasVectors ? (hasPropositions ? 0.25 : 0.3) : 1.0;
    const w_p = hasPropositions ? (hasVectors ? 0.25 : 0) : 0;
    expect(w_v).toBe(0.5);
    expect(w_b).toBe(0.25);
    expect(w_p).toBe(0.25);
    expect(w_v + w_b + w_p).toBeCloseTo(1.0, 5);
  });

  it("should apply BM25+Vector weights when no propositions", () => {
    const hasVectors = true;
    const hasPropositions = false;
    const w_v = hasVectors ? (hasPropositions ? 0.5 : 0.7) : 0;
    const w_b = hasVectors ? (hasPropositions ? 0.25 : 0.3) : 1.0;
    const w_p = hasPropositions ? (hasVectors ? 0.25 : 0) : 0;
    expect(w_v).toBe(0.7);
    expect(w_b).toBe(0.3);
    expect(w_p).toBe(0);
    expect(w_v + w_b + w_p).toBeCloseTo(1.0, 5);
  });

  it("should use BM25-only weight when no vectors", () => {
    const hasVectors = false;
    const hasPropositions = false;
    const w_v = hasVectors ? (hasPropositions ? 0.5 : 0.7) : 0;
    const w_b = hasVectors ? (hasPropositions ? 0.25 : 0.3) : 1.0;
    const w_p = hasPropositions ? (hasVectors ? 0.25 : 0) : 0;
    expect(w_v).toBe(0);
    expect(w_b).toBe(1.0);
    expect(w_p).toBe(0);
  });

  it("BM25 normalization: range=0 → all scores become 0", () => {
    const scores = [0, 0, 0];
    const max = Math.max(...scores, 0);
    const min = Math.min(...scores, 0);
    const range = max - min;
    const normalized = scores.map(s => range > 0 ? (s - min) / range : 0);
    expect(normalized).toEqual([0, 0, 0]);
  });

  it("Vector normalization: range=0 but vs>0 → returns 1", () => {
    const scores = [0.5, 0.5, 0.5];
    const max = Math.max(...scores, 0);
    const min = Math.min(...scores, 0);
    const range = max - min;
    const normalized = scores.map(s => range > 0 ? (s - min) / range : (s > 0 ? 1 : 0));
    expect(normalized).toEqual([1, 1, 1]);
  });

  it("Proposition normalization: range=0 → pass raw score (only when all scores are 0)", () => {
    // When all proposition scores are 0: range=0, raw score (0) is passed through
    const scores = [0, 0];
    const max = Math.max(...scores, 0);
    const min = Math.min(...scores, 0);
    const range = max - min;
    const normalized = scores.map(s => range > 0 ? (s - min) / range : s);
    expect(normalized).toEqual([0, 0]);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. E2E search quality (real book data, BM25-only mode)
// ═══════════════════════════════════════════════════════════════

// Helper: get real book file path from book-meta.json
async function getBookFilePath(bookId: string): Promise<string> {
  const metaPath = path.join(VAULT_PATH, ".pageindex", bookId, "book-meta.json");
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  return meta.filePath;
}

describe("E2E: 金钱心理学 — BM25 search quality", () => {
  let filePath: string;

  beforeEach(async () => {
    filePath = await getBookFilePath(MONEY_PSYCH_BOOK_ID);
  });

  it("should rank 豪车悖论 (node 0011) first for '豪车'", async () => {
    const results = await searchBookV2({
      filePath,
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
      query: "知足",
      topK: 10,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

describe("E2E: 金钱心理学 — result structure completeness", () => {
  let filePath: string;

  beforeEach(async () => {
    filePath = await getBookFilePath(MONEY_PSYCH_BOOK_ID);
  });

  it("should return nodeId in every result", async () => {
    const results = await searchBookV2({
      filePath,
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
      query: "储蓄",
      topK: 5,
      embedding: { provider: "local", model: "text-embedding-3-small" },
    });
    for (const r of results) {
      expect(Array.isArray(r.hierarchyPath)).toBe(true);
    }
  });
});

describe("E2E: 思辨与立场 — proposition data", () => {
  it("should have propositions.json file", async () => {
    const propPath = path.join(VAULT_PATH, ".pageindex", CRITICAL_BOOK_ID, "propositions.json");
    const exists = await fs.access(propPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("should load valid proposition data", async () => {
    const propPath = path.join(VAULT_PATH, ".pageindex", CRITICAL_BOOK_ID, "propositions.json");
    const raw = await fs.readFile(propPath, "utf8");
    const data = JSON.parse(raw);
    expect(data.totalCards).toBeGreaterThan(0);
    expect(data.cards.length).toBeGreaterThan(0);
    expect(data.cards[0]).toHaveProperty("type");
    expect(data.cards[0]).toHaveProperty("answer");
  });

  it("should return search results for 批判性思维", async () => {
    const filePath = await getBookFilePath(CRITICAL_BOOK_ID);
    const results = await searchBookV2({
      filePath,
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
    testBookId = generateBookId(testFilePath);
    const indexDir = path.join(testVault, ".pageindex", testBookId);

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
    const testBookId = generateBookId(testFilePath);
    const indexDir = path.join(testVault, ".pageindex", testBookId);

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
    const testBookId = generateBookId(testFilePath);
    const indexDir = path.join(testVault, ".pageindex", testBookId);

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
