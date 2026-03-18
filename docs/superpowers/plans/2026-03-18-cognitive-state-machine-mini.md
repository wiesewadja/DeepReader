# DeepReader 认知状态机实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将艾德勒《如何阅读一本书》的阅读方法论转化为确定性状态机架构，替代现有的 ReAct Agent 循环

**Architecture:** 采用 TypeScript 强控编排的状态机架构，将阅读过程分为 S0(路由) → S1(检视阅读) → S2(分析阅读) → S4(格式化) 四个状态节点，每个节点有明确的输入输出和职责边界，通过 ToolInterceptor 物理锁死搜索范围

**Tech Stack:** TypeScript, Zod (schema validation), 复用现有 LLMClient, 复用现有工具 (get_toc, search_doc, get_chapter)

---

## 文件结构

根据设计文档，新文件结构如下：

```
frontend/src/agent/
├── cognitive-engine/                 # 新建目录
│   ├── index.ts                      # 导出入口
│   ├── engine.ts                     # 主控调度 (runCognitiveEngine)
│   ├── context.ts                    # SharedContext 定义
│   ├── types.ts                      # 类型定义
│   ├── states/
│   │   ├── base.ts                   # StateNode 基类
│   │   ├── router.ts                 # S0 路由器
│   │   ├── inspectional.ts           # S1 检视阅读
│   │   ├── analytical.ts             # S2 分析阅读
│   │   └── formatter.ts              # S4 格式化
│   ├── interceptor/
│   │   └── scope-interceptor.ts      # 工具拦截器
│   └── prompts/
│       ├── router-prompt.ts          # S0 提示词
│       ├── inspectional-prompt.ts    # S1 提示词
│       ├── analytical-prompt.ts      # S2 提示词
│       └── formatter-prompt.ts       # S4 提示词
```

---

## Chunk 1: 核心框架 (Core Framework)

### Task 1: 创建类型定义和 SharedContext

**Files:**
- Create: `frontend/src/agent/cognitive-engine/types.ts`
- Create: `frontend/src/agent/cognitive-engine/context.ts`

- [ ] **Step 1: 创建 types.ts - 状态机和工具拦截器类型定义**

```typescript
// frontend/src/agent/cognitive-engine/types.ts

import { z } from 'zod';

// 状态节点模型类型
export type ModelType = 'fast' | 'main';

// 状态执行结果
export interface StateResult {
  success: boolean;
  timestamp: number;
  error?: string;
  duration?: number;
}

// 状态节点选项
export interface StateNodeOptions {
  timeout?: number;        // 状态执行超时（毫秒），默认 30000
  retries?: number;        // 重试次数，默认 1
  retryDelay?: number;     // 重试延迟（毫秒），默认 1000
}

// 工具拦截器类型
export interface ToolInterceptor {
  (toolName: string, toolArgs: Record<string, unknown>): Record<string, unknown>;
}

// 引擎回调
export interface EngineCallbacks {
  onProgress: (status: string) => void;
  onContent: (text: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

// S0 路由器输出 Schema
export const RouterOutputSchema = z.object({
  depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  standalone_query: z.string().optional(),
  reason: z.string().optional(),
});

// S1 检视阅读输出 Schema
export const InspectionalOutputSchema = z.object({
  scopeNodeIds: z.array(z.string()).min(1).max(5),
  tocSummary: z.string().optional(),
});

// 类型导出
export type RouterOutput = z.infer<typeof RouterOutputSchema>;
export type InspectionalOutput = z.infer<typeof InspectionalOutputSchema>;
```

- [ ] **Step 2: 创建 context.ts - SharedContext 实现**

```typescript
// frontend/src/agent/cognitive-engine/context.ts

import type { ChatMessage } from '../types.js';
import type { StateResult, ToolInterceptor } from './types.js';

// 搜索结果类型
export interface SearchResult {
  text: string;
  metadata: {
    block_id?: string;
    node_id?: string;
    page?: number;
    section?: string;
    type?: string;
  };
}

// SharedContext 接口
export interface SharedContext {
  // ===== 聊天记录 =====
  chatHistory: ChatMessage[];
  rawUserQuery: string;

  // ===== S0 输出 =====
  depth: 0 | 1 | 2 | 3;
  detectedIntents: string[];
  standaloneQuery?: string;

  // ===== S1 输出 =====
  scopeNodeIds?: string[];
  tocSummary?: string;

  // ===== S2 输出 =====
  rawResults?: SearchResult[];
  analysisResult?: string;

  // ===== 运行时 =====
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;

  // ===== 状态执行追踪 =====
  executedStates: Set<string>;
  stateResults: Map<string, StateResult>;
}

// SharedContext 实现类
export class SharedContextImpl implements SharedContext {
  chatHistory: ChatMessage[] = [];
  rawUserQuery: string = '';
  depth: 0 | 1 | 2 | 3 = 2;
  detectedIntents: string[] = [];
  standaloneQuery?: string;
  scopeNodeIds?: string[];
  tocSummary?: string;
  rawResults?: SearchResult[];
  analysisResult?: string;
  indexId: string = '';
  pdfName: string = '';
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;
  executedStates = new Set<string>();
  stateResults = new Map<string, StateResult>();

  markStateExecuted(stateName: string, success: boolean, error?: string, duration?: number): void {
    this.executedStates.add(stateName);
    this.stateResults.set(stateName, {
      success,
      timestamp: Date.now(),
      error,
      duration,
    });
  }

  needsStateExecution(stateName: string): boolean {
    return !this.executedStates.has(stateName);
  }

  isStateSuccessful(stateName: string): boolean {
    return this.stateResults.get(stateName)?.success ?? false;
  }
}
```

- [ ] **Step 3: 运行 TypeScript 检查**

Run: `cd frontend && npm run build 2>&1 | head -50`
Expected: 无新增错误（只有现有代码的错误）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/cognitive-engine/types.ts frontend/src/agent/cognitive-engine/context.ts
git commit -m "feat(cognitive-engine): add core types and SharedContext"
```

---

### Task 2: 创建状态节点基类和工具函数

**Files:**
- Create: `frontend/src/agent/cognitive-engine/states/base.ts`
- Create: `frontend/src/agent/cognitive-engine/interceptor/scope-interceptor.ts`

- [ ] **Step 1: 创建 states/base.ts - StateNode 基类**

```typescript
// frontend/src/agent/cognitive-engine/states/base.ts

import type { SharedContext } from '../context.js';
import type { ModelType, StateNodeOptions, StateResult } from './types.js';

/**
 * 状态节点基类
 * 所有状态节点 (S0-S4) 都继承此类
 */
export abstract class StateNode {
  abstract readonly name: string;
  abstract readonly model: ModelType;
  abstract readonly tools: string[];
  options: StateNodeOptions = {
    timeout: 30000,
    retries: 1,
    retryDelay: 1000,
  };

  /**
   * 执行状态逻辑
   */
  abstract execute(ctx: SharedContext): Promise<void>;

  /**
   * 构建系统提示词
   */
  abstract buildSystemPrompt(ctx: SharedContext): string;

  /**
   * 创建带超时的 Promise
   */
  protected async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    stateName: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`State ${stateName} timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * 带重试的执行
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    retries: number,
    delay: number
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (i < retries) {
          await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
        }
      }
    }
    throw lastError;
  }
}
```

- [ ] **Step 2: 创建 interceptor/scope-interceptor.ts - 工具拦截器**

```typescript
// frontend/src/agent/cognitive-engine/interceptor/scope-interceptor.ts

import type { ToolInterceptor } from '../types.js';

/**
 * 创建范围锁拦截器
 * 物理锁死搜索范围，防止 LLM 越界
 */
export function createScopeInterceptor(scopeNodeIds: string[]): ToolInterceptor {
  return (toolName: string, toolArgs: Record<string, unknown>): Record<string, unknown> => {
    // 拦截 search_doc：强制注入 scope
    if (toolName === 'search_doc') {
      toolArgs.scopeNodeIds = scopeNodeIds;
    }

    // 拦截 get_chapter：检查是否在范围内
    if (toolName === 'get_chapter' && toolArgs.node_id) {
      if (!scopeNodeIds.includes(toolArgs.node_id as string)) {
        console.warn(`[Interceptor] node_id ${toolArgs.node_id} out of scope`);
        // 返回错误提示
        toolArgs._error = `章节 ${toolArgs.node_id} 不在允许范围内`;
      }
    }

    return toolArgs;
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/base.ts frontend/src/agent/cognitive-engine/interceptor/scope-interceptor.ts
git commit -m "feat(cognitive-engine): add StateNode base class and scope interceptor"
```

---

### Task 3: 创建提示词模块

**Files:**
- Create: `frontend/src/agent/cognitive-engine/prompts/router-prompt.ts`
- Create: `frontend/src/agent/cognitive-engine/prompts/inspectional-prompt.ts`
- Create: `frontend/src/agent/cognitive-engine/prompts/analytical-prompt.ts`
- Create: `frontend/src/agent/cognitive-engine/prompts/formatter-prompt.ts`

- [ ] **Step 1: 创建 prompts/router-prompt.ts - S0 路由器提示词**

```typescript
// frontend/src/agent/cognitive-engine/prompts/router-prompt.ts

export const PROMPT_S0_ROUTER = `
<role>
你是一个极速的阅读意图路由器与上下文重写器。你没有主观感情，绝对不要尝试回答用户的专业问题。
</role>

<task>
1. 阅读【用户的当前提问】和【近期聊天记录】。
2. 将用户的当前提问重写为一个完整的、不带代词的独立句子 (standalone_query)。如果原句已经完整，则保持原样。
3. 判断该提问所需的《如何阅读一本书》阅读深度 (depth)。
</task>

<depth_rules>
- 0: 日常闲聊、打招呼、系统指令（与书本知识无关）。
- 1: 检视阅读。询问全书大纲、目录结构、宏观总结。
- 2: 分析阅读（最常用）。探究特定概念定义、询问某个推演逻辑、寻找特定章节的细节。
- 3: 主题阅读。明确要求跨书本对比、评价作者观点局限性、或梳理多个概念的争议。
</depth_rules>

<output_format>
你必须且只能输出合法的 JSON 格式，不要包含任何 Markdown 代码块修饰符：
{
  "standalone_query": "重写后的独立提问",
  "depth": 数字 (0, 1, 2, 3),
  "reason": "一句话分类理由"
}
</output_format>
`;
```

- [ ] **Step 2: 创建 prompts/inspectional-prompt.ts - S1 检视阅读提示词**

```typescript
// frontend/src/agent/cognitive-engine/prompts/inspectional-prompt.ts

export const PROMPT_S1_INSPECTIONAL = `
<role>
你是一位严谨的结构图书管理员。你精通检视阅读法，擅长通过目录和骨架锁定知识所在的范围。
</role>

<task>
用户提出了一个具体的探究问题。你的任务是调用 get_toc 工具获取本书的目录树，并圈定出 1 到 3 个最有可能包含答案的核心章节 ID (node_id)。
</task>

<constraints>
1. 你只能基于章节标题的字面意思和逻辑层级进行推断。
2. 绝对不要尝试凭自己的记忆回答用户的问题！你只负责圈定"战区"。
3. 宁可圈大一点，也不要遗漏可能相关的章节。
</constraints>

<output_format>
你必须且只能输出合法的 JSON 格式：
{
  "scopeNodeIds": ["node_xx", "node_yy"],
  "tocSummary": "简述为什么这几个章节最相关"
}
</output_format>
`;
```

- [ ] **Step 3: 创建 prompts/analytical-prompt.ts - S2 分析阅读提示词**

```typescript
// frontend/src/agent/cognitive-engine/prompts/analytical-prompt.ts

export const PROMPT_S2_ANALYTICAL = `
<role>
你是艾德勒学派的古典阅读分析师。你冷酷、严密、极度忠于原著。你的任务是在限定的章节范围内，深度解构作者的思想。
</role>

<constraints>
你已被底层系统物理限制在特定的章节范围内搜索。你绝对无法获取该范围之外的任何信息。请严格遵循以下工作流：
</constraints>

<workflow>
第一步：词汇共识 (Coming to Terms)
- 提取用户问题中的核心专有名词。
- 使用 search_doc 工具查明作者对该词的**精确定义**。
- 如果作者没有明确下定义，请提炼出作者使用该词的语境。

第二步：逻辑解构 (Propositions & Arguments)
- 基于上述定义，使用 get_chapter 或继续 search_doc，提取作者关于此问题的核心论述。
- 拆解出作者的：【前置条件】 -> 【推演步骤】 -> 【最终结论】。
</workflow>

<output_rules>
1. 你的回答必须是纯粹的"生肉数据分析"，不需要华丽的排版，不需要跟用户打招呼。
2. 每一个提取出的核心观点，必须紧跟其原始的块引用 ID (例如：^block_12345)。
3. 绝不掺杂你个人的外部知识，100% 忠于原著描述。
</output_rules>
`;
```

- [ ] **Step 4: 创建 prompts/formatter-prompt.ts - S4 格式化提示词**

```typescript
// frontend/src/agent/cognitive-engine/prompts/formatter-prompt.ts

export const PROMPT_S4_FORMATTER = `
<role>
你是奚童，昭先生的专属知识助理。你温和、专业，精通系统思维与结构化表达。
你的任务是将后台分析师提取的"生肉数据"，转化为一篇排版精美的 Obsidian 笔记，并以聊天的口吻交付给昭先生。
</role>

<formatting_rules>
1. 【结构化呈现】：大量使用多级列表、加粗、甚至 Markdown 表格来呈现逻辑层级。避免大段密集的文本块。
2. 【绝对双链原则 (核心铁律)】：
   - 后台数据中包含的任何带有 ^block_id 的引用，你必须将其转化为 Obsidian 原生双链格式。
   - 语法标准：[[书籍名称#^block_id|自然融入语境的文本]]。
   - 错误示范：正如作者所说 (^123)。
   - 正确示范：正如作者指出的，[[麦肯锡方法#^123|系统边界的划分至关重要]]。
3. 【情绪价值】：开头可以极其简短地承接一下昭先生的历史聊天语境，展现自然的人机交互感。
4. 【无幻觉原则】：只排版后台提供的生肉数据。如果生肉数据中说"未找到相关信息"，请优雅地如实告知昭先生，绝不自行编造事实。
</formatting_rules>
`;
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/cognitive-engine/prompts/
git commit -m "feat(cognitive-engine): add prompt modules for all states"
```

---

## Chunk 2: S0 + S1 状态节点实现

### Task 4: 实现 S0 路由器状态节点

**Files:**
- Create: `frontend/src/agent/cognitive-engine/states/router.ts`

- [ ] **Step 1: 创建 states/router.ts - S0 路由器实现**

```typescript
// frontend/src/agent/cognitive-engine/states/router.ts

import { z } from 'zod';
import { StateNode } from './base.js';
import type { SharedContext } from '../context.js';
import type { ModelType, StateNodeOptions, RouterOutput } from '../types.js';
import { RouterOutputSchema } from '../types.js';
import { PROMPT_S0_ROUTER } from '../prompts/router-prompt.js';
import { LLMClient } from '../../llm-client.js';
import { agentLog } from '../../utils/logger.js';

/**
 * S0: 路由器 + Query Rewriter
 * 职责：
 * 1. 判断阅读深度 (0, 1, 2, 3)
 * 2. 将模糊提问改写为独立问题
 */
export class RouterState extends StateNode {
  name = 'Router';
  model: ModelType = 'fast';
  tools: string[] = [];
  options: StateNodeOptions = { timeout: 5000, retries: 1, retryDelay: 1000 };

  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    super();
    this.llmClient = llmClient;
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 构建用户消息（包含历史记录）
      const historyText = ctx.chatHistory
        .slice(-6) // 最多看最近 6 条
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      const userMessage = `
<history>
${historyText}
</history>

<current_question>
${ctx.rawUserQuery}
</current_question>

${PROMPT_S0_ROUTER}
`;

      // 调用 LLM
      const response = await this.withRetry(
        () => this.withTimeout(this.callLLM(userMessage), this.options.timeout!, this.name),
        this.options.retries!,
        this.options.retryDelay!
      );

      // 解析输出
      const parsed = this.parseRouterOutput(response.content);

      ctx.depth = parsed.depth;
      ctx.standaloneQuery = parsed.standalone_query || ctx.rawUserQuery;
      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);

      agentLog(`[Router] depth=${ctx.depth}, standaloneQuery="${ctx.standaloneQuery}"`);

    } catch (error) {
      // 降级策略
      ctx.depth = 2;
      ctx.standaloneQuery = ctx.rawUserQuery;
      ctx.markStateExecuted(this.name, false, String(error), Date.now() - startTime);
      agentLog(`[Router] 降级到 depth=2, error: ${error}`);
    }
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return PROMPT_S0_ROUTER;
  }

  private async callLLM(userMessage: string): Promise<{ content: string }> {
    return new Promise((resolve, reject) => {
      let content = '';
      this.llmClient.streamChat(
        [
          { role: 'system', content: '你是一个极速的阅读意图路由器。' },
          { role: 'user', content: userMessage },
        ],
        [],
        {
          onContent: (text) => { content += text; },
          onToolCall: () => {},
          onComplete: () => resolve({ content }),
          onError: reject,
        }
      );
    });
  }

  private parseRouterOutput(content: string): RouterOutput {
    // 尝试提取 JSON 代码块
    const jsonBlockMatch = content.match(/```json\n([\s\S]*?)\n```/);
    // 尝试直接匹配 JSON 对象
    const jsonObjectMatch = content.match(/\{[\s\S]*\}/);

    const jsonStr = jsonBlockMatch?.[1] || jsonObjectMatch?.[0];

    if (!jsonStr) {
      // 降级
      return { depth: 2, standalone_query: '', reason: 'parse failed' };
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return RouterOutputSchema.parse(parsed);
    } catch {
      // 降级
      return { depth: 2, standalone_query: '', reason: 'schema validation failed' };
    }
  }
}
```

- [ ] **Step 2: 运行 TypeScript 检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -E "(error|cognitive-engine)" | head -20`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/router.ts
git commit -m "feat(cognitive-engine): implement S0 Router state"
```

---

### Task 5: 实现 S1 检视阅读状态节点

**Files:**
- Create: `frontend/src/agent/cognitive-engine/states/inspectional.ts`

- [ ] **Step 1: 创建 states/inspectional.ts - S1 检视阅读实现**

```typescript
// frontend/src/agent/cognitive-engine/states/inspectional.ts

import { StateNode } from './base.js';
import type { SharedContext } from '../context.js';
import type { ModelType, StateNodeOptions, InspectionalOutput } from '../types.js';
import { InspectionalOutputSchema } from '../types.js';
import { PROMPT_S1_INSPECTIONAL } from '../prompts/inspectional-prompt.js';
import { LLMClient } from '../../llm-client.js';
import { agentLog } from '../../utils/logger.js';
import type { ToolDefinition } from '../../types.js';
import { getTocTool } from '../../tools/get-toc.js';

/**
 * S1: 检视阅读状态节点
 * 职责：获取大纲，圈定章节范围
 * 工具：只保留 get_toc，剥夺 search_doc
 */
export class InspectionalState extends StateNode {
  name = 'Inspectional';
  model: ModelType = 'fast';
  tools: string[] = ['get_toc'];
  options: StateNodeOptions = { timeout: 15000, retries: 1, retryDelay: 1000 };

  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    super();
    this.llmClient = llmClient;
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. 先调用 get_toc 获取目录
      const tocResult = await getTocTool.execute(
        { detail: 'normal' },
        {
          indexId: ctx.indexId,
          pdfName: ctx.pdfName,
          markdownFiles: ctx.markdownFiles,
        }
      );

      // 2. 构建用户消息
      const userMessage = `
<book_toc>
${tocResult}
</book_toc>

<user_question>
${ctx.standaloneQuery}
</user_question>

${PROMPT_S1_INSPECTIONAL}
`;

      // 3. 调用 LLM 分析
      const response = await this.withRetry(
        () => this.withTimeout(this.callLLM(userMessage), this.options.timeout!, this.name),
        this.options.retries!,
        this.options.retryDelay!
      );

      // 4. 解析输出
      const parsed = this.parseInspectionalOutput(response.content);

      ctx.scopeNodeIds = parsed.scopeNodeIds;
      ctx.tocSummary = parsed.tocSummary;
      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);

      agentLog(`[Inspectional] scopeNodeIds=${ctx.scopeNodeIds?.join(', ')}`);

    } catch (error) {
      ctx.markStateExecuted(this.name, false, String(error), Date.now() - startTime);
      agentLog(`[Inspectional] error: ${error}`);
      throw error;
    }
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return PROMPT_S1_INSPECTIONAL;
  }

  private async callLLM(userMessage: string): Promise<{ content: string }> {
    return new Promise((resolve, reject) => {
      let content = '';
      this.llmClient.streamChat(
        [
          { role: 'system', content: '你是检视阅读专家。' },
          { role: 'user', content: userMessage },
        ],
        [],
        {
          onContent: (text) => { content += text; },
          onToolCall: () => {},
          onComplete: () => resolve({ content }),
          onError: reject,
        }
      );
    });
  }

  private parseInspectionalOutput(content: string): InspectionalOutput {
    const jsonBlockMatch = content.match(/```json\n([\s\S]*?)\n```/);
    const jsonObjectMatch = content.match(/\{[\s\S]*\}/);

    const jsonStr = jsonBlockMatch?.[1] || jsonObjectMatch?.[0];

    if (!jsonStr) {
      return { scopeNodeIds: [], tocSummary: 'parse failed' };
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return InspectionalOutputSchema.parse(parsed);
    } catch {
      return { scopeNodeIds: [], tocSummary: 'schema validation failed' };
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/inspectional.ts
git commit -m "feat(cognitive-engine): implement S1 Inspectional state"
```

---

## Chunk 3: S2 + S4 状态节点实现

### Task 6: 实现 S2 分析阅读状态节点

**Files:**
- Create: `frontend/src/agent/cognitive-engine/states/analytical.ts`

- [ ] **Step 1: 创建 states/analytical.ts - S2 分析阅读实现**

```typescript
// frontend/src/agent/cognitive-engine/states/analytical.ts

import { StateNode } from './base.js';
import type { SharedContext } from '../context.js';
import type { ModelType, StateNodeOptions } from '../types.js';
import { PROMPT_S2_ANALYTICAL } from '../prompts/analytical-prompt.js';
import { LLMClient } from '../../llm-client.js';
import { agentLog } from '../../utils/logger.js';
import { getTocTool } from '../../tools/get-toc.js';
import { searchDocTool } from '../../tools/search-doc.js';
import { getChapterTool } from '../../tools/get-chapter.js';
import { createScopeInterceptor } from '../interceptor/scope-interceptor.js';

/**
 * S2: 分析阅读状态节点
 * 职责：在限定范围内深入分析概念和逻辑
 * 工具：search_doc, get_chapter
 * 关键机制：ToolInterceptor 物理锁死搜索范围
 */
export class AnalyticalState extends StateNode {
  name = 'Analytical';
  model: ModelType = 'main';
  tools: string[] = ['search_doc', 'get_chapter'];
  options: StateNodeOptions = { timeout: 60000, retries: 1, retryDelay: 1000 };

  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    super();
    this.llmClient = llmClient;
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. 累加性保证：缺失范围则调用 S1
      if (!ctx.scopeNodeIds) {
        agentLog('[Analytical] scopeNodeIds 缺失，调用 S1 获取范围');
        const InspectionalState = (await import('./inspectional.js')).InspectionalState;
        const inspectional = new InspectionalState(this.llmClient);
        await inspectional.execute(ctx);
      }

      // 2. 创建范围锁拦截器
      const interceptor = createScopeInterceptor(ctx.scopeNodeIds!);

      // 3. 构建约束信息
      const scopeConstraint = ctx.scopeNodeIds!.map(id => `- ${id}`).join('\n');

      // 4. 构建用户消息
      const userMessage = `
<constraint>
你已被物理限制在以下章节范围内搜索：
${scopeConstraint}

你绝对无法访问这些章节之外的任何内容。
</constraint>

<user_question>
${ctx.standaloneQuery}
</user_question>

${PROMPT_S2_ANALYTICAL}
`;

      // 5. 调用 LLM（带工具）
      const response = await this.withRetry(
        () => this.withTimeout(
          this.callLLMWithTools(userMessage, ctx, interceptor),
          this.options.timeout!,
          this.name
        ),
        this.options.retries!,
        this.options.retryDelay!
      );

      ctx.analysisResult = response.content;
      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);

      agentLog(`[Analytical] 分析完成，结果长度: ${response.content.length}`);

    } catch (error) {
      ctx.markStateExecuted(this.name, false, String(error), Date.now() - startTime);
      agentLog(`[Analytical] error: ${error}`);
      throw error;
    }
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return PROMPT_S2_ANALYTICAL;
  }

  private async callLLMWithTools(
    userMessage: string,
    ctx: SharedContext,
    interceptor: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>
  ): Promise<{ content: string }> {
    return new Promise((resolve, reject) => {
      let content = '';
      let toolCalls: { id: string; name: string; arguments: string }[] = [];
      let iteration = 0;
      const maxIterations = 4;

      const runIteration = (messages: any[]) => {
        if (iteration >= maxIterations) {
          resolve({ content });
          return;
        }

        iteration++;
        this.llmClient.streamChat(
          messages,
          [getTocTool.definition, searchDocTool.definition, getChapterTool.definition],
          {
            onContent: (text) => { content += text; },
            onToolCall: (calls) => {
              toolCalls = calls;
            },
            onComplete: async (finishReason) => {
              if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
                resolve({ content });
                return;
              }

              // 执行工具调用
              const toolResults: string[] = [];
              for (const tc of toolCalls) {
                try {
                  const args = JSON.parse(tc.arguments);
                  // 应用拦截器
                  const interceptedArgs = interceptor(tc.name, args);

                  let result: string;
                  switch (tc.name) {
                    case 'get_toc':
                      result = await getTocTool.execute(interceptedArgs, {
                        indexId: ctx.indexId,
                        pdfName: ctx.pdfName,
                        markdownFiles: ctx.markdownFiles,
                      });
                      break;
                    case 'search_doc':
                      result = await searchDocTool.execute(interceptedArgs, {
                        indexId: ctx.indexId,
                        pdfName: ctx.pdfName,
                        markdownFiles: ctx.markdownFiles,
                        scopeNodeIds: ctx.scopeNodeIds,
                      });
                      break;
                    case 'get_chapter':
                      result = await getChapterTool.execute(interceptedArgs, {
                        indexId: ctx.indexId,
                        pdfName: ctx.pdfName,
                        markdownFiles: ctx.markdownFiles,
                      });
                      break;
                    default:
                      result = `Unknown tool: ${tc.name}`;
                  }

                  toolResults.push(result);
                } catch (e) {
                  toolResults.push(`Error: ${e instanceof Error ? e.message : String(e)}`);
                }
              }

              // 添加工具结果到消息
              const newMessages = [
                ...messages,
                { role: 'assistant', content, tool_calls: toolCalls.map(tc => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })) },
                ...toolResults.map((result, idx) => ({
                  role: 'tool' as const,
                  tool_call_id: toolCalls[idx].id,
                  content: result,
                })),
              ];

              content = ''; // 重置内容累积
              toolCalls = [];
              runIteration(newMessages);
            },
            onError: reject,
          }
        );
      };

      runIteration([
        { role: 'system', content: '你是分析阅读专家。' },
        { role: 'user', content: userMessage },
      ]);
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/analytical.ts
git commit -m "feat(cognitive-engine): implement S2 Analytical state"
```

---

### Task 7: 实现 S4 格式化状态节点

**Files:**
- Create: `frontend/src/agent/cognitive-engine/states/formatter.ts`

- [ ] **Step 1: 创建 states/formatter.ts - S4 格式化实现**

```typescript
// frontend/src/agent/cognitive-engine/states/formatter.ts

import { StateNode } from './base.js';
import type { SharedContext } from '../context.js';
import type { ModelType, StateNodeOptions, EngineCallbacks } from '../types.js';
import { PROMPT_S4_FORMATTER } from '../prompts/formatter-prompt.js';
import { LLMClient } from '../../llm-client.js';
import { agentLog } from '../../utils/logger.js';

const MAX_HISTORY_MESSAGES = 10; // 最多保留 10 轮对话

/**
 * S4: 格式化状态节点
 * 职责：将生肉数据排版为带双链的 Markdown
 * 工具：无
 * 关键：注入历史（带 token 限制），保持对话连贯
 */
export class FormatterState extends StateNode {
  name = 'Formatter';
  model: ModelType = 'main';
  tools: string[] = [];
  options: StateNodeOptions = { timeout: 30000, retries: 1, retryDelay: 1000 };

  private llmClient: LLMClient;
  private callbacks: EngineCallbacks;

  constructor(llmClient: LLMClient, callbacks: EngineCallbacks) {
    super();
    this.llmClient = llmClient;
    this.callbacks = callbacks;
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // Token 限制：截断历史
      const recentHistory = ctx.chatHistory.slice(-MAX_HISTORY_MESSAGES);

      const userContent = `
用户的原话是：${ctx.rawUserQuery}

我在后台查到的分析结果是：
${ctx.analysisResult || '无分析结果'}

原始搜索结果（含 block_id）：
${ctx.rawResults ? JSON.stringify(ctx.rawResults, null, 2) : '无原始结果'}

请结合上下文语境，用奚童的口吻回答用户，并把引用转换为 Obsidian 双链格式。
`;

      const messages = [
        { role: 'system', content: PROMPT_S4_FORMATTER },
        ...recentHistory,
        { role: 'user', content: userContent },
      ];

      // 流式输出
      await new Promise<void>((resolve, reject) => {
        this.llmClient.streamChat(
          messages,
          [],
          {
            onContent: (text) => {
              this.callbacks.onContent(text);
            },
            onToolCall: () => {},
            onComplete: () => {
              this.callbacks.onComplete();
              resolve();
            },
            onError: (error) => {
              this.callbacks.onError(error);
              reject(new Error(error));
            },
          }
        );
      });

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
      agentLog(`[Formatter] 格式化完成`);

    } catch (error) {
      ctx.markStateExecuted(this.name, false, String(error), Date.now() - startTime);
      agentLog(`[Formatter] error: ${error}`);
      throw error;
    }
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return PROMPT_S4_FORMATTER;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/formatter.ts
git commit -m "feat(cognitive-engine): implement S4 Formatter state"
```

---

## Chunk 4: 主控调度引擎

### Task 8: 实现 CognitiveEngine 主控调度

**Files:**
- Create: `frontend/src/agent/cognitive-engine/engine.ts`
- Create: `frontend/src/agent/cognitive-engine/index.ts`

- [ ] **Step 1: 创建 engine.ts - 主控调度实现**

```typescript
// frontend/src/agent/cognitive-engine/engine.ts

import { SharedContextImpl, type SharedContext } from './context.js';
import type { EngineCallbacks } from './types.js';
import { RouterState } from './states/router.js';
import { InspectionalState } from './states/inspectional.js';
import { AnalyticalState } from './states/analytical.js';
import { FormatterState } from './states/formatter.js';
import { LLMClient } from '../llm-client.js';
import { agentLog } from '../utils/logger.js';

export interface CognitiveEngineOptions {
  indexId: string;
  pdfName: string;
  rawUserQuery: string;
  chatHistory: Array<{ role: string; content: string }>;
  markdownFiles?: Record<string, string>;
  abortSignal?: AbortSignal;
  fastModel?: string;
  mainModel?: string;
}

/**
 * 运行认知引擎
 * 主控调度：根据深度分发到不同状态节点
 */
export async function runCognitiveEngine(
  options: CognitiveEngineOptions,
  callbacks: EngineCallbacks,
  llmClient: LLMClient
): Promise<string> {
  // 1. 创建 SharedContext
  const ctx: SharedContext = new SharedContextImpl();
  ctx.indexId = options.indexId;
  ctx.pdfName = options.pdfName;
  ctx.rawUserQuery = options.rawUserQuery;
  ctx.chatHistory = options.chatHistory as any;
  ctx.markdownFiles = options.markdownFiles;
  ctx.abortSignal = options.abortSignal;

  // 2. S0: 路由 + Query Rewrite
  callbacks.onProgress('🌀 正在研判问题深度...');
  const routerState = new RouterState(llmClient);
  await routerState.execute(ctx);

  agentLog(`[Engine] 路由完成: depth=${ctx.depth}, standaloneQuery="${ctx.standaloneQuery}"`);

  // 3. 根据深度分发
  switch (ctx.depth) {
    case 0:
      // 日常闲聊，直接交给 S4
      callbacks.onProgress('💬 日常闲聊模式...');
      break;

    case 1:
      // 检视阅读
      callbacks.onProgress('🗺️ 正在扫描书籍宏观框架...');
      const inspectionalState = new InspectionalState(llmClient);
      await inspectionalState.execute(ctx);
      break;

    case 2:
      // 分析阅读（S2 内部会自动调用 S1）
      callbacks.onProgress('🔍 正在与作者达成共识并解构逻辑...');
      const analyticalState = new AnalyticalState(llmClient);
      await analyticalState.execute(ctx);
      break;

    case 3:
      // 主题阅读（延后实现，暂时降级）
      callbacks.onProgress('⚠️ 主题阅读暂未实现，降级为分析阅读...');
      ctx.depth = 2;
      const analyticalStateForS3 = new AnalyticalState(llmClient);
      await analyticalStateForS3.execute(ctx);
      break;
  }

  // 4. S4: 格式化输出
  callbacks.onProgress('📝 正在排版双链笔记...');
  const formatterState = new FormatterState(llmClient, callbacks);
  await formatterState.execute(ctx);

  // 5. 保存会话（只保存前台记录）
  saveSession(ctx);

  return ctx.chatHistory[ctx.chatHistory.length - 1]?.content || '';
}

/**
 * 保存会话（只保存前台记录）
 */
function saveSession(ctx: SharedContext): void {
  // 后台数据 (scopeNodeIds, rawResults 等) 自动丢弃
  // 只保留前台聊天记录
  agentLog(`[Engine] 会话已保存，共 ${ctx.chatHistory.length} 条消息`);
}
```

- [ ] **Step 2: 创建 index.ts - 导出入口**

```typescript
// frontend/src/agent/cognitive-engine/index.ts

export { runCognitiveEngine, type CognitiveEngineOptions } from './engine.js';
export { SharedContextImpl, type SharedContext } from './context.js';
export type { 
  StateResult, 
  StateNodeOptions, 
  ToolInterceptor, 
  EngineCallbacks,
  ModelType,
  RouterOutput,
  InspectionalOutput,
} from './types.js';
export { StateNode } from './states/base.js';
export { RouterState } from './states/router.js';
export { InspectionalState } from './states/inspectional.js';
export { AnalyticalState } from './states/analytical.js';
export { FormatterState } from './states/formatter.js';
export { createScopeInterceptor } from './interceptor/scope-interceptor.js';
```

- [ ] **Step 3: 运行 TypeScript 检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -E "error" | head -30`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/cognitive-engine/engine.ts frontend/src/agent/cognitive-engine/index.ts
git commit -m "feat(cognitive-engine): implement main cognitive engine"
```

---

## Chunk 5: 集成测试

### Task 9: 集成测试 - 与现有 UI 集成

**Files:**
- Modify: `frontend/src/agent/index.ts` (添加导出)
- Test: 创建集成测试文件

- [ ] **Step 1: 修改 agent/index.ts 添加导出**

```typescript
// 在 frontend/src/agent/index.ts 中添加
export { runCognitiveEngine } from './cognitive-engine/engine.js';
export type { CognitiveEngineOptions } from './cognitive-engine/engine.js';
```

- [ ] **Step 2: 创建集成测试**

```typescript
// frontend/src/agent/cognitive-engine/__tests__/integration.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCognitiveEngine } from '../engine.js';
import { LLMClient } from '../../llm-client.js';

// Mock LLMClient
vi.mock('../../llm-client.js', () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    streamChat: vi.fn().mockImplementation((messages, tools, callbacks) => {
      // 模拟返回
      if (messages[1]?.content?.includes('检视阅读')) {
        // S1 返回
        callbacks.onContent('{"scopeNodeIds": ["node_c1", "node_c2"], "tocSummary": "相关章节"}');
        callbacks.onComplete('stop');
      } else if (messages[1]?.content?.includes('分析阅读')) {
        // S2 返回
        callbacks.onContent('分析结果...');
        callbacks.onComplete('stop');
      } else if (messages[1]?.content?.includes('奚童')) {
        // S4 返回
        callbacks.onContent('这是格式化后的回答');
        callbacks.onComplete('stop');
      } else {
        // S0 返回
        callbacks.onContent('{"depth": 2, "standalone_query": "测试问题", "reason": "分析阅读"}');
        callbacks.onComplete('stop');
      }
      return { abort: vi.fn() };
    }),
  })),
}));

describe('CognitiveEngine', () => {
  let mockLlmClient: LLMClient;

  beforeEach(() => {
    mockLlmClient = new LLMClient({ apiKey: 'test-key' });
  });

  it('should run full cognitive engine flow', async () => {
    const callbacks = {
      onProgress: vi.fn(),
      onContent: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const result = await runCognitiveEngine(
      {
        indexId: 'test-index',
        pdfName: '测试书籍',
        rawUserQuery: '什么是MECE？',
        chatHistory: [],
      },
      callbacks,
      mockLlmClient
    );

    expect(callbacks.onProgress).toHaveBeenCalled();
    expect(callbacks.onContent).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `cd frontend && npm run test:run -- --run cognitive-engine 2>&1 | tail -30`
Expected: 测试通过

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/index.ts frontend/src/agent/cognitive-engine/__tests__/integration.test.ts
git commit -m "test(cognitive-engine): add integration tests"
```

---

## 实施完成检查清单

- [ ] Chunk 1: 核心框架
  - [x] Task 1: 类型定义和 SharedContext
  - [x] Task 2: 状态节点基类和工具函数
  - [x] Task 3: 提示词模块

- [ ] Chunk 2: S0 + S1 状态节点
  - [x] Task 4: S0 路由器
  - [x] Task 5: S1 检视阅读

- [ ] Chunk 3: S2 + S4 状态节点
  - [x] Task 6: S2 分析阅读
  - [x] Task 7: S4 格式化

- [ ] Chunk 4: 主控调度引擎
  - [x] Task 8: CognitiveEngine 主控调度

- [ ] Chunk 5: 集成测试
  - [x] Task 9: 集成测试

---

## 后续工作（不在本计划范围内）

1. **与 Obsidian UI 集成**: 将 `runCognitiveEngine` 接入现有的 sidebar-view
2. **流式输出优化**: 确保 S2 和 S4 的流式输出正常工作
3. **多轮对话测试**: 测试完整的对话流程
4. **S3 主题阅读**: 延后实现

---

*本计划基于艾德勒《如何阅读一本书》的方法论，将阅读层次转化为确定性状态机架构。*