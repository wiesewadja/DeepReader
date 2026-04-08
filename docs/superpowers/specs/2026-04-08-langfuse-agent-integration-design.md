# Langfuse Agent 集成设计

**日期**: 2026-04-08
**范围**: 前端 Agent（Obsidian 插件）
**目标**: 全面可观测性 — LLM 调用追踪 + Agent 执行链路追踪

---

## 1. 概述

为 DeepReader 前端 Agent 集成自托管的 Langfuse 可观测性平台，实现完全追踪：认知引擎状态机流转、工具调用、子 Agent、内存操作、LLM 调用全部纳入追踪。

同时移除现有的文件级 debug logger（`agent/debug/`），由 Langfuse 统一承担开发调试和生产可观测性职责。

## 2. 模块架构

### 2.1 新增模块

```
frontend/src/agent/tracing/
  ├── index.ts              # 导出
  ├── tracer.ts             # LangfuseTracer 单例，初始化 Langfuse client
  ├── noop-tracer.ts        # 环境变量缺失时的 no-op 实现
  └── trace-context.ts      # TraceContext：在模块间传递 observation 引用
```

### 2.2 删除模块

```
frontend/src/agent/debug/
  ├── index.ts              # 移除
  ├── logger.ts             # 移除
  ├── types.ts              # 移除
  └── __tests__/logger.test.ts  # 移除
```

以下文件中的 `debugLogger` 引用需同步移除（共 8 个文件，约 33 处引用）：
- `agent-loop.ts`（14 处）
- `cognitive-engine/engine.ts`（4 处）
- `router/intent-router.ts`（2 处）
- `cognitive-engine/states/inspectional.ts`（2 处）
- `cognitive-engine/states/run-state-loop.ts`（2 处）
- `agent/index.ts`（3 处导出和导入）

### 2.3 依赖

新增 2 个 npm 依赖：
- `@langfuse/client` — Langfuse v5 API 客户端（2026年3月发布的 v5 重写版）
- `@langfuse/tracing` — v5 的追踪模块，提供 `startObservation` / `startActiveObservation`

不使用 `@langfuse/openai`，因为 LLMClient 是手写 fetch 实现，不适合 OpenAI Wrapper。

## 3. 核心组件

### 3.1 LangfuseTracer（单例）

初始化时读取配置（来源见 3.4 节）：
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_HOST`（自托管地址，如 `http://localhost:3000`）
- `LANGFUSE_ENABLED`（可选显式开关）

三个必填变量齐全且 `LANGFUSE_ENABLED !== 'false'` 时创建真实 Langfuse client；否则创建 NoopTracer。

```typescript
import { LangfuseClient } from "@langfuse/client";

interface ILangfuseTracer {
  createTrace(params: {
    name: string;
    sessionId: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): ITraceContext;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
```

### 3.2 TraceContext（不可变传递）

通过函数参数在模块间显式传递。不使用 AsyncLocalStorage（Obsidian 插件环境限制）。

基于 Langfuse v5 的 `startObservation` API：

```typescript
interface ITraceContext {
  /** 创建子 observation（对应 Langfuse v5 的 startObservation），返回新的 context（不可变） */
  withSpan(name: string, metadata?: Record<string, unknown>): ITraceContext;

  /** 创建子 generation observation */
  withGeneration(name: string, params: {
    model?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): IObservationRef;

  /** 结束当前 observation */
  end(output?: Record<string, unknown>): void;

  /** 获取 trace ID（用于 Langfuse UI 链接） */
  getTraceId(): string | undefined;
}
```

**实现核心**（trace-context.ts 内部）：

```typescript
import { startObservation } from "@langfuse/tracing";

class LangfuseTraceContext implements ITraceContext {
  private observation: Observation;  // Langfuse v5 Observation 对象

  constructor(observation: Observation) {
    this.observation = observation;
  }

  withSpan(name: string, metadata?: Record<string, unknown>): ITraceContext {
    // v5 API: 在父 observation 上创建子 observation
    const child = this.observation.startObservation(
      name,
      { ...metadata },
      { asType: "span" }
    );
    return new LangfuseTraceContext(child);
  }

  withGeneration(name: string, params): IObservationRef {
    return this.observation.startObservation(
      name,
      { input: params.input, model: params.model, ...params.metadata },
      { asType: "generation" }
    );
  }

  end(output?: Record<string, unknown>): void {
    if (output) {
      this.observation.update({ output }).end();
    } else {
      this.observation.end();
    }
  }

  getTraceId(): string | undefined {
    return this.observation.traceId;
  }
}
```

**不可变模式**：`withSpan()` 创建新的 `LangfuseTraceContext` 实例包装子 observation，原实例不变。并行子 Agent 场景中每个子任务持有独立 context，互不干扰。

### 3.3 NoopTracer

所有方法为空操作：
- `createTrace()` 返回 `NoopTraceContext`
- `flush()` / `shutdown()` 为空函数
- `NoopTraceContext.withSpan()` 返回自身
- `NoopTraceContext.end()` 不做任何事
- 零性能开销，零 console 输出

### 3.4 配置来源

Obsidian 插件运行在 Electron 渲染进程中，`process.env` 可用但用户设置体验不佳。采用**双重来源**策略：

1. **首选**：`process.env` 读取（`LANGFUSE_PUBLIC_KEY` / `SECRET_KEY` / `HOST`）
2. **Fallback**：Obsidian 插件设置（`PluginSettingTab` 中添加 Langfuse 配置区域）

初始化时优先读 `process.env`，缺失则读插件设置，都缺失则降级为 NoopTracer。

## 4. 追踪层级映射

Agent 执行层级映射为 Langfuse v5 的 observation 树（`startObservation` + `asType`）：

```
Observation (asType=span, 根): agent-session   ← 一次完整对话
├── Observation (span): intent-routing          # 意图路由
│   └── metadata: { matchedRule, toolFilter }
├── Observation (span): state-machine           # 认知引擎整体
│   ├── Observation (span): router (S0)         # 深度分类
│   │   └── Observation (generation): classify  # LLM 调用
│   ├── Observation (span): inspectional (S1)   # 检视阅读
│   │   ├── Observation (span): toc-scan
│   │   └── Observation (span): scope-lock
│   ├── Observation (span): analytical (S2)     # 分析阅读
│   │   ├── Observation (generation): read      # LLM 深度阅读
│   │   ├── Observation (span): tool-call       # 每次工具调用
│   │   │   └── { toolName, input, output }
│   │   └── Observation (span): sub-agent       # 子 Agent
│   │       └── ... (递归结构)
│   └── Observation (span): formatter (S4)      # 输出格式化
│       └── Observation (generation): format
└── Observation (span): memory                  # 内存操作
    ├── Observation (span): store
    ├── Observation (span): consolidate
    └── Observation (span): milestone
```

| 层级 | asType | 来源模块 | 追踪内容 |
|------|--------|---------|---------|
| 对话根 | `span` | cognitive-engine 入口 | sessionId, userId, 书名, 查询文本 |
| 状态流转 | `span` | cognitive-engine/states/* | 状态名, 输入/输出, 耗时 |
| LLM 调用 | `generation` | llm-client.ts 内部 | prompt, completion, tokens, model, latency |
| 工具调用 | `span` | tools/* | 工具名, 参数, 结果, 耗时 |
| 子 Agent | `span` | subagent/manager | 子任务列表, 并行度, 结果汇总 |
| 内存操作 | `span` | memory/* | 操作类型, 数据量 |

## 5. 各模块集成点

### 5.1 LLM Client（llm-client.ts）

在 `streamChat()` 和 `chat()` 内部手动创建 Generation observation。

**参数传递**：`ctx` 放入现有的 `StreamOptions` / 请求 options 中，不改变函数签名：

```typescript
// 扩展 StreamOptions
interface StreamOptions {
  // ... 现有字段 ...
  traceContext?: ITraceContext;  // 新增
}

// streamChat 内部
async streamChat(messages, tools, callbacks, options?: StreamOptions) {
  const generation = options?.traceContext?.withGeneration('chat-completion', {
    model: this.model,
    input: messages,
    metadata: { provider: this.provider, tools: tools?.map(t => t.name) }
  });

  // ... 现有 fetch + SSE 逻辑不变 ...

  generation?.update({
    output: fullResponse,
    usageDetails: { input: promptTokens, output: completionTokens, total: totalTokens }
  }).end();
}

// chat() 同样处理
```

改动量：~20 行（streamChat + chat 两个方法）。

### 5.2 认知引擎（cognitive-engine/engine.ts）

入口创建根 observation，状态流转结束 flush：

```typescript
import { startObservation } from "@langfuse/tracing";

async run(query: string, sessionId: string) {
  const rootObservation = startObservation('agent-session', {
    input: { query },
    sessionId,
  });
  const ctx = new LangfuseTraceContext(rootObservation);

  // ... 状态流转 ...

  rootObservation.update({ output: result }).end();
  await tracer.flush();
  return result;
}
```

改动量：~10 行。

### 5.3 各状态（cognitive-engine/states/*.ts）

每个状态的 `execute()` 方法接收 `ITraceContext`：

```typescript
async execute(ctx: ITraceContext) {
  const stateCtx = ctx.withSpan('state.analytical', { input: this.query });

  // ... 状态逻辑 ...

  stateCtx.end({ output: result });
}
```

改动量：每个状态 ~5 行。

### 5.4 工具系统（tools/*）

在工具分发层统一包装，不侵入每个工具内部：

```typescript
async executeTool(tool, params, ctx) {
  const toolCtx = ctx.withSpan(`tool.${tool.name}`, { input: params });
  const result = await tool.execute(params);
  toolCtx.end({ output: result });
  return result;
}
```

改动量：~10 行。

### 5.5 子 Agent（subagent/manager.ts）

`spawn()` 创建父 Span，每个子任务创建子 Span：

```
Observation (span): subagent-batch
  ├── Observation (span): subagent-1
  │   └── ... (递归)
  ├── Observation (span): subagent-2
  └── metadata: { parallelCount, cacheHits, failures }
```

改动量：~10 行。

### 5.6 内存系统（memory/*.ts）

轻量 Span，记录操作类型和数据量：

```typescript
const memCtx = ctx.withSpan('memory.store', { dataSize: data.length });
await this.store.save(data);
memCtx.end();
```

改动量：每个模块 ~5 行。

### 5.7 意图路由（router/）

正则匹配不涉及 LLM，记录为简单 Span：

```typescript
const routeCtx = ctx.withSpan('intent-routing');
const result = this.matchRules(query);
routeCtx.end({ matchedRule: result.rule, toolFilter: result.tools });
```

改动量：~5 行。

## 6. 降级策略

```
启动时检测配置（process.env 或插件设置）
  ├── 三个必填都存在且 ENABLED !== 'false' → LangfuseTracer（完整追踪）
  └── 任一缺失 → NoopTracer（空操作，零开销）
```

NoopTracer 保证：
- 所有方法返回值类型与真实 Tracer 一致（实现同一 ITraceContext 接口）
- 编译期类型安全
- 运行时零性能损耗

## 7. 数据上传与错误处理

### 7.1 上传机制

- Langfuse v5 SDK 内置队列缓冲，批量上传
- flush 时机：
  1. 每次 trace 结束后（根 observation.end() + tracer.flush()）
  2. 插件卸载时（onunload → tracer.shutdown()）
- 不阻塞 Agent 执行

### 7.2 错误处理

- **flush 失败**：SDK 内部自动重试，开发者无需处理
- **Langfuse 服务不可达**：SDK 内部队列缓冲，服务恢复后自动上传；队列设有上限（默认），超出时丢弃最早的数据
- **shutdown 超时**：设置 5 秒超时保护，超时后放弃未上传数据，不阻塞插件卸载
- **插件崩溃**：内存中未 flush 的数据会丢失，这是可接受的——Langfuse 追踪是可观测性工具，非关键数据路径

## 8. 敏感数据

- LLM prompt/completion 默认完整上传（可观测性核心价值）
- 用户可通过 `LANGFUSE_ENABLED=false` 临时关闭
- 书籍内容（PDF 段落）作为工具 Span 的 input 记录，可在 Langfuse 服务端配置保留策略

## 9. 改动总览

| 模块 | 改动文件 | 改动性质 |
|------|---------|---------|
| tracing/ | 4 个新文件 | 新增模块 |
| llm-client.ts | ~20 行 | 添加 generation 埋点（streamChat + chat） |
| cognitive-engine/engine.ts | ~10 行 | 创建/结束根 observation |
| cognitive-engine/states/*.ts | 每个 ~5 行 | withSpan/end |
| agent-loop.ts / 工具分发 | ~10 行 | 工具执行包装 |
| subagent/manager.ts | ~10 行 | 子 Agent span |
| memory/*.ts | 每个 ~5 行 | 内存操作 span |
| router/ | ~5 行 | 意图路由 span |
| settings.ts | ~10 行 | Langfuse 配置 fallback 字段 |
| 删除 debug/ | 4 个文件 + 8 个调用文件的 ~33 处引用 | 移除旧日志系统 |
