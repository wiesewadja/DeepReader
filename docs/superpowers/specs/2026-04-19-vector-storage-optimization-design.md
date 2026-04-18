# 向量化存储优化设计

## 目标

优化 PageIndex 的向量存储层：标准化存储格式、修正向量化粒度、支持跨书搜索。不引入新依赖，保持纯文件方案。

## 背景

当前向量存储存在三个问题：

1. **向量化内容过大**：L1 节点编码了 `title + summary + 完整正文`，单条向量压缩数千到上万 token 的文本，语义精度低且 embedding API 成本高
2. **存储格式自定义且脆弱**：`.f32` 二进制文件（24 字节头 + Float32 数组）与 `.meta.json`（slot 映射）分离存储，需要 compact 逻辑处理逻辑删除，两文件一致性难保证
3. **无跨书搜索能力**：每本书独立存储在 `.pageindex/{bookId}/` 下，搜索只能针对单本书

## 设计

### 改动一：向量化内容瘦身

**现状**：L0/L1 节点向量化 `title + summary + text`（含完整正文）

**改为**：
- **L0**（书级）：`书名 + 文档描述` — 全书的一句概括
- **L1**（章节级）：`章节标题 + 章节摘要` — 不含正文

正文匹配交给 BM25（关键词）和段落级向量（语义精细匹配）处理，各层各司其职。

**影响范围**：`book-indexer.ts` 的 `vectorizeL0L1Nodes()` 和 `collectIndexLeafNodes()`，以及 `buildBM25IndexFromParseResult()` 中 BM25 的文本拼接逻辑不变（BM25 仍使用完整正文）。

### 改动二：存储格式从 `.f32` + `.meta.json` 改为 JSONL

**现状**：`vectors.f32`（自定义二进制头 + Float32 连续数组）+ `vectors.meta.json`（slot 映射）

**改为**：每本书一个 `vectors.jsonl` 文件，每行一条 JSON 记录：

```jsonl
{"nodeId":"0001","title":"第一章 概述","level":"L1","vector":[0.123,-0.456,...]}
{"nodeId":"0002","title":"1.1 背景","level":"L1","vector":[0.789,...]}
```

好处：
- 单文件自包含，无 slot 映射/compact 复杂度
- 文本格式，可直接查看/调试
- 追加写入简单
- `title` 字段方便调试时快速识别节点

Proposition 向量同理改用 `prop-vectors.jsonl`。

**迁移**：索引时检测旧格式（`vectors.f32` + `vectors.meta.json`），自动迁移为新格式并删除旧文件。搜索时优先读新格式，fallback 读旧格式（兼容过渡期）。

### 改动三：全局目录 + 跨书搜索

新增 `.pageindex/catalog.json`：

```json
{
  "version": 1,
  "books": {
    "a1b2c3d4": {
      "title": "如何阅读一本书",
      "vectorModel": "text-embedding-3-small",
      "dimensions": 1536,
      "nodeCount": 20,
      "hasPropositions": true,
      "indexedAt": "2026-04-19T..."
    }
  }
}
```

**维护时机**：每次 `indexBook()` 完成或 `deleteBookIndex()` 时更新 catalog。

**跨书搜索流程**：
1. 读 `catalog.json` → 筛选同模型/维度的书
2. 按需加载各书的 `vectors.jsonl`
3. 逐书 cosine search，合并 topK

**单书搜索**：不变，直接读 `.pageindex/{bookId}/vectors.jsonl`。

### 不改的部分

- Embedding API 调用逻辑（`generateEmbeddings`、`generateEmbedding`）
- BM25 索引（`bm25.json`）及其文本拼接逻辑
- 搜索管线 8 阶段架构（`book-search-v2.ts`），只改向量加载/搜索部分
- 段落级向量缓存（`paragraph-vectors/`）
- Proposition 向量化内容（卡片本身已是精炼短文本，不需要瘦身）
- `EmbeddingOptions` 接口

## 文件变更

| 文件 | 变更 |
|------|------|
| `vault/vectors.ts` | 重写存储层：移除 `.f32` 逻辑，新增 JSONL 读写函数、全局目录操作、跨书搜索 |
| `vault/types.ts` | 新增 `VectorRecord`、`CatalogMeta` 类型；移除 `VectorIndexMeta` |
| `book-indexer.ts` | `vectorizeL0L1Nodes()` 文本拼接改为 `title + summary`；索引完成后更新 catalog |
| `book-search-v2.ts` | `asyncVectorSearch()` 改用新格式加载；新增跨书搜索入口 |
| `proposition-indexer.ts` | proposition 向量写入改用 `prop-vectors.jsonl` |
| `proposition-search.ts` | 加载改用新格式 |
| `core/types.ts` | 无变更 |

## 目录结构（改后）

```
{vaultPath}/.pageindex/
├── catalog.json                     # 全局目录（新增）
├── {bookId}/
│   ├── vectors.jsonl                # L0/L1 节点向量（替代 vectors.f32 + vectors.meta.json）
│   ├── prop-vectors.jsonl           # proposition 卡片向量（替代 prop_vectors.f32 + prop_vectors.meta.json）
│   ├── paragraph-vectors/           # 段落级向量缓存（不变）
│   ├── book-meta.json               # 书籍元数据（不变）
│   ├── tree.json                    # 文档树（不变）
│   ├── bm25.json                    # BM25 索引（不变）
│   └── propositions.json            # proposition 数据（不变）
```
