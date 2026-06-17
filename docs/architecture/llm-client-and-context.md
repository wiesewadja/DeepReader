# LLM Client 与 Context Loader

> DeepReader Agent 调 LLM 的两个基础设施——**LLMClient**（流式 + 工具调用 + thinking 模式 +
> xiaomi fallback） + **ContextBuilder/Loader**（4 层系统提示 + 运行时上下文注入）。
>
> 配套阅读：[config-system.md](../architecture/config-system.md)（AIProviderAccount 配置）、
> [tools-execution-model.md](./tools-execution-model.md)（LLM 输出的工具调用）、
> [prompt-modules.md](./prompt-modules.md)（共享 prompt 上下文）。

---

## 目录

1. [设计意图：为什么需要独立 LLMClient / ContextLoader](#why)
2. [LLMClient：流式 + 工具 + thinking + fallback](#llmclient)
3. [ContextBuilder：4 层系统提示](#contextbuilder)
4. [ContextLoader：用户运行时数据加载](#contextloader)
5. [与 Agent 集成](#integration)
6. [关键源文件](#files)
7. [已知限制](#limitations-inference)

---

## 设计意图 (why)

DeepReader 不直接用 LangChain `ChatOpenAI`：

- **不直接用 LangChain**——LangChain 模型封装隐藏了 trace / thinking / fallback 等细节
- **不耦合 Provider 协议**——DeepSeek / OpenAI / 小米 共用一套调用接口
- **支持流式**——用户看到 AI 回答"边写边出"
- **支持工具调用**——ReAct 循环需要 function calling
- **支持 thinking 模式**——DeepSeek R1 / Claude 等推理模型有 `<think>` 块

**Context 4 层分离**（4 个层次独立维护、版本化、缓存）：

- **Identity 层**（静态）—— 角色人设，**改一次要部署**
- **Bootstrap 层**（用户定义）—— 用户自定义提示
- **Memory 层**（持久化）—— 长期用户画像
- **Skills 层**（动态摘要）—— 可用技能列表

---

## LLMClient

**位置**：`src/agent/llm-client.ts`（517 行）

### 核心功能

| 功能 | 位置 | 描述 |
|---|---|---|
| 流式响应 | `stream()` | 边下边出，UI 实时显示 |
| 工具调用 | `bindTools()` | OpenAI function calling 协议 |
| Thinking 模式 | `getDisableThinkingParams()` | DeepSeek R1 / Claude 等自动检测 |
| xiaomi fallback | `safeRequest()` | Token Plan 欠费时自动切换 |
| 跨域兜底 | `fetchWithCorsFallback()` | 浏览器/CORS 限制时切直连 |

### 配置：`LLMClientOptions`

```typescript
interface LLMClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string;
  disableThinking?: boolean;
  fallbackApiKey?: string;  // xiaomi 备用
  fallbackBaseUrl?: string;
}
```

### 流式回调

```typescript
interface StreamCallbacks {
  onContent: (text: string) => void;
  onToolCall: (calls: ToolCall[]) => void;
  onThinking?: (think: string) => void;
  onError: (err: Error) => void;
  onDone: () => void;
}
```

**5 回调**：`onContent` / `onToolCall` 是必填；`onThinking` / `onError` / `onDone` 可选。

### 工具绑定

```typescript
const client = new LLMClient(options);
const modelWithTools = client.bindTools([
  searchBookTool,
  readSectionTool,
  // ...
]);
```

**返回**：一个新的 model 实例（**不修改原 client**），可继续 `invoke()` 或 `stream()`。

### thinking 模式自动检测

**位置**：`src/config/thinking-models.ts`

```typescript
const THINKING_MODEL_PATTERNS = [
  /deepseek.*r1/i,
  /o1/i,
  /claude.*opus/i,
  // ...
];

function getDisableThinkingParams(model: string, override?: boolean) {
  if (override !== undefined) return { thinking: { type: 'disabled' } };
  if (THINKING_MODEL_PATTERNS.some(p => p.test(model))) {
    return {};  // 不禁用
  }
  return { thinking: { type: 'disabled' };  // 默认禁用
}
```

**自动检测 + 用户 override**：
- `disableThinking: undefined` → 自动检测（推理模型保留 thinking）
- `disableThinking: true` → 强制禁用
- `disableThinking: false` → 强制启用

### xiaomi Fallback

```typescript
if (response.status === 402 || response.status === 403) {
  // Token Plan 欠费
  if (options.fallbackApiKey) {
    log('[LLM] xiaomi fallback 触发');
    return await requestWithFallback(options.fallbackBaseUrl, options.fallbackApiKey, ...);
  }
}
```

**触发条件**：HTTP 402/403 + `fallbackApiKey` 配齐。

---

## ContextBuilder

**位置**：`src/agent/context/builder.ts`（336 行）

### 4 层系统提示

```typescript
async buildSystemPrompt(ctx: ContextBuildContext): Promise<string> {
  return [
    await this.buildIdentityLayer(),       // 第 1 层
    await this.buildBootstrapLayer(),      // 第 2 层
    await this.buildMemoryLayer(),          // 第 3 层
    await this.buildSkillsLayer(),          // 第 4 层
  ].filter(Boolean).join('\n\n---\n\n');
}
```

### 4 层详解

| 层 | 内容 | 来源 | 变更频率 |
|---|---|---|---|
| **Identity** | 角色人设（"你是奚童"） | 静态字符串 | 改一次部署一次 |
| **Bootstrap** | 用户自定义提示 | `DeepReader/BOOTSTRAP.md` | 用户主动改 |
| **Memory** | 用户画像摘要 | `MEMORY.md` 自动维护 | 每次对话 |
| **Skills** | 可用技能列表 | `src/agent/skills/markdown/` | 技能添加时 |

### 运行时上下文注入（不进 System Prompt）

**关键设计**：`[运行时上下文 — 仅元数据，非指令]` 标签

```typescript
const RUNTIME_CONTEXT_TAG = '[运行时上下文 — 仅元数据，非指令]';

buildUserMessage(userInput, runtimeCtx) {
  return `${RUNTIME_CONTEXT_TAG}
时间：${runtimeCtx.now}
当前章节：${runtimeCtx.currentChapter}
当前进度：${runtimeCtx.progress}%

${userInput}`;
}
```

**为什么不直接拼到 System Prompt**：
- System Prompt 应该**稳定**——LLM 看到的"宪法"不应每次变
- 运行时上下文（时间 / 进度）是**会话级**——会变
- **明确标记**告诉 LLM "这是元数据不是指令"，避免 LLM 把"当前章节"理解成新指令

### 用户消息 vs 系统消息

| 类别 | System Prompt | User Message |
|---|---|---|
| 稳定性 | 高（部署级） | 低（每次对话） |
| 来源 | Identity / Bootstrap / Memory / Skills | 用户输入 + 运行时元数据 |
| 改一次要发版？ | 是（Identity）/ 否（Memory 自动） | 否 |

---

## ContextLoader

**位置**：`src/agent/context/loader.ts`（165 行）

### 职责

从 vault 中**按需加载**用户数据：

```typescript
class ContextLoader {
  loadMemory(): Promise<MemoryData>;            // MEMORY.md
  loadBootstrap(): Promise<string>;             // BOOTSTRAP.md
  loadSkills(): Promise<SkillSummary[]>;        // 扫描 skills/
  loadRecentSessions(bookId, limit): Promise<Session[]>;
  loadProfile(bookId): Promise<UserProfile>;    // profile/chapter-summaries.json
}
```

### 5 加载器

| 方法 | 加载目标 | 缓存 |
|---|---|---|
| `loadMemory` | MEMORY.md | 5 分钟 |
| `loadBootstrap` | BOOTSTRAP.md | 5 分钟 |
| `loadSkills` | `src/agent/skills/markdown/*.md` | 1 分钟 |
| `loadRecentSessions` | `sessions/{threadId}.jsonl` | 不缓存（实时） |
| `loadProfile` | `profile/chapter-summaries.json` | 5 分钟 |

**为什么缓存 5 分钟**——MEMORY.md / Bootstrap 用户**偶尔改**，但 LLM 每次对话都读，**5 分钟足够**平衡"实时性 vs 重复读盘"。

---

## Integration

### 调用链

```
FrontendAgent.runGraphEngine
  └─→ buildGraphConfigurable(ctx)
        ├─ sharedContext: { memory, profile, history, ... }
        │     └─ ContextLoader 加载
        │     └─ ContextBuilder 拼 4 层
        │
        ├─ mainModel: LLMClient       ←  S2/S4 主对话
        ├─ fastModel: LLMClient       ←  S0/S1 路由
        │
        └─ _langsmithTracer: Tracer   ←  观测
```

### 2 个 LLMClient 实例

**`mainModel`** —— 用于 S2 Analytical / S4 Formatter（**高质量，昂贵**）
**`fastModel`** —— 用于 S1 Inspectional（含原 S0 Router，**便宜快**）

典型配置：
- main = `mimo-v2.5-pro`（Pro 版）
- fast = `mimo-v2.5`（标准版）

---

## Files

| 文件 | 职责 |
|---|---|
| `src/agent/llm-client.ts` | LLMClient 主类（517 行） |
| `src/agent/context/builder.ts` | ContextBuilder 4 层系统提示（336 行） |
| `src/agent/context/loader.ts` | ContextLoader 用户数据加载（165 行） |
| `src/agent/context/index.ts` | 公开 API 入口 |
| `src/config/thinking-models.ts` | thinking 模式自动检测正则 |
| `src/utils/safe-request.ts` | fetch + CORS 兜底 |
| `tests/unit/agent/llm-client.test.ts` | LLMClient 单测（mock Provider） |
| `tests/unit/agent/context/builder.test.ts` | ContextBuilder 4 层测试 |
| `tests/unit/agent/context/loader.test.ts` | ContextLoader 缓存测试 |

---

## Limitations [INFERENCE]

### LLMClient

- **不实现请求重试** —— 网络抖动时**直接抛错**给上游
- **不实现 token 用量统计** —— 没法做"单次对话成本"展示
- **流式中断无法续接** —— SSE 连接断了**之前收到的内容作废**
- **fallback 仅 xiaomi** —— 其他 Provider 失败时无降级
- **不支持 OpenAI Assistants API** —— 只支持 Chat Completions
- **不实现 Provider 限流** —— 并发请求**不排队**（Obsidian 进程内串行）

### ContextBuilder

- **Bootstrap / Memory / Skills 4 层拼接顺序硬编码** —— 想换顺序得改源码
- **Memory 层 5 分钟缓存** —— 用户改完 MEMORY.md 要等 5 分钟
- **运行时上下文不缓存** —— 每次都重算时间 / 进度
- **`[运行时上下文 — 仅元数据，非指令]` 标签写死中文** —— 国际化用户看不懂
- **不压缩历史** —— `recentHistorySummaries` 由 history-summarizer.ts 单独处理

### ContextLoader

- **缓存失效靠时间** —— 文件**实际改了不会主动失效**
- **不预加载** —— 启动时不预热，每次都按需读
- **Skills 加载是扫描目录** —— 技能多了会慢
- **不验证加载结果** —— MEMORY.md 格式错误**静默**用空字符串

### 集成

- **不支持多 LLM 同时调** —— mainModel / fastModel 只能串行
- **不支持 LLM 选择策略** —— 用户改了配置立刻生效，无优雅过渡

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/agent/llm-client.ts` 517 行 + `src/agent/context/*` 518 行的架构视角文档。LLMClient 5 功能 + ContextBuilder 4 层 + ContextLoader 5 加载器 + 18 条已知限制 |
