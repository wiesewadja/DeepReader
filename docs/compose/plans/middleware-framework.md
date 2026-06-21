# 中间件框架实现计划

> **版本**：v1.2（已修正审查问题，可实施）
> **分支**：`feat/middleware-framework`（基于 main 创建 worktree）
> **创建 worktree**：`npm run worktree:create feat/middleware-framework main`
> **最后更新**：2026-06-20

## 一、目标

将 DeepReader 的 LangGraph 节点重构为支持洋葱模型的中间件架构，统一处理横切关注点（日志、缓存、重试、错误处理）。

### 与 LangGraph 内置机制的对比

| 特性 | LangGraph 内置 | 本方案中间件 |
|------|----------------|--------------|
| 重试 | `RetryPolicy`（节点级，固定策略） | 自定义重试逻辑、错误分类、指数退避 |
| 缓存 | Checkpoint（状态级，非响应级） | 响应级缓存，支持条件跳过 |
| 日志 | 无内置 | 统一日志格式，支持耗时统计 |
| 错误处理 | 无内置 | 分类错误、降级策略、fallback |

**结论**：LangGraph 内置机制提供基础能力，本方案在此基础上提供更精细的控制和业务定制。两者互补，非替代关系。

## 二、当前状态分析

### 现有代码

```
src/agent/graph/
├── index.ts              # 图定义，使用 safeNode 包装
├── state.ts              # 状态定义
├── edges.ts              # 条件边
├── node-names.ts         # 节点名称常量
├── nodes/                # 节点实现
│   ├── inspectional.ts
│   ├── analytical-pre-search.ts
│   ├── analytical.ts
│   ├── syntopical.ts
│   ├── advisor.ts
│   ├── visualizer.ts
│   └── formatter.ts
└── utils/
    └── safe-node.ts      # 当前的错误处理封装
```

### 现有问题

1. **safeNode 功能单一**：只处理错误，不支持日志、缓存、重试
2. **无统一日志格式**：每个节点日志格式不一致
3. **无缓存机制**：相同查询重复执行
4. **无重试逻辑**：网络错误直接失败

## 三、目标架构

```
src/agent/graph/
├── middleware/                    # 新增：中间件目录
│   ├── index.ts                  # 中间件导出
│   ├── types.ts                  # 类型定义
│   ├── compose.ts                # 洋葱执行器
│   ├── logging.ts                # 日志中间件
│   ├── caching.ts                # 缓存中间件
│   ├── error-retry.ts            # 重试中间件
│   └── node-error.ts             # 错误分类（供日志/重试使用）
├── index.ts                      # 图定义（使用新中间件）
├── ...
```

## 四、实现步骤

### Phase 1：基础设施（1-2 天）

#### Step 1.1：定义类型接口

**文件**：`src/agent/graph/middleware/types.ts`

```typescript
import type { RunnableConfig } from '@langchain/core/runnables';
import type { CognitiveEngineState } from '../state';

/**
 * 节点上下文
 */
export interface NodeContext {
  /** 节点名称 */
  name: string;
  /** 当前状态 */
  state: CognitiveEngineState;
  /** 运行时配置 */
  config: RunnableConfig;
  /** 会话/线程标识 */
  threadId: string;
  /** 执行开始时间（毫秒） */
  startTime: number;
}

/**
 * 节点函数类型
 */
export type NodeFn = (
  state: CognitiveEngineState,
  config: RunnableConfig,
) => Promise<Partial<CognitiveEngineState>>;

/**
 * 中间件函数类型
 *
 * 洋葱模型：每个中间件可以：
 * 1. 在 next() 前执行逻辑（前置）
 * 2. 调用 next() 执行下一个中间件或核心节点
 * 3. 在 next() 后执行逻辑（后置）
 * 4. 拦截错误并处理
 */
export interface NodeMiddleware {
  (ctx: NodeContext, next: () => Promise<Partial<CognitiveEngineState>>): Promise<Partial<CognitiveEngineState>>;
  /** 中间件名称（调试用） */
  middlewareName?: string;
}

/**
 * 错误类型枚举
 */
export enum ErrorType {
  TIMEOUT = 'timeout',
  NETWORK = 'network',
  PARSING = 'parsing',
  LLM = 'llm',
  TOOL = 'tool',
  UNKNOWN = 'unknown',
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 缓存 TTL（毫秒），默认 5 分钟 */
  ttl: number;
  /** 最大缓存条目数 */
  maxEntries: number;
  /** 不缓存的节点列表 */
  excludeNodes: string[];
}

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 基础延迟（毫秒） */
  baseDelay: number;
  /** 最大延迟（毫秒） */
  maxDelay: number;
  /** 可重试的错误类型 */
  retryableErrors: ErrorType[];
}

/**
 * 节点降级策略
 */
export const FALLBACK_ACTIONS: Record<string, import('../state').NodeError['fallbackAction']> = {
  inspectional: 'global_search',
  pre_search: 'global_search',
  formatter: 'abort',
};

export const DEFAULT_FALLBACK_ACTION: import('../state').NodeError['fallbackAction'] = 'skip_to_formatter';
```

#### Step 1.2：实现洋葱执行器

**文件**：`src/agent/graph/middleware/compose.ts`

```typescript
import type { NodeFn, NodeMiddleware, NodeContext } from './types';

/**
 * 组合多个中间件为一个执行管道
 *
 * 执行顺序：middleware[0]（最外层） → middleware[1] → ... → nodeFn（最内层）
 *
 * @param middlewares 中间件数组（从外到内）
 * @returns 组合后的节点函数
 */
export function composeMiddlewares(
  middlewares: NodeMiddleware[]
): (name: string, fn: NodeFn) => NodeFn {
  return (name, fn) => {
    return async (state, config) => {
      let index = -1;
      const ctx: NodeContext = {
        name,
        state,
        config,
        threadId: config.configurable?.thread_id ?? config.configurable?.checkpoint_id ?? 'unknown',
        startTime: Date.now(),
      };

      async function dispatch(
        i: number
      ): Promise<Partial<CognitiveEngineState>> {
        if (i <= index) {
          throw new Error('next() called multiple times');
        }
        index = i;

        // 到达核心节点
        if (i === middlewares.length) {
          return fn(ctx.state, ctx.config);
        }

        // 执行中间件
        const handler = middlewares[i];
        return handler(ctx, () => dispatch(i + 1));
      }

      return dispatch(0);
    };
  };
}

/**
 * 创建单个中间件的便捷函数
 */
export function createMiddleware(
  name: string,
  handler: NodeMiddleware
): NodeMiddleware {
  const named = handler as NodeMiddleware;
  named.middlewareName = name;
  return named;
}
```

#### Step 1.3：实现日志中间件

**文件**：`src/agent/graph/middleware/logging.ts`

```typescript
import { agentLog as log } from '../../../utils/logger';
import type { NodeContext, NodeMiddleware } from './types';

/**
 * 日志中间件
 *
 * 功能：
 * - 记录节点执行开始
 * - 记录节点执行结束和耗时
 * - 记录错误信息
 */
export const loggingMiddleware: NodeMiddleware = async (ctx, next) => {
  const { name, state, startTime } = ctx;

  // 前置：记录开始
  const messageCount = state.messages?.length ?? 0;
  log(`[${name}] ▶ 开始执行 (messages: ${messageCount})`);

  try {
    // 执行下一个中间件或核心节点
    const result = await next();

    // 后置：记录成功
    const duration = Date.now() - startTime;
    const updatedFields = Object.keys(result).filter(
      (k) => (result as Record<string, unknown>)[k] !== undefined
    );
    log(`[${name}] ✓ 完成 (${duration}ms) → ${updatedFields.join(', ') || '(empty)'}`);

    return result;
  } catch (err) {
    // 后置：记录错误
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`[${name}] ✗ 失败 (${duration}ms): ${errorMsg}`);
    throw err; // 重新抛出，让上层处理
  }
};
```

### Phase 2：核心中间件（2-3 天）

#### Step 2.1：实现错误分类

**文件**：`src/agent/graph/middleware/node-error.ts`

```typescript
import { agentLog as log } from '../../../utils/logger';
import { ErrorType } from './types';
import type { NodeContext } from './types';

/**
 * 分类错误类型
 */
export function classifyError(err: unknown): ErrorType {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('timeout') || msg.includes('TIMEOUT')) {
    return ErrorType.TIMEOUT;
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return ErrorType.NETWORK;
  }
  if (msg.includes('parse') || msg.includes('JSON')) {
    return ErrorType.PARSING;
  }
  if (msg.includes('quota') || msg.includes('rate')) {
    return ErrorType.LLM;
  }
  return ErrorType.UNKNOWN;
}

/**
 * 判断错误是否可重试
 */
export function isRetryable(errorType: ErrorType): boolean {
  return [ErrorType.TIMEOUT, ErrorType.NETWORK, ErrorType.UNKNOWN].includes(
    errorType
  );
}

/**
 * 记录节点错误（供日志/重试使用）
 */
export function logNodeError(ctx: NodeContext, err: unknown): void {
  const errorType = classifyError(err);
  const errorMsg = err instanceof Error ? err.message : String(err);
  log(`[${ctx.name}] 错误处理: ${errorType} - ${errorMsg}`);
}
```

#### Step 2.2：实现重试中间件

**文件**：`src/agent/graph/middleware/error-retry.ts`

```typescript
import { agentLog as log } from '../../../utils/logger';
import type { NodeContext, NodeMiddleware, RetryConfig } from './types';
import { ErrorType, classifyError, isRetryable } from './node-error';

/**
 * 默认重试配置
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryableErrors: [ErrorType.TIMEOUT, ErrorType.NETWORK, ErrorType.UNKNOWN],
};

/**
 * 创建重试中间件
 *
 * 功能：
 * - 自动重试可重试的错误
 * - 指数退避策略
 * - 区分错误类型
 *
 * 注意：此中间件只 catch 异常并决定是否重试，不吞掉错误。
 * 错误兜底由外层的 createEnhancedNode 负责。
 */
export function createRetryMiddleware(
  config: Partial<RetryConfig> = {}
): NodeMiddleware {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  return async (ctx, next) => {
    const { name } = ctx;
    let lastError: unknown;

    for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
      try {
        return await next();
      } catch (err) {
        lastError = err;
        const errorType = classifyError(err);

        // 不可重试的错误直接抛出
        if (!isRetryable(errorType)) {
          log(`[${name}] 不可重试错误 (${errorType})，直接抛出`);
          throw err;
        }

        // 最后一次尝试也失败
        if (attempt === finalConfig.maxRetries) {
          log(`[${name}] 重试 ${finalConfig.maxRetries} 次后仍然失败`);
          throw err;
        }

        // 指数退避
        const delay = Math.min(
          finalConfig.baseDelay * Math.pow(2, attempt),
          finalConfig.maxDelay
        );
        log(
          `[${name}] 重试 ${attempt + 1}/${finalConfig.maxRetries} (${errorType})，等待 ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  };
}

/**
 * 默认重试中间件实例
 */
export const errorRetryMiddleware = createRetryMiddleware();
```

#### Step 2.3：实现缓存中间件

**文件**：`src/agent/graph/middleware/caching.ts`

```typescript
import { agentLog as log } from '../../../utils/logger';
import type { NodeContext, NodeMiddleware, CacheConfig } from './types';

/**
 * 简单字符串 hash（避免 Node crypto 依赖，兼容 Obsidian 渲染进程）
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

/**
 * 内存缓存实现
 */
class MemoryCache {
  private store = new Map<string, { value: unknown; expiry: number }>();
  private maxEntries: number;

  constructor(maxEntries: number = 100) {
    this.maxEntries = maxEntries;
  }

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttl: number): void {
    // 清理过期条目
    if (this.store.size >= this.maxEntries) {
      this.cleanup();
    }

    this.store.set(key, {
      value,
      expiry: Date.now() + ttl,
    });
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiry) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * 默认缓存配置
 */
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 5 * 60 * 1000, // 5 分钟
  maxEntries: 100,
  excludeNodes: ['formatter', 'visualizer', 'syntopical', 'advisor'],
};

/**
 * 节点依赖的状态字段映射
 *
 * ⚠️ 初版实现，后续根据实际节点输入细调。
 * 原则：缓存键必须覆盖影响该节点输出的所有状态字段。
 */
const NODE_DEPENDENCIES: Record<string, (state: import('../state').CognitiveEngineState) => string> = {
  inspectional: (s) => [
    s.messages?.length,
    s.messages?.[s.messages.length - 1]?.content,
    s.pdfName,
    s.bookId,
    s.correctionDetected,
    s.mode,
    s.crossBookMode,
  ].join('|'),
  pre_search: (s) => [
    s.scopeNodeIds?.join(','),
    s.rewrittenQuery,
    s.allowedTools?.join(','),
    s.queryVector?.slice(0, 5).join(','),
  ].join('|'),
  analytical: (s) => [
    s.preSearchBlock,
    s.validatedScopeNodeIds?.join(','),
    s.rewrittenQuery,
    s.depth,
    s.allowedTools?.join(','),
  ].join('|'),
};

/**
 * 生成缓存键（基于节点依赖的状态字段 + 会话标识）
 */
function generateCacheKey(ctx: NodeContext): string {
  const { name, state, threadId } = ctx;

  // 节点依赖的状态字段
  const depsFn = NODE_DEPENDENCIES[name];
  const deps = depsFn ? depsFn(state) : '';

  // 组合并 hash
  const raw = `${threadId}:${name}:${deps}`;
  return djb2Hash(raw);
}

/**
 * 创建缓存中间件
 *
 * 功能：
 * - 缓存节点执行结果
 * - 相同查询直接返回缓存
 * - 支持配置排除的节点
 */
export function createCachingMiddleware(
  config: Partial<CacheConfig> = {}
): NodeMiddleware {
  const finalConfig = { ...DEFAULT_CACHE_CONFIG, ...config };
  const cache = new MemoryCache(finalConfig.maxEntries);

  return async (ctx, next) => {
    const { name, startTime } = ctx;

    // 检查是否排除
    if (finalConfig.excludeNodes.includes(name)) {
      return next();
    }

    // 检查缓存
    const cacheKey = generateCacheKey(ctx);
    const cached = cache.get(cacheKey);

    if (cached) {
      const duration = Date.now() - startTime;
      log(`[${name}] 💾 缓存命中 (${duration}ms)`);
      return cached as Partial<import('../state').CognitiveEngineState>;
    }

    // 执行并缓存
    const result = await next();
    cache.set(cacheKey, result, finalConfig.ttl);

    return result;
  };
}

/**
 * 默认缓存中间件实例
 */
export const cachingMiddleware = createCachingMiddleware();
```

### Phase 3：集成与迁移（1-2 天）

#### Step 3.1：导出中间件

**文件**：`src/agent/graph/middleware/index.ts`

```typescript
/**
 * 中间件框架导出
 */

// 类型
export type { NodeContext, NodeMiddleware, NodeFn } from './types';
export { ErrorType, FALLBACK_ACTIONS, DEFAULT_FALLBACK_ACTION } from './types';

// 核心
export { composeMiddlewares, createMiddleware } from './compose';

// 中间件
export { loggingMiddleware } from './logging';
export { classifyError, isRetryable, logNodeError } from './node-error';
export { errorRetryMiddleware, createRetryMiddleware } from './error-retry';
export { cachingMiddleware, createCachingMiddleware } from './caching';

// 便捷函数
import { composeMiddlewares } from './compose';
import { loggingMiddleware } from './logging';
import { cachingMiddleware } from './caching';
import { errorRetryMiddleware } from './error-retry';
import { FALLBACK_ACTIONS, DEFAULT_FALLBACK_ACTION } from './types';
import type { NodeMiddleware, NodeFn } from './types';
import type { CognitiveEngineState, NodeError } from '../state';

/**
 * 默认中间件管道
 * 顺序（从外到内）：createEnhancedNode 外部 Fallback 包装层 → 日志 → 重试 → 缓存 → 节点
 *
 * 为什么这个顺序：
 * - createEnhancedNode 外部作为最后的防线，捕获最终失败并返回 fallback 状态与 nodeErrors
 * - logging 记录整个中间件链（含重试）的最终执行结果和总耗时
 * - retry 位于中间层，当内部节点或缓存阶段抛出异常时执行指数退避重试
 * - caching 在成功时拦截并返回缓存，避免进入真实的节点执行
 */
export const defaultMiddlewares: NodeMiddleware[] = [
  loggingMiddleware,
  errorRetryMiddleware,
  cachingMiddleware,
];

/**
 * 创建增强版节点（带中间件 + fallback）
 *
 * @param name 节点名称
 * @param fn 核心节点函数
 * @param middlewares 中间件管道
 * @param fallback 失败时的降级函数（可选）
 */
export function createEnhancedNode(
  name: string,
  fn: NodeFn,
  middlewares: NodeMiddleware[] = defaultMiddlewares,
  fallback?: (state: CognitiveEngineState) => Partial<CognitiveEngineState>
): NodeFn {
  // 1. 先用中间件管道包装原始节点函数 fn（使重试和缓存能感知到 fn 抛出的异常）
  const composed = composeMiddlewares(middlewares)(name, fn);

  // 2. 在最外层进行统一的错误捕获与降级 fallback
  return async (state, config) => {
    try {
      return await composed(state, config);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const nodeError: NodeError = {
        message: errorMsg,
        recoverable: name !== 'formatter',
        fallbackAction: FALLBACK_ACTIONS[name] ?? DEFAULT_FALLBACK_ACTION,
      };

      // 合并 fallback 结果和 nodeErrors
      const fallbackResult = fallback ? fallback(state) : {};
      return {
        ...fallbackResult,
        nodeErrors: { [name]: nodeError },
      };
    }
  };
}
```

#### Step 3.2：重构图定义

**文件**：`src/agent/graph/index.ts`（修改）

```typescript
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { routeFromStart, routeAfterInspectional, routeAfterPreSearch, routeAfterAnalysis } from './edges';
import { NODE_NAMES, EDGE_KEYS } from './node-names';
import { advisorNode } from './nodes/advisor';
import { analyticalNode } from './nodes/analytical';
import { preSearchNode } from './nodes/analytical-pre-search';
import { formatterNode } from './nodes/formatter';
import { inspectionalNode } from './nodes/inspectional';
import { syntopicalNode } from './nodes/syntopical';
import { visualizerNode } from './nodes/visualizer';
import { CognitiveEngineAnnotation } from './state';
import { createEnhancedNode } from './middleware';

// 使用新的中间件系统包装节点
const enhancedInspectional = createEnhancedNode(
  NODE_NAMES.INSPECTIONAL,
  inspectionalNode,
  undefined,
  (state) => ({
    scopeNodeIds: [],
    tocSummary: '',
    betterQuestion: state.rewrittenQuery,
    structuralAnalysis: '',
    suggestedKeywords: [],
  })
);

const enhancedPreSearch = createEnhancedNode(
  NODE_NAMES.PRE_SEARCH,
  preSearchNode,
  undefined,
  (state) => ({
    validatedScopeNodeIds: state.scopeNodeIds ?? [],
    preSearchBlock: '',
    earlyStopContent: '',
    toolResultsSnapshot: [],
  })
);

const enhancedAnalytical = createEnhancedNode(
  NODE_NAMES.ANALYTICAL,
  analyticalNode,
  undefined,
  () => ({
    analysisResult: '',
    toolResultsSnapshot: [],
  })
);

const enhancedFormatter = createEnhancedNode(
  NODE_NAMES.FORMATTER,
  formatterNode,
  undefined,
  (state) => ({
    formattedOutput: state.analysisResult || state.rewrittenQuery || '抱歉，处理您的请求时遇到了问题，请重试。',
  })
);

// Build the graph
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode(NODE_NAMES.INSPECTIONAL, enhancedInspectional)
  .addNode(NODE_NAMES.PRE_SEARCH, enhancedPreSearch)
  .addNode(NODE_NAMES.ANALYTICAL, enhancedAnalytical)
  .addNode(NODE_NAMES.SYNTOPICAL, createEnhancedNode(
    NODE_NAMES.SYNTOPICAL,
    syntopicalNode,
    undefined,
    () => ({
      analysisResult: '',
      toolResultsSnapshot: [],
    })
  ))
  .addNode(NODE_NAMES.ADVISOR, createEnhancedNode(
    NODE_NAMES.ADVISOR,
    advisorNode,
    undefined,
    () => ({
      analysisResult: '',
      toolResultsSnapshot: [],
    })
  ))
  .addNode(NODE_NAMES.VISUALIZER, createEnhancedNode(
    NODE_NAMES.VISUALIZER,
    visualizerNode,
    undefined,
    (state) => ({
      analysisResult: state.analysisResult || '',
    })
  ))
  .addNode(NODE_NAMES.FORMATTER, enhancedFormatter)
  .addConditionalEdges(START, routeFromStart, {
    [NODE_NAMES.INSPECTIONAL]: NODE_NAMES.INSPECTIONAL,
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
    [NODE_NAMES.ADVISOR]: NODE_NAMES.ADVISOR,
  })
  .addConditionalEdges(NODE_NAMES.INSPECTIONAL, routeAfterInspectional, {
    [NODE_NAMES.PRE_SEARCH]: NODE_NAMES.PRE_SEARCH,
    [NODE_NAMES.SYNTOPICAL]: NODE_NAMES.SYNTOPICAL,
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
    [EDGE_KEYS.DONE]: NODE_NAMES.FORMATTER,
  })
  .addConditionalEdges(NODE_NAMES.PRE_SEARCH, routeAfterPreSearch, {
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
    [NODE_NAMES.ANALYTICAL]: NODE_NAMES.ANALYTICAL,
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
  })
  .addConditionalEdges(NODE_NAMES.ANALYTICAL, routeAfterAnalysis, {
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
  })
  .addConditionalEdges(NODE_NAMES.SYNTOPICAL, routeAfterAnalysis, {
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
  })
  .addEdge(NODE_NAMES.VISUALIZER, NODE_NAMES.FORMATTER)
  .addEdge(NODE_NAMES.ADVISOR, NODE_NAMES.FORMATTER)
  .addEdge(NODE_NAMES.FORMATTER, END);

export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});
```

#### Step 3.3：删除旧的 safeNode

**文件**：`src/agent/graph/utils/safe-node.ts`

```typescript
/**
 * @deprecated createEnhancedNode 已替代 safeNode，请直接使用 src/agent/graph/middleware
 */
export { createEnhancedNode as safeNode } from '../middleware';
```

## 五、测试计划

### 单元测试

**文件**：`tests/unit/agent/middleware/`

```
middleware/
├── compose.test.ts        # 测试洋葱执行器
├── logging.test.ts        # 测试日志中间件
├── caching.test.ts        # 测试缓存中间件
├── error-retry.test.ts    # 测试重试中间件
└── node-error.test.ts     # 测试错误分类
```

### 集成测试

**文件**：`tests/integration/agent/middleware-integration.test.ts`

```typescript
describe('Middleware Integration', () => {
  it('should execute middleware in correct order', async () => {
    const order: string[] = [];
    
    const middleware1: NodeMiddleware = async (ctx, next) => {
      order.push('before-1');
      const result = await next();
      order.push('after-1');
      return result;
    };
    
    const middleware2: NodeMiddleware = async (ctx, next) => {
      order.push('before-2');
      const result = await next();
      order.push('after-2');
      return result;
    };
    
    const node: NodeFn = async () => {
      order.push('node');
      return {};
    };
    
    const enhanced = composeMiddlewares([middleware1, middleware2])('test', node);
    await enhanced(mockState, mockConfig);
    
    expect(order).toEqual(['before-1', 'before-2', 'node', 'after-2', 'after-1']);
  });

  it('should retry errors and eventually fallback', async () => {
    let calls = 0;
    const failingNode: NodeFn = async () => {
      calls++;
      throw new Error('timeout');
    };

    const enhanced = createEnhancedNode(
      'test',
      failingNode,
      [errorRetryMiddleware],
      () => ({ analysisResult: 'fallback' })
    );

    const result = await enhanced(mockState, mockConfig);
    expect(calls).toBe(4); // 1 次初始 + 3 次重试
    expect(result.analysisResult).toBe('fallback');
    expect(result.nodeErrors).toBeDefined();
  });
});
```

### Fallback 回归测试

**文件**：`tests/integration/agent/fallback-regression.test.ts`

```typescript
describe('Fallback Regression Tests', () => {
  it('inspectional fallback should return required fields', async () => {
    const state = createMockState({ rewrittenQuery: 'test' });
    const result = await enhancedInspectional(state, mockConfig);
    
    expect(result).toHaveProperty('scopeNodeIds');
    expect(result).toHaveProperty('tocSummary');
    expect(result).toHaveProperty('structuralAnalysis');
    expect(result).toHaveProperty('suggestedKeywords');
    expect(result).toHaveProperty('nodeErrors');
  });

  it('pre_search fallback should return validatedScopeNodeIds', async () => {
    const state = createMockState({ scopeNodeIds: ['1', '2'] });
    const result = await enhancedPreSearch(state, mockConfig);
    
    expect(result).toHaveProperty('validatedScopeNodeIds');
    expect(result.validatedScopeNodeIds).toEqual(['1', '2']);
    expect(result).toHaveProperty('nodeErrors');
  });

  it('formatter fallback should return formattedOutput', async () => {
    const state = createMockState({ analysisResult: 'test result' });
    const result = await enhancedFormatter(state, mockConfig);
    
    expect(result).toHaveProperty('formattedOutput');
    expect(result.formattedOutput).toContain('test result');
  });
});
```

### 冒烟测试

```bash
npm run smoke:core
```

### E2E 测试

```bash
npm run e2e-light
```

## 六、时间估算

| 阶段 | 任务 | 时间 |
|------|------|----------|
| **Phase 1** | 基础设施（类型 + 执行器 + 日志） | 1-2 天 |
| **Phase 2** | 核心中间件（错误分类 + 重试 + 缓存） | 2-3 天 |
| **Phase 3** | 集成与迁移 | 1-2 天 |
| **测试** | 单元测试 + 集成测试 + fallback 回归 | 1-2 天 |
| **总计** | | **5-9 天** |

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 缓存导致数据不一致 | 高 | 排除关键节点，NODE_DEPENDENCIES 覆盖所有相关状态，支持缓存失效 |
| 重试风暴 | 中 | 设置最大重试次数和延迟上限 |
| 中间件顺序错误 | 高 | 文档明确顺序，集成测试验证 |
| 性能下降 | 低 | 基准测试，优化缓存命中率 |
| fallback 行为回退 | 高 | 完整 fallback 回归测试 |

## 八、后续优化

1. **分布式缓存**：使用 Redis 替代内存缓存
2. **中间件配置化**：支持从配置文件加载中间件
3. **中间件插件化**：支持动态加载/卸载中间件
4. **性能监控**：添加中间件执行耗时统计
5. **A/B 测试**：支持不同中间件组合的对比测试

## 九、参考资源

- [dive-into-langgraph 第3章: 中间件](https://luochang212.github.io/dive-into-langgraph/middleware/)
- [Koa.js 中间件模型](https://koajs.com/)
- [LangGraph Python 中间件](https://langchain-ai.github.io/langgraph/how-tos/middleware/)
