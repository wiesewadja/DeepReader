# L1 — FrontendAgent 入口层

> L0 传进来的 ToolContext 在这里被转译成 LangGraph 配置
>
> 状态机"被叫醒"后做的第一件事：分配会话、构建 configurable、调用 `cognitiveEngine.stream()`。

---

## 1. 现状

### 1.1 角色定位

L1 是 L0 与 L2 之间的"翻译官 + 调度室"：

| 职责 | 说明 |
|------|------|
| **唯一对外 API** | `chat()` / `continueChat()` / `resumeGraphExecution()` / `getSystemPromptAsync()` |
| **子系统装配** | 持有 `LLMClientManager`、`MemoryStore`、`ContextBuilder`、`IntentRouter` |
| **会话管理** | `threadId` 分配（HITL 恢复时复用） |
| **LangGraph 配置构建** | `buildGraphConfigurable()` — 把 ToolContext + 历史 + 记忆 → configurable |
| **流执行** | `executeWithStream()` — 包装 `cognitiveEngine.stream()` + 错误处理 |
| **生命周期** | `initialize()` / `destroy()`，目录创建、`MEMORY.md` 初始化 |

### 1.2 FrontendAgent 公开 API

| 方法 | 用途 | 何时调用 |
|------|------|---------|
| `chat(userMessage, context, callbacks)` | 发起新对话 | L0 用户发送消息、proactive 触发 |
| `continueChat(history, userMessage, context, callbacks)` | 带历史续接（同一 thread 内） | Socratic 模式续接 |
| `resumeGraphExecution(approved, feedback, context, callbacks)` | HITL 恢复 | 用户审查 S4 输出后点击"继续" |
| `getSystemPromptAsync(metadata, docDescription)` | 获取拼装好的系统 prompt | ChatInput 初始化时 |
| `getLLMClient()` | 直接获取 LLM 客户端 | L0 内部使用（已知问题 §2.3） |
| `getMemoryStore()` | 获取 MemoryStore | 里程碑记录等 |

**关键不变量**：所有"用户问题 → 状态机"的路径都必须经过 `runGraphEngine`（CLAUDE.md 约束："Agent 唯入口: `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`"）。

### 1.3 runGraphEngine 主流程

```typescript
async runGraphEngine(userMessage, context, callbacks, chatHistory?) {
  await this.initialize();  // 确保目录 + MEMORY.md 存在

  // Step 1: 校验 API Key
  if (!this.options.apiKey) { callbacks.onError(...); return early; }

  // Step 2: 分配 threadId
  const threadId = `thread-${bookId}-${Date.now()}-${rand6}`;
  this.activeThreadId = threadId;

  // Step 3: 构建 LangGraph configurable
  const { _langsmithTracer, ...configurable } =
    await this.buildGraphConfigurable(context, callbacks, threadId, userMessage, chatHistory);

  // Step 4: 组装 LangGraph 初始 state
  const streamInput = {
    messages: [new HumanMessage(userMessage)],
    bookId, pdfName,
    depth: context.mode === 'proactive' ? ReadingDepth.INSPECTIONAL : undefined,
    mode: context.mode,
    proactiveTrigger, highlightContext,
    wereadAvailable: !!plugin.settings.wereadApiKey,
    crossBookMode: !!context.crossBook?.booklistBookIds?.length,
  };

  // Step 5: stream() + 错误处理
  const result = await this.executeWithStream(streamInput, callbacks, configurable, tracer);

  // Step 6: 后台累计对话轮数（profileBuilder）
  this.accumulateConversationRound(userMessage, result.messages[0]?.content);

  return result;
}
```

### 1.4 IntentRouter（路由预处理器）

L1 内部有一个**正则预路由**的 `IntentRouter`，与 LangGraph 内部的 Inspectional 节点不同：

- **IntentRouter（L1）**：基于 `intent-rules.json` 的正则匹配，**裁剪 allowedTools** + 生成 `<system_note>` 注入
- **Inspectional（LangGraph，含原 S0 Router）**：用 fastModel 做深度分类 + 查询重写

> **架构变更说明**：原先独立的 S0 Router 节点已合并到 Inspectional 节点。
> 深度分类 + 查询重写现在由 inspectional 节点一次性完成。

`IntentRouter.analyze()` 返回：
```typescript
interface IntentResult {
  allowedTools: string[];      // 允许的工具子集
  systemNote: string;          // 注入到 prompt 的 <system_note>
  detectedIntents: string[];   // 命中的意图
  maxIterations: number;       // 动态最大迭代次数
}
```

**关键设计**：`allowedTools` 是**裁剪**作用——Inspectional 在分类时不会越界选工具。这是"模型不听话"问题的工程级防御。

`intent-rules.json` 结构（src/agent/router/intent-rules.json）：
```json
{
  "version": "1.0",
  "rules": [
    {
      "id": "search-book",
      "pattern": "第[一二三四五六七八九十0-9]+章",
      "intent": "book_search",
      "tools": ["search_book", "read_book_section"],
      "priority": 1,
      "maxIterations": 6
    },
    ...
  ],
  "fallback": {
    "intent": "general_qa",
    "tools": ["search_book", "read_book_section", "search_journal"],
    "maxIterations": 4
  }
}
```

### 1.5 buildGraphConfigurable 详解

`configurable` 是 LangGraph 节点通过 `RunnableConfig` 接收的"运行时配置"。构建过程：

```typescript
private async buildGraphConfigurable(context, callbacks, threadId, rawUserQuery?, chatHistory?) {
  // 1. 懒加载 chat models（main + fast）
  if (!this.cachedModels) {
    this.cachedModels = createChatModels(mainConfig, fastConfig);
  }
  const models = this.cachedModels;  // { fast, main }

  // 2. 加载 MEMORY.md 上下文
  const memoryContext = await this.memoryStore.getMemoryContext();

  // 3. 注入 journalDir（启用 search_journal 工具）
  if (options.journalDir && !context.visual?.journalDir) {
    context.visual = { journalDir: options.journalDir };
  }

  // 4. 读取用户画像摘要（常驻注入）
  const userProfileSummary = await profileBuilder?.readSummary() || undefined;

  // 5. 清洗历史 + 摘要
  const cleanHistory = chatHistory?.filter(m => m.role === 'user' || m.role === 'assistant');
  const recentHistorySummaries = summarizeRecentHistory(cleanHistory, 3);
  const prevSearchedBlockIds = extractPrevBlockIds(cleanHistory);

  // 6. 构建 SharedContext（节点用）
  const ctx = createSharedContext({...});

  // 7. 构造 engineCallbacks
  const engineCallbacks = {
    onProgress, onContent, onReasoning, onComplete, onError,
  };

  // 8. LangSmith tracer
  const langsmithTracer = langsmithEnabled
    ? getLangSmithTracer({...})
    : null;

  return {
    thread_id: threadId,
    fastModel: models.fast,
    mainModel: models.main,
    sharedContext: ctx,
    chatHistory: cleanHistory,
    toolContext: context,
    callbacks: engineCallbacks,
    enableHumanReview,
    ttsConfig, llmConfig,
    _langsmithTracer,
  };
}
```

### 1.6 executeWithStream 错误处理

```typescript
private async executeWithStream(streamInput, callbacks, configurable, tracer, errorPrefix) {
  try {
    const stream = await this.getCompiledEngine().stream(streamInput, {
      streamMode: 'updates',
      configurable,
      signal: callbacks.abortSignal,
      ...(tracer ? { callbacks: [tracer] } : {}),
    });
    const result = await this.processGraphStream(stream, callbacks, { configurable });
    if (!result.interrupted) this.activeThreadId = null;
    return result;
  } catch (err) {
    // Abort 静默处理
    if (err instanceof DOMException && err.name === 'AbortError') return { messages: [] };
    if (isAbort(err) || callbacks.abortSignal?.aborted) return { messages: [] };

    // 真实错误
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`[FrontendAgent] ${errorPrefix}:`, errorMsg);
    callbacks.onError?.(errorMsg);
    this.activeThreadId = null;
    return { messages: [{ role: 'assistant', content: `${errorPrefix}: ${errorMsg}` }] };
  }
}
```

**已知风险**：catch 兜底会**吞掉所有非 abort 错误**，对前端暴露的是模糊错误信息。

---

## 2. 已知问题

### 2.1 IntentRouter 与 Inspectional 内双调用造成歧义

**现象**：
- L1 调 `IntentRouter.analyze()` 一次（裁剪 tools）
- L2 内部 Inspectional 节点（含原 S0 Router）**又**调 `IntentRouter.analyze()` 两次（rawQuery 一次，rewrittenQuery 一次）—— 见 `src/agent/graph/nodes/inspectional.ts:101, 212`

**后果**：
- 同样的输入可能匹配多次，行为难以预测
- `intent-rules.json` 的修改影响面大（L1 改 + L2 改）
- Inspectional 内部的 `inheritedTools` 机制（`prevTools`）让逻辑更复杂

**证据**：`inspectional.ts` 两处独立的 `intentRouter.analyze()` 调用。

### 2.2 threadId 分配策略过细

**现象**：
```typescript
const threadId = `thread-${context.book.indexId || 'unknown'}-${Date.now()}-${rand6}`;
```

每次 `runGraphEngine` 都生成新 threadId，**`continueChat` 和 `chat` 都会生成新 ID**，这意味着 LangGraph 的 `MemorySaver` checkpointer 实际上**不会被命中**（同一逻辑会话不会被认为是同一会话）。

**后果**：
- HITL 恢复的 threadId 靠 `this.activeThreadId` 保留，但重启后丢失
- 没有真正的"会话级"记忆能力

### 2.3 getLLMClient() 破坏分层

**现象**：`getLLMClient()` 让 L0（chat-controller）能直接调 LLM，绕过 LangGraph。

**后果**：
- `compressReferencedDoc` 等业务逻辑散落在 L0
- L0 持有 LLM 客户端的引用，调试时容易误调

**建议**（见 §3）：禁用 `getLLMClient()`，或只允许调"安全的 LLM 任务"（摘要、分类）。

### 2.4 MEMORY.md 压缩策略粗糙

**现象**：`maybeCompressMemory()` + `compressMemoryWithLLM()` 是一段**直接 LLM 调用**压缩代码，独立于 LangGraph。

**问题**：
- 压缩 prompt 写死在代码里，无法迭代优化
- 压缩触发只看"行数"或"字符数"，没有"语义阈值"
- 失败时静默回退（`return null`），用户感知不到

### 2.5 LangSmith tracer 注入到 callbacks 数组

**现象**：
```typescript
await this.getCompiledEngine().stream(streamInput, {
  streamMode: 'updates',
  configurable,
  signal: callbacks.abortSignal,
  ...(tracer ? { callbacks: [tracer] } : {}),
});
```

`callbacks: [tracer]` 是 LangChain 的回调机制，不是 LangGraph 的标准 API。**这里混用了两套机制**。

**风险**：
- LangGraph 节点执行不一定会触发 LangChain callbacks
- tracer 可能只记录"裸 LLM 调用"，错过节点级 span

---

## 3. 优化探讨

### 3.1 IntentRouter 调用点统一

**问题**：L1 调一次 + Inspectional 内调两次，合计三次。

**方案 A**：把 IntentRouter 移到 LangGraph state 初始化阶段（buildConfigurable 时调一次），结果写入 `allowedTools` 字段。
- ✅ 调用点统一
- ❌ 失去"rewrittenQuery 后再分类"的能力

**方案 B**：Inspectional 内不再调 IntentRouter，只信任 L1 传入的 `allowedTools`，自己加一个 `rewrittenQuery` 后的"二次裁剪"逻辑。
- ✅ 平衡：保持 LLM 二次裁剪的能力
- ❌ Inspectional 逻辑更复杂

**待定**：哪种方案更符合"工具裁剪是 L0 的事" vs "rewrittenQuery 后需要再判"的争论。

### 3.2 threadId 持久化

**问题**：threadId 只在 `this.activeThreadId` 内存变量中。

**方案**：
- 写到 `chatHistory` 顶部
- LLM 退出时持久化到 `sessions/{sessionId}.json`
- 启动时读回

**前提**：要解决"同一 threadId 多次 stream"的 checkpointer 行为（LangGraph 默认会从 checkpointer 续接，但 S4 formatter 可能重复执行）。

### 3.3 LangSmith tracer 重构

**问题**：现在 tracer 通过 `callbacks: [tracer]` 注入。

**方案**：用 LangGraph 的 `LangChainTracer` 实例化，或换成 OpenTelemetry exporter。
- 收益：节点级 span、跨节点数据流追踪
- 风险：迁移成本，需要重新跑一次数据校对

### 3.4 MEMORY.md 压缩的"无 LLM"快速路径

**问题**：现在压缩无脑调 LLM。

**方案**：
- 行数 > 阈值：先尝试**基于规则的瘦身**（去重、合并相似条目、删时间戳）
- 规则瘦身不够：再调 LLM
- 失败：保留原 MEMORY.md，下次再试

**收益**：减少 LLM 调用，降低 token 成本。

### 3.5 errorPrefix 与错误分类

`executeWithStream` 的 catch 块用 `errorPrefix: string` 区分"图执行错误"和"恢复错误"，但实际行为是"统一包成字符串扔给 onError"。

**方案**：
- 引入 `AgentError` 类型（`{ code, recoverable, userMessage, details }`）
- onError 接收结构化错误，UI 层可以分情况提示
- 可恢复错误（如"网络超时"）不暴露"引擎错误"前缀

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/index.ts` | FrontendAgent 主类（568 行） |
| `src/agent/llm-client.ts` | LLMClientManager（main + fast 双模型） |
| `src/agent/router/intent-router.ts` | 正则预路由 |
| `src/agent/router/intent-rules.json` | 路由规则配置 |
| `src/agent/router/types.ts` | IntentRule / IntentResult |
| `src/agent/graph/shared-context.ts` | SharedContext 工厂 |
| `src/agent/graph/utils/history-summarizer.ts` | 历史摘要、prevBlockIds 提取 |

## 5. 关联文档

- L0 外部触发层 — 调用 `chat()` / `continueChat()` / `resumeGraphExecution()`
- L2 LangGraph 状态机层 — `getCompiledEngine()` 返回 `cognitiveEngine`
- L8 基础设施层 — `MemoryStore` / `ContextBuilder` / Tracer 的实现
- ADR-003 LangGraph 状态机 — 选型决策
- ADR-006 双模型路由 — main / fast 分离的设计
