# Langfuse Agent 集成实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DeepReader 前端 Agent 集成 Langfuse v5 全面可观测性追踪，替代现有 debug logger。

**Architecture:** 创建 `agent/tracing/` 模块（LangfuseTracer 单例 + TraceContext 不可变传递），通过函数参数在认知引擎、Agent Loop、LLM Client、子 Agent、内存系统之间传递追踪上下文。环境变量缺失时降级为 NoopTracer。

**Tech Stack:** TypeScript, Langfuse v5 (`@langfuse/client` + `@langfuse/tracing`), Vitest

**Spec:** `docs/superpowers/specs/2026-04-08-langfuse-agent-integration-design.md`

---

## File Structure

### 新建文件
| 文件 | 职责 |
|------|------|
| `frontend/src/agent/tracing/index.ts` | 模块导出 |
| `frontend/src/agent/tracing/types.ts` | ITraceContext、ITracer 接口定义 |
| `frontend/src/agent/tracing/tracer.ts` | LangfuseTracer 单例 + 初始化 |
| `frontend/src/agent/tracing/trace-context.ts` | LangfuseTraceContext 实现 |
| `frontend/src/agent/tracing/noop-tracer.ts` | NoopTracer + NoopTraceContext |
| `frontend/tests/agent/tracing/tracer.test.ts` | Tracing 模块单元测试 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `frontend/src/agent/llm-client.ts` | StreamOptions 加 traceContext，streamChat/chat 加 generation 埋点 |
| `frontend/src/agent/cognitive-engine/types.ts` | SharedContext 加 traceContext 字段 |
| `frontend/src/agent/cognitive-engine/engine.ts` | 创建根 observation，传递给状态 |
| `frontend/src/agent/cognitive-engine/states/base.ts` | 无改动（execute 签名通过 SharedContext 获取） |
| `frontend/src/agent/cognitive-engine/states/run-state-loop.ts` | 替换 14 处 debug 引用为 tracing span |
| `frontend/src/agent/cognitive-engine/states/inspectional.ts` | 替换 6 处 debug 引用为 tracing span |
| `frontend/src/agent/agent-loop.ts` | AgentLoopOptions 加 traceContext，工具执行加 span |
| `frontend/src/agent/subagent/manager.ts` | spawn/runLoop 传递 traceContext |
| `frontend/src/agent/router/intent-router.ts` | analyze 方法接收 traceContext |
| `frontend/src/agent/memory/store.ts` | 关键操作加 span |
| `frontend/src/agent/memory/consolidator.ts` | consolidate 加 span |
| `frontend/src/agent/memory/milestones.ts` | recordMilestone 加 span |
| `frontend/src/config/settings.ts` | 加 Langfuse 配置字段 |
| `frontend/src/main.ts` | 插件加载时 initTracer，卸载时 tracer.shutdown() |
| `frontend/src/agent/index.ts` | 替换 debug 导出为 tracing 导出，构造函数 initTracer |
| `frontend/package.json` | 加 @langfuse/client 和 @langfuse/tracing |

### 删除文件
| 文件 | 说明 |
|------|------|
| `frontend/src/agent/debug/index.ts` | 旧 debug 模块入口 |
| `frontend/src/agent/debug/logger.ts` | 旧 debug logger 实现 |
| `frontend/src/agent/debug/types.ts` | 旧 debug 类型 |
| `frontend/src/agent/debug/__tests__/logger.test.ts` | 旧 debug 测试 |

---

## Chunk 1: Tracing 基础设施

### Task 1: 安装 Langfuse SDK

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd frontend && npm install @langfuse/client @langfuse/tracing
```

- [ ] **Step 2: 验证安装**

```bash
cd frontend && npm ls @langfuse/client @langfuse/tracing
```

Expected: 两个包都显示版本号

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无新增错误（可能有 unused import 警告，正常）

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add @langfuse/client and @langfuse/tracing dependencies"
```

---

### Task 2: 创建 tracing 类型定义

**Files:**
- Create: `frontend/src/agent/tracing/types.ts`
- Create: `frontend/src/agent/tracing/index.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// frontend/src/agent/tracing/types.ts

/**
 * Langfuse 追踪上下文接口
 * 通过函数参数在模块间传递，不使用全局变量
 */
export interface ITraceContext {
  /**
   * 创建子 span observation，返回新的 context（不可变）
   * NoopTracer 下返回自身
   */
  withSpan(name: string, metadata?: Record<string, unknown>): ITraceContext;

  /**
   * 在当前 context 下创建 generation observation
   * 返回 observation 引用，用于后续 update/end
   */
  withGeneration(name: string, params: {
    model?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): IObservationRef;

  /**
   * 结束当前 observation
   */
  end(output?: Record<string, unknown>): void;

  /**
   * 获取 trace ID（用于 Langfuse UI 链接）
   */
  getTraceId(): string | undefined;
}

/**
 * Langfuse observation 引用
 * 用于 update + end 操作
 */
export interface IObservationRef {
  update(params: {
    output?: unknown;
    usageDetails?: Record<string, number>;
    metadata?: Record<string, unknown>;
  }): IObservationRef;
  end(): void;
}

/**
 * Noop implementation of IObservationRef
 */
export class NoopObservationRef implements IObservationRef {
  update(_params: { output?: unknown; usageDetails?: Record<string, number>; metadata?: Record<string, unknown> }): IObservationRef {
    return this;
  }
  end(): void {
    // no-op
  }
}

/**
 * Langfuse Tracer 单例接口
 */
export interface ITracer {
  /**
   * 创建根 observation（对应一次完整对话）
   */
  createTrace(params: {
    name: string;
    sessionId?: string;
    userId?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): ITraceContext;

  /**
   * 刷新缓冲区，上传所有待发送数据
   */
  flush(): Promise<void>;

  /**
   * 关闭 tracer，带超时保护
   */
  shutdown(): Promise<void>;

  /**
   * 是否已启用（Langfuse 配置完整）
   */
  isEnabled(): boolean;
}
```

- [ ] **Step 2: 创建模块导出**

```typescript
// frontend/src/agent/tracing/index.ts

export type { ITraceContext, IObservationRef, ITracer } from './types';
export { NoopObservationRef } from './types';
export { getTracer, initTracer } from './tracer';
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/tracing/types.ts frontend/src/agent/tracing/index.ts
git commit -m "feat(tracing): add ITraceContext and ITracer type definitions"
```

---

### Task 3: 实现 NoopTracer

**Files:**
- Create: `frontend/src/agent/tracing/noop-tracer.ts`
- Test: `frontend/tests/agent/tracing/tracer.test.ts`

- [ ] **Step 1: 写 NoopTracer 测试**

```typescript
// frontend/tests/agent/tracing/tracer.test.ts

import { describe, it, expect } from 'vitest';
import { NoopTracer } from '../../../src/agent/tracing/noop-tracer';

describe('NoopTracer', () => {
  it('isEnabled returns false', () => {
    const tracer = new NoopTracer();
    expect(tracer.isEnabled()).toBe(false);
  });

  it('createTrace returns NoopTraceContext', () => {
    const tracer = new NoopTracer();
    const ctx = tracer.createTrace({ name: 'test' });
    expect(ctx.getTraceId()).toBeUndefined();
  });

  it('flush does not throw', async () => {
    const tracer = new NoopTracer();
    await expect(tracer.flush()).resolves.toBeUndefined();
  });

  it('shutdown does not throw', async () => {
    const tracer = new NoopTracer();
    await expect(tracer.shutdown()).resolves.toBeUndefined();
  });
});

describe('NoopTraceContext', () => {
  it('withSpan returns self', () => {
    const tracer = new NoopTracer();
    const ctx = tracer.createTrace({ name: 'test' });
    const child = ctx.withSpan('child');
    expect(child).toBe(ctx);
  });

  it('withGeneration returns NoopObservationRef', () => {
    const tracer = new NoopTracer();
    const ctx = tracer.createTrace({ name: 'test' });
    const gen = ctx.withGeneration('llm', { model: 'gpt-4' });
    expect(gen.update({ output: 'test' })).toBe(gen);
    expect(() => gen.end()).not.toThrow();
  });

  it('end does not throw', () => {
    const tracer = new NoopTracer();
    const ctx = tracer.createTrace({ name: 'test' });
    expect(() => ctx.end()).not.toThrow();
    expect(() => ctx.end({ output: 'test' })).not.toThrow();
  });

  it('getTraceId returns undefined', () => {
    const tracer = new NoopTracer();
    const ctx = tracer.createTrace({ name: 'test' });
    expect(ctx.getTraceId()).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run tests/agent/tracing/tracer.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现 NoopTracer**

```typescript
// frontend/src/agent/tracing/noop-tracer.ts

import type { ITracer, ITraceContext, IObservationRef } from './types';
import { NoopObservationRef } from './types';

/**
 * No-op trace context — 所有方法为空操作
 */
export class NoopTraceContext implements ITraceContext {
  withSpan(_name: string, _metadata?: Record<string, unknown>): ITraceContext {
    return this;
  }

  withGeneration(_name: string, _params: {
    model?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): IObservationRef {
    return new NoopObservationRef();
  }

  end(_output?: Record<string, unknown>): void {
    // no-op
  }

  getTraceId(): string | undefined {
    return undefined;
  }
}

/**
 * No-op tracer — Langfuse 未配置时的降级实现
 * 零性能开销，零 console 输出
 */
export class NoopTracer implements ITracer {
  private static instance: NoopTraceContext = new NoopTraceContext();

  isEnabled(): boolean {
    return false;
  }

  createTrace(_params: {
    name: string;
    sessionId?: string;
    userId?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): ITraceContext {
    return NoopTracer.instance;
  }

  async flush(): Promise<void> {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run tests/agent/tracing/tracer.test.ts
```

Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/tracing/noop-tracer.ts frontend/tests/agent/tracing/tracer.test.ts
git commit -m "feat(tracing): implement NoopTracer with tests"
```

---

### Task 4: 实现 LangfuseTracer 和 LangfuseTraceContext

**Files:**
- Create: `frontend/src/agent/tracing/trace-context.ts`
- Create: `frontend/src/agent/tracing/tracer.ts`
- Test: `frontend/tests/agent/tracing/tracer.test.ts` (扩展)

- [ ] **Step 1: 写 LangfuseTraceContext 测试**

在 `frontend/tests/agent/tracing/tracer.test.ts` 末尾追加：

```typescript
describe('LangfuseTraceContext', () => {
  it('withSpan returns new context (immutable)', () => {
    // 测试不可变性：withSpan 返回新对象
    const mockObservation = {
      startObservation: (_name: string, _opts: unknown, _config: { asType: string }) => mockObservation,
      update: (_opts: unknown) => mockObservation,
      end: () => {},
      traceId: 'trace-123',
    };
    const ctx = new LangfuseTraceContext(mockObservation);
    const child = ctx.withSpan('child');
    expect(child).not.toBe(ctx);
  });

  it('getTraceId returns trace ID', () => {
    const mockObservation = {
      startObservation: () => mockObservation,
      update: () => mockObservation,
      end: () => {},
      traceId: 'trace-456',
    };
    const ctx = new LangfuseTraceContext(mockObservation);
    expect(ctx.getTraceId()).toBe('trace-456');
  });

  it('withGeneration returns observation ref', () => {
    const genRef = { update: () => genRef, end: () => {} };
    const mockObservation = {
      startObservation: (_name: string, _opts: unknown, config: { asType: string }) => {
        if (config.asType === 'generation') return genRef;
        return mockObservation;
      },
      update: () => mockObservation,
      end: () => {},
      traceId: 'trace-789',
    };
    const ctx = new LangfuseTraceContext(mockObservation);
    const gen = ctx.withGeneration('llm', { model: 'gpt-4', input: [] });
    expect(gen).toBe(genRef);
  });
});
```

注意：需要在文件顶部添加 import:
```typescript
import { LangfuseTraceContext } from '../../../src/agent/tracing/trace-context';
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run tests/agent/tracing/tracer.test.ts
```

Expected: FAIL — LangfuseTraceContext not found

- [ ] **Step 3: 实现 LangfuseTraceContext**

```typescript
// frontend/src/agent/tracing/trace-context.ts

import type { ITraceContext, IObservationRef } from './types';

/**
 * Langfuse v5 observation 对象的最小接口
 * 只暴露我们需要的方法
 */
export interface LangfuseObservation {
  startObservation(
    name: string,
    options?: Record<string, unknown>,
    config?: { asType: 'span' | 'generation' | 'tool' | 'event' }
  ): LangfuseObservation;
  update(options: Record<string, unknown>): LangfuseObservation;
  end(): void;
  readonly traceId?: string;
}

/**
 * Langfuse 追踪上下文 — 基于 v5 startObservation API
 * 不可变：withSpan 返回新实例
 */
export class LangfuseTraceContext implements ITraceContext {
  private observation: LangfuseObservation;

  constructor(observation: LangfuseObservation) {
    this.observation = observation;
  }

  withSpan(name: string, metadata?: Record<string, unknown>): ITraceContext {
    const child = this.observation.startObservation(
      name,
      { ...metadata },
      { asType: 'span' }
    );
    return new LangfuseTraceContext(child);
  }

  withGeneration(name: string, params: {
    model?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): IObservationRef {
    const generation = this.observation.startObservation(
      name,
      {
        ...(params.input !== undefined ? { input: params.input } : {}),
        ...(params.model ? { model: params.model } : {}),
        ...params.metadata,
      },
      { asType: 'generation' }
    );
    return {
      update(p: { output?: unknown; usageDetails?: Record<string, number>; metadata?: Record<string, unknown> }) {
        generation.update(p as Record<string, unknown>);
        return this;
      },
      end() {
        generation.end();
      },
    };
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

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run tests/agent/tracing/tracer.test.ts
```

Expected: PASS — all tests pass

- [ ] **Step 5: 实现 LangfuseTracer 单例**

```typescript
// frontend/src/agent/tracing/tracer.ts

import { LangfuseClient } from '@langfuse/client';
import { startObservation } from '@langfuse/tracing';
import type { ITracer, ITraceContext } from './types';
import { NoopTracer } from './noop-tracer';
import { LangfuseTraceContext } from './trace-context';
import type { LangfuseObservation } from './trace-context';

let tracerInstance: ITracer | null = null;

/**
 * 初始化 Tracer 单例
 * 如果 Langfuse 配置完整，创建真实 tracer；否则降级为 NoopTracer
 */
export function initTracer(config?: {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
}): ITracer {
  // 优先使用传入的配置，其次读 process.env
  const publicKey = config?.publicKey || process?.env?.LANGFUSE_PUBLIC_KEY;
  const secretKey = config?.secretKey || process?.env?.LANGFUSE_SECRET_KEY;
  const baseUrl = config?.baseUrl || process?.env?.LANGFUSE_HOST;
  const enabled = process?.env?.LANGFUSE_ENABLED !== 'false';

  if (!publicKey || !secretKey || !baseUrl || !enabled) {
    tracerInstance = new NoopTracer();
    return tracerInstance;
  }

  tracerInstance = new LangfuseTracerImpl(publicKey, secretKey, baseUrl);
  return tracerInstance;
}

/**
 * 获取 Tracer 单例（未初始化时自动创建 NoopTracer）
 */
export function getTracer(): ITracer {
  if (!tracerInstance) {
    tracerInstance = new NoopTracer();
  }
  return tracerInstance;
}

/**
 * 真实 Langfuse Tracer 实现
 *
 * 注意：LangfuseClient 构造时会自动注册到 @langfuse/tracing 的全局状态，
 * 因此后续的 startObservation() 调用可以找到正确的 client 实例。
 */
class LangfuseTracerImpl implements ITracer {
  private initialized: boolean;

  constructor(publicKey: string, secretKey: string, baseUrl: string) {
    try {
      // LangfuseClient 构造即注册到 @langfuse/tracing 全局
      new LangfuseClient({ publicKey, secretKey, baseUrl });
      this.initialized = true;
    } catch {
      console.warn('[DeepReader] Failed to initialize Langfuse client, falling back to NoopTracer');
      this.initialized = false;
    }
  }

  isEnabled(): boolean {
    return this.initialized;
  }

  createTrace(params: {
    name: string;
    sessionId?: string;
    userId?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): ITraceContext {
    if (!this.initialized) {
      return new NoopTracer().createTrace(params);
    }

    const observation = startObservation(params.name, {
      ...(params.input ? { input: params.input } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
    }, { asType: 'span' }) as unknown as LangfuseObservation;

    return new LangfuseTraceContext(observation);
  }

  async flush(): Promise<void> {
    if (!this.initialized) return;
    try {
      const { langfuseSpanProcessor } = await import('@langfuse/tracing');
      await langfuseSpanProcessor.forceFlush();
    } catch {
      // flush 失败静默处理
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    try {
      const { langfuseSpanProcessor } = await import('@langfuse/tracing');
      // 5 秒超时保护，避免阻塞插件卸载
      await Promise.race([
        langfuseSpanProcessor.forceFlush(),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // shutdown 失败静默处理
    }
  }
}
```

- [ ] **Step 6: 运行全部测试**

```bash
cd frontend && npx vitest run tests/agent/tracing/tracer.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/agent/tracing/trace-context.ts frontend/src/agent/tracing/tracer.ts frontend/tests/agent/tracing/tracer.test.ts
git commit -m "feat(tracing): implement LangfuseTracer singleton and LangfuseTraceContext"
```

---

## Chunk 2: 核心集成 — Engine、States、LLM Client

### Task 5: SharedContext 添加 traceContext 字段

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/types.ts:44`

- [ ] **Step 1: 在 SharedContext 接口中添加 traceContext**

在 `frontend/src/agent/cognitive-engine/types.ts` 的 `SharedContext` 接口中，`// ===== Engine Dependencies =====` 区域上方添加：

```typescript
  // ===== Tracing =====
  /** Langfuse 追踪上下文（可选） */
  traceContext?: import('../tracing/types').ITraceContext;
```

使用 inline import 避免循环依赖。

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/cognitive-engine/types.ts
git commit -m "feat(tracing): add traceContext to SharedContext"
```

---

### Task 6: 认知引擎入口集成

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/engine.ts`

- [ ] **Step 1: 添加 tracing import 并修改 runCognitiveEngine**

在 `engine.ts` 中：

1. 添加 import（替换现有的 debug logger import）：

```typescript
// 替换
import { getDebugLogger } from '../debug/logger';
import type { StateOutputLog } from '../debug/types';

// 为
import { getTracer } from '../tracing/index';
```

2. 修改 `runCognitiveEngine` 函数开头，在 `const logger = getDebugLogger();` 位置替换为：

```typescript
export async function runCognitiveEngine(
  ctx: SharedContext,
  callbacks: EngineCallbacks
): Promise<string> {
  const tracer = getTracer();
  const traceCtx = tracer.createTrace({
    name: 'agent-session',
    sessionId: ctx.indexId,
    input: { query: ctx.rawUserQuery, book: ctx.pdfName },
    metadata: { bookName: ctx.pdfName, indexId: ctx.indexId },
  });
  ctx.traceContext = traceCtx;

  try {
    // ... 保持现有状态流转逻辑不变 ...
    // 所有 executeStateWithLogging 调用保持不变
```

3. 修改 `executeStateWithLogging` 函数，将 debug logger 替换为 tracing span：

```typescript
async function executeStateWithLogging(
  stateName: string,
  state: {
    name: string;
    execute: (ctx: SharedContext) => Promise<void>;
    tools?: string[];
  },
  ctx: SharedContext,
  callbacks: EngineCallbacks
): Promise<void> {
  const spanCtx = ctx.traceContext?.withSpan(`state.${stateName.toLowerCase()}`, {
    input: {
      query: ctx.standaloneQuery || ctx.rawUserQuery,
      availableTools: state.tools || [],
      scopeNodeIds: ctx.scopeNodeIds,
    },
  });

  try {
    // 临时替换 traceContext，让状态内部使用这个 span
    const prevCtx = ctx.traceContext;
    if (spanCtx) ctx.traceContext = spanCtx;

    await state.execute(ctx);

    // 恢复原始 traceContext
    if (spanCtx) ctx.traceContext = prevCtx;

    spanCtx?.end({
      depth: ctx.depth,
      standaloneQuery: ctx.standaloneQuery,
      scopeNodeIds: ctx.scopeNodeIds,
      analysisResult: ctx.analysisResult ? 'present' : undefined,
    });
  } catch (error) {
    spanCtx?.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
```

4. 在 `runCognitiveEngine` 函数末尾，替换 `logger.endSession()` 调用：

将 try 块末尾的：
```typescript
if (logger?.isEnabled()) {
  logger.setFinalOutput(output);
}
// ...
if (logger?.isEnabled()) {
  await logger.endSession();
}
```

替换为：
```typescript
traceCtx.end({ output, finalOutputLength: output.length });
callbacks.onComplete();
await tracer.flush();
```

将 catch 块中的：
```typescript
if (logger?.isEnabled()) {
  await logger.endSession();
}
```

替换为：
```typescript
traceCtx.end({ error: error instanceof Error ? error.message : String(error) });
await tracer.flush();
```

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 编译通过（debug logger 引用已全部移除）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/cognitive-engine/engine.ts
git commit -m "feat(tracing): integrate tracing into cognitive engine entry point"
```

---

### Task 7: LLM Client 集成

**Files:**
- Modify: `frontend/src/agent/llm-client.ts`

- [ ] **Step 1: 扩展 StreamOptions**

在 `llm-client.ts` 中，修改 `StreamOptions` 接口：

```typescript
export interface StreamOptions {
  signal?: AbortSignal;
  /** Langfuse 追踪上下文（可选） */
  traceContext?: import('./tracing/types').ITraceContext;
}
```

- [ ] **Step 2: 在 streamChat 中添加 generation 埋点**

在 `streamChat` 方法体内，找到创建 fetch 的位置之前，添加：

```typescript
const generation = options?.traceContext?.withGeneration('chat-completion', {
  model: this.model,
  input: messages,
  metadata: { provider: this.providerName, tools: tools?.map(t => t.name) },
});
```

在流式结束的位置，**必须在 `onComplete` 回调内部**调用（因为 streamChat 是流式的，generation 的结束时机是流结束）：

```typescript
// 在 onComplete 回调内部
generation?.update({
  output: { content: fullContent, finishReason },
  usageDetails: { input: promptTokenEstimate, output: completionTokens, total: promptTokenEstimate + completionTokens },
}).end();
```

同样，在 `onError` 回调中也应 end generation 并记录错误：
```typescript
// 在 onError 回调内部
generation?.update({
  output: { error: errorMessage },
}).end();
```

注意：具体变量名需要根据现有代码中的 token 统计变量来确定。如果 streamChat 当前没有统计 tokens，先用估算值。

- [ ] **Step 3: 在 chat 方法中添加 generation 埋点**

在 `chat` 方法中同样处理。chat 是非流式方法，结构更简单：

```typescript
async chat(messages, tools, responseFormat) {
  // 使用 traceContext 如果可用（需要从调用方传入，暂不改动签名）
  // chat 目前不接收 StreamOptions，先不处理
  // 后续如果需要可通过参数传递
}
```

chat 方法暂不改签名，因为它主要用于简单场景。如果后续需要追踪，可以扩展。

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/llm-client.ts
git commit -m "feat(tracing): add generation tracing to LLMClient.streamChat"
```

---

### Task 8: Agent Loop 集成

**Files:**
- Modify: `frontend/src/agent/agent-loop.ts`

- [ ] **Step 1: 添加 tracing import 并扩展 AgentLoopOptions**

1. 将 `import { getDebugLogger } from './debug/index.js';` 替换为：
```typescript
import type { ITraceContext } from './tracing/types';
```

2. 在 `AgentLoopOptions` 接口中添加：
```typescript
  /** Langfuse 追踪上下文（可选） */
  traceContext?: ITraceContext;
```

- [ ] **Step 2: 替换 runAgentLoop 中的 debugLogger 调用**

在 `runAgentLoop` 函数中，替换所有 `debugLogger` 调用：

1. 函数开头（约 line 316-321）：
```typescript
// 删除
const debugLogger = getDebugLogger();
if (debugLogger?.isEnabled()) {
  const fullQuestion = messages.filter(m => m.role === 'user').pop()?.content;
  await debugLogger.startSession(fullQuestion);
}

// 替换为
const traceCtx = options.traceContext;
```

2. 每次迭代开头（约 line 341-342）：
```typescript
// 删除
debugLogger?.startIteration(iterations);
debugLogger?.logMessages(workingMessages);

// 替换为
const iterCtx = traceCtx?.withSpan(`iteration.${iterations}`, {
  messageCount: workingMessages.length,
});
```

3. LLM 调用前（约 line 365-367）：
```typescript
// 删除
debugLogger?.logSystemPrompt(...);
debugLogger?.logLLMRequest({...});

// 将 traceContext 传入 StreamOptions
```

找到 `streamChat` 调用位置，确保 options 包含 traceContext：
```typescript
const abortController = await client.streamChat(
  workingMessages,
  tools,
  {
    onContent: ...,
    onToolCall: ...,
    onComplete: ...,
    onError: ...,
    onReasoning: ...,
  },
  {
    signal: options.abortSignal,
    traceContext: iterCtx,  // 新增
  }
);
```

4. LLM 响应后（约 line 444）：
```typescript
// 删除
debugLogger?.logLLMResponse({...});
```

5. 工具执行处（约 line 567, 596, 612）：
```typescript
// 删除
debugLogger?.logToolStart(tc.id, tc.name, args);
// ...
debugLogger?.logToolResult(tc.id, result, duration);
// ...
debugLogger?.logToolError(tc.id, errorMsg, duration);

// 在 Promise.all 的 map 内部，用 span 包裹工具执行：
const toolCtx = traceCtx?.withSpan(`tool.${tc.name}`, {
  toolCallId: tc.id,
  input: args,
});
try {
  const result = await executeTool(toolRegistry, tc.name, args, context);
  toolCtx?.end({ output: { status: 'success', resultLength: String(result).length } });
  // ... 现有成功处理逻辑
} catch (error) {
  toolCtx?.end({ error: error instanceof Error ? error.message : String(error) });
  // ... 现有错误处理逻辑
}
```

6. 迭代结束（约 line 700）：
```typescript
// 删除
await debugLogger?.endIteration({...});

// 替换为
iterCtx?.end({ iterations });
```

7. 函数末尾（约 line 821）：
```typescript
// 删除
await debugLogger?.endSession();
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 编译通过（debugLogger 引用已全部移除）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/agent-loop.ts
git commit -m "feat(tracing): integrate tracing into agent loop, replace debugLogger"
```

---

### Task 8.5: Run-State-Loop 集成

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/states/run-state-loop.ts`

`run-state-loop.ts` 有 **14 处** debug logger 引用，是高频使用文件（LLM 调用循环 + 工具执行追踪），必须替换。

- [ ] **Step 1: 替换 debug logger import 为 tracing**

```typescript
// 删除
import { getDebugLogger } from '../../debug/logger.js';

// 替换为
// (traceContext 通过 SharedContext 传入，无需额外 import)
```

- [ ] **Step 2: 替换所有 logger 调用**

`run-state-loop.ts` 中的 `executeRunStateLoop` 函数接收 `ctx: SharedContext`，从中获取 `ctx.traceContext`：

1. 函数开头 `const logger = getDebugLogger();` → 删除
2. `logger.logSystemPrompt(...)` → 删除（system prompt 在 generation 的 input 中已有）
3. `logger.startLLMInteraction(...)` / `logger.endLLMInteraction(...)` → 由 LLM Client 的 generation 埋点自动处理
4. `logger.logToolStart/logToolCall/logToolResult/logToolError` → 替换为 span：

```typescript
// 工具执行处
const toolCtx = ctx.traceContext?.withSpan(`tool.${toolName}`, {
  toolCallId: tc.id,
  input: args,
});
try {
  const result = await executeTool(...);
  toolCtx?.end({ output: { status: 'success', resultLength: String(result).length } });
} catch (error) {
  toolCtx?.end({ error: error instanceof Error ? error.message : String(error) });
}
```

5. `logger.logLLMResponse(...)` → 删除（由 LLM Client 处理）
6. `logger.logMessages(...)` → 删除
7. `logger.logInnerIterations(...)` → 删除

确保将 `streamChat` 的 `options` 传入 `traceContext`：

```typescript
const abortController = await client.streamChat(
  messages, tools, callbacks,
  { signal: ctx.abortSignal, traceContext: ctx.traceContext }
);
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/run-state-loop.ts
git commit -m "feat(tracing): replace debug logger with tracing in run-state-loop"
```

---

### Task 8.6: Inspectional State 集成

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/states/inspectional.ts`

`inspectional.ts` 有 **6 处** debug logger 引用（import + getDebugLogger + 4 处 logger 调用）。

- [ ] **Step 1: 替换 debug logger import**

```typescript
// 删除
import { getDebugLogger } from '../../debug/logger.js';
```

- [ ] **Step 2: 替换 logger 调用**

1. `const logger = getDebugLogger();` → 删除
2. `logger.logToolCall(...)` → 替换为 span：

```typescript
const toolCtx = ctx.traceContext?.withSpan('tool.get_document_outline', {
  input: { indexId: ctx.indexId },
});
const outline = await getDocumentOutline(ctx);
toolCtx?.end({ output: { nodeCount: outline?.length } });
```

3. `logger.startLLMInteraction(...)` / `logger.endLLMInteraction(...)` → 由 LLM Client 自动处理，确保 `streamChat` 调用传入 `traceContext`：

```typescript
await client.streamChat(messages, tools, callbacks, {
  signal: ctx.abortSignal,
  traceContext: ctx.traceContext,
});
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/inspectional.ts
git commit -m "feat(tracing): replace debug logger with tracing in inspectional state"
```

---

## Chunk 3: 扩展模块集成与清理

### Task 9: 子 Agent Manager 集成

**Files:**
- Modify: `frontend/src/agent/subagent/manager.ts`

- [ ] **Step 1: 在 spawn 和 runLoop 中传递 traceContext**

1. 添加 import：
```typescript
import type { ITraceContext } from '../tracing/types';
```

2. 给 `SubagentManager` 添加可选的 traceContext 字段：
```typescript
private traceCtx?: ITraceContext;

constructor(
  client: LLMClient,
  toolRegistry: ToolRegistry,
  context: ToolContext,
  config: Partial<SubagentConfig> = {},
  onResult?: SubagentCallback,
  traceCtx?: ITraceContext  // 新增
) {
  // ... 现有赋值
  this.traceCtx = traceCtx;
}
```

3. 在 `spawn` 方法中，对实际执行的任务创建子 span：
```typescript
// 在非缓存路径中（line ~166 附近），创建任务 span
const taskSpanCtx = this.traceCtx?.withSpan(`subagent.${taskId}`, {
  description: description.slice(0, 100),
  label,
});
```

4. 在 `runSubagent` 中，将 taskSpanCtx 传递给 runLoop：
在调用 `this.runLoop()` 前：
```typescript
// 在 runSubagent 中需要访问 taskSpanCtx
// 可以通过 this 传递或作为参数
```

5. 在 `runLoop` 中将 traceContext 传入 `runAgentLoop` 的 options：
```typescript
await runAgentLoop(this.client, messages, tools, this.toolRegistry, this.context, {
  maxIterations: this.config.maxIterations,
  abortSignal,
  traceContext: taskSpanCtx,  // 新增
  onContent: (text) => { ... },
  // ...
});
```

6. 在任务完成后结束 span：
```typescript
// 在 runSubagent 成功完成后
taskSpanCtx?.end({ resultLength: result?.length });
// 在失败时
taskSpanCtx?.end({ error: lastError });
```

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/subagent/manager.ts
git commit -m "feat(tracing): integrate tracing into subagent manager"
```

---

### Task 10: Intent Router 集成

**Files:**
- Modify: `frontend/src/agent/router/intent-router.ts`

- [ ] **Step 1: 替换 debug logger 为 tracing**

1. 替换 import：
```typescript
// 删除
import { getDebugLogger } from '../debug/logger.js';

// 替换为
import type { ITraceContext } from '../tracing/types';
```

2. 修改 `analyze` 方法签名，添加可选 traceContext：
```typescript
analyze(userInput: string, traceCtx?: ITraceContext): IntentResult {
```

3. 替换 debug logger 调用（约 line 34, 80-88）：
```typescript
// 删除
const logger = getDebugLogger();

// 在 analyze 方法中：
const spanCtx = traceCtx?.withSpan('intent-routing');
const result = this.matchRules(userInput);  // 现有的匹配逻辑
spanCtx?.end({
  matchedRule: result.detectedIntents.join(','),
  toolFilter: result.allowedTools,
});

// 删除 logger.logIntentRouting({...})
```

- [ ] **Step 2: 更新 intent-router 的调用方**

搜索调用 `analyze()` 的地方，传入 `ctx.traceContext`。调用方在 `cognitive-engine/states/router.ts` 中。

在 router state 的 `execute` 方法中：
```typescript
// 找到 analyze 调用，添加 traceContext 参数
const result = this.router.analyze(ctx.rawUserQuery, ctx.traceContext);
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/agent/router/intent-router.ts frontend/src/agent/cognitive-engine/states/router.ts
git commit -m "feat(tracing): integrate tracing into intent router"
```

---

### Task 11: Memory 系统集成

**Files:**
- Modify: `frontend/src/agent/memory/store.ts`
- Modify: `frontend/src/agent/memory/consolidator.ts`
- Modify: `frontend/src/agent/memory/milestones.ts`

- [ ] **Step 1: 在 MemoryStore 关键方法中添加 span**

在 `store.ts` 的关键异步方法中添加可选 `traceCtx` 参数：

```typescript
async writeLongTermMemory(content: string, traceCtx?: ITraceContext): Promise<void> {
  const span = traceCtx?.withSpan('memory.write', { contentLength: content.length });
  // ... 现有逻辑 ...
  span?.end();
}

async appendHistory(entry: string, traceCtx?: ITraceContext): Promise<void> {
  const span = traceCtx?.withSpan('memory.append-history', { entryLength: entry.length });
  // ... 现有逻辑 ...
  span?.end();
}
```

对 `readLongTermMemory`、`getMemoryContext`、`searchHistory` 等读操作暂不添加 span（读操作频率高且速度快）。

- [ ] **Step 2: 在 MemoryConsolidator.consolidate 中添加 span**

```typescript
async consolidate(messages, lastConsolidated, boundary, traceCtx?: ITraceContext) {
  const span = traceCtx?.withSpan('memory.consolidate', {
    messageCount: messages.length,
    boundary,
  });
  // ... 现有逻辑 ...
  span?.end({ removedCount, summaryLength: result?.summary?.length });
  return result;
}
```

- [ ] **Step 3: 在 MilestoneRecorder.recordMilestone 中添加 span**

```typescript
async recordMilestone(type: MilestoneType, data: MilestoneData, traceCtx?: ITraceContext) {
  const span = traceCtx?.withSpan('memory.milestone', { type });
  // ... 现有逻辑 ...
  span?.end();
}
```

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/memory/store.ts frontend/src/agent/memory/consolidator.ts frontend/src/agent/memory/milestones.ts
git commit -m "feat(tracing): add tracing spans to memory system"
```

---

### Task 12: 插件设置、Agent 入口与生命周期

**Files:**
- Modify: `frontend/src/config/settings.ts`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/agent/index.ts`

- [ ] **Step 1: 在 DeepPDFSettings 中添加 Langfuse 配置**

在 `settings.ts` 的 `DeepPDFSettings` 接口中添加：

```typescript
    // Langfuse 可观测性配置
    langfusePublicKey: string;
    langfuseSecretKey: string;
    langfuseBaseUrl: string;
    langfuseEnabled: boolean;
```

在 `DEFAULT_SETTINGS` 中添加默认值：

```typescript
    // Langfuse 可观测性
    langfusePublicKey: "",
    langfuseSecretKey: "",
    langfuseBaseUrl: "http://localhost:3000",
    langfuseEnabled: false,
```

- [ ] **Step 2: 在 main.ts 插件初始化中初始化 tracer**

在插件的 `onload` 方法中，加载设置后初始化 tracer：

```typescript
import { initTracer } from './agent/tracing';

// 在 onload 中，加载设置后：
initTracer({
  publicKey: this.settings.langfusePublicKey || process?.env?.LANGFUSE_PUBLIC_KEY,
  secretKey: this.settings.langfuseSecretKey || process?.env?.LANGFUSE_SECRET_KEY,
  baseUrl: this.settings.langfuseBaseUrl || process?.env?.LANGFUSE_HOST,
});
```

在 `onunload` 中：

```typescript
import { getTracer } from './agent/tracing';

// 在 onunload 中：
const tracer = getTracer();
await tracer.shutdown();
```

- [ ] **Step 3: 更新 agent/index.ts — 替换 debug 导出**

`frontend/src/agent/index.ts` 是 Agent 模块的公共 API，包含 debug 相关导出：

1. 替换 import：
```typescript
// 删除
import { initDebugLogger, getDebugLogger, DEBUG_LOG_ENABLED } from './debug/index.js';

// 替换为
import { initTracer, getTracer } from './tracing/index';
```

2. 在 `FrontendAgent` 构造函数中，将 `initDebugLogger` 调用替换为 `initTracer`：
```typescript
// 删除
initDebugLogger(this.app, { enabled: settings.enableDebugLog });

// 替换为
initTracer({
  publicKey: settings.langfusePublicKey || process?.env?.LANGFUSE_PUBLIC_KEY,
  secretKey: settings.langfuseSecretKey || process?.env?.LANGFUSE_SECRET_KEY,
  baseUrl: settings.langfuseBaseUrl || process?.env?.LANGFUSE_HOST,
});
```

3. 更新导出：
```typescript
// 删除
export { initDebugLogger, getDebugLogger, DEBUG_LOG_ENABLED } from './debug/index.js';

// 替换为
export { initTracer, getTracer } from './tracing/index';
export type { ITraceContext, ITracer } from './tracing/types';
```

4. 搜索整个项目中是否有其他文件 import `getDebugLogger` / `initDebugLogger`，如有则替换。

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/config/settings.ts frontend/src/main.ts
git commit -m "feat(tracing): add Langfuse settings and plugin lifecycle hooks"
```

---

### Task 13: 删除 debug 模块

**Files:**
- Delete: `frontend/src/agent/debug/index.ts`
- Delete: `frontend/src/agent/debug/logger.ts`
- Delete: `frontend/src/agent/debug/types.ts`
- Delete: `frontend/src/agent/debug/__tests__/logger.test.ts`

- [ ] **Step 1: 确认所有 debug 引用已移除**

```bash
cd frontend && grep -rn "debug" src/agent/ --include="*.ts" | grep -v "tracing" | grep -v "node_modules"
```

Expected: 无结果（所有 debugLogger 引用已在前面步骤中替换）

如果有残留引用，逐一修复。

- [ ] **Step 2: 删除 debug 目录**

```bash
rm -rf frontend/src/agent/debug/
```

- [ ] **Step 3: 检查是否有其他文件引用 debug 模块**

```bash
cd frontend && grep -rn "from.*debug" src/ --include="*.ts"
```

Expected: 无结果

如果有残留，修复后重新运行。

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/agent/debug/
git commit -m "chore: remove legacy debug logger module (replaced by Langfuse tracing)"
```

---

### Task 14: 构建验证

**Files:** 无新改动

- [ ] **Step 1: 运行完整构建**

```bash
cd frontend && npm run build
```

Expected: 构建成功

- [ ] **Step 2: 运行测试**

```bash
cd frontend && npm run test:run
```

Expected: 所有测试通过

- [ ] **Step 3: 检查打包大小**

```bash
ls -la frontend/main.js
```

验证新增的 Langfuse SDK 不会导致包体积异常增长。如果过大，考虑 dynamic import。

- [ ] **Step 4: 最终 Commit（如有调整）**

```bash
git add -A
git commit -m "chore: final adjustments for Langfuse integration"
```

---

## 执行顺序依赖

```
Task 1 (install deps) ─── prerequisite for all
    │
Task 2 (types) ──────────┐
Task 3 (noop tracer) ────┤── parallel
    │                     │
Task 4 (real tracer) ────┘── depends on Task 2, 3
    │
Task 5 (SharedContext) ── depends on Task 2
    │
Task 6 (engine) ───────── depends on Task 4, 5
Task 7 (llm client) ──── depends on Task 4
Task 8 (agent loop) ──── depends on Task 4, 7
Task 8.5 (run-state-loop)── depends on Task 4, 5, 7
Task 8.6 (inspectional) ── depends on Task 4, 5
    │
Task 9 (subagent) ────── depends on Task 8
Task 10 (router) ─────── depends on Task 4
Task 11 (memory) ─────── depends on Task 4
    │
Task 12 (settings + agent/index.ts + main.ts) ── depends on Task 4
Task 13 (delete debug) ── depends on Task 6, 8, 8.5, 8.6, 10, 12 (all debug refs removed)
    │
Task 14 (verify build) ── depends on all above
```
