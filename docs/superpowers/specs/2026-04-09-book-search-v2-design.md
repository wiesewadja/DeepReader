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
Stage 8: 内容读取 + block_id 提取
  - 从 tree.json 的 nodeFileMap 定位 MD 文件
  - 读取文件内容，保留 ^block_id 标记
  - 提取所有 block_ids 列表
  - 构建层级路径（从 tree.json structure）
  - 截断：每个结果最多 8000 字
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

/** Book Search v2 输出 */
export interface BookSearchResultV2 {
  nodeId: string;
  title: string;
  summary: string;
  content: string;                  // 段落内容（保留 ^block_id 标记）
  blockIds: string[];               // 内容中所有 block_id
  mdFilePath: string;               // MD 文件相对路径
  hierarchyPath: string[];          // 层级路径 ["第1章", "概述"]
  score: number;
  bm25Score: number;
  vectorScore: number;
  level: "L0" | "L1";
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

### 2.5 内容读取 + block_id

```typescript
async function readContentWithBlockIds(
  nodeId: string,
  tree: TreeData,
  vaultPath: string,
  maxContentLength: number
): Promise<{ content: string; blockIds: string[]; mdFilePath: string; hierarchyPath: string[] }> {
  const fileName = tree.nodeFileMap[nodeId];
  if (!fileName) throw new Error(`nodeId ${nodeId} not found in nodeFileMap`);

  const bookName = tree.title;
  const mdFilePath = `DeepReader/${bookName}/${fileName}`;
  const fullPath = path.join(vaultPath, mdFilePath);

  let content = await fs.readFile(fullPath, "utf-8");
  // 移除 frontmatter
  content = content.replace(/^---[\s\S]*?---\n/, "");
  // 移除 callout、wiki links 等（保留 ^block_id）
  content = cleanContent(content);

  // 提取所有 block_ids
  const blockIds = [...content.matchAll(/\^([\w-]+)/g)].map(m => `^${m[1]}`);

  // 截断
  const truncated = content.length > maxContentLength;
  if (truncated) {
    content = content.slice(0, maxContentLength) + "\n... (truncated)";
  }

  // 构建层级路径
  const hierarchyPath = findHierarchyPath(nodeId, tree.structure);

  return { content, blockIds, mdFilePath, hierarchyPath };
}
```

## 第三部分：Agent 工具改造

### 3.1 get_document_outline

**文件**: `src/agent/tools/local/get-outline.ts`

从 tree.json 读取，不再扫描 MD 文件 frontmatter：

```typescript
async execute(args, context) {
  const tree = await loadTreeJson(context);
  const outline = treeToOutline(tree.structure, tree.title, args.max_depth);
  return JSON.stringify({ status: "SUCCESS", outline });
}
```

核心逻辑从 ~100 行降到 ~30 行。

### 3.2 search_markdown_text

**文件**: `src/agent/tools/local/search-text.ts`

调用 `searchBookV2()` 代替 `searchBook()`：

```typescript
const results = await searchBookV2({
  filePath,
  query: keywords.join(" "),
  topK: 5,
  embedding: context.plugin?.settings?.embedding,
  scopeNodeIds: scopeNodeIds,
  // reranker 和 treeSearch 暂不启用
});

const hits = results.map(r => ({
  node_id: r.nodeId,
  location: {
    heading: r.title,
    path: r.hierarchyPath,
    file_path: r.mdFilePath,
  },
  content: r.content.slice(0, 500),   // 500 字上下文
  block_ids: r.blockIds,
  score: r.score,
}));
```

移除 `extractFirstBlockId`、`use_regex` 参数、后置 scope 过滤。

### 3.3 read_markdown_section

**文件**: `src/agent/tools/local/read-section.ts`

查找逻辑改为从 tree.json：

```typescript
// node_id 查找
const fileName = tree.nodeFileMap[nodeId];
const filePath = `DeepReader/${bookName}/${fileName}`;

// heading 查找：遍历 tree.structure 找 title 匹配 → nodeId → nodeFileMap
```

移除 `normalizeNodeId`、frontmatter 扫描、`buildLocalCache` 的 frontmatter 依赖。

移除工具层 MAX_LENGTH=4000 硬限制。

### 3.4 LocalToolCache 重定义

**文件**: `src/agent/tools/local/types.ts`

```typescript
export interface LocalToolCache {
  /** tree.json 数据 */
  treeData?: TreeData;

  /** 从 tree.json structure 构建的 nodeId → title 映射 */
  nodeTitleMap?: Map<string, string>;

  /** block_id → nodeId 映射（扫描 MD 文件内容构建，一次性） */
  blockIdToNodeMap?: Map<string, string>;
}
```

不再需要 `chapterFiles`、`nodeIdIndex`、`headingIndex`。

### 3.5 utils.ts 简化

移除 `buildLocalCache()` 的 frontmatter 扫描逻辑，改为加载 `.pageindex/{bookId}/tree.json`。

移除 `normalizeNodeId()`。

保留 `normalizeHeading()` 和 `estimateTokens()`（其他地方仍使用）。

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
| `src/pageindex/book-search-v2.ts` | **新文件**: 8 阶段搜索管线 |
| `src/pageindex/book-search.ts` | 保留但标记 deprecated，工具层迁移到 v2 |
| `src/pageindex/book-types.ts` | 新增 BookSearchOptionsV2、BookSearchResultV2 |
| `src/pageindex/exporters/pdf-to-obsidian.ts` | tree.json 位置 + frontmatter 简化 |
| `src/pageindex/exporters/epub-to-obsidian.ts` | nodeId 统一 + tree.json 位置 + frontmatter 简化 |
| `src/agent/tools/local/search-text.ts` | 调用 searchBookV2、新返回格式 |
| `src/agent/tools/local/read-section.ts` | tree.json 查找、移除 normalizeNodeId |
| `src/agent/tools/local/get-outline.ts` | 从 tree.json 读取 |
| `src/agent/tools/local/utils.ts` | 简化：加载 tree.json 替代 frontmatter 扫描 |
| `src/agent/tools/local/types.ts` | LocalToolCache 重定义 |
| `src/agent/cognitive-engine/states/run-state-loop.ts` | MAX_TOOL_RESULT_LENGTH 4000→8000 |
| `src/agent/cognitive-engine/prompts/analytical-prompt.ts` | 移除 use_regex、添加 block_id 引导 |

## 验证标准

1. 索引后 BM25 覆盖所有 270 个 L1 叶节点（不是 1 个）
2. 搜索 "数据提取" 命中 `03 - 实际应用与用例` 而不是根节点
3. scope 过滤在 Stage 4 完成，scope 内结果不为空
4. 搜索结果返回完整的 `blockIds` 列表和 `hierarchyPath`
5. `read_markdown_section(node_id="0003")` 精确找到 `03 - 实际应用与用例.md`
6. EPUB 索引后 node_id 在 tree.json、BM25、frontmatter 三处一致
7. 长章节内容不再被双重截断
