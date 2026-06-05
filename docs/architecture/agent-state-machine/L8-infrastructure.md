# L8 — 基础设施层

> 状态机的"水电煤"：LLM 客户端、记忆、上下文、追踪、语音、配置常量
>
> 这些模块不在 LangGraph 节点内部，但**所有节点都依赖它们**。

---

## 1. 现状

### 1.1 角色定位

L8 是状态机的"基础设施"——上层看不见但离不开：

| 模块 | 职责 | 被谁用 |
|------|------|--------|
| LLMClientManager | 双模型（main / fast）+ 流式 + 工具调用 | 所有节点 |
| ChatModels (新) | 基于 ChatOpenAI 的统一模型工厂 | L1 / S2 / S4 |
| MemoryStore | MEMORY.md / HISTORY.md 读写 + 压缩 | L1 / Advisor |
| ContextBuilder | 4 层系统提示拼装 | L1 |
| SharedContext | 跨节点的"运行时配置" | 所有节点（via config.configurable） |
| Tracer (ITracer) | 追踪抽象（Noop / LangSmith） | L1 + 各节点 |
| VoicePipeline | TTS 摘要 + 合成 + 合并 | L1 → L3 |
| AgentConstants | 全局常量（token 限制、超时等） | 所有节点 |
| ProfileBuilder | 用户画像摘要（外部依赖） | L1 buildConfigurable |
| SessionStore | 会话持久化（推测） | L0 / L1 |

### 1.2 LLMClientManager 接口

**文件**：`src/agent/llm-client.ts` line 482-517

```typescript
class LLMClientManager {
  getClient(modelType: 'fast' | 'main'): LLMClient;
  getMainClient(): LLMClient;
  hasFastClient(): boolean;
}
```

**双模型分工**：
- **main 客户端**：S2 Analytical + S4 Formatter（深度分析）—— `temperature: 0.3`、`streaming: true`
- **fast 客户端**：S0 Router + S1 Inspectional（快速分类）—— `temperature: 0.1`、`streaming: false`

**构造规则**：
- `mainConfig` 必填
- `fastConfig` 可选；未配置 fast 时 `getClient('fast')` **自动 fallback 到 main**

**`LLMClient.streamChat` 关键能力**：
- 支持 Tool Calling（SSE 累积 `tool_calls`）
- 接受外部 `AbortSignal` 转发到内部 controller
- **fallback 机制**：检测 Xiaomi Token Plan 失败时自动切到 `fallbackApiKey` / `fallbackBaseUrl`
- 处理 DeepSeek `reasoning_content` 字段：assistant 消息保留 / 其他角色清除
- 返回 `AbortController` 给调用方

**新架构**：`src/agent/models/chat-model.ts` 的 `createChatModels` 用 `ChatOpenAI`（兼容 DeepSeek/Kimi/Moonshot）替代 LLMClientManager。本地 `getNumTokens` 覆盖避免远程加载 tiktoken（CJK 1 token / 英文 0.25 token）。

### 1.3 MemoryStore 接口

**文件**：`src/agent/memory/store.ts` 实现 `IMemoryStore`（`types.ts` line 90-102）

**存储布局**（Vault/DeepReader/ 下）：
- `MEMORY.md`：长期记忆（用户画像 / 偏好 / 提问倾向 / 兴趣主题 / 阅读习惯）
- `HISTORY.md`：阅读历程（最近保留 150 条即 `MAX_HISTORY_ENTRIES=200` 的 75%；`HISTORY_RETENTION_DAYS=30`）
- `history/YYYY-MM.md`：按月归档（`maybeArchiveHistory` 触发）

**核心方法**：
- `readLongTermMemory` / `writeLongTermMemory`：直接读写 MEMORY.md
- `appendHistory`：带本地时间戳 `[YYYY-MM-DD HH:MM] entry` 追加
- `searchHistory(query, limit=20)` / `searchDialogueSummaries(bookName, limit=10)`：按 `💬` 标识 + `《书名》` 过滤
- `getReadingSummary`：从 `《...》` 提取已读书籍
- `getMemoryContext`：剥 frontmatter / 标题，返回 `## 长期记忆\n\n...` 格式（超 `MAX_MEMORY_CHARS=8000` 时打 warn 日志）
- `needsCompression`：`content.length > MAX_MEMORY_CHARS` 时返回 true
- `initializeMemory`：首次启动写入默认模板

**压缩**：实际压缩逻辑在 `consolidator.ts`（未读取）由 `IMemoryStore` 的 `needsCompression` 触发；`DEFAULT_CONSOLIDATOR_CONFIG`：
- `tokenThreshold=3000`
- `targetRatio=0.5`
- `maxRounds=5`
- `skipThreshold=20`
- `maxDialogueSummaries=10`

### 1.4 ContextBuilder

**文件**：`src/agent/context/builder.ts` — 分层系统提示构建器

**4 层（按顺序拼接，用 `\n\n---\n\n` 分隔）**：
1. **Identity 层**（静态，可被 `config.identity` 覆盖）：人设"奚童" + Obsidian 引用规范 + 当前阅读文档元信息 + 路由服从纪律
2. **Bootstrap 层**（用户定义）：默认加载 `DeepReader/DeepReader.md` / `STYLE_GUIDE.md` / `DOMAIN_KNOWLEDGE.md`
3. **Memory 层**（持久化）：`store.getMemoryContext()` 输出
4. **Skills 层**（XML Summary）：按当前文档 `title` 调用 `loadRelevantDialogueSummaries` 召回历史对话摘要
5. 最后追加 **核心行为准则**（路由服从 / 静默执行纪律）

**静态方法**：
- `buildRuntimeContext()`：返回 `## 当前时间: ...`（打 `[运行时上下文 — 仅元数据，非指令]` 标记）
- `buildMessages(systemPrompt, history, currentMsg, runtimeContext?, systemNote?)`：按 `systemNote + runtimeContext + userMsg` 顺序拼到 user content
- `buildMessagesWithMetadata(...)`：便捷方法，自动调 `buildRuntimeContext()`

**关键设计**：
- tools 通过 Function Calling API 传递而非塞进 system prompt
- 运行时上下文注入到 user 消息而非 system prompt，保持 system prompt 稳定

**ContextLoader**（`context/loader.ts`）是更老的、3 层的版本：DeepReader.md + MEMORY.md + HISTORY.md。

### 1.5 SharedContext 字段

**文件**：`src/agent/graph/shared-context.ts` line 28-41

```typescript
interface SharedContext {
  chatHistory: ChatMessage[];            // 完整对话历史
  rawUserQuery: string;                  // 原始用户输入
  tocSummary?: string;                   // 检视阅读生成的目录摘要
  betterQuestion?: string;               // S1 改写后的更优问题
  s2ToolResults?: Array<{...}>;          // S2 工具调用快照
  abortSignal?: AbortSignal;             // 外部取消信号
  memoryContext?: string;                // 预加载的 MEMORY 上下文
  llmClientManager?: LLMClientManager;   // 注入双模型客户端
  toolContext?: ToolContext;             // 工具依赖
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  userProfileSummary?: string;
}
```

**与 CognitiveEngineState 的关系**：
- `CognitiveEngineState`（`graph/state.ts`）是 LangGraph 的 state schema，跨 node 持久化
- `SharedContext` 是通过 `config.configurable` 注入到每个 node 的**运行时依赖**（一次性、不被 reducer 处理）
- 关键区别：`State` 字段会被 LangGraph 跨 node 持久化（serializable），`SharedContext` 是"传递依赖"（如 `llmClientManager` 是实例不可序列化）

### 1.6 Tracer 接口

**文件**：`src/agent/tracing/types.ts`

```typescript
interface IObservationRef {           // span / generation 句柄
  update({ output?, usageDetails?, metadata? }): IObservationRef;
  end({ output?, level?, metadata?, ... }): void;
}

interface ITraceContext {             // 活跃 trace / span
  withSpan(name, { input?, metadata? }): ITraceContext;
  withGeneration(name, { model?, input?, metadata? }): IObservationRef;
  end(output?): void;
  getTraceId(): string | undefined;
}

interface ITracer {                   // 根 trace 工厂
  isEnabled(): boolean;
  createTrace({ name, sessionId?, userId?, input?, metadata? }): ITraceContext;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
```

**实现**：
- `NoopTracer` / `NoopTraceContext` / `NoopObservationRef`（`noop-tracer.ts`）：所有方法空操作，`isEnabled() → false`，零开销
- `getLangSmithTracer(config?)`（`langsmith.ts`）：返回 `LangChainTracer`（`@langchain/core/tracers/tracer_langchain`），用 `Proxy` 包裹（`safeWrap`）吞掉所有回调错误——LangSmith 失败绝不阻塞主对话；按 `apiKey:projectName:apiUrl` 缓存
- `resetLangSmithTracer()`：清缓存（settings 变更时调用）

**注意**：Langfuse 已移除，tracing/types.ts 命名是历史遗留；现文档里说"Langfuse"但实现只剩 LangSmith + Noop（见 `tracing/index.ts` 注释）。

### 1.7 Voice Pipeline 触发点

**文件**：`src/agent/graph/voice-pipeline.ts`

**触发流程**（`generateVoice(formattedOutput, ttsConfig, llmConfig, options, onChunk?)`）：
1. 用 `TTSSummarizer`（依赖注入的 LLM client）对 `formattedOutput` 做摘要
2. `splitSentences`（line 94-107）按 `[。！？!?]` 切句
3. 按句顺序调 TTS 客户端合成（`TTSClient` 或 `MiniMaxTTSClient`，按 `ttsConfig.provider` 切换）
4. 每合成一句就 `onChunk?.(audioBuffer)` 触发流式回调
5. `TTSService.mergeAudioChunks` 合并所有音频片段为完整 `ArrayBuffer`

**触发点**：在 chat-controller 输出 `formattedOutput` 后，按用户设置（"朗读"按钮）调用；接受 `AbortSignal` 在每句后检查 cancellation。

`provider: 'minimax'` 走 MiniMax TTS 客户端分支。

### 1.8 agent-constants 关键常量

**文件**：`src/agent/config/agent-constants.ts`

| 常量 | 值 | 用途 |
|------|-----|------|
| `MAX_TOOL_RESULT_LENGTH` | 4000 | 工具结果截断长度（字符）；超长时 L7 `truncated-invisible` 状态触发 |
| `MAX_FULL_TOOL_MESSAGES` | 2 | React Loop 保留完整工具消息条数上限 |
| `MAX_CONTEXT_TOKENS` | 20000 | 消息历史最大 token 数，超出触发压缩 |
| `MAX_MEMORY_LINES` | 150 | 记忆条数上限 |
| `MAX_MEMORY_CHARS` | 8000 | 单条记忆最大字符数（MEMORY.md 超过则 warn） |
| `SYNTOPICAL_SNAPSHOT_LIMIT` | 20 | 主题阅读每本书召回最大快照数 |
| `SYNTOPICAL_MAX_BOOKS` | 5 | 主题阅读最大参与书籍数 |
| `SYNTOPICAL_TOP_K_PER_BOOK` | 5 | 主题阅读每本书 Top-K |
| `TREE_STRUCTURE_MAX_TEXT_LENGTH` | 100 | 检视阅读目录树文本截断长度 |
| `TREE_STRUCTURE_MAX_DEPTH` | 4 | 检视阅读目录树最大深度 |
| `GENERAL_MODE_INDEX_ID` | `__general__` | 阅读顾问模式 sentinel indexId |
| `TOOL_EXECUTION_TIMEOUT_MS` | 60000 | 工具执行超时 |
| `DEFAULT_EARLY_STOP_THRESHOLD` | 0.6 | 分析节点早停置信度阈值 |

### 1.9 ProfileBuilder（外部依赖）

不在 agent 模块内，但 L1 `buildConfigurable` 会调：

```typescript
const profileBuilder = context.vault.plugin?.profileBuilder;
if (profileBuilder) {
  try {
    userProfileSummary = await profileBuilder.readSummary() || undefined;
  } catch {
    // 摘要不存在，静默跳过
  }
}
```

- 维护 `DeepReader.md` 画像
- 按 section/field 定位
- 工具 `update_profile` 也通过它更新

---

## 2. 已知问题

### 2.1 LLMClientManager 与新 ChatModels 并存

**现象**：
- 老 `LLMClientManager` 仍在使用（被 `FrontendAgent` 持有）
- 新 `createChatModels`（`src/agent/models/chat-model.ts`）用 `ChatOpenAI`
- L1 `buildGraphConfigurable` 用 `createChatModels`，但 LLMClientManager 又通过 `getLLMClient()` 暴露

**问题**：
- 两套模型实例化逻辑并存
- 配置（fallback / disableThinking）只在一边生效
- L0 通过 `getLLMClient()` 绕过 LangGraph 调 LLM

**建议**：明确二选一（推荐新 ChatModels），老 LLMClientManager 标记 deprecated。

### 2.2 MEMORY.md 压缩规则粗糙

**现象**：
- `tokenThreshold=3000`、`targetRatio=0.5` 是 magic numbers
- `maybeCompressMemory` 在 L1 `runGraphEngine` 内部"先压缩再跑图"

**问题**：
- 每次 `runGraphEngine` 都检查 `needsCompression`，有 IO 开销
- 压缩 prompt 写死在 `FrontendAgent.compressMemoryWithLLM`（不在 `prompts/` 目录）
- 失败时静默回退

**建议**：
- 移到独立 cron / 启动时跑
- prompt 移到 `prompts/memory-compress-prompt.ts`

### 2.3 ContextBuilder 4 层与 ContextLoader 3 层并存

**现象**：
- `ContextBuilder`（4 层）— L1 用
- `ContextLoader`（3 层，更老）— `context/index.ts` 还导出

**问题**：
- 维护两套
- L1 用 builder，旧代码可能用 loader
- 用户配置（如 `STYLE_GUIDE.md`）走 builder，但旧 fallback 走 loader

**建议**：标记 ContextLoader deprecated，统一用 Builder。

### 2.4 SharedContext 与 ToolContext 字段重叠

**现象**：
- `SharedContext` 有 `memoryContext`、`userProfileSummary`、`toolContext`
- `ToolContext` 也有 `mode`、`proactiveTrigger`、`highlightContext`

**问题**：
- 两层"上下文"概念混淆
- 节点通过 `config.configurable.sharedContext` + `config.configurable.toolContext` 都能拿到
- 字段值可能不一致（runtime 修改时不同步）

**建议**：
- `SharedContext` 留下"传递依赖"（`llmClientManager`、`abortSignal`）
- `ToolContext` 留下"运行时参数"（`mode`、`book`、`crossBook`）
- `memoryContext` 等"快照数据"应该走 state（已经走 `state.memoryContext` 等）

### 2.5 Tracer 的 Langfuse 历史遗留

**现象**：`tracing/types.ts` 命名/注释仍提到 Langfuse，但实现已删。

**问题**：误导新人。

**建议**：清理注释 / 文档。

### 2.6 Voice Pipeline 的"非流式触发"

**现象**：L3 `processGraphStream` 流结束后才调 voicePipeline。

**问题**：
- S4 流式输出时用户已经等 5-10s
- 语音合成又需要 3-5s
- 总等待时间过长

**建议**：让 S4 流式输出过程中同步调 TTS 摘要 + 句子切分（不调合成），流结束后立刻合成。

### 2.7 AgentConstants 缺乏注释

**现象**：`agent-constants.ts` 里的常量是数值，不知道为什么是这个值。

**问题**：
- 调参无依据
- 新人改一个数字可能引发大变化

**建议**：每个常量加 JSDoc 注释 + 来源（"基于 1k token 上下文 3-5 轮对话的估算"）。

### 2.8 LangSmith tracer 的 callbacks 注入不标准化

**现象**：
```typescript
await this.getCompiledEngine().stream(streamInput, {
  streamMode: 'updates',
  configurable,
  signal: callbacks.abortSignal,
  ...(tracer ? { callbacks: [tracer] } : {}),  // ⚠️ 混用 LangChain callback
});
```

**问题**：LangGraph 不一定触发 LangChain callbacks。

**建议**：用 LangGraph 官方的 `LangChainTracer` 实例化方式。

---

## 3. 优化探讨

### 3.1 LLMClientManager 与 ChatModels 合并

**方案**：
- 删除老的 `LLMClientManager`
- 把 `getLLMClient()` 重定向到 `mainModel`（来自 `createChatModels`）
- `compressMemoryWithLLM` 走 LangGraph 子图，而不是直连

### 3.2 MEMORY.md 压缩后台化

**方案**：
- 在 `MemoryStore.appendHistory` 时检查行数
- 超阈值时触发后台 `setTimeout` 调 consolidator
- 不阻塞主对话

**收益**：
- 减少 L1 `runGraphEngine` 的 IO 开销
- 压缩失败可重试

### 3.3 ContextBuilder 与 ContextLoader 合并

**方案**：
- ContextLoader 标记 deprecated
- ContextBuilder 兼容旧 3 层 API
- 新功能（如 Skills 层）只在 Builder

### 3.4 SharedContext 瘦身

**新 SharedContext**：
```typescript
interface SharedContext {
  llmClientManager: LLMClientManager;     // 必需
  abortSignal: AbortSignal;              // 必需
  toolContext: ToolContext;              // 必需
  callbacks: EngineCallbacks;            // 必需
}
```

**其余字段（memoryContext, userProfileSummary, recentHistorySummaries, prevSearchedBlockIds）** 移到 state（已经有同名字段）。

### 3.5 Tracer 注入标准化

**方案**：
- 用 `LangGraph` 提供的 `LangChainTracer` 类
- 在 `cognitiveEngine.compile({ checkpointer, callbacks: [tracer] })` 注入
- 不再用 `stream({ callbacks: [tracer] })` 旁路

### 3.6 Voice Pipeline 边流边合成

**方案**：
- S4 formatter 流式输出时，每 `streamToContent` 收到一个 chunk 就尝试切句
- 切到完整句子就调 TTS 合成（不等全文）
- 音频边合成边推给 L1 onVoiceChunk

**收益**：
- 语音与文本几乎同步开始播放
- 减少总等待时间

**风险**：切句错误会导致 TTS 输出混乱。

### 3.7 AgentConstants 配置化

```typescript
// agent-constants.ts
export const AGENT_CONSTANTS = {
  MAX_TOOL_RESULT_LENGTH: {
    value: 4000,
    reason: 'Average LLM context 8k tokens, half for tools',
    override: (settings) => settings.maxToolResultLength,
  },
  // ...
};
```

**收益**：
- 用户设置可覆盖
- 注释解释每个值的来源

### 3.8 ProfileBuilder 解耦

**问题**：L1 直接调 `profileBuilder.readSummary()`，但 profileBuilder 来自 `vault.plugin`。

**方案**：
- 抽 `IProfileProvider` 接口
- L1 通过接口拿，agent 模块不知道 plugin 实现

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/llm-client.ts` | LLMClientManager（main + fast 双模型） |
| `src/agent/models/chat-model.ts` | 新 ChatModels（`createChatModels`） |
| `src/agent/memory/store.ts` | MemoryStore 实现 |
| `src/agent/memory/types.ts` | IMemoryStore 接口 |
| `src/agent/memory/consolidator.ts` | 记忆压缩（未读） |
| `src/agent/context/builder.ts` | ContextBuilder（4 层） |
| `src/agent/context/loader.ts` | ContextLoader（3 层，老） |
| `src/agent/graph/shared-context.ts` | SharedContext 工厂 |
| `src/agent/tracing/types.ts` | ITracer / ITraceContext / IObservationRef |
| `src/agent/tracing/langsmith.ts` | LangSmith 实现 |
| `src/agent/tracing/noop-tracer.ts` | NoopTracer |
| `src/agent/graph/voice-pipeline.ts` | Voice Pipeline |
| `src/agent/config/agent-constants.ts` | 全局常量 |

## 5. 关联文档

- L1 FrontendAgent 入口层 — 持有这些基础设施
- L2 LangGraph 状态机层 — 通过 `config.configurable.sharedContext` 注入
- L4 节点层 — 每个节点用 LLMClient / ToolContext / SharedContext
- L7 验证与输出处理层 — 引用 `MAX_TOOL_RESULT_LENGTH` 等常量
- ADR-006 双模型路由 — main/fast 分工
- ADR-007 记忆与会话架构 — Memory / Session 设计
