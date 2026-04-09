# Book Search v2 设计规范

## 问题

当前 book-search 管线存在三层根本性缺陷：

### 索引层：BM25 和向量索引基本无效
- `buildBM25IndexFromParseResult()` 只处理 `structure[0]`（Preface），忽略其余 31 个章节
- `structure` 是 32 元素扁平数组，代码错误地假设 `structure[0]` 是包含所有子节点的根
- 结果：BM25 只有 1 个 node，向量 count=0，混合搜索是空壳

### 检索层：缺少关键能力
- 无 scope 前置过滤（S1 圈定范围后在 BM25 阶段无效）
- 无层级加权（章节级和小节级同权）
- 无 LLM 树搜索（vault search 有但 book search 没有）
- 无 cross-encoder 重排（vault search 有但 book search 没有）
- 搜索粒度太粗（BM25 以 L1 节点为最小单位，无法定位段落）

### 工具层：数据链路断裂
- 搜索结果的 node_id 与 `read_markdown_section` 的 nodeIdIndex 不匹配
- 只返回第一个 block_id，与搜索命中的段落无关
- 三个工具（search/read/outline）各自维护独立索引
- 双重截断丢失 50-73% 内容

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据源 | `.pageindex/` 为唯一索引源 | 单一数据源消除不一致 |
| tree.json | 从 `DeepReader/` 移到 `.pageindex/{bookId}/` | 索引数据集中 |
| 搜索架构 | 8 阶段管线（对标 vault search） | 召回→过滤→重排→内容补充 |
| BM25 索引 | 覆盖所有 L1 叶节点 | 270 个小节作为独立文档 |
| block_id | 搜索结果返回完整内容含 block_ids，LLM 自行判断 | 精确引用靠信息完整 |
| 段落向量缓存 | 懒加载 + 磁盘持久化 | 避免重复搜索时重复计算 embedding |
| search 角色 | 携带段落内容（主力），减少 read 调用 | 节省 S2 的 5 次 tool call 预算 |
| 向后兼容 | 不兼容，version 升 2，重新索引 | 代码更干净 |

## 第一部分：索引重建

### 1.1 修复 BM25 索引构建

**文件**: `src/pageindex/book-indexer.ts`

**Bug**: `buildBM25IndexFromParseResult()` 只处理 `structure[0]`。

**修复**: 遍历整个 `structure` 数组的所有元素及其子节点：

```typescript
function buildBM25IndexFromParseResult(parseResult: any): BM25Data {
  const nodes: Array<{ id: string; text: string; level: "L0" | "L1" }> = [];

  for (const rootNode of parseResult.structure || []) {
    // 每个顶层元素作为 L0
    nodes.push({
      id: rootNode.nodeId || `L0-${nodes.length}`,
      text: `${rootNode.title}\n${rootNode.summary || ""}\n${rootNode.text || ""}`,
      level: "L0",
    });

    // 递归收集所有子节点作为 L1
    collectLeafNodes(rootNode, nodes);
  }

  return buildBM25Index(nodes);
}

function collectLeafNodes(
  node: any,
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): void {
  if (!node.nodes || node.nodes.length === 0) return;

  for (const child of node.nodes) {
    nodes.push({
      id: child.nodeId || `L1-${nodes.length}`,
      text: `${child.title}\n${child.summary || ""}\n${child.text || ""}`,
      level: "L1",
    });
    collectLeafNodes(child, nodes);
  }
}
```

同样修复 `buildBookMeta()` 和 `vectorizeL0L1Nodes()` 中的相同 bug。

### 1.2 tree.json 移到 .pageindex/

**文件**: `src/pageindex/exporters/pdf-to-obsidian.ts`, `src/pageindex/exporters/epub-to-obsidian.ts`

**变更**: tree.json 写入 `.pageindex/{bookId}/tree.json` 而非 `DeepReader/{bookName}/tree.json`。

### 1.3 book-meta.json v2

**文件**: `src/pageindex/book-indexer.ts`

简化为书籍级元信息，移除 `chapters[]`（章节信息由 tree.json 承载）：

```json
{
  "version": 2,
  "bookId": "7e8d5f20",
  "title": "...",
  "description": "...",
  "filePath": "...",
  "fileType": "pdf",
  "indexedAt": "...",
  "embedding": { "provider": "...", "model": "...", "dimensions": 1536 }
}
```

### 1.4 EPUB nodeId 统一

**文件**: `src/pageindex/exporters/epub-to-obsidian.ts:110`

```typescript
// 旧：独立编号
const nodeId = String(i + 1).padStart(4, "0");

// 新：使用解析树的 nodeId
const nodeId = chapterNode.nodeId || String(i + 1).padStart(4, "0");
```

### 1.5 段落向量缓存（paragraph-vectors）

**文件**: `src/pageindex/book-search-v2.ts`

Stage 8 对每个段落做 embedding 是主要延迟来源。将已计算的段落向量持久化到磁盘，后续搜索直接复用。

**存储结构**: `.pageindex/{bookId}/paragraph-vectors/`

```
.pageindex/7e8d5f20/
├── book-meta.json
├── tree.json
├── bm25.json
├── vectors.f32              # node 级向量（现有）
├── vectors.meta.json
└── paragraph-vectors/       # 新增：段落级向量缓存
    ├── meta.json            # { version, embeddingProvider, embeddingModel, totalParagraphs }
    ├── 0002.vecs            # node 0002 的段落向量（Float32 二进制）
    ├── 0003.vecs
    └── ...
```

**每个 `.vecs` 文件格式**:

```
[4 bytes: count] [4 bytes: dim] [count × dim × 4 bytes: vectors]
```

附带一个同名的 `.offsets.json` 文件，记录每个段落在原始 MD 文件中的位置：

```json
{
  "nodeId": "0003",
  "paragraphs": [
    { "blockId": "^s1-001", "text": "以下是几个实际应用...", "offset": 120, "length": 87 },
    { "blockId": "^s1-002", "text": "1. 信息处理工作流...", "offset": 230, "length": 156 }
  ]
}
```

**缓存策略**:

1. **懒加载**：首次搜索命中某个 node 时，检查 `.vecs` 文件是否存在
   - 存在且 embedding 配置匹配（provider + model + dimensions）→ 直接加载，跳过 embedding 调用
   - 不存在或配置不匹配 → 实时计算 embedding，写盘保存

2. **失效条件**：
   - `book-meta.json` 的 `embedding` 字段变更（model/dimensions 不同）
   - tree.json 的 `nodeFileMap` 对应文件修改时间变化
   - `meta.json` 中的 version 不匹配

3. **预热（可选）**：索引完成后，可选择性对所有 node 预计算段落 embedding。但这会增加索引时间和 API 成本（270 个 node × ~20 段落/node ≈ 5400 次 embedding），建议默认不预热，按需缓存。

**影响文件**:
- `src/pageindex/book-search-v2.ts` — Stage 8 加载/保存缓存逻辑
- 无需修改 book-indexer（缓存不在索引阶段生成）

## 第二部分：Book Search v2 管线

**文件**: `src/pageindex/book-search-v2.ts`（新文件）

8 阶段管线，每层可选，按条件退化：

```
输入: BookSearchOptions { filePath, query, topK, embedding, scopeNodeIds, reranker }
                                        │
                                        ▼
Stage 1: 动态召回量
  短查询(<5字) → recallK=50
  中查询(5-15字) → recallK=30
  长查询(>15字) → recallK=15
                                        │
                                        ▼
Stage 2: BM25 搜索
  - 加载 .pageindex/{bookId}/bm25.json
  - 如果有 scopeNodeIds，只搜索 scope 内的 node
  - 返回 topK*3 个候选
                                        │
                                        ▼
Stage 3: 向量语义搜索（可选）
  - 需要 embedding 配置
  - 加载 .pageindex/{bookId}/vectors.f32
  - cosineSearch(queryVector, store, recallK)
  - 如果无向量数据，跳过此阶段
                                        │
                                        ▼
Stage 4: Scope 过滤
  - 如果 scopeNodeIds 非空，过滤掉不在 scope 内的结果
  - 此阶段在分数融合前执行，避免浪费召回配额
                                        │
                                        ▼
Stage 5: 分数融合 + 层级加权
  - BM25 归一化到 [0,1]（min-max）
  - 融合：score = w_vector * vectorScore + w_bm25 * normalizedBM25
    - 有向量：w_vector=0.7, w_bm25=0.3
    - 无向量：w_bm25=1.0
  - 层级加权：
    - L0（全书级）：× 1.0
    - L1 章节级（有子节点）：× 0.7
    - L1 小节级（叶节点）：× 0.5
                                        │
                                        ▼
Stage 6: LLM 树搜索（可选）
  - 将 tree.json 的子树序列化
  - 发给 fast model，返回相关 nodeId 列表和分数
  - 权重：0.6 * treeScore + 0.4 * previousScore
                                        │
                                        ▼
Stage 7: Cross-encoder 重排（可选）
  - 需要 reranker 配置
  - 取 top 20 候选，送 cross-encoder
  - 权重：0.7 * rerankScore + 0.3 * previousScore
                                        │
                                        ▼
Stage 8: 匹配片段定位（聚焦到 block_id 级别）
  - BM25/向量命中 nodeId 后，读该 node 的 MD 文件
  - 按 ^block_id 标记分割为段落
  - 段落排序策略（双路径）：
    - 有 embedding 配置：对每个段落做 embedding，与 query vector 做 cosine 相似度排序
    - 无 embedding 配置：退化到 query token 命中密度排序
  - 取每个 node 内 top N 段落（~500 字/段），含内联 ^block_id 标记
  - search_book 不需要再调 read 就能提供精确的段落级内容
                                        │
                                        ▼
输出: BookSearchResultV2[]
```

### 2.1 新的类型定义

**文件**: `src/pageindex/book-types.ts`

```typescript
/** Book Search v2 输入 */
export interface BookSearchOptionsV2 {
  filePath: string;
  query: string;
  topK?: number;                    // 默认 5
  embedding?: EmbeddingOptions;     // 向量配置（可选）
  scopeNodeIds?: string[];          // S1 圈定的章节范围（可选）
  reranker?: RerankerOptions;       // 重排配置（可选）
  treeSearch?: boolean;             // 是否启用 LLM 树搜索
  llmClient?: any;                  // LLM 客户端（树搜索需要）
  maxContentLength?: number;        // 每个结果最大内容长度，默认 8000
}

/** 匹配片段（聚焦到 block_id 级别） */
export interface MatchedBlock {
  blockId: string;                  // 最近的 block_id
  content: string;                  // 片段内容（含 ^block_id 标记，~500 字）
}

/** Book Search v2 输出（聚焦到段落级） */
export interface BookSearchResultV2 {
  nodeId: string;
  title: string;
  hierarchyPath: string[];          // 层级路径 ["第1章", "概述"]
  matchedBlocks: MatchedBlock[];    // 该 node 内匹配的段落片段
  score: number;
  bm25Score: number;
  vectorScore: number;
}

/** Book Section 读取结果（read_book_section 返回，含完整内容） */
export interface BookSectionResult {
  nodeId: string;
  title: string;
  content: string;                  // 完整内容（^block_id 内联在段落末尾）
  wordCount: number;
  truncated: boolean;               // 是否超过 8000 字截断
  truncatedAt?: number;
}
```

### 2.2 Scope 前置过滤实现

在 BM25 搜索阶段，如果 `scopeNodeIds` 非空，只搜索 scope 内的 node：

```typescript
function searchBM25WithScope(
  query: string,
  bm25Index: BM25Data,
  topK: number,
  scopeNodeIds?: string[]
): Array<{ nodeId: string; score: number }> {
  const results = searchBM25(query, bm25Index, topK);

  if (!scopeNodeIds || scopeNodeIds.length === 0) {
    return results;
  }

  const scopeSet = new Set(scopeNodeIds);
  return results.filter(r => scopeSet.has(r.nodeId));
}
```

注意：`searchBM25` 本身仍然搜索全部 node（因为 BM25 的 IDF 需要全局文档频率），过滤在结果上做。但 topK 增大到 `topK * 5`（而不是 `topK * 3`），确保过滤后仍有足够结果。

### 2.3 层级加权

从 tree.json 的 structure 中计算每个 node 的深度：

```typescript
function computeLevelWeight(nodeId: string, structure: TreeNode[]): number {
  const node = findNodeInTree(nodeId, structure);
  if (!node) return 0.5;

  const hasChildren = node.nodes && node.nodes.length > 0;
  const depth = findDepth(nodeId, structure);

  if (depth === 0) return 1.0;    // L0 全书级
  if (hasChildren) return 0.7;    // L1 章节级（有子节点）
  return 0.5;                      // L1 小节级（叶节点）
}
```

### 2.4 LLM 树搜索

将 tree.json 的子树序列化为文本，发给 fast model 判断哪些节点与 query 相关：

```typescript
async function llmTreeSearch(
  query: string,
  structure: TreeNode[],
  llmClient: any
): Promise<Map<string, number>> {
  // 序列化树为文本（每个节点一行：nodeId | title | summary）
  const treeText = serializeTree(structure);

  // 调用 fast model
  const response = await llmClient.chat([
    { role: "system", content: TREE_SEARCH_PROMPT },
    { role: "user", content: `Query: ${query}\n\nTree:\n${treeText}` },
  ], [], { type: "json_object" });

  // 解析返回的 { relevant_nodes: [{ node_id, relevance }] }
  // 转为 Map<nodeId, score>
}
```

这是可选的。当 `treeSearch=true` 且有 llmClient 时才启用。代价是额外一次 fast model 调用。

### 2.5 匹配片段定位（双路径：向量优先 + token 退化）

命中 node 后，读 MD 文件，按 ^block_id 分割为段落，然后用段落级向量相似度排序。无 embedding 时退化到 token 密度。

**理论基础**：BM25/向量在 node 级完成了"哪一节相关"的判断（文档级检索）。Stage 8 在节内做段落级排序（passage retrieval），这是 IR 中标准的两阶段检索。段落级 embedding cosine similarity 比 token 计数能更好地捕捉语义相关性，尤其是自然语言查询（如"为什么链式调用更好"）的答案段落可能不包含 query 中的词汇。

```typescript
async function locateMatchedBlocks(
  nodeId: string,
  query: string,
  queryTokens: string[],
  tree: TreeData,
  vaultPath: string,
  options?: {
    embedding?: EmbeddingOptions;      // 有则走向量路径
    queryVector?: Float32Array;        // 复用 Stage 3 已计算的 query vector
    cacheDir?: string;                 // .pageindex/{bookId}/paragraph-vectors/
    maxBlocksPerNode?: number;         // 默认 3
    blockSize?: number;                // 默认 500
  }
): Promise<MatchedBlock[]> {
  const fileName = tree.nodeFileMap[nodeId];
  if (!fileName) return [];

  const fullPath = path.join(vaultPath, "DeepReader", tree.title, fileName);
  let content = await fs.readFile(fullPath, "utf-8");
  content = content.replace(/^---[\s\S]*?---\n/, "");  // 移除 frontmatter

  // 1. 将内容按 ^block_id 标记分割为段落
  const paragraphs = splitByBlockIds(content);

  if (paragraphs.length === 0) return [];

  // 2. 段落排序：双路径
  let scored: Array<{ blockId: string; text: string; start: number; end: number; score: number }>;

  if (options?.queryVector && options?.embedding) {
    // 路径 A：段落级向量相似度（优先，从缓存加载）
    scored = await scoreByVectorSimilarity(
      nodeId, paragraphs, options.queryVector, options.embedding, options.cacheDir || ""
    );
  } else {
    // 路径 B：退化到 token 密度排序
    scored = scoreByTokenDensity(paragraphs, queryTokens);
  }

  // 3. 取 top N 段落
  const maxBlocks = options?.maxBlocksPerNode ?? 3;
  const topMatches = scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxBlocks);

  // 4. 构建匹配片段（段落文本 + 前后扩展上下文）
  const blockSize = options?.blockSize ?? 500;
  return topMatches.map(m => ({
    blockId: m.blockId,
    content: expandToContext(m, paragraphs, blockSize),
  }));
}

/** 路径 A：段落级向量相似度（优先从缓存加载） */
async function scoreByVectorSimilarity(
  nodeId: string,
  paragraphs: Array<{ blockId: string; text: string; start: number; end: number }>,
  queryVector: Float32Array,
  embedding: EmbeddingOptions,
  cacheDir: string  // .pageindex/{bookId}/paragraph-vectors/
): Promise<Array<{ blockId: string; text: string; start: number; end: number; score: number }>> {
  // 1. 尝试从缓存加载
  let paragraphVectors = await loadParagraphVectors(nodeId, cacheDir, embedding);

  if (!paragraphVectors) {
    // 2. 缓存未命中：实时计算 embedding
    const texts = paragraphs.map(p => p.text);
    paragraphVectors = await batchEmbed(texts, embedding);

    // 3. 异步写盘（不阻塞搜索结果返回）
    saveParagraphVectors(nodeId, paragraphVectors, cacheDir, embedding).catch(() => {
      // 写盘失败不影响搜索，下次搜索时会重新计算
    });
  }

  // 4. 计算每个段落与 query 的相似度
  return paragraphs.map((p, i) => ({
    ...p,
    score: cosineSimilarity(queryVector, paragraphVectors[i]),
  }));
}

/** 从磁盘加载段落向量缓存 */
async function loadParagraphVectors(
  nodeId: string,
  cacheDir: string,
  embedding: EmbeddingOptions
): Promise<Float32Array[] | null> {
  const vecsPath = path.join(cacheDir, `${nodeId}.vecs`);
  const metaPath = path.join(cacheDir, `${nodeId}.offsets.json`);

  if (!fs.existsSync(vecsPath)) return null;

  // 校验 embedding 配置是否匹配
  const cacheMeta = JSON.parse(await fs.readFile(
    path.join(cacheDir, "meta.json"), "utf-8"
  ));
  if (cacheMeta.embeddingModel !== embedding.model ||
      cacheMeta.embeddingProvider !== embedding.provider) {
    return null;  // 配置变更，缓存失效
  }

  // 读取二进制向量
  const buf = await fs.readFile(vecsPath);
  const view = new DataView(buf.buffer);
  const count = view.getUint32(0, true);
  const dim = view.getUint32(4, true);

  const vectors: Float32Array[] = [];
  let offset = 8;
  for (let i = 0; i < count; i++) {
    const vec = new Float32Array(dim);
    for (let j = 0; j < dim; j++) {
      vec[j] = view.getFloat32(offset, true);
      offset += 4;
    }
    vectors.push(vec);
  }

  return vectors;
}

/** 路径 B：token 密度退化 */
function scoreByTokenDensity(
  paragraphs: Array<{ blockId: string; text: string; start: number; end: number }>,
  queryTokens: string[]
): Promise<Array<{ blockId: string; text: string; start: number; end: number; score: number }>> {
  return paragraphs.map(p => ({
    ...p,
    score: countTokenHits(p.text, queryTokens),
  }));
}
```

**辅助函数**：

```typescript
// 将内容按 ^block_id 分割为段落
function splitByBlockIds(content: string): Array<{ blockId: string; text: string; start: number; end: number }> {
  const paragraphs = [];
  const regex = /\^([\w-]+)/g;
  let lastEnd = 0;
  let lastBlockId = "";
  let match;

  while ((match = regex.exec(content)) !== null) {
    const blockId = `^${match[1]}`;
    const text = content.slice(lastEnd, match.index).trim();
    if (text) {
      paragraphs.push({ blockId: lastBlockId, text, start: lastEnd, end: match.index });
    }
    lastBlockId = blockId;
    lastEnd = match.index + match[0].length;
  }
  // 最后一段
  const remaining = content.slice(lastEnd).trim();
  if (remaining) {
    paragraphs.push({ blockId: lastBlockId, text: remaining, start: lastEnd, end: content.length });
  }

  return paragraphs;
}

// 计算段落内 query token 命中数
function countTokenHits(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  return tokens.reduce((count, token) => {
    let pos = 0;
    while ((pos = lower.indexOf(token.toLowerCase(), pos)) !== -1) {
      count++;
      pos += token.length;
    }
    return count;
  }, 0);
}

// 向量余弦相似度
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}
```

**性能优化**：`queryVector` 复用 Stage 3 已计算的结果，避免重复 embedding。段落 embedding 使用 `batchEmbed` 批量调用（OpenAI 支持单次请求嵌入多个文本），典型一个 node ~15-25 个段落，5 个命中 node ≈ 100 次段落 embedding，一次 batch API 调用完成。

**成本分析**：
- text-embedding-3-small：100 个段落 × ~200 token/段 ≈ 20K token → ~$0.003/次搜索
- 如果 embedding 调用失败或超时，自动退化到 token density 路径

**LLM 看到的 search_book 返回：**

```json
{
  "status": "SUCCESS",
  "total_hits": 5,
  "hits": [
    {
      "node_id": "0003",
      "title": "实际应用与用例",
      "path": ["第 1 章：提示词链", "实际应用与用例"],
      "matched_blocks": [
        {
          "block_id": "^s1-001",
          "content": "以下是几个实际应用和用例： ^s1-001\n\n1. 信息处理工作流：许多任务涉及通过多次转换处理原始信息。例如，总结文档、提取关键实体，然后使用 ^s1-002"
        },
        {
          "block_id": "^s1-005",
          "content": "3. 数据提取和转换：将非结构化文本转换为结构化格式通常通过迭代过程实现... ^s1-006\n・处理：检查是否提取了所有必需字段以及它们是否满足格式要求。 ^s1-007"
        }
      ],
      "score": 0.89
    }
  ]
}
```

每个 hit 的 matched_blocks 只有几百字，5 个 hit 总共约 3000-5000 字，完全在 8000 字限制内。LLM 直接看到内容 + block_id，大部分情况不需要再调 read。

## 第三部分：Agent 工具改造

### 设计决策：3 个工具 → 2 个工具

| 工具 | 决策 | 理由 |
|------|------|------|
| get_document_outline | **移除** | S1 直接读 tree.json，不需要经过工具注册表 |
| search_markdown_text | **升级为 search_book** | 主力工具，调用 book-search-v2，返回 content + 内联 block_id |
| read_markdown_section | **简化为 read_book_section** | 兜底工具，从 tree.json 查找文件，移除 frontmatter 依赖 |

### 3.1 移除 get_document_outline

**文件**: `src/agent/tools/local/get-outline.ts` — 删除

S1 (InspectionalState) 直接读 tree.json：

```typescript
// 旧: 通过工具注册表调用
const outlineResult = await this.getOutline(toolRegistry, toolContext);

// 新: 直接读 tree.json
const treeData = await loadTreeJson(bookId, vaultPath);
const treeText = formatTreeStructure(treeData.structure);
```

影响文件:
- `src/agent/tools/local/get-outline.ts` — 删除
- `src/agent/cognitive-engine/states/inspectional.ts` — 改为直接读 tree.json
- `src/agent/tools/index.ts` — 移除注册

### 3.2 search_book（原 search_markdown_text）

**文件**: `src/agent/tools/local/search-text.ts`

重命名为 `search_book`，调用 `searchBookV2()`：

```typescript
const SEARCH_BOOK_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_book',
    description: `在书中搜索关键词，返回匹配段落片段（聚焦到 block_id 级别）。

【搜索逻辑】
- 8 阶段管线：BM25 + 向量语义 + scope 过滤 + 层级加权
- 每个 hit 返回 node 内匹配最密集的段落片段（含 ^block_id）

【返回结果】
- matched_blocks: 匹配的段落片段，可直接引用 ^block_id
- 大部分情况无需再调 read_book_section

【中文搜索技巧】
- 提取核心名词，剔除"如何"、"是什么"等修饰语
- 拆分复合词：不要搜"解决问题的前提"，改用 ["解决问题", "前提"]`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组，AND 逻辑'
        },
        scope_node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '限定搜索范围（章节 ID 列表），留空则全局搜索'
        }
      },
      required: ['keywords']
    }
  }
};
```

执行逻辑（聚焦到 block_id 级别）：

```typescript
const results = await searchBookV2({
  filePath,
  query: keywords.join(" "),
  topK: 5,
  embedding: context.plugin?.settings?.embedding,
  scopeNodeIds: scopeNodeIds,
});

const hits = results.map(r => ({
  node_id: r.nodeId,
  title: r.title,
  path: r.hierarchyPath,
  matched_blocks: r.matchedBlocks,  // [{blockId, content}]
  score: r.score,
}));
```

变更点:
- 移除 `use_regex` 参数
- 移除 `extractFirstBlockId`
- 移除后置 scope 过滤
- scope 通过 `searchBookV2` 的 `scopeNodeIds` 参数前置处理
- **新增 Stage 8 匹配片段定位**：读 MD 文件，段落级向量相似度排序（有 embedding）或 token 密度退化（无 embedding），按 block_id 边界截取

SearchHit 类型更新：

```typescript
interface MatchedBlock {
  block_id: string;    // 最近的 block_id
  content: string;     // 片段内容（含 ^block_id 标记，~500 字）
}

interface SearchHit {
  node_id: string;
  title: string;
  path: string[];
  matched_blocks: MatchedBlock[];
  score: number;
}
```

### 3.3 read_book_section（批量读取）

**文件**: `src/agent/tools/local/read-section.ts`

**核心认知**: 所有段落级信息（包括 block_id）都来自 MD 文件内容，不从索引中获取。tree.json 只是路由表（nodeId → 哪个 MD 文件），真正的段落定位靠读文件。

**支持批量 node_ids**，一次调用读取多个章节：

```typescript
const READ_BOOK_SECTION_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_book_section',
    description: `读取指定章节的完整内容（含 ^block_id 标记）。

【推荐用法】先 search_book 获取 node_id 列表，再批量读取。
参数优先级: node_ids (批量) > node_id+block_id (精确定位) > heading`,
    parameters: {
      type: 'object',
      properties: {
        node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '批量读取多个章节（推荐，一次读取多个 node_id）'
        },
        node_id: {
          type: 'string',
          description: '单个章节 ID'
        },
        block_id: {
          type: 'string',
          description: '块引用 ID（如 ^s1-002），需配合 node_id 使用'
        },
        heading: {
          type: 'string',
          description: '标题名称（模糊匹配）'
        }
      },
      required: []
    }
  }
};
```

**LLM 典型工作流（2 次 tool call）：**

```
1. search_book(keywords=["提示词链", "信息处理"])
   → 5 个结果摘要，LLM 判断 0002、0003、0005 最相关

2. read_book_section(node_ids=["0002", "0003", "0005"])
   → 3 个章节完整内容（含 ^block_id），LLM 直接分析引用

剩余 3 次 tool call 预算给深度分析
```

**批量读取实现：**

```typescript
async function readMultipleSections(
  nodeIds: string[],
  tree: TreeData,
  vaultPath: string,
  bookName: string,
  maxPerSection: number  // 每章节最大 8000 字
): Promise<BookSectionResult[]> {
  const results: BookSectionResult[] = [];

  for (const nodeId of nodeIds) {
    const fileName = tree.nodeFileMap[nodeId];
    if (!fileName) continue;

    const fullPath = path.join(vaultPath, "DeepReader", bookName, fileName);
    let content = await fs.readFile(fullPath, "utf-8");
    content = content.replace(/^---[\s\S]*?---\n/, "");  // 移除 frontmatter
    content = cleanContent(content);                      // 保留 ^block_id

    const truncated = content.length > maxPerSection;
    if (truncated) {
      content = content.slice(0, maxPerSection) + "\n... (truncated)";
    }

    results.push({
      nodeId,
      title: findNodeTitle(nodeId, tree.structure),
      content,
      wordCount: content.length,
      truncated,
      truncatedAt: truncated ? maxPerSection : undefined,
    });
  }

  return results;
}
```

**单章节 + block_id 定位（保持现有逻辑）：**

```
输入: node_id="0003", block_id="^s1-002"
  1. nodeFileMap["0003"] → "03 - 实际应用与用例.md"
  2. 读文件内容
  3. 定位 ^s1-002 所在行
  4. 取该段落上下文（前后扩展）
  5. 返回内容（含 ^block_id 标记）
```

### 3.4 LocalToolCache 重定义

**文件**: `src/agent/tools/local/types.ts`

```typescript
export interface LocalToolCache {
  /** tree.json 数据（从 .pageindex/{bookId}/tree.json 加载） */
  treeData?: TreeData;

  /** 从 tree.json structure 构建的 nodeId → title 映射 */
  nodeTitleMap?: Map<string, string>;
}
```

不再需要 `chapterFiles`、`nodeIdIndex`、`headingIndex`（原来从 frontmatter 构建的索引）。
也不需要 `blockIdToNodeMap`（block_id 在 MD 文件内容中，通过 node_id 提示定位文件后在文件内查找）。

### 3.5 utils.ts 简化

**文件**: `src/agent/tools/local/utils.ts`

- `buildLocalCache()` 改为加载 `.pageindex/{bookId}/tree.json`
- 移除 `normalizeNodeId()`
- 移除 `extractChapterMetadata()`（不再读 frontmatter）
- 保留 `normalizeHeading()`、`estimateTokens()`、`parseSectionPath()`

### 3.6 S2 Analytical 工具列表更新

**文件**: `src/agent/cognitive-engine/states/analytical.ts`

```typescript
// 旧
readonly tools = ['search_markdown_text', 'read_markdown_section'];

// 新
readonly tools = ['search_book', 'read_book_section'];
```

### 3.7 ScopeInterceptor 工具名更新

**文件**: `src/agent/cognitive-engine/interceptor/scope-interceptor.ts`

```typescript
// 旧
if (toolName === 'search_markdown_text') {

// 新
if (toolName === 'search_book') {
```

## 第四部分：配套变更

### 4.1 截断策略

| 层 | 当前 | 改后 |
|----|------|------|
| book-search-v2 Stage 8 | 不存在 | 每个结果 8000 字 |
| read_markdown_section | MAX_LENGTH=4000 | 移除硬限制 |
| runStateLoop | MAX_TOOL_RESULT_LENGTH=4000 | 提升到 8000 |

### 4.2 S2 Analytical Prompt

**文件**: `src/agent/cognitive-engine/prompts/analytical-prompt.ts`

- 移除 `use_regex` 相关提示
- 添加：`搜索结果的 block_ids 列表包含该章节所有段落标记。根据精读内容选择最相关的 block_id 引用。`

### 4.3 MD frontmatter 简化

移除索引字段：`indexed`、`section_index`、`token_count`、`created`、`node_id`、`summary`、`source_file`。

保留用户可见字段：`title`、`source`、`type`、`tags`、`page_range`。

## 影响范围

| 文件 | 改动 |
|------|------|
| `src/pageindex/book-indexer.ts` | 修 BM25 bug、tree.json 位置、book-meta v2 |
| `src/pageindex/book-search-v2.ts` | **新文件**: 8 阶段搜索管线 + 段落向量缓存 |
| `src/pageindex/book-search.ts` | 保留但标记 deprecated |
| `src/pageindex/book-types.ts` | 新增 BookSearchOptionsV2、BookSearchResultV2 |
| `src/pageindex/exporters/pdf-to-obsidian.ts` | tree.json 位置 + frontmatter 简化 |
| `src/pageindex/exporters/epub-to-obsidian.ts` | nodeId 统一 + tree.json 位置 + frontmatter 简化 |
| `src/agent/tools/local/search-text.ts` | 重命名为 search_book，调用 searchBookV2 |
| `src/agent/tools/local/read-section.ts` | 简化为 read_book_section，从 tree.json 查找 |
| `src/agent/tools/local/get-outline.ts` | **删除**（S1 直接读 tree.json） |
| `src/agent/tools/local/utils.ts` | 简化：加载 tree.json 替代 frontmatter 扫描 |
| `src/agent/tools/local/types.ts` | LocalToolCache 重定义 |
| `src/agent/tools/index.ts` | 工具注册更新（移除 outline，重命名 search/read） |
| `src/agent/cognitive-engine/states/inspectional.ts` | 直接读 tree.json |
| `src/agent/cognitive-engine/states/analytical.ts` | 工具列表更新 |
| `src/agent/cognitive-engine/interceptor/scope-interceptor.ts` | 工具名更新 |
| `src/agent/cognitive-engine/states/run-state-loop.ts` | MAX_TOOL_RESULT_LENGTH 4000→8000 |
| `src/agent/cognitive-engine/prompts/analytical-prompt.ts` | 工具名更新 + 移除 use_regex |

## 验证标准

1. 索引后 BM25 覆盖所有 270 个 L1 叶节点（不是 1 个）
2. 搜索 "数据提取" 命中 `03 - 实际应用与用例` 而不是根节点
3. scope 过滤在 Stage 4 完成，scope 内结果不为空
4. 搜索结果返回完整的 `blockIds` 列表和 `hierarchyPath`
5. `read_markdown_section(node_id="0003")` 精确找到 `03 - 实际应用与用例.md`
6. EPUB 索引后 node_id 在 tree.json、BM25、frontmatter 三处一致
7. 长章节内容不再被双重截断
8. 首次搜索后 `.pageindex/{bookId}/paragraph-vectors/` 生成缓存文件，二次搜索相同 node 时跳过 embedding 调用
