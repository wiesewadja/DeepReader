# DeepReader 认知状态机架构设计

> **目标**: 将艾德勒《如何阅读一本书》的阅读方法论转化为确定性状态机架构

**生成日期**: 2026-03-18
**状态**: 设计完成，待实现

---

## 一、设计哲学

### 1.1 核心转变

从 **"LLM 自主探索"** 到 **"TypeScript 强控编排"**

- 传统 ReAct Agent：LLM 自主决定调用什么工具、何时结束 → 幻觉、死循环、Token 浪费
- 认知状态机：TypeScript 代码强控编排，LLM 在固定状态节点被唤醒 → 零幻觉、确定性输出

### 1.2 艾德勒阅读法映射

| 阅读层次 | 状态节点 | 核心任务 |
|---------|---------|---------|
| 基础阅读 | - | 用户自行完成 |
| 检视阅读 | S1 | 掌握骨架，圈定战区 |
| 分析阅读 | S2 | 词汇共识，逻辑解构 |
| 主题阅读 | S3 | 跨书对比，辩证统合 |

---

## 二、架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DeepReader Cognitive Engine                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │   S0    │───▶│   S1    │───▶│   S2    │───▶│   S4    │──▶ 输出     │
│  │ 路由器   │    │ 检视阅读 │    │ 分析阅读 │    │ 格式化   │             │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘             │
│       │              │              │              │                   │
│       │              ▼              ▼              │                   │
│       │        ┌──────────────────────────┐       │                   │
│       │        │     SharedContext        │       │                   │
│       │        │  - chatHistory           │       │                   │
│       │        │  - rawUserQuery          │       │                   │
│       │        │  - standaloneQuery       │       │                   │
│       │        │  - scopeNodeIds          │       │                   │
│       │        │  - analysisResult        │       │                   │
│       │        └──────────────────────────┘       │                   │
│       │                                           │                   │
│       ▼                                           ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    LLMClient (多模型支持)                        │   │
│  │  - fastModel: gpt-4o-mini / deepseek-chat (S0, S1)              │   │
│  │  - mainModel: deepseek-reasoner / claude (S2, S4)               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    ToolRegistry + Interceptor                   │   │
│  │  - get_toc, search_doc, get_chapter, analyze_chapter            │   │
│  │  - createScopeInterceptor: 物理锁死搜索范围                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、状态流转规则

### 3.1 深度路由

```
depth=0 (日常闲聊)  → S4 直接输出
depth=1 (检视阅读)  → S1 → S4
depth=2 (分析阅读)  → S1 → S2 → S4
depth=3 (主题阅读)  → S1 → S2 → S3 → S4 (延后实现，暂时降级为 depth=2)
```

### 3.2 累加式调用

高深度状态内部调用低深度状态（函数复用）：

```typescript
// S2 内部调用 S1
class AnalyticalState {
  async execute(ctx: SharedContext) {
    if (!ctx.scopeNodeIds) {
      await inspectionalState.execute(ctx);  // 累加性保证
    }
    // ... S2 专属逻辑
  }
}

// S3 内部多次调用 S2
class SyntopicalState {
  async execute(ctx: SharedContext) {
    const book1 = await runAnalytical(ctx, "在书1中，" + query);
    const book2 = await runAnalytical(ctx, "在书2中，" + query);
    // ... 跨书辩证
  }
}
```

---

## 四、SharedContext 数据结构

```typescript
interface SharedContext {
  // ===== 聊天记录 =====
  chatHistory: ChatMessage[];     // 前台纯净历史（只有 User + Assistant）
  rawUserQuery: string;           // 用户原话

  // ===== S0 输出 =====
  depth: 0 | 1 | 2 | 3;
  detectedIntents: string[];
  standaloneQuery?: string;       // 独立提问（Rewrite 后）

  // ===== S1 输出 =====
  scopeNodeIds?: string[];        // 锁定的章节范围
  tocSummary?: string;            // 大纲摘要

  // ===== S2 输出 =====
  rawResults?: SearchResult[];    // 原始搜索结果（含 block_id）
  analysisResult?: string;        // 分析结论

  // ===== S3 输出（延后实现）=====
  globalPassages?: SearchResult[];  // 跨书本素材
  syntopicalInsight?: string;       // 辩证统合洞见

  // ===== 运行时 =====
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;

  // ===== 状态执行追踪 =====
  executedStates: Set<string>;    // 已执行的状态节点
  stateResults: Map<string, StateResult>;
}

interface StateResult {
  success: boolean;
  timestamp: number;
  error?: string;
  duration?: number;
}

// SharedContext 扩展方法
class SharedContextImpl implements SharedContext {
  // ... 其他字段 ...

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

---

## 五、工具函数与错误处理

### 5.1 健壮的 JSON 解析

```typescript
import { z } from 'zod';

class StateParseError extends Error {
  constructor(message: string, public rawContent: string) {
    super(message);
    this.name = 'StateParseError';
  }
}

/**
 * 从 LLM 响应中安全解析 JSON
 * 1. 支持提取 ```json 代码块
 * 2. 支持直接 JSON 对象匹配
 * 3. 使用 Zod 进行 schema 校验
 */
function parseStateOutput<T>(
  content: string,
  schema: z.ZodSchema<T>,
  fallback?: T
): T {
  // 1. 尝试提取 JSON 代码块
  const jsonBlockMatch = content.match(/```json\n([\s\S]*?)\n```/);
  // 2. 尝试直接匹配 JSON 对象
  const jsonObjectMatch = content.match(/\{[\s\S]*\}/);

  const jsonStr = jsonBlockMatch?.[1] || jsonObjectMatch?.[0];

  if (!jsonStr) {
    if (fallback !== undefined) return fallback;
    throw new StateParseError('No JSON found in LLM response', content);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return schema.parse(parsed);
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new StateParseError(
      `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
      content
    );
  }
}

// S1 输出的 schema 定义
const InspectionalOutputSchema = z.object({
  scopeNodeIds: z.array(z.string()).min(1).max(5),
  reasoning: z.string(),
});

// S0 输出的 schema 定义
const RouterOutputSchema = z.object({
  depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  standalone_query: z.string().optional(),
  reasoning: z.string().optional(),
});
```

### 5.2 状态超时与重试机制

```typescript
interface StateNodeOptions {
  timeout?: number;        // 状态执行超时（毫秒），默认 30000
  retries?: number;        // 重试次数，默认 1
  retryDelay?: number;     // 重试延迟（毫秒），默认 1000
}

class StateTimeoutError extends Error {
  constructor(stateName: string, timeout: number) {
    super(`State ${stateName} timed out after ${timeout}ms`);
    this.name = 'StateTimeoutError';
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  stateName: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new StateTimeoutError(stateName, timeout)), timeout)
    ),
  ]);
}

async function withRetry<T>(
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
```

---

## 六、状态节点设计

### 5.1 状态节点基类

```typescript
abstract class StateNode {
  abstract readonly name: string;
  abstract readonly model: 'fast' | 'main';
  abstract readonly tools: string[];

  abstract execute(ctx: SharedContext): Promise<void>;
  abstract buildSystemPrompt(ctx: SharedContext): string;
}
```

### 5.2 状态工具表

| 状态 | 模型 | 工具 | 说明 |
|------|------|------|------|
| S0 Router | fast | 无 | 纯分类 + Query Rewrite |
| S1 Inspectional | fast | `get_toc` | 只看大纲，剥夺 search_doc |
| S2 Analytical | main | `search_doc`, `get_chapter` | LLM 自主调用，TS 拦截加锁 |
| S3 Syntopical | main | `search_read_books` | 跨书搜索（延后实现） |
| S4 Formatter | main | 无 | 纯排版，无工具 |

---

## 六、核心机制

### 6.1 ToolInterceptor（工具拦截器）

物理锁死搜索范围，防止 LLM 越界：

```typescript
interface ToolInterceptor {
  (toolName: string, toolArgs: Record<string, unknown>): Record<string, unknown>;
}

function createScopeInterceptor(scopeNodeIds: string[]): ToolInterceptor {
  return (toolName, toolArgs) => {
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

### 6.2 Query Rewrite（提问重写）

S0 附加任务：结合历史记录，将模糊提问改写为独立问题

```typescript
// 输入
rawUserQuery: "那作者是怎么应用它的？"
chatHistory: [
  { role: 'user', content: '什么是MECE？' },
  { role: 'assistant', content: 'MECE是...' }
]

// 输出
standaloneQuery: "作者是如何应用 MECE 原则的？"
```

---

## 七、上下文管理机制

### 7.1 前台/后台分离

```
┌─────────────────────────────────────────────────────────────────┐
│           前台聊天记录 (Chat History)                            │
│  - 只包含 User 提问 + S4 最终回答                               │
│  - 无工具调用，无 JSON，持久化存储                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│           后台工作记录 (Trace) ── 用完即弃                       │
│  - scopeNodeIds, rawResults, analysisResult                     │
│  - 仅存在于当次 SharedContext 中                                │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 上下文分发规则

| 状态 | 是否看历史 | 原因 |
|------|-----------|------|
| S0 Router | ✅ 看 | 需要 Rewrite Query |
| S1 Inspectional | ❌ 不看 | 只用 standaloneQuery，避免污染 |
| S2 Analytical | ❌ 不看 | 只用 standaloneQuery，专注分析 |
| S3 Syntopical | ❌ 不看 | 只用 standaloneQuery，跨书统合 |
| S4 Formatter | ✅ 看 | 保持对话连贯，理解语境 |

### 7.3 会话持久化

```typescript
function saveSession(ctx: SharedContext, finalOutput: string) {
  // 只保存纯净的前台记录
  ctx.chatHistory.push({ role: 'user', content: ctx.rawUserQuery });
  ctx.chatHistory.push({ role: 'assistant', content: finalOutput });

  // 后台数据 (scopeNodeIds, rawResults 等) 自动丢弃
}
```

---

## 八、各状态节点详细设计

### 8.1 S0: Router + Query Rewriter

**职责**：
1. 判断阅读深度 (0, 1, 2, 3)
2. 将模糊提问改写为独立问题

**路由方式**：混合模式（正则优先，LLM fallback）

#### 正则规则与 Depth 映射

复用现有 `IntentRouter` 配置，扩展 depth 字段：

```json
// intent-rules.json 扩展
{
  "rules": [
    {
      "id": "macro_overview",
      "pattern": "总结|大纲|概括|全书|核心观点|讲了什么",
      "intent": "检视阅读",
      "depth": 1
    },
    {
      "id": "concept_inquiry",
      "pattern": "如何理解|什么是|解释一下|定义|概念",
      "intent": "分析阅读",
      "depth": 2
    },
    {
      "id": "syntopical",
      "pattern": "对比|结合|另一本|异同|主题阅读",
      "intent": "主题阅读",
      "depth": 3
    }
  ],
  "fallback": { "depth": 2 }
}
```

#### 完整实现

```typescript
class RouterState extends StateNode {
  name = 'Router';
  model = 'fast' as const;
  tools = [];
  options = { timeout: 5000, retries: 1 };

  private intentRouter: IntentRouter;

  constructor(config: IntentRulesConfig) {
    super();
    this.intentRouter = new IntentRouter(config);
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. 正则匹配
      const regexResult = this.tryRegexRoute(ctx.rawUserQuery);

      if (regexResult && !regexResult.needsRewrite) {
        ctx.depth = regexResult.depth;
        ctx.standaloneQuery = ctx.rawUserQuery;
        ctx.markStateExecuted(this.name, true);
        return;
      }

      // 2. LLM fallback
      const response = await withRetry(
        () => withTimeout(this.callLLM(ctx), this.options.timeout!, this.name),
        this.options.retries!, 1000
      );

      const parsed = parseStateOutput(response.content, RouterOutputSchema, {
        depth: 2,
        standalone_query: ctx.rawUserQuery,
      });

      ctx.depth = parsed.depth;
      ctx.standaloneQuery = parsed.standalone_query || ctx.rawUserQuery;
      ctx.markStateExecuted(this.name, true);

    } catch (error) {
      // 降级策略
      ctx.depth = 2;
      ctx.standaloneQuery = ctx.rawUserQuery;
      ctx.markStateExecuted(this.name, false, String(error));
    }
  }

  private tryRegexRoute(query: string): { depth: number; needsRewrite: boolean } | null {
    const result = this.intentRouter.analyze(query);
    const depthMap: Record<string, number> = {
      '检视阅读': 1, '分析阅读': 2, '主题阅读': 3
    };
    const depth = depthMap[result.detectedIntents[0]];
    if (depth === undefined) return null;

    // 包含代词的短句需要 rewrite
    const needsRewrite = /(它|这个|那个)/.test(query) || query.length < 10;
    return { depth, needsRewrite };
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return `你是路由器。结合历史，判断深度并重写问题。

<history>
${ctx.chatHistory.map(m => `${m.role}: ${m.content}`).join('\n')}
</history>

<depth>0=闲聊,1=检视,2=分析,3=主题</depth>

输出JSON: {"depth":2,"standalone_query":"...","reasoning":"..."}`;
  }
}
```

### 8.2 S1: Inspectional State

**职责**：获取大纲，圈定章节范围

**工具**：只保留 `get_toc`，剥夺 `search_doc`

```typescript
class InspectionalState extends StateNode {
  name = 'Inspectional';
  model = 'fast' as const;
  tools = ['get_toc'];  // 只有 get_toc！

  async execute(ctx: SharedContext): Promise<void> {
    const response = await runStateLoop({
      model: this.model,
      systemPrompt: this.buildSystemPrompt(ctx),
      userMessage: ctx.standaloneQuery,  // 用独立提问，不看历史
      availableTools: this.tools,
      // 注意：没有传 chatHistory！
    });

    const parsed = JSON.parse(response.content);
    ctx.scopeNodeIds = parsed.scopeNodeIds;
    ctx.tocSummary = parsed.reasoning;
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return `你是检视阅读专家。你的任务是快速定位问题所属的章节范围。

<workflow>
1. 使用 get_toc 获取全书目录
2. 根据用户问题，判断最相关的 1-3 个章节
3. 返回这些章节的 node_id 列表
</workflow>

输出格式：
{
  "scopeNodeIds": ["node_c4", "node_c5"],
  "reasoning": "根据问题关键词，判断主要涉及第4章和第5章..."
}`;
  }
}
```

### 8.3 S2: Analytical State

**职责**：在限定范围内深入分析概念和逻辑

**工具**：`search_doc`, `get_chapter`

**关键机制**：ToolInterceptor 物理锁死搜索范围

```typescript
class AnalyticalState extends StateNode {
  name = 'Analytical';
  model = 'main' as const;
  tools = ['search_doc', 'get_chapter'];

  async execute(ctx: SharedContext): Promise<void> {
    // 1. 累加性保证：缺失范围则调用 S1
    if (!ctx.scopeNodeIds) {
      await inspectionalState.execute(ctx);
    }

    // 2. 创建范围锁拦截器
    const interceptor = createScopeInterceptor(ctx.scopeNodeIds!);

    // 3. 将控制权交给 LLM
    const response = await runStateLoop({
      model: this.model,
      systemPrompt: this.buildSystemPrompt(ctx),
      userMessage: ctx.standaloneQuery,  // 用独立提问，不看历史
      availableTools: this.tools,
      toolInterceptor: interceptor,  // 物理锁死
      callbacks: {
        onContent: (text) => { /* 流式输出 */ },
      },
    });

    ctx.analysisResult = response.content;
    ctx.rawResults = response.toolResults;
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return `你是分析阅读专家。你的任务是在限定范围内深入解构问题。

<constraint>
你已被物理限制在以下章节范围内搜索：
${ctx.scopeNodeIds?.map(id => `- ${id}`).join('\n')}

你绝对无法访问这些章节之外的任何内容。
</constraint>

<workflow>
1. 先用 search_doc 查明核心概念的原始定义
2. 基于定义，用 get_chapter 提取作者的论证逻辑
3. 返回纯净的分析结论，附带引用（包含 block_id）
</workflow>`;
  }
}
```

### 8.4 S4: Formatter State

**职责**：将生肉数据排版为带双链的 Markdown

**工具**：无

**关键**：注入历史（带 token 限制），保持对话连贯

```typescript
const MAX_HISTORY_MESSAGES = 10;  // 最多保留 10 轮对话

class FormatterState extends StateNode {
  name = 'Formatter';
  model = 'main' as const;
  tools = [];

  async execute(ctx: SharedContext): Promise<void> {
    // Token 限制：截断历史
    const recentHistory = ctx.chatHistory.slice(-MAX_HISTORY_MESSAGES);

    const messages = [
      { role: 'system', content: this.buildSystemPrompt(ctx) },
      ...recentHistory,  // 使用截断后的历史
      {
        role: 'user',
        content: `
用户的原话是：${ctx.rawUserQuery}

我在后台查到的分析结果是：
${ctx.analysisResult}

原始搜索结果（含 block_id）：
${JSON.stringify(ctx.rawResults, null, 2)}

请结合上下文语境，用奚童的口吻回答用户，并把引用转换为 Obsidian 双链格式。
        `
      },
    ];

    await streamLLM({
      model: this.model,
      messages,
      onContent: (text) => { /* 流式输出 */ },
    });
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return `你是奚童，昭先生的专属知识助理。

【排版铁律：强制双链化】
你接收到的生肉数据（rawResults）中，包含了 block_id 引用。

✅ 正确：[[书籍名#^block_id|自然文本]]
❌ 错误：(^block_id) 或 [^1]

<rules>
1. 将 block_id 转换为双链格式
2. 保持对话连贯
3. 如无结果，坦诚告知
4. 不编造信息
</rules>`;
  }
}

---

## 九、主控调度流

```typescript
// cognitive-engine.ts

export async function runCognitiveEngine(
  ctx: SharedContext,
  callbacks: EngineCallbacks
): Promise<string> {

  // 1. S0: 路由 + Query Rewrite
  callbacks.onProgress('🌀 正在研判问题深度...');
  await routerState.execute(ctx);

  // 2. 根据深度分发
  switch (ctx.depth) {
    case 0:
      // 日常闲聊，直接交给 S4
      break;

    case 1:
      // 检视阅读
      callbacks.onProgress('🗺️ 正在扫描书籍宏观框架...');
      await inspectionalState.execute(ctx);
      break;

    case 2:
      // 分析阅读（S2 内部会自动调用 S1）
      callbacks.onProgress('🔍 正在与作者达成共识并解构逻辑...');
      await analyticalState.execute(ctx);
      break;

    case 3:
      // 主题阅读（延后实现，暂时降级）
      callbacks.onProgress('⚠️ 主题阅读暂未实现，降级为分析阅读...');
      ctx.depth = 2;
      await analyticalState.execute(ctx);
      break;
  }

  // 3. S4: 格式化输出
  callbacks.onProgress('📝 正在排版双链笔记...');
  const output = await formatterState.execute(ctx);

  // 4. 保存会话（只保存前台记录）
  saveSession(ctx, output);

  return output;
}
```

---

## 十、文件结构

```
frontend/src/agent/
├── cognitive-engine/
│   ├── index.ts              # 导出入口
│   ├── engine.ts             # 主控调度
│   ├── context.ts            # SharedContext 定义
│   ├── types.ts              # 类型定义
│   ├── states/
│   │   ├── base.ts           # StateNode 基类
│   │   ├── router.ts         # S0 路由器
│   │   ├── inspectional.ts   # S1 检视阅读
│   │   ├── analytical.ts     # S2 分析阅读
│   │   ├── syntopical.ts     # S3 主题阅读（延后）
│   │   └── formatter.ts      # S4 格式化
│   ├── interceptor/
│   │   └── scope-interceptor.ts  # 工具拦截器
│   └── prompts/
│       ├── router-prompt.ts      # S0 提示词
│       ├── inspectional-prompt.ts # S1 提示词
│       ├── analytical-prompt.ts   # S2 提示词
│       └── formatter-prompt.ts    # S4 提示词
├── llm-client.ts             # LLM 客户端（多模型支持）
├── tools/                    # 工具定义（复用现有）
└── agent-loop.ts             # 废弃，由 cognitive-engine 替代
```

---

## 十一、三大护城河

### 11.1 数据隔离与流转

每个状态节点有明确的责任田：
- S1 只负责 `scopeNodeIds` 和 `tocSummary`
- S2 只负责 `rawResults` 和 `analysisResult`
- S3 只负责 `globalPassages` 和 `syntopicalInsight`

数据流转呈现单向瀑布流，Bug 定位一目了然。

### 11.2 物理级越权拦截

```typescript
if (toolName === 'search_doc') {
  toolArgs.scopeNodeIds = scopeNodeIds; // 物理锁死
}
```

用确定性的代码，驯服概率性的 AI。

### 11.3 模型算力精准调配

| 任务 | 模型 | 原因 |
|------|------|------|
| S0 分类 + S1 看大纲 | fast (mini) | 对智商要求低，对速度要求高 |
| S2 分析 + S4 排版 | main (full) | 真正的逻辑拆解需要最强算力 |

预计 API 成本压缩 60% 以上。

---

## 十、提示词工程 (Prompt Engineering)

> **核心原则**：每个状态节点的提示词是其《标准操作程序（SOP）》。使用 XML 标签结构化写法，最大化触发 Prompt Caching，保证极高的指令遵从度。

### 10.1 S0 路由器 (Router & Rewriter)

**核心目标**：绝不废话，只输出 JSON；结合历史记录补全代词。
**推荐模型**：gpt-4o-mini 或 Claude 3 Haiku (极速且便宜)

```typescript
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

**TS 注入建议**：将 `ctx.chatHistory` 拼接到 Prompt 的 User Message 中。

### 10.2 S1 检视阅读官 (Inspectional State)

**核心目标**：只查目录，锁定战区。**物理剥夺**看正文的能力。
**推荐模型**：gpt-4o-mini 或 Claude 3 Haiku

```typescript
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

**TS 注入建议**：User Message 只需传入 S0 翻译好的 `ctx.standaloneQuery`。

### 10.3 S2 分析阅读官 (Analytical State)

**核心目标**：冷血的逻辑解剖，强制"先定义，后逻辑"。
**推荐模型**：gpt-4o 或 Claude 3.5 Sonnet (需要极强推理能力)

```typescript
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

**TS 注入建议**：通过 `toolInterceptor` 强行把 `ctx.scopeNodeIds` 注入大模型的 `search_doc` 调用中。

### 10.4 S4 知识交付官 (Formatter State)

**核心目标**：化腐朽为神奇，完美结合 Obsidian 双链与昭先生的审美。
**推荐模型**：gpt-4o 或 Claude 3.5 Sonnet

```typescript
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

<context_data>
这是后台分析师提供给你的生肉数据：
{{raw_analysis_result}}

这是当前的参考书名：{{book_name}}
</context_data>
`;
```

**TS 注入建议**：将 `ctx.chatHistory` 和 S2 产出的 `ctx.analysisResult` 组装进这个 Prompt。

### 10.5 为什么这套 Prompt 会产生"化学反应"

1. **职责清晰**：S1 不用操心双链怎么写，S4 也不用操心 `search_doc` 怎么调用。每个状态的 CPU 都 100% 用在刀刃上。
2. **XML 标签的威力**：使用 `<role>`, `<workflow>`, `<constraints>` 这种标签，是大模型注意力机制的最爱。它能极其清晰地划定指令的边界，防止大模型遗忘规则。
3. **S2 的"生肉"与 S4 的"熟肉"**：S2 的输出规则写明了"不需要华丽的排版"，这就逼迫大模型把所有的 Token 都用来输出密密麻麻的逻辑细节和 `^block_id`。当这块多汁的"生肉"喂给 S4 时，S4 就能挥洒自如地做成一份极其精美的 Obsidian 知识大餐。

---

## 十一、实施计划

### Phase 1: 核心框架
- 实现 SharedContext 和 StateNode 基类
- 实现 CognitiveEngine 主控调度
- 实现多模型 LLMClient

### Phase 2: S0 + S1
- 实现混合路由（正则 + LLM fallback）
- 实现 Query Rewrite
- 实现 S1 检视阅读

### Phase 3: S2 + S4
- 实现 ToolInterceptor
- 实现 S2 分析阅读
- 实现 S4 格式化

### Phase 4: 集成测试
- 与现有 Obsidian UI 集成
- 流式输出测试
- 多轮对话测试

### Phase 5 (延后): S3 主题阅读
- 跨书搜索
- 概念对齐
- 辩证统合

---

*本设计基于艾德勒《如何阅读一本书》的方法论，将阅读层次转化为确定性状态机架构。*
