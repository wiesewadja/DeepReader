# S3 主题阅读（Syntopical Reading）设计规范

## 概述

基于《如何阅读一本书》的主题阅读方法论，实现多书籍融合分析功能。

**核心特性**：
- 多书籍向量检索 + Proposition 检索
- 系统自动从 Vault 推荐相关书籍（top 3-5）
- LLM 融合分析，输出连贯文本（而非观点并列）
- 跨书 wiki 链接引用

---

## 1. 整体架构

### 1.1 Graph 结构变更

```
当前结构:
START → router → inspectional → analytical → formatter → END

变更后:
START → router → inspectional → [analytical | syntopical] → formatter → END
                              ↓
                    routeAfterInspectional:
                      depth=1 → formatter
                      depth=2 → analytical
                      depth=3 → syntopical  ← 新增
```

### 1.2 新增文件

| 文件 | 功能 |
|------|------|
| `src/agent/graph/nodes/syntopical.ts` | S3 节点实现 |
| `src/agent/utils/syntopical-search.ts` | 多书籍检索 |
| `src/agent/graph/prompts/syntopical-prompt.ts` | 融合分析 Prompt |

### 1.3 修改文件

| 文件 | 改动 |
|------|------|
| `src/agent/graph/index.ts` | 新增 syntopical 节点和边 |
| `src/agent/graph/edges.ts` | 新增 depth=3 路由判断 |
| `src/agent/graph/nodes/router.ts` | 删除 depth>=3 降级逻辑 |
| `src/agent/graph/state.ts` | 无需新增字段（输出结构与 S2 一致） |

---

## 2. S3 Syntopical 节点

### 2.1 输入/输出

```
输入:
  - state.rewrittenQuery: 用户问题（改写后）
  - state.suggestedKeywords: S1 提取的关键词（可选）
  - config.configurable.embedding: Embedding 配置
  - config.configurable.toolContext.app: Obsidian App 实例

输出:
  - analysisResult: 融合分析文本（带跨书 wiki 链接）
  - toolResultsSnapshot: 工具调用记录（用于 self-verification）
```

### 2.2 流程

```
S3 Syntopical Node:

1. 扫描 Vault
   ├── glob: vaultPath/.pageindex/*/book-meta.json
   ├── 提取所有 bookId + bookName
   └── 过滤: status === "complete"

2. 多书籍检索
   ├── 复用 embedding-cache.ts（避免重复 API 调用）
   ├── Promise.all(books.map(book => searchBookV2({ bookId, query, topK: 5 })))
   ├── Proposition 检索（可选）
   └── 合并结果，每本书 top 5，按 score 排序

3. 内容注入
   └── 检索结果格式化为 context 注入 LLM

4. LLM 融合分析
   ├── 建立共识词汇（统一术语）
   ├── 提取核心议题
   ├── 综合讨论（中立分析）
   └── 输出连贯文本（带跨书 wiki 链接）

5. Self-verification
   └── 调用 wiki-link-hook.ts 验证跨书链接
```

---

## 3. 多书籍检索（syntopical-search.ts）

### 3.1 接口定义

```typescript
interface SyntopicalSearchOptions {
  query: string;
  vaultPath: string;
  embedding?: EmbeddingOptions;
  maxBooks?: number;     // 默认 5
  topKPerBook?: number;  // 默认 5
}

interface SyntopicalSearchResult {
  bookId: string;
  bookName: string;
  results: BookSearchResultV2[];
  propositions?: PropositionCard[];
}
```

### 3.2 检索流程

```typescript
export async function syntopicalSearch(options: SyntopicalSearchOptions): Promise<SyntopicalSearchResult[]> {
  // 1. 扫描 Vault
  const bookMetas = await scanVaultForIndexedBooks(options.vaultPath);
  
  if (bookMetas.length === 0) {
    return [];
  }
  
  // 2. 复用 embedding 缓存
  const queryEmbedding = await getOrGenerateEmbedding(options.query, options.embedding);
  
  // 3. 并行检索
  const searchPromises = bookMetas.map(book => 
    searchBookV2({
      bookId: book.id,
      vaultPath: options.vaultPath,
      query: options.query,
      topK: options.topKPerBook,
      embedding: options.embedding,
    }).catch(() => [])  // 单书失败不阻断
  );
  
  const results = await Promise.all(searchPromises);
  
  // 4. 合并并排序
  const validResults = bookMetas
    .map((book, i) => ({
      bookId: book.id,
      bookName: book.name,
      results: results[i].filter(r => r.matchedBlocks.length > 0),
    }))
    .filter(r => r.results.length > 0)
    .sort((a, b) => {
      const maxScoreA = Math.max(...a.results.map(r => r.score));
      const maxScoreB = Math.max(...b.results.map(r => r.score));
      return maxScoreB - maxScoreA;
    })
    .slice(0, options.maxBooks);
  
  return validResults;
}
```

### 3.3 Vault 扫描

```typescript
async function scanVaultForIndexedBooks(vaultPath: string): Promise<{ id: string; name: string }[]> {
  const pageindexDir = path.join(vaultPath, '.pageindex');
  
  try {
    await fs.access(pageindexDir);
  } catch {
    return [];
  }
  
  const dirs = await fs.readdir(pageindexDir);
  const books: { id: string; name: string }[] = [];
  
  for (const bookId of dirs) {
    const metaPath = path.join(pageindexDir, bookId, 'book-meta.json');
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      if (meta.status === 'complete') {
        books.push({ id: bookId, name: meta.bookName || bookId });
      }
    } catch {
      continue;
    }
  }
  
  return books;
}
```

---

## 4. Graph 路由变更

### 4.1 Router 变更

```typescript
// src/agent/graph/nodes/router.ts

// 删除降级逻辑
// 原: const effectiveDepth = depth >= 3 ? 2 : depth;
// 新: const effectiveDepth = depth;

const depth = parsed?.depth ?? 2;
const effectiveDepth = depth;  // 不降级

log(`[S0 Router] depth=${effectiveDepth}, query="${standaloneQuery.slice(0, 50)}"`);
```

### 4.2 Edges 变更

```typescript
// src/agent/graph/edges.ts

export function routeAfterInspectional(state: CognitiveEngineState): string {
  if (state.depth === 3) {
    return 'syntopical';  // 新增
  }
  
  if (state.depth <= 1 && state.structuralAnalysis) {
    return 'done';
  }
  
  return 'continue';  // depth=2 → analytical
}
```

### 4.3 Graph 变更

```typescript
// src/agent/graph/index.ts

import { syntopicalNode } from './nodes/syntopical';

const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode('router', routerNode)
  .addNode('inspectional', inspectionalNode)
  .addNode('analytical', analyticalNode)
  .addNode('syntopical', syntopicalNode)  // 新增
  .addNode('formatter', formatterNode)
  .addEdge(START, 'router')
  .addConditionalEdges('router', routeByDepth, {
    formatter: 'formatter',
    inspectional: 'inspectional',
  })
  .addConditionalEdges('inspectional', routeAfterInspectional, {
    continue: 'analytical',
    syntopical: 'syntopical',  // 新增
    done: 'formatter',
  })
  .addEdge('analytical', 'formatter')
  .addEdge('syntopical', 'formatter')  // 新增
  .addEdge('formatter', END);
```

---

## 5. 触发机制（混合模式）

### 5.1 关键词预检

```typescript
// src/agent/graph/nodes/router.ts

const SYNTOPICAL_KEYWORDS = [
  '对比', '比较', '异同', '其他书', '联系起来',
  '不同文献', '另一本', '主题阅读', '跨书'
];

function hasSyntopicalKeywords(query: string): boolean {
  return SYNTOPICAL_KEYWORDS.some(kw => query.includes(kw));
}
```

### 5.2 混合判断逻辑

```typescript
// Router 节点内

const rawQuery = extractLastHumanMessage(state.messages);
const candidateSyntopical = hasSyntopicalKeywords(rawQuery);

// LLM 分类
const response = await fastModel.invoke([system, user], config);
const parsed = extractJSON(response.content);
const depth = parsed?.depth ?? 2;

// 最终判断
const effectiveDepth = (depth >= 3 || candidateSyntopical) ? 3 : depth;

// 限制: 只有 0-3
if (effectiveDepth > 3) effectiveDepth = 3;
```

---

## 6. S3 Prompt 设计

### 6.1 System Prompt

```typescript
export const PROMPT_S3_SYNTOPICAL = `
<role>
你是艾德勒学派的主题阅读分析师。执行主题阅读，综合多本书的观点。
</role>

<methodology>
1. 【共识词汇】先统一术语，确保不同作者讨论的是同一个概念
2. 【议题提取】找出核心问题，而非照搬章节标题
3. 【立场对比】每位作者对议题的立场（赞同/反对/补充/中立）
4. 【综合分析】中立呈现，不偏向任何作者，让读者自行判断
</methodology>

<workflow>
0. 优先利用注入的多书籍检索结果
1. 建立共识词汇表（如"财富"在各书中的定义是否一致）
2. 按议题组织内容，而非按书籍
3. 每个议题下综合讨论，引用多书观点
4. 输出连贯文本，wiki 链接格式正确
</workflow>

<output_rules>
1. 按议题展开，一议题一段
2. 每个观点标注来源书籍 [[书名/章节#^block_id|摘要]]
3. 争议点明确标注"《A》认为...，而《B》则主张..."
4. 不做评判，只做综合呈现
5. wiki 链接格式: [[{{书名}}/{{file_name}}#^{{block_id}}|自然语言别名]]
   - file_name 来自检索结果的 fileName 字段（含数字前缀）
   - block_id 来自 matchedBlocks.blockId（去掉 ^ 前缀）
</output_rules>
`;
```

### 6.2 User Message 构建

```typescript
export function buildSyntopicalUserMessage(
  query: string,
  searchResults: SyntopicalSearchResult[]
): string {
  const contextBlocks = searchResults.map(book => {
    const blocks = book.results.flatMap(r => 
      r.matchedBlocks.map(b => 
        `【${book.bookName}/${r.fileName}#^${b.blockId}】\n${b.content.slice(0, 500)}`
      )
    );
    return `<book name="${book.bookName}" bookId="${book.bookId}">\n${blocks.join('\n\n')}\n</book>`;
  });
  
  return `
以下是从 ${searchResults.length} 本书中检索到的相关内容：

${contextBlocks.join('\n\n')}

请基于以上内容，执行主题阅读分析，回答用户问题：${query}
`;
}
```

---

## 7. 错误处理

### 7.1 降级策略

| 场景 | 处理 |
|------|------|
| Vault 无 .pageindex 目录 | 返回空，LLM 输出提示"请先索引书籍" |
| 无已索引书籍（status !== "complete"） | 返回空，提示用户 |
| 只找到 1 本书有结果 | 降级到 S2 单书籍分析 |
| 所有书籍检索失败 | 降级到 S2 单书籍分析 |
| LLM 调用失败 | 返回检索结果摘要 + 提示用户自行判断 |

### 7.2 单书籍降级逻辑

```typescript
// src/agent/graph/nodes/syntopical.ts

const searchResults = await syntopicalSearch({ ... });

if (searchResults.length === 0) {
  log('[S3 Syntopical] 无已索引书籍，降级到提示');
  return {
    analysisResult: '未找到已索引的书籍。请先在 Library 中索引相关书籍。',
    toolResultsSnapshot: [],
  };
}

if (searchResults.length === 1) {
  log('[S3 Syntopical] 只找到 1 本书，降级到单书籍分析');
  // 降级到 analytical 模式（复用 S2 逻辑）
  return await runAnalyticalOnSingleBook(searchResults[0], query, config);
}
```

---

## 8. 数据流示例

```
用户输入: "《金钱心理学》和《纳瓦尔宝典》对财富的看法有什么不同？"

S0 Router:
  关键词预检: "看法有什么不同" → candidate_depth=3
  LLM 分类: depth=3
  最终: effectiveDepth=3
  rewrittenQuery: "财富的定义和获取方式"

S1 Inspectional:
  当前书籍: 金钱心理学
  suggestedKeywords: ["财富", "储蓄", "杠杆", "自由"]

S3 Syntopical:
  扫描 Vault: 发现 3 本已索引书籍
  检索结果:
    金钱心理学: 5 章节 + 3 命题卡片
    红瓦尔宝典: 5 章节 + 2 命题卡片
    思考快与慢: 2 章节（score 较低，丢弃）
  
  内容注入: 10 章节 + 5 命题卡片
  
  LLM 融合分析输出:
    "关于财富的理解，两本书有共识也有分歧。
    
    【定义层面】
    两书都认同财富不仅是金钱。[[金钱心理学/14#^p003|财富是隐形的，
    是你没消费的部分]]，而[[纳瓦尔宝典/财富#^n1|财富是自由，
    是拥有不做事的权利]]。本质上都指向"选择权"。
    
    【获取方式】
    [[金钱心理学/14#^p005|高储蓄率是财富积累的核心]]，
    而[[纳瓦尔宝典/杠杆#^n2|专长加杠杆才是财富杠杆]]。
    ..."

S4 Formatter:
  格式化输出
  Wiki 链接验证（跨书）
  输出给用户
```

---

## 9. 测试策略

### 9.1 单元测试

| 测试文件 | 测试内容 |
|----------|----------|
| `syntopical-search.test.ts` | Vault 扫描、并行检索、结果合并 |
| `router.test.ts` | depth=3 不降级、混合触发逻辑 |

### 9.2 E2E 测试场景

1. 多书籍检索成功 → 融合分析输出
2. 只找到 1 本书 → 降级到单书籍分析
3. 无已索引书籍 → 提示用户
4. 跨书 wiki 链接正确性

---

## 10. 性能考虑

| 问题 | 方案 |
|------|------|
| 多书籍并行检索延迟 | Promise.all 并行，每书 topK=5 |
| Embedding API 调用次数 | 复用 embedding-cache.ts，相同 query 只调用 1 次 |
| LLM context 过长 | 每书最多 5 章节 × 500 字 ≈ 2500 字，5 书 ≈ 12500 字 |
| Wiki 链接验证开销 | wiki-link-hook.ts 后处理，不影响 LLM 调用 |

---

## 11. 未来扩展

| 功能 | 说明 |
|------|------|
| S3 子图化 | 将 S3 分解为议题提取 → 立场收集 → 分析讨论子节点 |
| 主题卡片持久化 | 将融合分析结果保存为主题笔记 |
| 可视化比较矩阵 | 表格形式展示多书观点对比 |
| 用户指定书籍 | 支持用户明确指定比较的书籍列表 |