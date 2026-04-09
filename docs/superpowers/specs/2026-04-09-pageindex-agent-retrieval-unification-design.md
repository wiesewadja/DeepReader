# PageIndex-Agent 检索统一设计

## 问题

PageIndex 索引数据和 Agent Cognitive Engine 的检索工具之间存在 5 个 CRITICAL 级别的断裂：

1. **数据源分裂**: 索引树在 `DeepReader/{bookName}/tree.json`，BM25/向量在 `.pageindex/`，frontmatter 元数据在 270 个 MD 文件中。三处互不通信。
2. **EPUB node_id 双轨编号**: book-indexer 用解析树 DFS 编号，EPUB exporter 用独立计数器。搜索结果传给 `read_markdown_section` 找不到。
3. **scope 过滤后置**: `searchBook()` 全局搜索 topK=5，之后再按 scope 过滤。~60% 概率返回 0 条结果。
4. **block_id 定位丢失**: 搜索结果只取第一个 block_id，与命中段落无关。LLM 无法精确引用。
5. **双重截断**: read_section 截 4000 字 + runStateLoop 截 4000 字，长章节丢失 50-73%。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据源方向 | Agent 工具全部基于 `.pageindex/` | 单一数据源，消除不一致 |
| tree.json 位置 | 从 `DeepReader/` 移到 `.pageindex/{bookId}/` | 索引数据集中管理 |
| book-meta.json | 简化为书籍级元信息，不含 chapters | chapters 信息由 tree.json 承载 |
| MD frontmatter | 移除索引字段 (node_id, section_index, summary) | 统一在 .pageindex/ |
| block_id 精度 | LLM 自行判断 | 返回完整 rawText 含 block_id，LLM 精读后标注 |
| 向后兼容 | 不兼容，需要重新索引 | 代码更干净 |
| 修复范围 | 5 个 CRITICAL + ISSUE-007 (架构) | 核心问题全覆盖 |

## 新的 `.pageindex/{bookId}/` 目录结构

```
.pageindex/7e8d5f20/
├── book-meta.json      # 书籍级元信息（v2，无 chapters）
├── tree.json           # 完整索引树（从 DeepReader/ 移入）
├── bm25.json           # BM25 索引（基于 tree.json 重建，覆盖所有 L1 叶节点）
├── vectors.f32         # 向量数据（不变）
└── vectors.meta.json   # 向量元数据（不变）
```

## 数据模型变更

### book-meta.json v2

```json
{
  "version": 2,
  "bookId": "7e8d5f20",
  "title": "agentic-design-patterns-chinese",
  "description": "...",
  "filePath": "/.../agentic-design-patterns-chinese.pdf",
  "fileType": "pdf",
  "indexedAt": "...",
  "embedding": { "provider": "openai", "model": "text-embedding-3-small", "dimensions": 1536 }
}
```

- 移除 `chapters[]`
- 移除 `book-meta.json` 中的 `author`（EPUB 的 author 移入 tree.json 根节点）
- `version` 升为 2，触发重新索引

### tree.json

保持现有结构不变，只改位置：

```json
{
  "title": "agentic-design-patterns-chinese",
  "docDescription": "...",
  "source": "/path/to/file.pdf",
  "nodeFileMap": {
    "0002": "02 - 提示词链模式概述.md",
    "0003": "03 - 实际应用与用例.md"
  },
  "structure": [
    {
      "title": "Preface",
      "nodeId": "0000",
      "summary": "...",
      "nodes": []
    },
    {
      "title": "第 1 章：提示词链",
      "nodeId": "0001",
      "summary": "...",
      "nodes": [
        { "title": "提示词链模式概述", "nodeId": "0002", "summary": "..." },
        { "title": "实际应用与用例", "nodeId": "0003", "summary": "..." }
      ]
    }
  ]
}
```

### bm25.json 重建

当前 BM25 只有 1 个根节点。重建后覆盖所有 L1 叶节点（270 个），每个节点独立作为 BM25 doc。搜索粒度从"整本书"细化为"每个小节"。

### MD frontmatter 简化

移除索引字段，只保留用户可见元数据：

```yaml
---
title: 提示词链模式概述
source: agentic-design-patterns-chinese
type: pdf
tags:
  - pdf
  - document
  - agentic-design-patterns-chinese
page_range: 11-12
---
```

移除: `indexed`, `section_index`, `token_count`, `created`, `node_id`, `summary`, `source_file`

## Agent 工具改造

### get_document_outline

**当前**: 运行时扫描 `DeepReader/{bookName}/*.md` 的 frontmatter，构建 OutlineNode[]。

**改后**: 读 `.pageindex/{bookId}/tree.json`，直接从 `structure` 构建 OutlineNode[]。

影响文件: `src/agent/tools/local/get-outline.ts`

### search_markdown_text

**当前问题**:
- scope 后置过滤
- 只返回第一个 block_id
- snippet 只有 150 字

**改造点**:
1. `searchBook()` 新增 `scopeNodeIds?: string[]` 参数，BM25 阶段前置过滤
2. 返回结果从 `BookSearchResult` 增加 `mdFilePath`（从 tree.json 的 nodeFileMap 获取）
3. snippet 扩大到包含更多 block_id 上下文（当前 150 → 建议 500 字）
4. 移除 `extractFirstBlockId`，改为 `extractAllBlockIds` 返回 rawText 中所有 block_id 列表

返回格式调整：

```json
{
  "status": "SUCCESS",
  "total_hits": 5,
  "returned_hits": 3,
  "distribution_map": { ... },
  "hits": [
    {
      "node_id": "0003",
      "location": {
        "heading": "实际应用与用例",
        "path": ["第 1 章：提示词链", "实际应用与用例"],
        "file_path": "DeepReader/agentic-design-patterns-chinese/03 - 实际应用与用例.md"
      },
      "snippet": "...（500字，保留 ^block_id 标记）...",
      "block_ids": ["^s1-001", "^s1-002", "^s1-003"]
    }
  ],
  "scope_filter": "已限定在 2 个章节"
}
```

影响文件:
- `src/agent/tools/local/search-text.ts`
- `src/pageindex/book-search.ts`
- `src/pageindex/book-types.ts` (BookSearchOptions 增加 scopeNodeIds)

### read_markdown_section

**当前问题**:
- 运行时扫描 frontmatter 构建 nodeIdIndex / headingIndex
- `normalizeNodeId` 去前导零的 hack
- 依赖 frontmatter 的 `node_id` 和 `section` 字段

**改造点**:
1. nodeIdIndex 改为从 `.pageindex/{bookId}/tree.json` 的 `nodeFileMap` 构建
2. headingIndex 改为从 `tree.json` 的 `structure` 遍历构建
3. 移除 `normalizeNodeId` hack，直接用 nodeId 精确匹配
4. 返回内容保留完整的 `^block_id` 标记，方便 LLM 引用
5. 移除工具层 4000 字硬限制，改为动态上限（由 runStateLoop 兜底）

查找逻辑简化：

```typescript
// 旧: 从 frontmatter nodeIdIndex 查找
const normalizedId = normalizeNodeId(nodeId);
const filePath = nodeIdIndex.get(normalizedId);

// 新: 从 tree.json nodeFileMap 查找
const fileName = tree.nodeFileMap[nodeId];
const filePath = `DeepReader/${bookName}/${fileName}`;
```

影响文件:
- `src/agent/tools/local/read-section.ts`
- `src/agent/tools/local/utils.ts`

### ScopeInterceptor

保持不变。它注入 `scope_node_ids` 到 search_text 参数中，searchBook 内部处理过滤。

## book-indexer.ts 改造

### 索引流程调整

1. **tree.json 写入位置**: 从 `DeepReader/{bookName}/` 改为 `.pageindex/{bookId}/`
2. **BM25 重建**: `buildBM25IndexFromParseResult()` 改为遍历所有 L1 叶节点，不再只取根和一级子节点
3. **book-meta.json v2**: 不再填充 `chapters[]`，移除 `embedding` 字段中的冗余信息
4. **nodeId 一致性**: 确保 PDF 和 EPUB exporter 的 node_id 都来自解析树的 `node.nodeId`

### EPUB exporter 修复

`epub-to-obsidian.ts:110` 改为使用解析树的 `node.nodeId`，不再独立编号：

```typescript
// 旧
const nodeId = String(i + 1).padStart(4, "0");

// 新
const nodeId = chapterNode.nodeId || String(i + 1).padStart(4, "0");
```

## 截断策略调整

| 层 | 当前 | 改后 |
|----|------|------|
| read_markdown_section | MAX_LENGTH = 4000 硬限制 | 移除硬限制，返回完整内容 |
| runStateLoop | MAX_TOOL_RESULT_LENGTH = 4000 | 提升到 8000，附带 `[已省略 N 字符]` 提示 |

LLM 看到截断提示后，可以再调用 `read_markdown_section` 读取其他段落。

## S2 Analytical Prompt 微调

`analytical-prompt.ts` 的 `<output_rules>` 已要求 block_id 引用。需增加：

```
3. 搜索结果的 block_ids 列表包含该章节所有段落标记。请根据你精读的内容，选择最相关的 block_id 引用。
```

同时移除 `use_regex` 相关提示（因为该参数未实现）。

## 影响范围总结

| 文件 | 改动类型 |
|------|----------|
| `src/pageindex/book-indexer.ts` | 重构：tree.json 位置、BM25 重建逻辑、book-meta v2 |
| `src/pageindex/book-search.ts` | 重构：增加 scopeNodeIds 参数、利用 tree.json |
| `src/pageindex/book-types.ts` | 修改：BookSearchOptions 增加 scopeNodeIds |
| `src/pageindex/exporters/pdf-to-obsidian.ts` | 修改：tree.json 写入新位置、frontmatter 简化 |
| `src/pageindex/exporters/epub-to-obsidian.ts` | 修改：使用解析树 nodeId、tree.json 写入新位置 |
| `src/pageindex/bm25.ts` | 不变 |
| `src/agent/tools/local/search-text.ts` | 重构：scope 前置、block_id 列表、snippet 扩大 |
| `src/agent/tools/local/read-section.ts` | 重构：从 tree.json 查找、移除 normalizeNodeId |
| `src/agent/tools/local/get-outline.ts` | 重构：从 tree.json 读取 |
| `src/agent/tools/local/utils.ts` | 简化：移除 buildLocalCache 的 frontmatter 扫描 |
| `src/agent/cognitive-engine/states/run-state-loop.ts` | 修改：MAX_TOOL_RESULT_LENGTH 4000→8000 |
| `src/agent/cognitive-engine/prompts/analytical-prompt.ts` | 微调：移除 use_regex 提示 |

## 不变的文件

- `bm25.ts`: BM25 算法本身不变，只是输入数据变多
- `vault/vectors.ts`: 向量存储格式不变
- `cognitive-engine/states/router.ts`: 路由逻辑不变
- `cognitive-engine/states/inspectional.ts`: S1 逻辑不变（已通过 get_outline 间接受益）
- `cognitive-engine/states/formatter.ts`: S4 格式化不变
- `cognitive-engine/interceptor/scope-interceptor.ts`: 不变

## 验证标准

1. EPUB 索引后，`searchBook()` 返回的 nodeId 能通过 `read_markdown_section(node_id=...)` 精确定位
2. scope 过滤在 BM25 阶段完成，搜索结果不再需要后置过滤
3. LLM 回复中的 `[[书名/章节#^block_id|别名]]` 引用的 block_id 与实际引用的段落一致
4. 长章节（>4000 字）不再被双重截断
5. 重新索引后，`.pageindex/` 包含完整的 tree.json + bm25.json
