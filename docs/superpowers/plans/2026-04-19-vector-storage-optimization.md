# 向量化存储优化 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将向量存储从自定义 `.f32` 二进制格式迁移到 JSONL 文本格式，瘦身向量化内容，新增全局目录支持跨书搜索。

**Architecture:** 存储层从双文件（`.f32` + `.meta.json`）重构为单文件 JSONL（每行一条 `nodeId + title + level + vector` 的 JSON）。新增 `.pageindex/catalog.json` 全局目录，索引/删除时维护，搜索时按需加载。向量化内容从 `title + summary + 全文` 瘦身为 `title + summary`。

**Tech Stack:** TypeScript, Node.js fs, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/pageindex/vault/types.ts` | Modify | 新增 `VectorRecord`、`CatalogMeta` 类型，移除 `VectorIndexMeta` |
| `src/pageindex/vault/vectors.ts` | Modify | 重写：JSONL 读写、catalog 操作、cosine search、跨书搜索 |
| `src/pageindex/book-indexer.ts` | Modify | 向量化文本瘦身 + 索引完成更新 catalog |
| `src/pageindex/book-search-v2.ts` | Modify | `asyncVectorSearch` 改用新格式，新增跨书搜索入口 |
| `src/pageindex/proposition-indexer.ts` | Modify | proposition 向量写入改用 JSONL |
| `src/pageindex/proposition-search.ts` | Modify | proposition 向量加载改用 JSONL |
| `src/pageindex/__tests__/vector-storage.test.ts` | Create | JSONL 存储层单元测试 |
| `src/pageindex/__tests__/vector-catalog.test.ts` | Create | 全局目录单元测试 |

---

## Chunk 1: Types + JSONL 存储原语

### Task 1: 新增 JSONL 存储类型

**Files:**
- Modify: `src/pageindex/vault/types.ts`

- [ ] **Step 1: 添加新类型定义**

在 `src/pageindex/vault/types.ts` 文件末尾添加：

```typescript
// ─── JSONL Vector Storage Types ───────────────────────────────

/** 单条向量记录（JSONL 每行的结构） */
export interface VectorRecord {
  nodeId: string;
  title: string;
  level: "L0" | "L1";
  vector: number[];
}

/** 单条 proposition 向量记录 */
export interface PropVectorRecord {
  cardId: string;
  vector: number[];
}

/** 全局目录 */
export interface CatalogMeta {
  version: number;
  books: Record<string, CatalogBookEntry>;
}

/** 全局目录中每本书的条目 */
export interface CatalogBookEntry {
  title: string;
  vectorModel: string;
  dimensions: number;
  nodeCount: number;
  hasPropositions: boolean;
  indexedAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pageindex/vault/types.ts
git commit -m "refactor: 新增 JSONL 向量存储类型定义"
```

---

### Task 2: JSONL 向量读写函数

**Files:**
- Modify: `src/pageindex/vault/vectors.ts`
- Create: `src/pageindex/__tests__/vector-storage.test.ts`

- [ ] **Step 1: 写存储层单元测试**

```typescript
// src/pageindex/__tests__/vector-storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import {
  writeVectorJsonl,
  readVectorJsonl,
  appendVectorRecord,
  cosineSearchJsonl,
} from "../vault/vectors.js";
import type { VectorRecord } from "../vault/types.js";

describe("JSONL Vector Storage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vec-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const record1: VectorRecord = {
    nodeId: "0001",
    title: "第一章 概述",
    level: "L1",
    vector: [0.1, 0.2, 0.3],
  };
  const record2: VectorRecord = {
    nodeId: "0002",
    title: "1.1 背景",
    level: "L1",
    vector: [0.4, 0.5, 0.6],
  };

  it("should write and read vector records", async () => {
    const filePath = path.join(tempDir, "vectors.jsonl");
    await writeVectorJsonl(filePath, [record1, record2]);

    const records = await readVectorJsonl(filePath);
    expect(records).toHaveLength(2);
    expect(records[0].nodeId).toBe("0001");
    expect(records[0].vector).toEqual([0.1, 0.2, 0.3]);
    expect(records[1].nodeId).toBe("0002");
  });

  it("should append a record to existing file", async () => {
    const filePath = path.join(tempDir, "vectors.jsonl");
    await writeVectorJsonl(filePath, [record1]);
    await appendVectorRecord(filePath, record2);

    const records = await readVectorJsonl(filePath);
    expect(records).toHaveLength(3); // 1 original + 1 appended + trailing newline handling
  });

  it("should return empty array for missing file", async () => {
    const records = await readVectorJsonl(path.join(tempDir, "nope.jsonl"));
    expect(records).toEqual([]);
  });

  it("should perform cosine search on records", async () => {
    const filePath = path.join(tempDir, "vectors.jsonl");
    await writeVectorJsonl(filePath, [record1, record2]);

    const results = await cosineSearchJsonl(filePath, [0.4, 0.5, 0.6], 1);
    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe("0002");
    expect(results[0].score).toBeCloseTo(1.0, 4);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/pageindex/__tests__/vector-storage.test.ts`
Expected: FAIL — 函数不存在

- [ ] **Step 3: 在 vectors.ts 中实现 JSONL 函数**

在 `src/pageindex/vault/vectors.ts` 文件末尾（`cosineSearch` 函数之后）添加以下新函数。**不删除旧的 `.f32` 函数**，保留兼容：

```typescript
// ─── JSONL Vector Storage ─────────────────────────────────────

import type { VectorRecord } from "./types";

/**
 * Write vector records to a JSONL file (replaces entire file)
 */
export async function writeVectorJsonl(
  filePath: string,
  records: VectorRecord[]
): Promise<void> {
  const lines = records.map((r) => JSON.stringify(r));
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

/**
 * Read all vector records from a JSONL file
 */
export async function readVectorJsonl(
  filePath: string
): Promise<VectorRecord[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as VectorRecord);
  } catch {
    return [];
  }
}

/**
 * Append a single record to an existing JSONL file
 */
export async function appendVectorRecord(
  filePath: string,
  record: VectorRecord
): Promise<void> {
  await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
}

/**
 * Cosine search over a JSONL vector file
 */
export async function cosineSearchJsonl(
  filePath: string,
  queryVector: number[],
  topK: number
): Promise<Array<{ nodeId: string; title: string; score: number }>> {
  const records = await readVectorJsonl(filePath);
  const query = new Float32Array(queryVector);
  const scores: Array<{ nodeId: string; title: string; score: number }> = [];

  for (const record of records) {
    const vector = new Float32Array(record.vector);
    const score = cosineSimilarity(query, vector);
    scores.push({ nodeId: record.nodeId, title: record.title, score });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

注意：需要在文件顶部 import 区域添加 `import type { VectorRecord } from "./types";`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:run -- src/pageindex/__tests__/vector-storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/vault/vectors.ts src/pageindex/__tests__/vector-storage.test.ts
git commit -m "feat: JSONL 向量存储读写函数 + 单元测试"
```

---

### Task 3: 全局目录（Catalog）函数

**Files:**
- Modify: `src/pageindex/vault/vectors.ts`
- Create: `src/pageindex/__tests__/vector-catalog.test.ts`

- [ ] **Step 1: 写目录测试**

```typescript
// src/pageindex/__tests__/vector-catalog.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import {
  loadCatalog,
  updateCatalogEntry,
  removeCatalogEntry,
} from "../vault/vectors.js";
import type { CatalogBookEntry } from "../vault/types.js";

describe("Vector Catalog", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const entry: CatalogBookEntry = {
    title: "如何阅读一本书",
    vectorModel: "text-embedding-3-small",
    dimensions: 1536,
    nodeCount: 20,
    hasPropositions: false,
    indexedAt: "2026-04-19T00:00:00Z",
  };

  it("should create catalog on first update", async () => {
    await updateCatalogEntry(tempDir, "a1b2c3d4", entry);
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books["a1b2c3d4"]).toBeDefined();
    expect(catalog.books["a1b2c3d4"].title).toBe("如何阅读一本书");
  });

  it("should update existing entry", async () => {
    await updateCatalogEntry(tempDir, "a1b2c3d4", entry);
    await updateCatalogEntry(tempDir, "a1b2c3d4", {
      ...entry,
      nodeCount: 25,
    });
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books["a1b2c3d4"].nodeCount).toBe(25);
  });

  it("should remove entry", async () => {
    await updateCatalogEntry(tempDir, "a1b2c3d4", entry);
    await removeCatalogEntry(tempDir, "a1b2c3d4");
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books["a1b2c3d4"]).toBeUndefined();
  });

  it("should return empty catalog when file missing", async () => {
    const catalog = await loadCatalog(tempDir);
    expect(catalog.books).toEqual({});
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/pageindex/__tests__/vector-catalog.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 vectors.ts 中实现目录函数**

```typescript
import type { VectorRecord, CatalogMeta, CatalogBookEntry } from "./types";

const CATALOG_FILE = "catalog.json";

/**
 * Load global catalog from .pageindex/catalog.json
 */
export async function loadCatalog(pageindexPath: string): Promise<CatalogMeta> {
  const catalogPath = path.join(pageindexPath, CATALOG_FILE);
  try {
    const content = await fs.readFile(catalogPath, "utf-8");
    return JSON.parse(content) as CatalogMeta;
  } catch {
    return { version: 1, books: {} };
  }
}

/**
 * Update or insert a book entry in the global catalog
 */
export async function updateCatalogEntry(
  pageindexPath: string,
  bookId: string,
  entry: CatalogBookEntry
): Promise<void> {
  const catalog = await loadCatalog(pageindexPath);
  catalog.books[bookId] = entry;
  const catalogPath = path.join(pageindexPath, CATALOG_FILE);
  await fs.mkdir(pageindexPath, { recursive: true });
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");
}

/**
 * Remove a book entry from the global catalog
 */
export async function removeCatalogEntry(
  pageindexPath: string,
  bookId: string
): Promise<void> {
  const catalog = await loadCatalog(pageindexPath);
  delete catalog.books[bookId];
  const catalogPath = path.join(pageindexPath, CATALOG_FILE);
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:run -- src/pageindex/__tests__/vector-catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/vault/vectors.ts src/pageindex/__tests__/vector-catalog.test.ts
git commit -m "feat: 全局目录 catalog 读写函数 + 单元测试"
```

---

## Chunk 2: 向量化内容瘦身 + 索引流程对接

### Task 4: L0/L1 向量化文本瘦身

**Files:**
- Modify: `src/pageindex/book-indexer.ts:519-556`

- [ ] **Step 1: 修改 vectorizeL0L1Nodes 的文本拼接**

在 `src/pageindex/book-indexer.ts` 中修改 `vectorizeL0L1Nodes()` 函数：

```typescript
// 修改前（约 line 540-545）:
for (const rootNode of parseResult.structure || []) {
  nodes.push({
    id: rootNode.nodeId || `L0-${nodes.length}`,
    text: `${rootNode.title}\n${rootNode.summary || ""}\n${rootNode.text || ""}`,
    level: "L0",
  });
  collectIndexLeafNodes(rootNode, nodes);
}

// 修改后:
for (const rootNode of parseResult.structure || []) {
  nodes.push({
    id: rootNode.nodeId || `L0-${nodes.length}`,
    text: `${rootNode.title}\n${rootNode.description || rootNode.summary || ""}`,
    level: "L0",
  });
  collectIndexLeafNodes(rootNode, nodes);
}
```

- [ ] **Step 2: 修改 collectIndexLeafNodes 的文本拼接**

同文件中 `collectIndexLeafNodes()` 函数（约 line 583-597）：

```typescript
// 修改前:
nodes.push({
  id: child.nodeId || `L1-${nodes.length}`,
  text: `${child.title}\n${child.summary || ""}\n${child.text || ""}`,
  level: "L1",
});

// 修改后:
nodes.push({
  id: child.nodeId || `L1-${nodes.length}`,
  text: `${child.title}\n${child.summary || ""}`,
  level: "L1",
});
```

注意：`buildBM25IndexFromParseResult()` 中的文本拼接**不改**，BM25 仍使用完整正文。

- [ ] **Step 3: Commit**

```bash
git add src/pageindex/book-indexer.ts
git commit -m "refactor: L0/L1 向量化内容瘦身，移除正文"
```

---

### Task 5: vectorizeL0L1Nodes 改用 JSONL 写入

**Files:**
- Modify: `src/pageindex/book-indexer.ts:519-556`

- [ ] **Step 1: 重写 vectorizeL0L1Nodes 使用 JSONL**

```typescript
async function vectorizeL0L1Nodes(
  parseResult: any,
  indexDir: string,
  embedding: any
): Promise<number | undefined> {
  const { generateEmbedding, generateEmbeddings, writeVectorJsonl } = await import("./vault/vectors.js");

  // Auto-detect dimensions from first embedding
  let dimensions = embedding.dimensions;
  if (!dimensions) {
    const testEmbedding = await generateEmbedding("test", embedding);
    dimensions = testEmbedding.length;
    piLog(`[vectorize] Auto-detected embedding dimensions: ${dimensions}`);
  }

  const nodes: Array<{ id: string; text: string; title: string; level: "L0" | "L1" }> = [];

  for (const rootNode of parseResult.structure || []) {
    nodes.push({
      id: rootNode.nodeId || `L0-${nodes.length}`,
      title: rootNode.title || "",
      text: `${rootNode.title}\n${rootNode.description || rootNode.summary || ""}`,
      level: "L0",
    });
    collectIndexLeafNodes(rootNode, nodes);
  }

  const texts = nodes.map((n) => n.text);
  const vectors = await generateEmbeddings(texts, embedding);

  // 写入 JSONL
  const records = nodes.map((n, i) => ({
    nodeId: n.id,
    title: n.title,
    level: n.level as "L0" | "L1",
    vector: vectors[i],
  }));

  const vectorPath = path.join(indexDir, "vectors.jsonl");
  await writeVectorJsonl(vectorPath, records);

  return dimensions;
}
```

- [ ] **Step 2: 运行构建验证**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/pageindex/book-indexer.ts
git commit -m "refactor: vectorizeL0L1Nodes 改用 JSONL 写入"
```

---

### Task 6: 索引完成后更新 catalog

**Files:**
- Modify: `src/pageindex/book-indexer.ts`

- [ ] **Step 1: 在 indexBook 完成向量化后更新 catalog**

在 `src/pageindex/book-indexer.ts` 的 `indexBook()` 函数中，向量化成功后的位置（约 line 336-346 附近，`vectorizationSuccess = true` 之后），添加 catalog 更新：

```typescript
// 在 vectorizationSuccess = true 赋值之后添加:
if (vectorizationSuccess && detectedDimensions) {
  const { updateCatalogEntry } = await import("./vault/vectors.js");
  await updateCatalogEntry(path.join(vaultPath, ".pageindex"), bookId, {
    title: bookMeta.title || path.basename(filePath),
    vectorModel: embedding.model || "text-embedding-3-small",
    dimensions: detectedDimensions,
    nodeCount: nodes.length,
    hasPropositions: false,
    indexedAt: new Date().toISOString(),
  });
}
```

注意：`nodes.length` 需要在 `vectorizeL0L1Nodes` 的作用域外可访问。最简方案：让 `vectorizeL0L1Nodes` 返回 `{ dimensions, nodeCount }` 而非仅 `dimensions`。修改返回类型：

```typescript
async function vectorizeL0L1Nodes(
  parseResult: any,
  indexDir: string,
  embedding: any
): Promise<{ dimensions: number; nodeCount: number } | undefined> {
  // ... 现有逻辑 ...
  return { dimensions, nodeCount: nodes.length };
}
```

调用处同步修改：

```typescript
const vectorizeResult = await vectorizeL0L1Nodes(parseResult, indexDir, options.embedding);
const detectedDimensions = vectorizeResult?.dimensions;
const nodeCount = vectorizeResult?.nodeCount || 0;
vectorizationSuccess = !!vectorizeResult;
```

- [ ] **Step 2: 在 deleteBookIndex 中移除 catalog 条目**

找到 `deleteBookIndex()` 函数，添加 catalog 清理：

```typescript
// 在实际删除文件的逻辑之后添加:
const { removeCatalogEntry } = await import("./vault/vectors.js");
await removeCatalogEntry(path.join(vaultPath, ".pageindex"), bookId);
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src/pageindex/book-indexer.ts
git commit -m "feat: 索引/删除时维护全局目录 catalog"
```

---

## Chunk 3: 搜索流程对接

### Task 7: asyncVectorSearch 改用 JSONL

**Files:**
- Modify: `src/pageindex/book-search-v2.ts:689-712`

- [ ] **Step 1: 修改 asyncVectorSearch**

```typescript
// 修改前:
async function asyncVectorSearch(
  indexDir: string,
  queryVector: number[],
  topK: number
): Promise<{ scores: Map<string, number>; vector: number[] | null }> {
  try {
    const vectorStore = await loadVectorStore(indexDir);
    if (!vectorStore || vectorStore.meta.count === 0) {
      return { scores: new Map(), vector: null };
    }
    const vectorResults = await cosineSearch(queryVector, vectorStore, topK);
    // ...
  }
}

// 修改后:
async function asyncVectorSearch(
  indexDir: string,
  queryVector: number[],
  topK: number
): Promise<{ scores: Map<string, number>; vector: number[] | null }> {
  try {
    const vectorPath = path.join(indexDir, "vectors.jsonl");
    const results = await cosineSearchJsonl(vectorPath, queryVector, topK);

    const scores = new Map<string, number>();
    for (const r of results) {
      scores.set(r.nodeId, r.score);
    }

    return { scores, vector: queryVector };
  } catch (error) {
    piLog(`[book-search-v2] Vector search failed: ${error}`);
    return { scores: new Map(), vector: null };
  }
}
```

同时更新文件顶部的 import：移除 `loadVectorStore` 和 `cosineSearch`，添加 `cosineSearchJsonl`。

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/pageindex/book-search-v2.ts
git commit -m "refactor: asyncVectorSearch 改用 JSONL 格式"
```

---

### Task 8: asyncPropositionSearch 改用 JSONL

**Files:**
- Modify: `src/pageindex/proposition-search.ts`
- Modify: `src/pageindex/proposition-indexer.ts`

- [ ] **Step 1: 修改 proposition-indexer.ts 的 vectorizeCards 使用 JSONL**

```typescript
// 修改 vectorizeCards 函数（约 line 466-512）
// 替换写入 prop_vectors.f32 + prop_vectors.meta.json 的逻辑为:

async function vectorizeCards(
  cards: PropositionCard[],
  indexDir: string,
  embedding: EmbeddingOptions
): Promise<void> {
  const texts = cards.map((c) => `${c.answer}\n${c.context}\n${c.tags.join(" ")}`);

  let dimensions = embedding.dimensions;
  if (!dimensions) {
    const testEmbedding = await generateEmbedding("test", embedding);
    dimensions = testEmbedding.length;
    piLog(`[proposition-indexer] Auto-detected dimensions: ${dimensions}`);
  }

  const allVectors = await generateEmbeddings(texts, embedding);

  // 写入 JSONL
  const records = cards.map((card, i) => ({
    cardId: card.id,
    vector: allVectors[i],
  }));

  const jsonlPath = path.join(indexDir, "prop-vectors.jsonl");
  const lines = records.map((r) => JSON.stringify(r));
  await fs.writeFile(jsonlPath, lines.join("\n") + "\n", "utf-8");

  piLog(`[proposition-indexer] Vectorized ${cards.length} cards to ${jsonlPath}`);
}
```

可移除 `buildPropVectorHeader` 函数和 `PROP_VECTOR_HEADER_SIZE` 常量。

- [ ] **Step 2: 修改 proposition-search.ts 的 loadPropVectorStore 使用 JSONL**

```typescript
// 替换 loadPropVectorStore 函数为:
export async function loadPropVectorStore(
  indexDir: string
): Promise<Map<string, number[]> | null> {
  const jsonlPath = path.join(indexDir, "prop-vectors.jsonl");

  try {
    const content = await fs.readFile(jsonlPath, "utf-8");
    const records = content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { cardId: string; vector: number[] });

    const map = new Map<string, number[]>();
    for (const r of records) {
      map.set(r.cardId, r.vector);
    }
    return map;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: 更新 book-search-v2.ts 中 asyncPropositionSearch 的调用方**

`asyncPropositionSearch()` 中现在 `loadPropVectorStore` 返回 `Map<string, number[]>` 而非 `{ vectors, meta }`。更新搜索逻辑：

```typescript
async function asyncPropositionSearch(
  indexDir: string,
  queryVector: number[],
  recallK: number
): Promise<Map<string, PropositionCard[]>> {
  const propositionMatches = new Map<string, PropositionCard[]>();

  try {
    const propositionsData = await loadPropositions(indexDir);
    const propVectors = await loadPropVectorStore(indexDir);

    if (!propositionsData || !propVectors || propositionsData.totalCards === 0) {
      return propositionMatches;
    }

    const queryFloat32 = new Float32Array(queryVector);
    const scores: Array<{ cardId: string; score: number }> = [];

    for (const [cardId, vector] of propVectors) {
      const score = cosineSimilarity(queryFloat32, new Float32Array(vector));
      scores.push({ cardId, score });
    }

    const topScores = scores.sort((a, b) => b.score - a.score).slice(0, recallK);

    for (const s of topScores) {
      const card = propositionsData.cards.find((c) => c.id === s.cardId);
      if (card && s.score > 0.3) {
        const nodeId = card.sourceNodeId;
        if (!propositionMatches.has(nodeId)) {
          propositionMatches.set(nodeId, []);
        }
        propositionMatches.get(nodeId)!.push({ ...card, matchScore: s.score });
      }
    }
  } catch (error) {
    piLog(`[book-search-v2] Proposition search failed: ${error}`);
  }

  return propositionMatches;
}
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/proposition-indexer.ts src/pageindex/proposition-search.ts src/pageindex/book-search-v2.ts
git commit -m "refactor: proposition 向量存储改用 JSONL 格式"
```

---

## Chunk 4: 旧格式迁移 + 清理

### Task 9: 索引时自动迁移旧格式

**Files:**
- Modify: `src/pageindex/book-indexer.ts`

- [ ] **Step 1: 在 indexBook 开头添加迁移检测**

在 `indexBook()` 函数中，`indexDir` 创建之后（约 line 100 附近），添加旧格式迁移：

```typescript
// 旧格式迁移：.f32 + .meta.json → .jsonl
await migrateOldVectorFormat(indexDir);
```

在文件末尾添加迁移函数：

```typescript
/**
 * Migrate old .f32 + .meta.json vector format to JSONL
 */
async function migrateOldVectorFormat(indexDir: string): Promise<void> {
  const oldVectorPath = path.join(indexDir, "vectors.f32");
  const oldMetaPath = path.join(indexDir, "vectors.meta.json");
  const newJsonlPath = path.join(indexDir, "vectors.jsonl");

  // Skip if new format exists or old format missing
  if (fsSync.existsSync(newJsonlPath)) return;
  if (!fsSync.existsSync(oldVectorPath) || !fsSync.existsSync(oldMetaPath)) return;

  try {
    const metaContent = fsSync.readFileSync(oldMetaPath, "utf-8");
    const meta = JSON.parse(metaContent) as {
      dimensions: number;
      slots: Record<string, { slotIndex: number; deleted: boolean }>;
    };

    const buffer = fsSync.readFileSync(oldVectorPath);
    const HEADER_SIZE = 24;
    const vectors = new Float32Array(buffer.buffer, HEADER_SIZE);

    const records: Array<{ nodeId: string; title: string; level: string; vector: number[] }> = [];

    for (const [nodeId, slot] of Object.entries(meta.slots)) {
      if (slot.deleted) continue;
      const offset = slot.slotIndex * meta.dimensions;
      const vector = Array.from(vectors.subarray(offset, offset + meta.dimensions));
      records.push({ nodeId, title: nodeId, level: "L1", vector });
    }

    const lines = records.map((r) => JSON.stringify(r));
    fsSync.writeFileSync(newJsonlPath, lines.join("\n") + "\n", "utf-8");

    // Delete old files
    fsSync.unlinkSync(oldVectorPath);
    fsSync.unlinkSync(oldMetaPath);

    piLog(`[book-indexer] Migrated ${records.length} vectors from .f32 to .jsonl`);
  } catch (error) {
    piLog(`[book-indexer] Vector migration failed: ${error}`);
  }
}
```

注意：需要在文件顶部添加 `import * as fsSync from "fs";`（如果还没有）。

- [ ] **Step 2: 同样迁移 proposition 向量**

添加 proposition 旧格式迁移（逻辑类似，针对 `prop_vectors.f32` + `prop_vectors.meta.json` → `prop-vectors.jsonl`）：

```typescript
async function migrateOldPropVectorFormat(indexDir: string): Promise<void> {
  const oldVectorPath = path.join(indexDir, "prop_vectors.f32");
  const oldMetaPath = path.join(indexDir, "prop_vectors.meta.json");
  const newJsonlPath = path.join(indexDir, "prop-vectors.jsonl");

  if (fsSync.existsSync(newJsonlPath)) return;
  if (!fsSync.existsSync(oldVectorPath) || !fsSync.existsSync(oldMetaPath)) return;

  try {
    const metaContent = fsSync.readFileSync(oldMetaPath, "utf-8");
    const meta = JSON.parse(metaContent) as {
      dimensions: number;
      slots: Record<string, { slotIndex: number; deleted: boolean }>;
    };

    const buffer = fsSync.readFileSync(oldVectorPath);
    const vectors = new Float32Array(buffer.buffer, 24);

    const records: Array<{ cardId: string; vector: number[] }> = [];

    for (const [cardId, slot] of Object.entries(meta.slots)) {
      if (slot.deleted) continue;
      const offset = slot.slotIndex * meta.dimensions;
      const vector = Array.from(vectors.subarray(offset, offset + meta.dimensions));
      records.push({ cardId, vector });
    }

    const lines = records.map((r) => JSON.stringify(r));
    fsSync.writeFileSync(newJsonlPath, lines.join("\n") + "\n", "utf-8");

    fsSync.unlinkSync(oldVectorPath);
    fsSync.unlinkSync(oldMetaPath);

    piLog(`[book-indexer] Migrated ${records.length} prop vectors from .f32 to .jsonl`);
  } catch (error) {
    piLog(`[book-indexer] Prop vector migration failed: ${error}`);
  }
}
```

在 `migrateOldVectorFormat` 调用后紧接着调用 `migrateOldPropVectorFormat(indexDir)`。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src/pageindex/book-indexer.ts
git commit -m "feat: 索引时自动迁移旧 .f32 向量格式到 JSONL"
```

---

### Task 10: 清理旧代码

**Files:**
- Modify: `src/pageindex/vault/vectors.ts`
- Modify: `src/pageindex/vault/types.ts`

- [ ] **Step 1: 移除 vectors.ts 中不再使用的旧函数**

移除以下函数（已被 JSONL 函数替代）：
- `initVectorStore()`
- `loadVectorStore()`
- `appendVector()`
- `updateVector()`
- `markVectorDeleted()`
- `getNodeVector()`
- `loadAllVectors()`
- `compactVectors()`
- `buildHeader()`
- `cosineSearch()`（旧版，已被 `cosineSearchJsonl` 替代）
- `VectorStore` interface

保留：`generateEmbedding`、`generateEmbeddings`、`generateOpenAIEmbedding`、`generateOllamaEmbedding`、`cosineSimilarity`（如在此文件中）。

- [ ] **Step 2: 移除 types.ts 中的 VectorIndexMeta**

移除 `VectorIndexMeta` interface（已被 `VectorRecord` 替代）。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 编译通过（可能需要修复其他文件中对旧函数的引用）

如果有其他文件仍引用被移除的函数，更新它们使用新的 JSONL 函数。

- [ ] **Step 4: 运行全量测试**

Run: `npm run test:run`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/vault/vectors.ts src/pageindex/vault/types.ts
git commit -m "refactor: 移除旧 .f32 向量存储代码"
```

---

## Chunk 5: 构建部署验证

### Task 11: 端到端验证

- [ ] **Step 1: 完整构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 2: 全量测试**

Run: `npm run test:run`
Expected: 全部通过

- [ ] **Step 3: 部署到测试 vault**

Run: `cp bin/main.js /Users/lizhao/workspace/deepreadertest/.obsidian/plugins/deepreader/ && cp bin/styles.css /Users/lizhao/workspace/deepreadertest/.obsidian/plugins/deepreader/`

- [ ] **Step 4: 在 Obsidian 中 Cmd+R 重载，测试索引一本书并验证搜索功能**

验证：
1. 索引一本新书，检查 `.pageindex/{bookId}/vectors.jsonl` 文件生成
2. 检查 `.pageindex/catalog.json` 更新
3. 搜索该书，确认结果正常
4. 如有旧的 `.f32` 格式书籍，触发重新索引，确认迁移成功
