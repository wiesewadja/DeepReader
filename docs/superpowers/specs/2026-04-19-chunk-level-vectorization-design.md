# 段落级向量化 + 检索适配设计

> **Goal**: 将章节摘要级向量化替换为段落级向量化，提升搜索精度，并同步适配检索管线。

## 背景

当前向量化只存储章节摘要（title + summary），向量召回只能定位到章节级别，无法匹配具体段落。搜索时的段落定位依赖 `locateMatchedBlocks` 惰性生成段落向量，首次搜索慢且有缓存一致性问题。

三路召回中向量召回的价值最低（不如 BM25 命中具体段落，不如命题卡片定位知识点），根因是向量化粒度太粗。

## 设计

### 1. 存储层：统一 JSONL 三级向量

用一套 `vectors.jsonl` 替代现有的章节摘要向量和惰性段落向量缓存。

**三级结构**：

| Level | chunkId 格式 | 数量 | 内容 | 用途 |
|-------|-------------|------|------|------|
| L0 | `BOOK` | 1 | 书名 + 全书描述 | 跨书搜索 |
| L1 | `{nodeId}_summary` | ~27 | 章节标题 + 摘要 | 粗定位 |
| L2 | `{nodeId}_{blockId}` | ~数百 | 段落正文 | 精定位 |

**每条记录结构**：

```typescript
interface VectorRecord {
  chunkId: string;          // 唯一标识
  nodeId: string;           // 所属章节 nodeId（L0 为空字符串）
  blockIds: string[];       // 包含的 blockId 列表，不含 ^ 前缀（L0/L1 为空数组）
  type: "summary" | "heading" | "body" | "list" | "quote";
  level: "L0" | "L1" | "L2";
  vector: number[];
}
```

**blockId 格式规范**：统一去掉 `^` 前缀存储。例如原文中 `^p003` → 存储为 `p003`。搜索结果返回给前端时再拼回 `^p003` 用于 Obsidian 跳转。

### 2. Chunk 文本持久化

切分后的段落原文需要持久化，供搜索结果展示 matchedBlock content 使用。

方案：新增 `chunks.jsonl`，与 `vectors.jsonl` 同目录，每行一条：

```typescript
interface ChunkTextRecord {
  chunkId: string;
  nodeId: string;
  blockIds: string[];       // 包含的 blockId 列表（不含 ^ 前缀）
  text: string;             // 合并后的原文（去掉 ^blockId 标记）
  type: "summary" | "heading" | "body" | "list" | "quote";
}
```

与向量分离存储的原因：向量文件（数千维 float）已经很大，混合存储会进一步膨胀。分离后 `chunks.jsonl` 约为 200-300KB/书，搜索时按需加载到内存。

搜索流程中构建 `chunkTextMap`：

```typescript
// 搜索时一次性加载
const chunkTexts = await readChunkTexts(path.join(indexDir, "chunks.jsonl"));
const chunkTextMap = new Map(chunkTexts.map(c => [c.chunkId, c.text]));
```

### 3. 切分规则：段落合并到目标窗口

核心思路：不按单段落向量化，而是将连续段落合并到目标窗口（300-500 字），保证语义完整且数据量可控。

索引阶段，对每个章节的 `.md` 文件执行切分（新增 `chunker.ts`）：

1. 去掉 frontmatter 和 callout 摘要
2. 用 `splitByBlockIds` 按 `^pNNN` 标记切分为原始段落
3. **目标窗口合并**：按顺序将段落拼入当前 chunk，当累计字数 ≥ 300 字时结束当前 chunk、开始下一个
4. **长段落兜底**：如果单个段落 > 800 字，按句号/问号/感叹号在 800 字内切断；无句号则在逗号/分号处断开；都无则强制在 800 字处切断
5. **blockId 列表**：每个 chunk 记录包含的所有 blockId（用于搜索定位），如 `["p003", "p004", "p005"]`
6. **类型识别**：取 chunk 内首个非空段落的类型（以 `#` 开头 → heading，以 `>` 开头 → quote，以 `- ` 开头 → list，其余 → body）

**效果**：一本书约 ~100-150 个 chunk（而非 ~450 个段落），每个 chunk 300-500 字，包含 2-5 个连续段落，语义更完整。

**chunkId 生成**：`{nodeId}_{首个blockId}`，如 `0004_p003`。

### 4. 检索层：searchBookV2 适配

#### 向量召回改造

`cosineSearchJsonl` 增加过滤参数，只查 L2：

```typescript
// 新增参数
filter?: { level?: string }

// 返回类型扩展（从 VectorRecord 中透传 nodeId、blockIds）
Array<{ chunkId: string; nodeId: string; blockIds: string[]; score: number }>
```

职责边界：`cosineSearchJsonl` 只负责原始向量搜索并返回段落级结果，不做聚合。聚合到 nodeId 的逻辑由 `asyncVectorSearch` 承担。

#### asyncVectorSearch 改造

```typescript
async function asyncVectorSearch(
  indexDir: string,
  queryVector: number[],
  topK: number
): Promise<{
  scores: Map<string, number>;           // nodeId → max score
  chunkHits: Map<string, ChunkHit[]>;    // nodeId → 该章节命中的段落列表
  vector: number[] | null;
}>
```

聚合逻辑在 `asyncVectorSearch` 内部完成：
1. 调用 `cosineSearchJsonl` 获取段落级结果
2. 按 nodeId 聚合，每个 nodeId 取 max score
3. 同时保留每个 nodeId 下的 chunk 列表（blockId + score），供 Stage 8 使用

#### 分数融合改造

三路召回结果都通过 `nodeId` 聚合到章节级：

- 向量召回：一个章节下可能有多个段落命中，取 **max 分数**
- BM25 召回：章节级，不变
- 命题召回：卡片级，通过 `sourceNodeId` 关联章节，不变

权重保持现有值不变（向量精度提升但不应盲目提权，等实测数据再调）：

| 场景 | w_v | w_b | w_p |
|------|-----|-----|-----|
| 有向量 + 有命题 | 0.5 | 0.25 | 0.25 |
| 有向量 + 无命题 | 0.7 | 0.3 | 0 |
| 无向量 | 0 | 1.0 | 0 |

#### Stage 8 定位段落简化

L2 召回结果已包含 `blockId`，直接用作 matchedBlocks：

```typescript
// 变更后：从 asyncVectorSearch 返回的 chunkHits 中提取
const chunks = chunkHits.get(r.nodeId) || [];
matchedBlocks = chunks.map(c => ({
  blockIds: c.blockIds,    // ["p003", "p004", "p005"]
  content: chunkTextMap.get(c.chunkId) || "",
}));
```

不再需要 `locateMatchedBlocks` 的实时 embedding 和 `paragraph-vectors/` 缓存。

### 5. type 字段用途

`type` 字段（heading/body/list/quote）当前仅作为元数据标记，用于搜索结果的展示增强。未来可用于加权（heading 权重高于 body），但本期不实现加权逻辑。

### 6. 向后兼容与索引升级

**版本检测**：通过 `book-meta.json` 的 `version` 字段检测。当前版本为 2，新格式设为 3。

**升级策略**：检测到 version < 3 时，提示用户重新索引（不自动迁移，因为 L2 需要完整的 chunk embedding，代价等同全量重索引）。

**搜索降级**：如果 `vectors.jsonl` 中没有 L2 记录（旧格式），向量召回退化为 L1 摘要匹配，`matchedBlocks` 走现有的 BM25 token density 降级路径。

### 7. 删除的内容及关联影响

| 组件 | 文件 | 调用方 | 原因 |
|------|------|--------|------|
| `locateMatchedBlocks` | book-search-v2.ts | 仅 searchBookV2 Stage 8 内部调用 | L2 直接召回替代 |
| `scoreByVectorSimilarity` | book-search-v2.ts | 仅 locateMatchedBlocks 内部调用 | 不再需要搜索时 embedding |
| `scoreByTokenDensity` | book-search-v2.ts | 仅 locateMatchedBlocks 内部调用 | 被向量召回替代 |
| `splitByBlockIds` | book-search-v2.ts | locateMatchedBlocks + 测试 | 迁移到 chunker.ts，原处改为 import |
| `paragraph-vectors/` 缓存 | .pageindex/{bookId}/ | locateMatchedBlocks | 不再生成，旧目录在重新索引时清理 |
| `countTokenHits` | book-search-v2.ts | scoreByTokenDensity + 测试 | 无其他调用方，可删除 |

注意：`splitByBlockIds` 保留（迁移到 `chunker.ts`），因为索引阶段也需要用它切分。

### 8. 索引流程变更

`vectorizeL0L1Nodes` → 重命名为 `vectorizeAllLevels`，三步：

1. L0：全书摘要（1 条）
2. L1：遍历 structure，每个节点取 title + summary
3. L2：读取每个节点的 .md 文件，切分段落，批量 embedding，同时写入 `chunks.jsonl`

进度分配：

| 阶段 | 百分比 | 内容 |
|------|--------|------|
| 解析 | 0-5% | EPUB/PDF 解析 |
| 导出 | 5-70% | Markdown 导出 |
| 元数据 | 70-75% | tree.json, book-meta.json |
| L0+L1 向量化 | 75-78% | 书摘要 + 章节摘要 |
| L2 向量化 | 78-90% | 段落合并后的 chunk（进度回调：`向量化段落 50/120`）|
| BM25 | 90-95% | 关键词索引 |
| 命题 | 95-100% | 命题卡片 |

### 9. 性能估算

以《如何阅读一本书》为例（27 章节，~120 个 chunk）：

| Level | 条数 | Embedding 调用 | 预计耗时 |
|-------|------|----------------|----------|
| L0 | 1 | 1 次 | ~0.1s |
| L1 | 27 | 1 批 | ~0.5s |
| L2 | ~120 | 2 批 × 100 | ~3-5s |
| 命题卡片 | ~200 | 2 批 | ~2s |

总索引时间增加约 5s（L2 段落合并后 chunk 数约 120，远少于 450 个原始段落）。

存储增量：`vectors.jsonl` 约 500KB（120 × 4KB），`chunks.jsonl` 约 150KB。

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/pageindex/chunker.ts` | 新建 | splitByBlockIds + 短段合并 + 长段切分 + 类型识别 |
| `src/pageindex/vault/types.ts` | 修改 | VectorRecord 增加 chunkId/blockIds/type，level 扩展 L2 |
| `src/pageindex/vault/vectors.ts` | 修改 | cosineSearchJsonl 增加 filter + 返回 chunkId/nodeId/blockIds |
| `src/pageindex/book-indexer.ts` | 修改 | vectorizeAllLevels 三级向量化 + 写 chunks.jsonl |
| `src/pageindex/book-search-v2.ts` | 修改 | asyncVectorSearch 返回 chunkHits、Stage 8 简化 |
| `src/pageindex/book-search-v2.ts` | 删除 | locateMatchedBlocks、scoreByVectorSimilarity、scoreByTokenDensity、countTokenHits |
| `src/pageindex/book-types.ts` | 修改 | ChunkTextRecord 接口、book-meta version 3 |
