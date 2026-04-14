# LangChain/LangGraph 重构 — Chunk 1: ChatModel + 工具层

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 安装 LangChain 依赖，创建 ChatModel 工厂替换现有 LLMClient，将 12 个工具从 BaseTool 迁移到 LangChain `tool()` 格式。

**Architecture:** 用 `ChatOpenAI` 替换手写的 SSE fetch 客户端。工具通过闭包捕获 `ToolContext`（Obsidian app、PageIndex 路径等不可序列化依赖），注册为标准 `Tool[]` 数组。

**Tech Stack:** `@langchain/openai` (ChatOpenAI), `@langchain/core` (tool, messages), `@langchain/langgraph` (StateGraph 基础), `zod`

**Spec:** `docs/superpowers/specs/2026-04-13-langchain-langgraph-refactor-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/agent/models/index.ts` | 导出 createChatModels |
| Create | `src/agent/models/chat-model.ts` | ChatOpenAI 工厂（main/fast 双模型） |
| Create | `src/agent/tools/definitions/search-book.ts` | search_book 工具 |
| Create | `src/agent/tools/definitions/read-section.ts` | read_book_section 工具 |
| Create | `src/agent/tools/definitions/write-note.ts` | write_note 工具 |
| Create | `src/agent/tools/definitions/memory.ts` | save_memory + search_memory 工具 |
| Create | `src/agent/tools/definitions/profile.ts` | update_profile 工具 |
| Create | `src/agent/tools/definitions/search-read-books.ts` | search_read_books 工具 |
| Create | `src/agent/tools/definitions/canvas.ts` | canvas 工具 |
| Create | `src/agent/tools/definitions/excalidraw.ts` | excalidraw 工具 |
| Create | `src/agent/tools/definitions/sub-agent.ts` | check_sub_agent 工具 |
| Modify | `src/agent/tools/index.ts` | 新增 LangChain 工具注册路径 |
| Create | `src/agent/__tests__/tools/langchain-tools.test.ts` | 工具迁移验证测试 |

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 LangChain 依赖**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/langchain-refactor
npm install @langchain/core @langchain/langgraph @langchain/openai zod
```

- [ ] **Step 2: 验证安装成功**

```bash
npm ls @langchain/core @langchain/langgraph @langchain/openai zod
```

Expected: 所有包显示版本号，无 peer dependency 错误

- [ ] **Step 3: 验证构建不报错**

```bash
npm run build 2>&1 | tail -20
```

Expected: 构建成功（新依赖尚未使用，不应影响现有代码）

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 LangChain/LangGraph/zod 依赖"
```

---

## Task 2: ChatModel 工厂

**Files:**
- Create: `src/agent/models/chat-model.ts`
- Create: `src/agent/models/index.ts`

**Reference:** 现有 `src/agent/llm-client.ts` 的 `LLMClientManager` 提供 main/fast 双模型

- [ ] **Step 1: 创建 ChatModel 工厂**

```typescript
// src/agent/models/chat-model.ts
import { ChatOpenAI } from "@langchain/openai";

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatModels {
  main: ChatOpenAI;
  fast: ChatOpenAI;
}

/**
 * 创建 main/fast 双模型实例。
 * 替换现有 LLMClientManager，保留相同的双模型架构。
 *
 * - main: S2 Analytical + S4 Formatter（较强模型）
 * - fast: S0 Router + S1 Inspectional（快速/廉价模型）
 *
 * ChatOpenAI 兼容所有 OpenAI API 格式的 provider（DeepSeek、Kimi、Moonshot），
 * 通过 configuration.baseURL 切换。
 */
export function createChatModels(main: ModelConfig, fast?: ModelConfig): ChatModels {
  const mainModel = new ChatOpenAI({
    openAIApiKey: main.apiKey,
    configuration: { baseURL: main.baseUrl },
    model: main.model,
    streaming: true,
    temperature: 0.3,
  });

  const fastModel = fast
    ? new ChatOpenAI({
        openAIApiKey: fast.apiKey,
        configuration: { baseURL: fast.baseUrl },
        model: fast.model,
        streaming: true,
        temperature: 0.1,
      })
    : mainModel;

  return { main: mainModel, fast: fastModel };
}
```

- [ ] **Step 2: 创建导出文件**

```typescript
// src/agent/models/index.ts
export { createChatModels } from './chat-model';
export type { ModelConfig, ChatModels } from './chat-model';
```

- [ ] **Step 3: 验证构建**

```bash
npm run build 2>&1 | tail -5
```

Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add src/agent/models/
git commit -m "feat: 添加 ChatModel 工厂（替换 LLMClientManager）"
```

---

## Task 3: 工具类型定义

**Files:**
- Create: `src/agent/tools/definitions/types.ts`

**Reference:** 现有 `src/agent/tools/types.ts` 的 `ToolContext` 接口

- [ ] **Step 1: 创建工具定义共享类型**

复用现有 `ToolContext` 类型，为 LangChain 工具定义提供类型安全：

```typescript
// src/agent/tools/definitions/types.ts
import type { Tool } from "@langchain/core/tools";
import type { ToolContext } from "../types";

/**
 * 工具创建工厂函数类型。
 * 每个工具通过闭包捕获 ToolContext，返回 LangChain Tool 实例。
 */
export type ToolFactory = (ctx: ToolContext) => Tool;
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/definitions/types.ts
git commit -m "feat: 添加 LangChain 工具工厂类型定义"
```

---

## Task 4: search_book 工具迁移（包装模式）

**Files:**
- Create: `src/agent/tools/definitions/search-book.ts`
- Reference: `src/agent/tools/local/search-text.ts`

**迁移策略**: 直接包装现有 `searchBookTool: ToolExecutor`，调用其 `execute(args, context)` 方法。不重写业务逻辑。

- [ ] **Step 1: 创建 search_book 工具（包装现有 ToolExecutor）**

```typescript
// src/agent/tools/definitions/search-book.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolContext } from "../types";
import type { ToolFactory } from "./types";
import { searchBookTool } from "../local/search-text";

export const createSearchBookTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ keywords, scope_node_ids }) => {
      return await searchBookTool.execute(
        { keywords, scope_node_ids },
        ctx
      );
    },
    {
      name: "search_book",
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
      schema: z.object({
        keywords: z
          .array(z.string())
          .describe("关键词数组，AND 逻辑"),
        scope_node_ids: z
          .array(z.string())
          .optional()
          .describe("限定搜索范围（章节 ID 列表），留空则全局搜索"),
      }),
    }
  );
```

- [ ] **Step 2: 验证构建**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/definitions/search-book.ts
git commit -m "feat: 迁移 search_book 工具到 LangChain tool()（包装模式）"
```

---

## Task 5: read_book_section 工具迁移（包装模式）

**Files:**
- Create: `src/agent/tools/definitions/read-section.ts`
- Reference: `src/agent/tools/local/read-section.ts`（约 365 行，包含 tree.json 查找、block_id 定位、heading 模糊搜索等复杂逻辑）

**迁移策略**: 包装现有 `readBookSectionTool: ToolExecutor`。现有实现非常复杂（365 行），支持 node_ids 批量、node_id+block_id、block_id 扫描、heading 模糊匹配，不可简化。

- [ ] **Step 1: 创建 read_book_section 工具（包装现有 ToolExecutor）**

```typescript
// src/agent/tools/definitions/read-section.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolContext } from "../types";
import type { ToolFactory } from "./types";
import { readBookSectionTool } from "../local/read-section";

export const createReadSectionTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return await readBookSectionTool.execute(
        {
          node_ids: args.node_ids,
          node_id: args.node_id,
          block_id: args.block_id,
          heading: args.heading,
        },
        ctx
      );
    },
    {
      name: "read_book_section",
      description: `读取指定章节的完整内容（含 ^block_id 标记）。

【推荐用法】先 search_book 获取 node_id 列表，再批量读取。
参数优先级: node_ids (批量) > node_id+block_id (精确定位) > heading`,
      schema: z.object({
        node_ids: z
          .array(z.string())
          .optional()
          .describe("批量读取多个章节（推荐，一次读取多个 node_id）"),
        node_id: z
          .string()
          .optional()
          .describe("单个章节 ID"),
        block_id: z
          .string()
          .optional()
          .describe("块引用 ID（如 ^s1-002），需配合 node_id 使用"),
        heading: z
          .string()
          .optional()
          .describe("标题名称（模糊匹配）"),
      }),
    }
  );
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/definitions/read-section.ts
git commit -m "feat: 迁移 read_book_section 工具到 LangChain tool()（包装模式）"
```

---

## Task 7: write_note 工具迁移（包装模式）

**Files:**
- Create: `src/agent/tools/definitions/write-note.ts`
- Reference: `src/agent/tools/write-note.ts`

**迁移策略**: 包装现有 `writeNoteTool: ToolExecutor`。现有实现包含复杂的 frontmatter 处理（`aicreate` 权限、`parseContentFrontmatter`、`generateContentWithFrontmatter`），不可简化。

- [ ] **Step 1: 创建 write_note 工具（包装现有 ToolExecutor）**

```typescript
// src/agent/tools/definitions/write-note.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolContext } from "../types";
import type { ToolFactory } from "./types";
import { writeNoteTool } from "../write-note";

export const createWriteNoteTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ path, content, mode }) => {
      return await writeNoteTool.execute({ path, content, mode }, ctx);
    },
    {
      name: "write_note",
      description: `将内容写入 Obsidian 笔记文件。AI 创建的文件带有 aicreate 标记。
支持三种模式: create (新建), overwrite (覆盖已有 AI 文件), append (追加内容)。
只能操作 AI 创建的文件（安全机制）。`,
      schema: z.object({
        path: z.string().describe("笔记的相对路径（如 'DeepReader/Notes/分析.md'）"),
        content: z.string().describe("笔记的 Markdown 内容"),
        mode: z
          .enum(["create", "overwrite", "append"])
          .optional()
          .default("create")
          .describe("写入模式: create=新建, overwrite=覆盖, append=追加"),
      }),
    }
  );
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/definitions/write-note.ts
git commit -m "feat: 迁移 write_note 工具到 LangChain tool()（包装模式）"
```

---

## Task 6: memory 工具迁移

**Files:**
- Create: `src/agent/tools/definitions/memory.ts`
- Reference: `src/agent/tools/memory.ts`, `src/agent/memory/store.ts`

**现有工具行为**：
- `save_memory` (`addMemoryTool`): 参数 `history_entry`, `memory_update`。写入 HISTORY.md + 可选更新 MEMORY.md
- `search_memory` (`searchMemoryTool`): 参数 `query`。搜索 MEMORY.md + HISTORY.md

**关键**: `MemoryStore` 是实例类，需要 `new MemoryStore(app)` 后调用实例方法。

- [ ] **Step 1: 创建 memory 工具（包装现有 ToolExecutor）**

```typescript
// src/agent/tools/definitions/memory.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolContext } from "../types";
import type { ToolFactory } from "./types";
import { addMemoryTool, searchMemoryTool } from "../memory";

export const createSaveMemoryTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ history_entry, memory_update }) => {
      return await addMemoryTool.execute(
        { history_entry, memory_update },
        ctx
      );
    },
    {
      name: "save_memory",
      description: `保存信息到长期记忆系统。
- history_entry: 必填，记录到阅读历史（HISTORY.md）
- memory_update: 可选，更新用户画像/偏好（MEMORY.md）`,
      schema: z.object({
        history_entry: z
          .string()
          .describe("阅读历史条目，记录本次交互的关键信息"),
        memory_update: z
          .string()
          .optional()
          .describe("要更新到长期记忆的内容（如用户偏好、阅读习惯等）"),
      }),
    }
  );

export const createSearchMemoryTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ query }) => {
      return await searchMemoryTool.execute({ query }, ctx);
    },
    {
      name: "search_memory",
      description: "搜索长期记忆（MEMORY.md 和 HISTORY.md），查找与查询相关的用户偏好、阅读历史等",
      schema: z.object({
        query: z.string().describe("搜索关键词，空格分隔"),
      }),
    }
  );
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/definitions/memory.ts
git commit -m "feat: 迁移 save_memory + search_memory 工具到 LangChain tool() 格式"
```

---

## Task 8: 剩余工具批量迁移（全部包装模式）

**Files:**
- Create: `src/agent/tools/definitions/profile.ts`
- Create: `src/agent/tools/definitions/search-read-books.ts`
- Create: `src/agent/tools/definitions/canvas.ts`
- Create: `src/agent/tools/definitions/excalidraw.ts`
- Create: `src/agent/tools/definitions/sub-agent.ts`

**策略**: 所有工具都包装现有 `ToolExecutor`，不重写业务逻辑。

- [ ] **Step 1: 创建 profile 工具**

参数: `section` (枚举: '基础信息'|'阅读偏好'|'认知特点'|'阅读轨迹'), `field`, `value`, `mode` ('append'|'replace')

```typescript
// src/agent/tools/definitions/profile.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolFactory } from "./types";
import { updateProfileTool } from "../profile";
import type { ToolContext } from "../types";

export const createUpdateProfileTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return await updateProfileTool.execute(
        { section: args.section, field: args.field, value: args.value, mode: args.mode },
        ctx
      );
    },
    {
      name: "update_profile",
      description: "更新用户画像字段。用于用户表达新偏好、纠正行为、提供个人信息时。每次只更新一个字段。",
      schema: z.object({
        section: z
          .enum(["基础信息", "阅读偏好", "认知特点", "阅读轨迹"])
          .describe("画像部分"),
        field: z.string().describe("具体字段名，如 '称呼'、'风格'、'擅长'"),
        value: z.string().describe("新的值"),
        mode: z
          .enum(["append", "replace"])
          .optional()
          .describe("更新模式：append（追加）或 replace（替换，默认）"),
      }),
    }
  );
```

- [ ] **Step 2: 创建 search_read_books 工具**

```typescript
// src/agent/tools/definitions/search-read-books.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolFactory } from "./types";
import type { ToolContext } from "../types";
import { searchReadBooksTool } from "../search-read-books";

export const createSearchReadBooksTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return await searchReadBooksTool.execute(
        { query: args.query, top_k: args.top_k },
        ctx
      );
    },
    {
      name: "search_read_books",
      description: "跨书搜索已读过的书籍，查找与查询相关的内容",
      schema: z.object({
        query: z.string().describe("搜索关键词"),
        top_k: z.number().optional().default(5).describe("返回结果数量"),
      }),
    }
  );
```

- [ ] **Step 3: 创建 canvas 工具**

```typescript
// src/agent/tools/definitions/canvas.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolFactory } from "./types";
import type { ToolContext } from "../types";
import { createCanvasTool } from "../canvas";

export const createCanvasToolDefinition: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return await createCanvasTool.execute(args, ctx);
    },
    {
      name: "canvas",
      description: "创建或修改 Obsidian Canvas 文件",
      schema: z.object({
        action: z.enum(["create", "add_nodes"]).describe("操作类型"),
        path: z.string().describe("Canvas 文件路径"),
        title: z.string().optional().describe("Canvas 标题"),
        content: z.string().optional().describe("节点内容"),
      }),
    }
  );
```

- [ ] **Step 4: 创建 excalidraw 工具**

注意：excalidraw 不依赖 `ctx.app`，使用 `window.ExcalidrawAutomate` 全局 API。不应该放在 `if (ctx.app)` 条件内。

```typescript
// src/agent/tools/definitions/excalidraw.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolFactory } from "./types";
import type { ToolContext } from "../types";
import { createExcalidrawTool } from "../excalidraw";

export const createExcalidrawToolDefinition: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return await createExcalidrawTool.execute(args, ctx);
    },
    {
      name: "excalidraw",
      description: "创建 Excalidraw 图表",
      schema: z.object({
        action: z.enum(["create"]).describe("操作类型"),
        path: z.string().describe("文件路径"),
        content: z.string().optional().describe("图表内容描述"),
      }),
    }
  );
```

- [ ] **Step 5: 创建 check_sub_agent 工具**

```typescript
// src/agent/tools/definitions/sub-agent.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolFactory } from "./types";
import type { ToolContext } from "../types";
import { checkSubAgentTool } from "../create-sub-agent";

export const createCheckSubAgentTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ task_id }) => {
      return await checkSubAgentTool.execute({ task_id }, ctx);
    },
    {
      name: "check_sub_agent",
      description: "检查子 Agent 任务的状态",
      schema: z.object({
        task_id: z.string().describe("子 Agent 任务 ID"),
      }),
    }
  );
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools/definitions/
git commit -m "feat: 迁移 profile/search_read_books/canvas/excalidraw/sub-agent 工具"
```

---

## Task 9: 工具注册表 + 迁移开关

**Files:**
- Modify: `src/agent/tools/index.ts`

- [ ] **Step 1: 在 tools/index.ts 中添加 LangChain 工具注册路径**

在现有文件中添加新的导出函数，保留旧的 `createToolRegistry` 不变：

```typescript
// 在 src/agent/tools/index.ts 末尾添加

import type { Tool } from "@langchain/core/tools";
import type { ToolContext } from "./types";

// LangChain tool() 格式的工具注册
import { createSearchBookTool } from "./definitions/search-book";
import { createReadSectionTool } from "./definitions/read-section";
import { createWriteNoteTool } from "./definitions/write-note";
import { createSaveMemoryTool, createSearchMemoryTool } from "./definitions/memory";
import { createUpdateProfileTool } from "./definitions/profile";
import { createSearchReadBooksTool } from "./definitions/search-read-books";
import { createCanvasTool } from "./definitions/canvas";
import { createExcalidrawTool } from "./definitions/excalidraw";
import { createCheckSubAgentTool } from "./definitions/sub-agent";

const USE_LANGCHAIN_TOOLS = true;

/**
 * 创建 LangChain Tool[] 数组。
 * 每个工具通过闭包捕获 ToolContext。
 *
 * 注意：canvas 依赖 ctx.app（Obsidian vault 操作），
 * excalidraw 使用 window.ExcalidrawAutomate 全局 API（不依赖 ctx.app）。
 */
export function createLangChainTools(ctx: ToolContext): Tool[] {
  const tools: Tool[] = [
    createSearchBookTool(ctx),
    createReadSectionTool(ctx),
    createWriteNoteTool(ctx),
    createSaveMemoryTool(ctx),
    createSearchMemoryTool(ctx),
    createUpdateProfileTool(ctx),
    createSearchReadBooksTool(ctx),
    createCheckSubAgentTool(ctx),
    createExcalidrawToolDefinition(ctx),  // 不依赖 ctx.app
  ];

  // canvas 依赖 Obsidian app
  if (ctx.app) {
    tools.push(createCanvasToolDefinition(ctx));
  }

  return tools;
}
```

- [ ] **Step 2: 验证构建**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/index.ts
git commit -m "feat: 添加 LangChain 工具注册表（createLangChainTools）"
```

---

## Task 10: 工具迁移验证测试

**Files:**
- Create: `src/agent/__tests__/tools/langchain-tools.test.ts`

- [ ] **Step 1: 编写测试验证工具定义正确**

```typescript
// src/agent/__tests__/tools/langchain-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import { createLangChainTools } from "../../tools/index";
import type { ToolContext } from "../../tools/types";

// 最小 ToolContext mock
const mockContext: ToolContext = {
  indexId: "test-book-id",
  pdfName: "test-book.pdf",
  app: {
    vault: {
      adapter: { basePath: "/tmp/test-vault" },
      read: vi.fn().mockResolvedValue("test content"),
      create: vi.fn().mockResolvedValue(undefined),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
    },
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue({ frontmatter: {} }),
    },
  } as any,
  plugin: { settings: { embedding: null } } as any,
};

describe("LangChain Tools Migration", () => {
  it("should create all tools without errors", () => {
    const tools = createLangChainTools(mockContext);
    expect(tools.length).toBeGreaterThanOrEqual(9);

    const names = tools.map((t) => t.name);
    expect(names).toContain("search_book");
    expect(names).toContain("read_book_section");
    expect(names).toContain("write_note");
    expect(names).toContain("save_memory");
    expect(names).toContain("search_memory");
    expect(names).toContain("update_profile");
    expect(names).toContain("search_read_books");
    expect(names).toContain("canvas");
    expect(names).toContain("excalidraw");
  });

  it("each tool should have a valid zod schema", () => {
    const tools = createLangChainTools(mockContext);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.schema).toBeDefined();
    }
  });

  it("tools without app should exclude canvas and excalidraw", () => {
    const noAppContext = { ...mockContext, app: undefined };
    const tools = createLangChainTools(noAppContext as any);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("canvas");
    expect(names).not.toContain("excalidraw");
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test:run -- src/agent/__tests__/tools/langchain-tools.test.ts
```

Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/agent/__tests__/tools/langchain-tools.test.ts
git commit -m "test: 添加 LangChain 工具迁移验证测试"
```

---

## Task 11: ChatModel 集成测试

**Files:**
- Create: `src/agent/__tests__/models/chat-model.test.ts`

- [ ] **Step 1: 编写 ChatModel 工厂测试**

```typescript
// src/agent/__tests__/models/chat-model.test.ts
import { describe, it, expect } from "vitest";
import { createChatModels } from "../../models/chat-model";

describe("ChatModel Factory", () => {
  it("should create main model with correct config", () => {
    const models = createChatModels({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });

    expect(models.main).toBeDefined();
    expect(models.fast).toBe(models.main); // 无 fast 配置时 fallback 到 main
  });

  it("should create separate fast model when configured", () => {
    const models = createChatModels(
      {
        apiKey: "main-key",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      },
      {
        apiKey: "fast-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      }
    );

    expect(models.main).toBeDefined();
    expect(models.fast).toBeDefined();
    expect(models.main).not.toBe(models.fast);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test:run -- src/agent/__tests__/models/chat-model.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agent/__tests__/models/chat-model.test.ts
git commit -m "test: 添加 ChatModel 工厂测试"
```

---

## Task 12: 打 tag 标记 Chunk 1 完成

- [ ] **Step 1: 运行完整构建和测试**

```bash
npm run build && npm run test:run
```

Expected: 构建成功，现有测试全部通过

- [ ] **Step 2: 打 tag**

```bash
git tag chunk-1-complete
```

- [ ] **Step 3: 验证 bundle 体积**

```bash
ls -lh bin/main.js
```

Expected: 体积增量 ≤ 400KB（对比 main 分支的 `bin/main.js`）

---

## 验收标准

| 标准 | 验证方式 |
|------|---------|
| 所有依赖安装成功 | `npm ls` 无错误 |
| ChatModel 工厂可用 | 单元测试通过 |
| 12 个工具全部迁移 | `createLangChainTools()` 返回 9+ 个 Tool |
| 工具 schema 正确 | 每个工具有 name、description、schema |
| 构建不报错 | `npm run build` 成功 |
| 现有测试不受影响 | `npm run test:run` 全部通过 |
| bundle 体积增量 ≤ 400KB | 对比 `bin/main.js` 大小 |
