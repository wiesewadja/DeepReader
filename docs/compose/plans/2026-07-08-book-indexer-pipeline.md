# book-indexer Pipeline 拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 book-indexer.ts 的 indexBook() 函数（670 行）拆分为 Pipeline Step 模式，每个 Step 可独立测试。

**Architecture:** 引入 PipelineContext 和 PipelineStep 接口，将 indexBook() 拆分为 11 个 Step。Pipeline 执行器负责串联 Step、进度报告、错误处理。

**Tech Stack:** TypeScript, Vitest

## Global Constraints

- 不使用前端框架，全部原生 DOM API
- 所有 Vault 文件操作通过 `app.vault.adapter` 或 `app.vault` API
- 统一日志使用 `src/utils/logger.ts`
- 业务代码禁止静态 `import` Node 核心模块
- 测试必须分模块执行，先评估影响范围

## 当前状态分析

| 文件 | 行数 | 职责 |
|------|------|------|
| book-indexer.ts | 1334 | indexBook() 670 行单体函数 |

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/pageindex/book-indexer/pipeline-types.ts` | PipelineContext/PipelineStep 接口 | 创建 |
| `src/pageindex/book-indexer/steps/validate.ts` | Step 1: 文件验证 | 创建 |
| `src/pageindex/book-indexer/steps/parse.ts` | Step 2: 文档解析 | 创建 |
| `src/pageindex/book-indexer/steps/cover.ts` | Step 3: 封面提取 | 创建 |
| `src/pageindex/book-indexer/steps/export.ts` | Step 4: Markdown 导出 | 创建 |
| `src/pageindex/book-indexer/steps/metadata.ts` | Step 5: 元数据构建 | 创建 |
| `src/pageindex/book-indexer/steps/vectorize.ts` | Step 6: 向量化 | 创建 |
| `src/pageindex/book-indexer/steps/bm25.ts` | Step 7: BM25 索引 | 创建 |
| `src/pageindex/book-indexer/steps/propositions.ts` | Step 8: 命题提取 | 创建 |
| `src/pageindex/book-indexer/steps/finalize.ts` | Step 9: 完成收尾 | 创建 |
| `src/pageindex/book-indexer/executor.ts` | Pipeline 执行器 | 创建 |
| `src/pageindex/book-indexer.ts` | 瘦身后的入口 | 修改 |

---

## Task 1: 创建 Pipeline 类型定义

**Covers:** Pipeline 接口设计

**Files:**
- Create: `src/pageindex/book-indexer/pipeline-types.ts`

**Interfaces:**
- Consumes: 无
- Produces: PipelineContext, PipelineStep 接口

- [ ] **Step 1: 创建 pipeline-types.ts**

```typescript
/**
 * Pipeline 类型定义
 *
 * 用于 book-indexer 的 Step 模式拆分。
 */

import type { IndexListItem } from "../../types/index.js";

export interface PipelineContext {
  // 基础信息
  bookId: string;
  indexDir: string;
  deepReaderDir: string;
  bookDir: string;
  exportName: string;
  rootTitle: string;

  // 输入
  filePath: string;
  fileType: "pdf" | "epub";
  options: BookIndexOptions;

  // 中间结果（逐步填充）
  parseResult?: any;
  treeData?: any;
  bookMeta?: any;
  coverRelPath?: string;
  quality?: "good" | "degraded" | "poor";
  qualityReason?: string;
  nodeFileMap?: Map<string, string>;
  embeddings?: any[];

  // 追踪
  tracer: any;
  reportProgress: (progress: ProgressInfo) => void;
  plugin?: any;
  app?: any;
}

export interface PipelineStep {
  name: string;
  execute(ctx: PipelineContext): Promise<void>;
}

export interface ProgressInfo {
  percent: number;
  step: string;
  stepLabel: string;
  message?: string;
}

export interface BookIndexOptions {
  filePath: string;
  fileType: "pdf" | "epub";
  forceReindex?: boolean;
  propositions?: boolean;
  // ... 其他选项
}

export interface BookIndexResult {
  bookId: string;
  title: string;
  quality: "good" | "degraded" | "poor";
  qualityReason?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pageindex/book-indexer/pipeline-types.ts
git commit -m "feat(pageindex): add pipeline types for book-indexer decomposition"
```

---

## Task 2: 创建 ValidateStep

**Covers:** Step 1: 文件验证

**Files:**
- Create: `src/pageindex/book-indexer/steps/validate.ts`

**Interfaces:**
- Consumes: PipelineContext
- Produces: 填充 bookId, indexDir, deepReaderDir, bookDir, exportName, rootTitle

- [ ] **Step 1: 创建 validate.ts**

从 book-indexer.ts 提取验证逻辑（约 70 行）：
- 文件存在性检查
- bookId 生成
- 目录创建
- tracer 初始化
- 状态文件初始化

- [ ] **Step 2: Commit**

---

## Task 3: 创建 ParseStep

**Covers:** Step 2: 文档解析

**Files:**
- Create: `src/pageindex/book-indexer/steps/parse.ts`

**Interfaces:**
- Consumes: PipelineContext (filePath, fileType)
- Produces: 填充 parseResult

- [ ] **Step 1: 创建 parse.ts**

从 book-indexer.ts 提取解析逻辑（约 100 行）：
- 创建 PageIndex 实例
- 调用 fromPdf() 或 fromEpub()
- 记录解析路径决策

- [ ] **Step 2: Commit**

---

## Task 4: 创建 CoverStep

**Covers:** Step 3: 封面提取

**Files:**
- Create: `src/pageindex/book-indexer/steps/cover.ts`

**Interfaces:**
- Consumes: PipelineContext (parseResult, exportName)
- Produces: 填充 coverRelPath

- [ ] **Step 1: 创建 cover.ts**

从 book-indexer.ts 提取封面逻辑（约 50 行）：
- 处理 4 种封面情况（EPUB 早期封面、提取的封面、PDF 首页 PNG、文本 SVG）

- [ ] **Step 2: Commit**

---

## Task 5: 创建 ExportStep

**Covers:** Step 4: Markdown 导出

**Files:**
- Create: `src/pageindex/book-indexer/steps/export.ts`

**Interfaces:**
- Consumes: PipelineContext (parseResult)
- Produces: 填充 nodeFileMap, treeData

- [ ] **Step 1: 创建 export.ts**

从 book-indexer.ts 提取导出逻辑（约 90 行）：
- TOC 清理
- 调用 exporter 生成 .md 文件

- [ ] **Step 2: Commit**

---

## Task 6: 创建 MetadataStep

**Covers:** Step 5: 元数据构建

**Files:**
- Create: `src/pageindex/book-indexer/steps/metadata.ts`

**Interfaces:**
- Consumes: PipelineContext (parseResult, bookId)
- Produces: 填充 bookMeta

- [ ] **Step 1: 创建 metadata.ts**

从 book-indexer.ts 提取元数据逻辑（约 30 行）：
- 调用 buildBookMeta()
- 写入 book-meta.json

- [ ] **Step 2: Commit**

---

## Task 7: 创建 VectorizeStep

**Covers:** Step 6: 向量化

**Files:**
- Create: `src/pageindex/book-indexer/steps/vectorize.ts`

**Interfaces:**
- Consumes: PipelineContext (parseResult, options)
- Produces: 填充 embeddings

- [ ] **Step 1: 创建 vectorize.ts**

从 book-indexer.ts 提取向量化逻辑（约 90 行）：
- 调用 vectorizeAllLevels()
- 更新 bookMeta 和全局目录

- [ ] **Step 2: Commit**

---

## Task 8: 创建 BM25Step 和 PropositionsStep

**Covers:** Step 7-8: BM25 + 命题

**Files:**
- Create: `src/pageindex/book-indexer/steps/bm25.ts`
- Create: `src/pageindex/book-indexer/steps/propositions.ts`

**Interfaces:**
- Consumes: PipelineContext
- Produces: 更新 bookMeta

- [ ] **Step 1: 创建 bm25.ts**

从 book-indexer.ts 提取 BM25 逻辑（约 30 行）

- [ ] **Step 2: 创建 propositions.ts**

从 book-indexer.ts 提取命题逻辑（约 80 行）

- [ ] **Step 3: Commit**

---

## Task 9: 创建 FinalizeStep 和 Executor

**Covers:** Step 9 + 执行器

**Files:**
- Create: `src/pageindex/book-indexer/steps/finalize.ts`
- Create: `src/pageindex/book-indexer/executor.ts`

**Interfaces:**
- Consumes: PipelineContext
- Produces: BookIndexResult

- [ ] **Step 1: 创建 finalize.ts**

从 book-indexer.ts 提取收尾逻辑（约 50 行）：
- 标记 status="ready"
- 清理进度文件

- [ ] **Step 2: 创建 executor.ts**

Pipeline 执行器：
```typescript
import { PipelineContext, PipelineStep } from "./pipeline-types.js";

export async function executePipeline(
  steps: PipelineStep[],
  ctx: PipelineContext
): Promise<void> {
  for (const step of steps) {
    ctx.tracer.startPhase(step.name);
    try {
      await step.execute(ctx);
      ctx.tracer.endPhase();
    } catch (error) {
      ctx.tracer.failPhase(error.message);
      throw error;
    }
    ctx.tracer.save();
  }
}
```

- [ ] **Step 3: Commit**

---

## Task 10: 更新 book-indexer.ts 入口

**Covers:** 集成新模块

**Files:**
- Modify: `src/pageindex/book-indexer.ts`

**Interfaces:**
- Consumes: 所有 Steps, executor
- Produces: 瘦身后的 indexBook()

- [ ] **Step 1: 重构 indexBook()**

将 indexBook() 替换为使用 Pipeline 执行器：

```typescript
import { executePipeline } from "./book-indexer/executor.js";
import { ValidateStep } from "./book-indexer/steps/validate.js";
import { ParseStep } from "./book-indexer/steps/parse.js";
// ... 其他 Steps

export async function indexBook(options: BookIndexOptions): Promise<BookIndexResult> {
  const ctx = createPipelineContext(options);
  
  const steps = [
    new ValidateStep(),
    new ParseStep(),
    new CoverStep(),
    new ExportStep(),
    new MetadataStep(),
    new VectorizeStep(),
    new BM25Step(),
    new PropositionsStep(),
    new FinalizeStep(),
  ];
  
  await executePipeline(steps, ctx);
  
  return {
    bookId: ctx.bookId,
    title: ctx.bookMeta?.title || "",
    quality: ctx.quality || "good",
    qualityReason: ctx.qualityReason,
  };
}
```

- [ ] **Step 2: 运行测试**

```bash
npm run test:run -- tests/unit/pageindex/
```

- [ ] **Step 3: Commit**

---

## Task 11: 端到端验证

**Covers:** 完整功能验证

**Files:**
- 无文件修改

- [ ] **Step 1: 构建**

```bash
npm run build
```

- [ ] **Step 2: 全量测试**

```bash
npm run test:run
```

- [ ] **Step 3: 检查行数**

```bash
wc -l src/pageindex/book-indexer.ts src/pageindex/book-indexer/*.ts src/pageindex/book-indexer/steps/*.ts
```

- [ ] **Step 4: Commit summary**
