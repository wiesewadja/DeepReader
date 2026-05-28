# SPEC: 书籍索引追踪日志

> 每次索引一本书时，自动生成一份详细的追踪记录文件，用于调试和性能分析。

---

## 1. Objective

在书籍索引过程中，自动收集每个步骤的**耗时、数据量、路径选择、LLM 调用统计**，写入本地文件。一本书一个文件。

**目标用户**：开发者（调试、性能分析、成本追踪）

**存放位置**：`.pageindex/traces/{exportName}.json`（`exportName` 是简化后的书名，如 "如何阅读一本书"）

**与现有进度系统的关系**：现有 `BookIndexProgress` 只做实时 UI 更新，trace 是独立的数据收集层，不替代也不影响进度回调。

---

## 2. 追踪内容

### 2.1 每步耗时

每个阶段记录开始时间、结束时间、耗时（毫秒）。

### 2.2 数据量统计

每个阶段的输入/输出量化指标（章节数、节点数、block ID 数、文件大小等）。

### 2.3 路径选择与降级

记录走了哪条路径、是否降级、降级原因。

### 2.4 LLM 调用统计

每个 LLM 调用的模型、prompt 摘要、token 用量（input/output）、耗时。

---

## 3. 数据结构

### 3.1 顶层结构

```typescript
interface IndexTrace {
  // 基本信息
  bookId: string;
  title: string;
  filePath: string;
  fileType: "pdf" | "epub";
  startedAt: string;          // ISO 8601
  completedAt?: string;       // ISO 8601
  totalDurationMs?: number;
  success: boolean;
  error?: string;

  // 配置快照
  config: {
    pageindexModel: string;
    embeddingProvider?: string;
    embeddingModel?: string;
    mineruUsed: boolean;
  };

  // 阶段记录
  phases: TracePhase[];

  // 路径选择
  pathDecisions: PathDecision[];

  // LLM 调用汇总
  llmSummary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
    byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
  };
}
```

### 3.2 阶段记录

```typescript
interface TracePhase {
  name: string;               // "parse_document" | "export_markdown" | ...
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  success: boolean;
  error?: string;

  // 数据量
  stats?: Record<string, number | string>;

  // 该阶段内的 LLM 调用
  llmCalls: LlmCallTrace[];
}
```

### 3.3 路径决策

```typescript
interface PathDecision {
  phase: string;              // 哪个阶段做的决策
  decision: string;           // "outline_fast_path" | "llm_toc" | "ocr_fallback" | ...
  reason: string;             // "outline >= 5 entries, 75% coverage" | "MinerU API timeout"
  degradedFrom?: string;      // 降级前的路径
}
```

### 3.4 LLM 调用追踪

```typescript
interface LlmCallTrace {
  phase: string;              // 所属阶段
  purpose: string;            // "generate_toc" | "verify_page" | "generate_summary" | ...
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  error?: string;
}
```

---

## 4. 各阶段追踪点

### Phase B: book-indexer.ts

| 阶段 | name | stats | 路径决策 | LLM purpose |
|------|------|-------|---------|-------------|
| B0 验证 | `validate` | `fileSizeBytes` | — | — |
| B1 解析 | `parse_document` | `chaptersCount`, `treeDepth`, `totalNodes`, `totalTokens` | `pdf_parse_path` / `epub_parse_path` | 透传 Phase C 的所有 LLM 调用 |
| B1.5 封面 | `save_cover` | `coverType: "image/png/text"` | — | — |
| B1.6 图片 | `download_images` | `imageCount`, `totalBytes` | — | — |
| B2 导出 | `export_markdown` | `filesExported`, `totalMdBytes`, `blockIdsCount`, `mocGenerated: boolean` | — | — |
| B3 元数据 | `build_meta` | `treeJsonBytes`, `metaVersion` | — | — |
| B4 向量化 | `vectorize` | `l0Count`, `l1Count`, `l2Count`, `totalVectors`, `dimensions` | `vectorize_path` / `vectorize_skipped` | `generate_embedding` (按批) |
| B5 BM25 | `build_bm25` | `totalDocs`, `vocabSize`, `avgDocLength`, `indexBytes` | — | — |
| B6 命题 | `extract_propositions` | `totalCards`, `cardsByType` | — | `extract_proposition` |

### Phase C: pageindex.ts (嵌套在 parse_document 阶段内)

| 阶段 | name | stats | 路径决策 | LLM purpose |
|------|------|-------|---------|-------------|
| C1 路径选择 | `pdf_path_selection` | — | `outline_fast_path` / `llm_toc` / `ocr_fallback` | — |
| C3.1 TOC 检测 | `detect_toc` | `tocPageCount`, `tocEntryCount`, `hasPageNumbers: boolean` | — | — |
| C3.2 结构提取 | `parse_structure` | `tocItemsExtracted` | `toc_with_pages` / `toc_no_pages` / `no_toc` | `generate_toc` |
| C3.3 TOC 验证 | `verify_toc` | `accuracy`, `correctCount`, `incorrectCount` | `verify_pass` / `degrade_retry` | `verify_page` |
| C3.4 树构建 | `build_tree` | `treeNodeCount`, `maxDepth`, `largeNodesSplit` | — | `split_large_node` |
| C3.5 摘要生成 | `generate_summaries` | `nodesSummarized`, `batchCount` | — | `generate_summary` |
| C3.6 文档描述 | `generate_description` | — | — | `generate_description` |

### 路径决策示例

```
# PDF — 书签快路径
{ phase: "parse_document", decision: "outline_fast_path",
  reason: "outline has 12 entries, covers 78% of 156 pages" }

# PDF — MinerU 失败降级 OCR
{ phase: "parse_document", decision: "ocr_fallback",
  reason: "MinerU API timeout after 30s",
  degradedFrom: "mineru_cloud" }

# PDF — TOC 降级链
{ phase: "verify_toc", decision: "degrade_retry",
  reason: "accuracy 42% < 60% threshold, retrying without page numbers",
  degradedFrom: "toc_with_pages" }

# EPUB
{ phase: "parse_document", decision: "epub_direct",
  reason: "EPUB has 24 chapters from spine" }

# 向量化跳过
{ phase: "vectorize", decision: "vectorize_skipped",
  reason: "embedding role not configured" }
```

---

## 5. 输出文件格式

### 5.1 文件位置

`.pageindex/traces/{exportName}.json`

`exportName` = `simplifyTitle(docName)`，与导出目录 `DeepReader/{exportName}/` 一致。

示例路径：`.pageindex/traces/如何阅读一本书.json`

### 5.2 写入时机

- 索引开始时创建文件（仅含基本信息 + startedAt），确保 `traces/` 目录存在
- 每个阶段完成后追加更新（fire-and-forget `fs.writeFile`）
- 索引完成时写入最终汇总
- 索引失败时也写入（success=false + error）

### 5.3 示例输出

```json
{
  "bookId": "a1b2c3d4",
  "title": "如何阅读一本书",
  "filePath": "/vault/books/如何阅读一本书.pdf",
  "fileType": "pdf",
  "startedAt": "2026-05-28T14:30:00.000Z",
  "completedAt": "2026-05-28T14:32:15.000Z",
  "totalDurationMs": 135000,
  "success": true,

  "config": {
    "pageindexModel": "mimo-v2.5",
    "embeddingProvider": "siliconflow",
    "embeddingModel": "Qwen/Qwen3-Embedding-0.6B",
    "mineruUsed": true
  },

  "pathDecisions": [
    {
      "phase": "parse_document",
      "decision": "llm_toc",
      "reason": "outline has 3 entries, below threshold of 5"
    },
    {
      "phase": "verify_toc",
      "decision": "degrade_retry",
      "reason": "accuracy 55% < 60%, retrying without page numbers",
      "degradedFrom": "toc_with_pages"
    },
    {
      "phase": "vectorize",
      "decision": "vectorize_complete",
      "reason": "embedding role configured: siliconflow/Qwen3-Embedding-0.6B"
    }
  ],

  "phases": [
    {
      "name": "validate",
      "startedAt": "2026-05-28T14:30:00.100Z",
      "completedAt": "2026-05-28T14:30:00.150Z",
      "durationMs": 50,
      "success": true,
      "stats": { "fileSizeBytes": 5242880 },
      "llmCalls": []
    },
    {
      "name": "parse_document",
      "startedAt": "2026-05-28T14:30:00.200Z",
      "completedAt": "2026-05-28T14:31:20.000Z",
      "durationMs": 79800,
      "success": true,
      "stats": {
        "chaptersCount": 21,
        "treeDepth": 3,
        "totalNodes": 45,
        "totalTokens": 85000
      },
      "llmCalls": [
        {
          "phase": "parse_structure",
          "purpose": "generate_toc",
          "model": "mimo-v2.5",
          "inputTokens": 12000,
          "outputTokens": 800,
          "durationMs": 3200
        },
        {
          "phase": "verify_toc",
          "purpose": "verify_page",
          "model": "mimo-v2.5",
          "inputTokens": 5000,
          "outputTokens": 200,
          "durationMs": 1500
        },
        {
          "phase": "generate_summaries",
          "purpose": "generate_summary",
          "model": "mimo-v2.5",
          "inputTokens": 40000,
          "outputTokens": 3000,
          "durationMs": 25000
        },
        {
          "phase": "generate_description",
          "purpose": "generate_description",
          "model": "mimo-v2.5",
          "inputTokens": 8000,
          "outputTokens": 100,
          "durationMs": 2000
        }
      ]
    },
    {
      "name": "export_markdown",
      "startedAt": "2026-05-28T14:31:20.100Z",
      "completedAt": "2026-05-28T14:31:25.000Z",
      "durationMs": 4900,
      "success": true,
      "stats": {
        "filesExported": 23,
        "totalMdBytes": 180000,
        "blockIdsCount": 156,
        "mocGenerated": true
      },
      "llmCalls": []
    },
    {
      "name": "vectorize",
      "startedAt": "2026-05-28T14:31:30.000Z",
      "completedAt": "2026-05-28T14:32:10.000Z",
      "durationMs": 40000,
      "success": true,
      "stats": {
        "l0Count": 1,
        "l1Count": 21,
        "l2Count": 120,
        "totalVectors": 142,
        "dimensions": 1024
      },
      "llmCalls": [
        {
          "phase": "vectorize",
          "purpose": "generate_embedding",
          "model": "Qwen/Qwen3-Embedding-0.6B",
          "inputTokens": 0,
          "outputTokens": 0,
          "durationMs": 38000
        }
      ]
    },
    {
      "name": "build_bm25",
      "startedAt": "2026-05-28T14:32:10.100Z",
      "completedAt": "2026-05-28T14:32:12.000Z",
      "durationMs": 1900,
      "success": true,
      "stats": {
        "totalDocs": 45,
        "vocabSize": 3200,
        "avgDocLength": 380,
        "indexBytes": 45000
      },
      "llmCalls": []
    }
  ],

  "llmSummary": {
    "totalCalls": 5,
    "totalInputTokens": 65000,
    "totalOutputTokens": 4100,
    "totalDurationMs": 29700,
    "byModel": {
      "mimo-v2.5": {
        "calls": 4,
        "inputTokens": 65000,
        "outputTokens": 4100
      },
      "Qwen/Qwen3-Embedding-0.6B": {
        "calls": 1,
        "inputTokens": 0,
        "outputTokens": 0
      }
    }
  }
}
```

---

## 6. 实现方案

### 6.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/pageindex/index-tracer.ts` | `IndexTracer` 类：阶段计时、LLM 调用记录、路径决策、JSON 序列化 |
| `src/config/features.ts` | 新增 `INDEX_TRACE_ENABLED = false` 编译时开关 |

### 6.2 IndexTracer 类设计

```typescript
export class IndexTracer {
  private trace: IndexTrace;
  private currentPhase: TracePhase | null = null;

  constructor(bookId: string, filePath: string, fileType: "pdf" | "epub", config: TraceConfig);

  // 阶段管理
  startPhase(name: string): void;            // 记录 startedAt，设为 currentPhase
  endPhase(stats?: Record<string, number | string>): void;  // 记录 completedAt, durationMs, success=true
  failPhase(error: string): void;            // 记录 success=false, error

  // LLM 调用（可在阶段外调用，自动归入 currentPhase）
  recordLlmCall(call: Omit<LlmCallTrace, "phase">): void;

  // 路径决策
  recordPathDecision(decision: PathDecision): void;

  // 持久化（fire-and-forget）
  save(): void;            // 写入 indexing-trace.json（阶段中追加）
  finalize(success: boolean, error?: string): void;  // 最终汇总写入
}
```

### 6.3 编译时开关

`src/config/features.ts`:
```typescript
/** 索引追踪日志（调试用，默认关闭。开启后每次索引生成 indexing-trace.json） */
export const INDEX_TRACE_ENABLED = false;
```

当 `INDEX_TRACE_ENABLED = false` 时，`IndexTracer` 的所有方法为空操作（通过条件导入或 `if (!INDEX_TRACE_ENABLED) return` 实现），零运行时开销。

### 6.4 接入点

在以下位置注入 `IndexTracer`：

**book-indexer.ts `indexBook()`**:
```typescript
// 创建 tracer
const tracer = new IndexTracer(bookId, filePath, fileType, { ... });

// B0
tracer.startPhase("validate");
// ... 文件验证 ...
tracer.endPhase({ fileSizeBytes });
tracer.save();

// B1
tracer.startPhase("parse_document");
// PageIndex 需要接收 tracer 或回调来记录内部的 LLM 调用
tracer.endPhase({ chaptersCount, totalNodes, totalTokens });
tracer.save();

// 最终
tracer.finalize(true);
```

**pageindex.ts（LLM 调用追踪）**:

两种接入方式（选一）：

| 方案 | 优点 | 缺点 |
|------|------|------|
| A: 通过 `onLlmCall` 回调 | 不侵入 PageIndex 内部 | PageIndex 需新增回调参数 |
| B: 在 `chatGPT()` 包装层统一记录 | 零侵入 PageIndex，全局自动捕获 | 无法区分 purpose，需从调用栈推断 |

**推荐方案 A**：在 `PageIndex` 构造参数中新增 `onLlmCall?: (call: LlmCallTrace) => void`，在 `core/toc.ts`、`core/tree.ts` 中的每次 LLM 调用处手动调用。

### 6.5 LLM 调用 hook 点

需要在以下位置调用 `onLlmCall`：

| 文件 | 函数 | purpose |
|------|------|---------|
| `core/toc.ts` | `generateTocInit()` / `generateTocContinue()` | `generate_toc` |
| `core/toc.ts` | `tocTransformer()` | `extract_page_numbers` |
| `core/tree.ts` | `processNoToc()` | `generate_structure` |
| `core/tree.ts` | `verifyToc()` | `verify_page` |
| `core/tree.ts` | `fixIncorrectToc()` | `fix_toc_entry` |
| `core/tree.ts` | `generateSummariesForStructure()` | `generate_summary` |
| `core/tree.ts` | `generateDocDescription()` | `generate_description` |
| `pageindex.ts` | `processLargeNodesRecursively()` | `split_large_node` |
| `book-indexer.ts` | `vectorizeAllLevels()` | `generate_embedding` |

---

## 7. Boundaries

### 必须做

- **编译时总开关**：`src/config/features.ts` 新增 `INDEX_TRACE_ENABLED = false`，默认关闭。开启后 trace 功能才编译进插件，关闭时 tracer 为空操作，零运行时开销
- tracer 的 `save()` 必须是 fire-and-forget（`fs.writeFile().catch(() => {})`），不阻塞主流程
- tracer 记录失败不影响索引流程
- 开关开启时每次 `indexBook()` 都生成 trace

### 需先确认

- LLM 调用的 token 统计：是否需要从 API 响应中提取 `usage` 字段？当前 `chatGPT()` 是否已返回 token 信息？
- embedding 调用是否计入 LLM 统计？（建议计入，但单独标记）

### 不要做

- 不添加 UI 界面展示 trace（纯文件，开发者直接读 JSON）
- 不修改现有的 `BookIndexProgress` 进度回调机制
- 不添加 trace 文件的自动清理逻辑

---

## 8. 验证方式

1. 索引一本 PDF → 检查 `.pageindex/traces/{书名}.json` 存在且结构完整
2. 索引一本 EPUB → 同上
3. 模拟 MinerU 失败 → 检查 pathDecisions 记录了 `ocr_fallback` 降级
4. 模拟 TOC 准确率 < 60% → 检查 pathDecisions 记录了 `degrade_retry`
5. 不配置 embedding 角色 → 检查 vectorize 阶段 stats 记录了 `vectorize_skipped`
6. 索引失败 → 检查 trace 文件 `success: false` + `error` 字段
