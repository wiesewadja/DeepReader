/**
 * E2E: 段落级向量化 (Chunk-Level Vectorization)
 *
 * 使用 test-vault 中真实的《如何阅读一本书》数据，调用真实 Embedding API。
 * 全程无 mock，验证完整管线。
 *
 * Embedding 配置来源（优先级从高到低）：
 *   1. 环境变量 EMBEDDING_API_KEY + EMBEDDING_PROVIDER 等
 *   2. test-vault/.obsidian/plugins/deepreader/data.json 中的 providers + roles.embedding
 *
 * 分组：
 *   Group A: 真实 Vault 数据 + chunker（纯本地，无需 API）
 *   Group B: 真实 Embedding API 连通性 + 维度验证
 *   Group C: 段落级向量化完整管线（读 .md → chunk → embed → 写 JSONL）
 *   Group D: 向量搜索 + 混合搜索质量验证
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import { getBookDir } from '@/pageindex/paths';

// ─── 常量 ───────────────────────────────────────────────────────────

const VAULT_PATH = path.resolve(
  process.env.VAULT_PATH || path.join(process.cwd(), "test-vault"),
);
const BOOK_DIR = path.join(VAULT_PATH, "DeepReader", "如何阅读一本书");
const TEST_BOOK_DIR = getBookDir(VAULT_PATH, "459d6dbc");
const DATA_JSON = path.join(
  VAULT_PATH, ".obsidian", "plugins", "deepreader-dev", "data.json",
);

// 硅基流动 OpenAI 兼容 API base URL
const SILICONFLOW_BASE = "https://api.siliconflow.cn/v1";

// ─── Embedding 配置（环境变量 > data.json）─────────────────────────

interface ProviderInfo { apiKey: string; baseUrl?: string }
interface RoleInfo { provider: string; model: string }

function getEmbeddingConfig() {
  // 优先级 1: 环境变量
  const envKey = process.env.EMBEDDING_API_KEY;
  if (envKey) {
    const provider = (process.env.EMBEDDING_PROVIDER || "openai") as
      | "openai" | "ollama" | "lmstudio";
    const config: import("@/pageindex/vault/types").EmbeddingOptions = {
      provider,
      apiKey: envKey,
      model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      dimensions: process.env.EMBEDDING_DIMENSIONS
        ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
        : undefined,
    };
    if (process.env.EMBEDDING_BASE_URL) config.baseUrl = process.env.EMBEDDING_BASE_URL;
    return config;
  }

  // 优先级 2: data.json 中的 providers + roles.embedding
  try {
    if (!fsSync.existsSync(DATA_JSON)) return null;
    const raw = JSON.parse(fsSync.readFileSync(DATA_JSON, "utf-8"));
    const providers: Record<string, ProviderInfo> = raw.providers || {};
    const roles: Record<string, RoleInfo> = raw.roles || {};
    const embRole = roles.embedding;
    if (!embRole) return null;

    const providerInfo = providers[embRole.provider];
    if (!providerInfo?.apiKey) return null;

    // 硅基流动用 OpenAI 兼容接口
    const providerName = embRole.provider === "siliconflow" ? "openai" : "openai";
    const baseUrl = providerInfo.baseUrl || (embRole.provider === "siliconflow" ? SILICONFLOW_BASE : undefined);

    return {
      provider: providerName as "openai",
      apiKey: providerInfo.apiKey,
      model: embRole.model,
      baseUrl,
    } as import("@/pageindex/vault/types").EmbeddingOptions;
  } catch {
    return null;
  }
}

function hasEmbeddingConfig(): boolean {
  return getEmbeddingConfig() !== null;
}

// ═══════════════════════════════════════════════════════════════════════
// Group A: 真实 Vault 数据 + chunker（纯本地，无需 API）
// ═══════════════════════════════════════════════════════════════════════

describe.skip('E2E Group A: 真实 Vault 数据 + chunker', () => {
  it("test-vault 应包含《如何阅读一本书》的 .md 文件", () => {
    expect(fsSync.existsSync(BOOK_DIR)).toBe(true);
    const files = fsSync
      .readdirSync(BOOK_DIR)
      .filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    console.log(`  找到 ${files.length} 个 .md 文件`);
  });

  it("读取真实 .md 文件，splitByBlockIds 正确提取 blockId", async () => {
    const { splitByBlockIds } = await import("@/pageindex/chunker");
    const files = fsSync
      .readdirSync(BOOK_DIR)
      .filter((f) => f.endsWith(".md"));

    let totalBlocks = 0;
    let totalChars = 0;

    for (const file of files) {
      const content = await fs.readFile(path.join(BOOK_DIR, file), "utf-8");
      const cleaned = content.replace(/^---[\s\S]*?---\n/, "").trim();
      const paragraphs = splitByBlockIds(cleaned);
      const blocksWithId = paragraphs.filter((p) => p.blockId);

      totalBlocks += blocksWithId.length;
      totalChars += content.length;

      // 验证每个 blockId 都有非空 text
      for (const p of blocksWithId) {
        expect(p.text.length).toBeGreaterThan(0);
      }
    }

    console.log(`  总 blockId 数: ${totalBlocks}, 总字符数: ${totalChars}`);
    expect(totalBlocks).toBeGreaterThan(50);
    expect(totalChars).toBeGreaterThan(10000);
  });

  it("mergeToChunks 产出 L2 chunks，blockId 覆盖完整", async () => {
    const { splitByBlockIds, mergeToChunks } = await import("@/pageindex/chunker");
    const files = fsSync
      .readdirSync(BOOK_DIR)
      .filter((f) => f.endsWith(".md"));

    let totalChunks = 0;
    let totalBlocks = 0;
    const allBlockIds: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(path.join(BOOK_DIR, file), "utf-8");
      const cleaned = content.replace(/^---[\s\S]*?---\n/, "").trim();
      const paragraphs = splitByBlockIds(cleaned);
      const blocksWithId = paragraphs.filter((p) => p.blockId);
      totalBlocks += blocksWithId.length;

      const nodeId = file.replace(".md", "").replace(/\s/g, "_");
      const chunks = mergeToChunks(paragraphs, nodeId);
      totalChunks += chunks.length;

      for (const chunk of chunks) {
        allBlockIds.push(...chunk.blockIds);
        expect(chunk.text.length).toBeGreaterThan(0);
        expect(chunk.text.length).toBeLessThanOrEqual(800);
        expect(chunk.chunkId).toMatch(/^.*_\w+/);
      }
    }

    const coverage = new Set(allBlockIds).size;
    console.log(
      `  ${totalBlocks} 个 blockId → ${totalChunks} 个 L2 chunks (覆盖 ${coverage} 个 blockId)`,
    );
    console.log(
      `  合并率: ${(totalChunks / totalBlocks * 100).toFixed(0)}%`,
    );

    expect(totalChunks).toBeGreaterThan(0);
    expect(totalChunks).toBeLessThanOrEqual(totalBlocks);
    expect(coverage).toBeGreaterThan(0);
  });

  it("现有索引 tree.json 的 nodeFileMap 与 .md 文件一一对应", async () => {
    const treePath = path.join(TEST_BOOK_DIR, "tree.json");
    if (!fsSync.existsSync(treePath)) {
      console.log("  跳过：tree.json 不存在");
      return;
    }

    const treeData = JSON.parse(await fs.readFile(treePath, "utf-8"));
    const nodeFileMap: Record<string, string> = treeData.nodeFileMap || {};
    const mdFiles = new Set(
      fsSync
        .readdirSync(BOOK_DIR)
        .filter((f) => f.endsWith(".md")),
    );

    let matched = 0;
    for (const [nodeId, fileName] of Object.entries(nodeFileMap)) {
      if (mdFiles.has(fileName as string)) {
        matched++;
      } else {
        console.log(`  缺失: nodeId=${nodeId}, file=${fileName}`);
      }
    }

    console.log(
      `  nodeFileMap: ${Object.keys(nodeFileMap).length} 条, 匹配: ${matched}`,
    );
    expect(matched).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group B: 真实 Embedding API 验证
// ═══════════════════════════════════════════════════════════════════════

describe.skip('E2E Group B: 真实 Embedding API', () => {
  beforeAll(() => {
    if (!hasEmbeddingConfig()) {
      console.log(
        "  跳过 Group B-D: 未设置 EMBEDDING_API_KEY 环境变量",
      );
    }
  });

  it("单条 generateEmbedding 返回正确维度向量", async () => {
    if (!hasEmbeddingConfig()) return;

    const { generateEmbedding } = await import("@/pageindex/vault/vectors");
    const config = getEmbeddingConfig()!;

    const vec = await generateEmbedding("阅读的层次分为四种", config);

    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBeGreaterThan(0);
    expect(vec.every((v) => typeof v === "number")).toBe(true);

    // 向量应该是归一化的或至少大部分值非零
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeGreaterThan(0);

    console.log(
      `  向量维度: ${vec.length}, L2 范数: ${norm.toFixed(4)}`,
    );
  });

  it("批量 generateEmbeddings 返回与输入等长的数组", async () => {
    if (!hasEmbeddingConfig()) return;

    const { generateEmbeddings } = await import("@/pageindex/vault/vectors");
    const config = getEmbeddingConfig()!;

    const texts = [
      "阅读的层次分为四种",
      "分析阅读是最重要的阅读方式",
      "主题阅读是比较不同书籍的方法",
    ];
    const vectors = await generateEmbeddings(texts, config);

    expect(vectors.length).toBe(texts.length);
    for (const vec of vectors) {
      expect(vec.length).toBeGreaterThan(0);
    }

    console.log(
      `  批量: ${texts.length} 条 → ${vectors.length} 个向量, 维度: ${vectors[0].length}`,
    );
  });

  it("相似文本的余弦相似度高于不相似文本", async () => {
    if (!hasEmbeddingConfig()) return;

    const { generateEmbeddings } = await import("@/pageindex/vault/vectors");
    const { cosineSimilarity } = await import("@/pageindex/core/utils");
    const config = getEmbeddingConfig()!;

    const [v1, v2, v3] = await generateEmbeddings(
      [
        "阅读的四个层次",
        "阅读分为四种不同的层次",
        "烹饪牛排的技巧",
      ],
      config,
    );

    const simRelated = cosineSimilarity(
      new Float32Array(v1),
      new Float32Array(v2),
    );
    const simUnrelated = cosineSimilarity(
      new Float32Array(v1),
      new Float32Array(v3),
    );

    console.log(
      `  相似: ${simRelated.toFixed(4)}, 不相关: ${simUnrelated.toFixed(4)}`,
    );
    expect(simRelated).toBeGreaterThan(simUnrelated);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group C: 段落级向量化完整管线
// ═══════════════════════════════════════════════════════════════════════

describe.skip('E2E Group C: 完整向量化管线', () => {
  let tempDir: string;

  beforeAll(async () => {
    if (!hasEmbeddingConfig()) return;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepreader-e2e-"));
  });

  // 清理临时目录（afterAll 在所有 it 之后执行）
  // 注意：用 afterAll 会被 vitest 标记为 "afterAll" hook

  it("读取真实 .md → chunk → embed → 写 JSONL → 验证三层产物", async () => {
    if (!hasEmbeddingConfig()) return;

    const {
      splitByBlockIds,
      mergeToChunks,
    } = await import("@/pageindex/chunker");
    const {
      generateEmbeddings,
      writeVectorJsonl,
      writeChunkTexts,
      readVectorJsonl,
      readChunkTexts,
    } = await import("@/pageindex/vault/vectors");
    const config = getEmbeddingConfig()!;

    // 读取 tree.json 获取 nodeFileMap
    const treeData = JSON.parse(
      await fs.readFile(path.join(TEST_BOOK_DIR, "tree.json"), "utf-8"),
    );
    const nodeFileMap: Record<string, string> = treeData.nodeFileMap || {};
    const exportName = treeData.exportName || treeData.title;

    // 读取 book-meta.json 获取书名和描述
    const bookMeta = JSON.parse(
      await fs.readFile(path.join(TEST_BOOK_DIR, "book-meta.json"), "utf-8"),
    );

    // ── L0: 书籍级 ──
    const l0Text = `${bookMeta.title}\n${bookMeta.description}`;

    // ── L1: 章节摘要（从 tree.json 结构收集）──
    interface PendingL1 {
      nodeId: string;
      title: string;
      summary: string;
    }
    const l1Nodes: PendingL1[] = [];

    function collectL1(nodes: any[]) {
      for (const node of nodes) {
        if (node.nodeId && node.summary) {
          l1Nodes.push({
            nodeId: node.nodeId,
            title: node.title || "",
            summary: node.summary || "",
          });
        }
        if (node.nodes) collectL1(node.nodes);
      }
    }
    for (const root of treeData.structure || []) {
      if (root.nodeId && root.summary) {
        l1Nodes.push({
          nodeId: root.nodeId,
          title: root.title || "",
          summary: root.summary || "",
        });
      }
      if (root.nodes) collectL1(root.nodes);
    }

    // ── L2: 段落 chunks（采样前 8 个 node 以加速测试）──
    interface L2Chunk {
      chunkId: string;
      nodeId: string;
      blockIds: string[];
      text: string;
      type: "heading" | "body" | "list" | "quote";
    }
    const l2Chunks: L2Chunk[] = [];
    const sampledEntries = Object.entries(nodeFileMap).slice(0, 8);

    for (const [nodeId, fileName] of sampledEntries) {
      const mdPath = path.join(BOOK_DIR, fileName as string);
      if (!fsSync.existsSync(mdPath)) continue;

      const content = await fs.readFile(mdPath, "utf-8");
      const cleaned = content.replace(/^---[\s\S]*?---\n/, "").trim();
      const paragraphs = splitByBlockIds(cleaned);
      const chunks = mergeToChunks(paragraphs, nodeId);

      for (const chunk of chunks) {
        l2Chunks.push({
          chunkId: chunk.chunkId,
          nodeId,
          blockIds: chunk.blockIds,
          text: chunk.text,
          type: chunk.type,
        });
      }
    }

    console.log(
      `  L0: 1, L1: ${l1Nodes.length}, L2: ${l2Chunks.length}`,
    );

    // ── Embedding（分批）──
    // 先 embedding L0 + L1
    const l0l1Texts = [l0Text, ...l1Nodes.map((n) => `${n.title}\n${n.summary}`)];
    console.log(`  Embedding L0+L1: ${l0l1Texts.length} 条...`);
    const l0l1Vectors = await generateEmbeddings(l0l1Texts, config);

    // 再 embedding L2（分批，每批 50，截断到 400 字防超 512 token 限制）
    console.log(`  Embedding L2: ${l2Chunks.length} 条 (batch=50)...`);
    const l2Vectors: number[][] = [];
    const batchSize = 50;
    const MAX_EMBED_CHARS = 400;
    for (let i = 0; i < l2Chunks.length; i += batchSize) {
      const batch = l2Chunks.slice(i, i + batchSize);
      const texts = batch.map((c) =>
        c.text.length > MAX_EMBED_CHARS ? c.text.slice(0, MAX_EMBED_CHARS) : c.text,
      );
      const vecs = await generateEmbeddings(texts, config);
      l2Vectors.push(...vecs);
      console.log(
        `    batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(l2Chunks.length / batchSize)} done`,
      );
    }

    // ── 组装记录 ──
    const vectorRecords: Array<import("@/pageindex/vault/types").VectorRecord> = [];
    const chunkTexts: Array<import("@/pageindex/vault/types").ChunkTextRecord> = [];

    // L0
    vectorRecords.push({
      chunkId: "BOOK",
      nodeId: "",
      blockIds: [],
      type: "summary",
      level: "L0",
      vector: l0l1Vectors[0],
    });
    chunkTexts.push({
      chunkId: "BOOK",
      nodeId: "",
      blockIds: [],
      text: l0Text,
      type: "summary",
    });

    // L1
    for (let i = 0; i < l1Nodes.length; i++) {
      const n = l1Nodes[i];
      vectorRecords.push({
        chunkId: `${n.nodeId}_s`,
        nodeId: n.nodeId,
        blockIds: [],
        type: "summary",
        level: "L1",
        vector: l0l1Vectors[i + 1],
      });
      chunkTexts.push({
        chunkId: `${n.nodeId}_s`,
        nodeId: n.nodeId,
        blockIds: [],
        text: `${n.title}\n${n.summary}`,
        type: "summary",
      });
    }

    // L2
    for (let i = 0; i < l2Chunks.length; i++) {
      const c = l2Chunks[i];
      vectorRecords.push({
        chunkId: c.chunkId,
        nodeId: c.nodeId,
        blockIds: c.blockIds,
        type: c.type,
        level: "L2",
        vector: l2Vectors[i],
      });
      chunkTexts.push({
        chunkId: c.chunkId,
        nodeId: c.nodeId,
        blockIds: c.blockIds,
        text: c.text,
        type: c.type,
      });
    }

    // ── 写 JSONL ──
    const vectorPath = path.join(tempDir, "vectors.jsonl");
    const chunksPath = path.join(tempDir, "chunks.jsonl");
    await writeVectorJsonl(vectorPath, vectorRecords);
    await writeChunkTexts(chunksPath, chunkTexts);

    // ── 验证 ──
    const savedVectors = await readVectorJsonl(vectorPath);
    const savedChunks = await readChunkTexts(chunksPath);

    const l0 = savedVectors.filter((v) => v.level === "L0");
    const l1 = savedVectors.filter((v) => v.level === "L1");
    const l2 = savedVectors.filter((v) => v.level === "L2");

    expect(l0).toHaveLength(1);
    expect(l0[0].chunkId).toBe("BOOK");

    expect(l1.length).toBeGreaterThan(10);
    expect(l1.every((v) => v.type === "summary")).toBe(true);

    expect(l2.length).toBeGreaterThan(10);
    // 大部分 L2 chunk 有 blockId（少数尾部段落可能没有）
    const withBlockIds = l2.filter((v) => v.blockIds.length > 0);
    expect(withBlockIds.length).toBeGreaterThan(l2.length * 0.8);
    expect(l2.every((v) => v.vector.length === l2[0].vector.length)).toBe(true);

    // chunks.jsonl 和 vectors.jsonl 总数一致
    expect(savedChunks.length).toBe(savedVectors.length);

    // L2 chunkId 一一对应
    const l2Ids = new Set(l2.map((v) => v.chunkId));
    const chunkL2Ids = new Set(
      savedChunks.filter((c) => l2Ids.has(c.chunkId)).map((c) => c.chunkId),
    );
    expect(chunkL2Ids.size).toBe(l2Ids.size);

    console.log(
      `  产物验证通过: L0=${l0.length} L1=${l1.length} L2=${l2.length} total=${savedVectors.length}`,
    );
    console.log(`  向量维度: ${l2[0].vector.length}`);
  });

  // 清理
  it("清理临时文件", async () => {
    if (!hasEmbeddingConfig()) return;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group D: 向量搜索 + 混合搜索质量验证
// ═══════════════════════════════════════════════════════════════════════

describe.skip('E2E Group D: 搜索质量验证', () => {
  // 复用 Group C 的产物，如果存在的话
  // 否则使用 test-vault 已有的旧格式向量做 BM25 搜索

  it("cosineSearchJsonl 在 L2 级别返回最相关的段落", async () => {
    if (!hasEmbeddingConfig()) return;

    const {
      generateEmbedding,
      generateEmbeddings,
      writeVectorJsonl,
      cosineSearchJsonl,
    } = await import("@/pageindex/vault/vectors");
    const config = getEmbeddingConfig()!;

    // 构造一个小型测试数据集
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepreader-search-"));
    try {
      // 用真实 embedding 生成几个段落向量
      const texts = [
        "阅读的四个层次分别是基础阅读、检视阅读、分析阅读和主题阅读",
        "分析阅读要求读者深入理解文本的结构和作者的意图",
        "烹饪美食需要掌握火候和调味的技巧",
      ];
      const vectors = await generateEmbeddings(texts, config);

      const records: Array<import("@/pageindex/vault/types").VectorRecord> = texts.map(
        (text, i) => ({
          chunkId: `test_${i}`,
          nodeId: `node${i}`,
          blockIds: [`p${i}`],
          type: "body" as const,
          level: "L2" as const,
          vector: vectors[i],
        }),
      );

      const testFile = path.join(testDir, "vectors.jsonl");
      await writeVectorJsonl(testFile, records);

      // 查询"阅读的方法"应该返回前两条（阅读相关）
      const queryVec = await generateEmbedding("阅读的方法和技巧", config);
      const results = await cosineSearchJsonl(testFile, queryVec, 3, {
        level: "L2",
      });

      expect(results.length).toBe(3);
      // 前两条阅读相关的得分应该高于烹饪
      const readingScores = results
        .filter((r) => r.nodeId !== "node2")
        .map((r) => r.score);
      const cookingScore = results.find((r) => r.nodeId === "node2")?.score || 0;

      console.log(
        `  搜索结果: ${results.map((r) => `${r.nodeId}=${r.score.toFixed(4)}`).join(", ")}`,
      );
      expect(readingScores[0]).toBeGreaterThan(cookingScore);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("BM25 搜索在已有索引上返回正确结果", async () => {
    const bm25Path = path.join(TEST_BOOK_DIR, "bm25.json");
    if (!fsSync.existsSync(bm25Path)) {
      console.log("  跳过：bm25.json 不存在");
      return;
    }

    const { searchBM25 } = await import("@/pageindex/bm25");
    const bm25Data = JSON.parse(await fs.readFile(bm25Path, "utf-8"));

    // 搜索"阅读的层次"
    const results = searchBM25("阅读的层次", bm25Data, 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    console.log(
      `  BM25 "阅读的层次": ${results.map((r) => `${r.nodeId}=${r.score.toFixed(4)}`).join(", ")}`,
    );

    // 搜索"分析阅读"
    const results2 = searchBM25("分析阅读", bm25Data, 5);
    expect(results2.length).toBeGreaterThan(0);
    console.log(
      `  BM25 "分析阅读": ${results2.map((r) => `${r.nodeId}=${r.score.toFixed(4)}`).join(", ")}`,
    );
  });

  it("BM25 搜索中文查询和英文查询都能返回结果", async () => {
    const bm25Path = path.join(TEST_BOOK_DIR, "bm25.json");
    if (!fsSync.existsSync(bm25Path)) {
      console.log("  跳过：bm25.json 不存在");
      return;
    }

    const { searchBM25 } = await import("@/pageindex/bm25");
    const bm25Data = JSON.parse(await fs.readFile(bm25Path, "utf-8"));

    // 中文查询
    const cnResults = searchBM25("如何做一个自我要求的读者", bm25Data, 3);
    expect(cnResults.length).toBeGreaterThan(0);

    // 短查询
    const shortResults = searchBM25("阅读", bm25Data, 3);
    expect(shortResults.length).toBeGreaterThan(0);

    console.log(
      `  中文长查询: ${cnResults.length} 条, 短查询: ${shortResults.length} 条`,
    );
  });
});
