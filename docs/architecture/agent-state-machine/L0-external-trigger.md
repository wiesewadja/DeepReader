# L0 — 外部触发层

> 用户行为 / 主动引擎 / 跨书模式 → 如何调用 `FrontendAgent`
>
> 状态机从这里「被叫醒」。本层不直接执行状态机，只决定**何时**、**带什么上下文**调用。

---

## 1. 现状

### 1.1 角色定位

L0 是状态机的"门外汉"。它不实现 LangGraph 节点，不写 state 字段，只负责：

| 职责 | 说明 |
|------|------|
| **触发源** | 收集用户输入、proactive 触发器、Socratic 续接、HITL 恢复 |
| **上下文组装** | 把 `ToolContext`（书、模式、booklist、TTS、profileBuilder）装好交给 L1 |
| **生命周期** | `AbortController` 管理、isProcessing/isAiStreaming 状态锁 |
| **结果消费** | 订阅 `onProgress`/`onContent`/`onComplete`/`onError`/`onVoiceReady` |

### 1.2 入口清单

| 触发源 | 入口 | 调用 FrontendAgent 方法 | 文件 |
|--------|------|------------------------|------|
| 用户发送消息 | `chat-input` submit | `chat()` / `continueChat()` | `src/views/sidebar/agent-chat-controller.ts` |
| Proactive (book open) | `ProactiveEngine.onBookOpen()` | `chat()` with `proactiveTrigger='inspectional'` | `src/agent/proactive/engine.ts` |
| Proactive (highlight ×3) | `ProactiveEngine.onHighlight()` | `chat()` with `proactiveTrigger='highlight'` | 同上 |
| Proactive (chapter leave) | `ProactiveEngine.onChapterLeave()` | `chat()` with `proactiveTrigger='chapter'` | 同上 |
| Socratic 续接 | 用户在 Socratic 回复后继续 | `continueChat()` | `agent-chat-controller.ts` |
| HITL 恢复 | 用户在 S4 审查后点击"继续" | `resumeGraphExecution(approved, feedback)` | `agent-chat-controller.ts` |
| 跨书（booklist） | 用户启用书单模式后发问 | `chat()` with `crossBook.booklistBookIds` 非空 | `agent-chat-controller.ts` |
| 流式重载 | 同一 threadId 内 user 重发 | 直接 `chat()`（不调 `continueChat`）| `agent-chat-controller.ts` |

### 1.3 chat-controller 关键代码路径

`src/views/sidebar/agent-chat-controller.ts` 是 L0 的主要载体，核心字段：

```typescript
class AgentChatController {
  private streamController: AbortController | null = null;   // 用户取消
  private proactiveAbortController: AbortController | null = null;  // proactive 取消
  private isProcessing: boolean = false;                     // 互斥锁
  private isAiStreaming: boolean = false;                    // 流式状态
  private streamingVoicePlayers: Map<string, StreamingVoicePlayer> = new Map();
  private _agentChatHistory: ChatMessage[] = [];             // 累积历史
  private _currentMarkdownFiles: Record<string, string> = {};
}
```

**消息发送主流程**（伪代码）：
```
sendUserMessage(text):
  if isProcessing: 拦截 + 提示
  isProcessing = true
  streamController = new AbortController()
  chatHistory = _agentChatHistory (累积)
  ToolContext {
    book, mode, proactiveTrigger, highlightContext,
    crossBook, ttsConfig, llmConfig, abortSignal,
    ...
  }
  result = await frontendAgent.chat(text, context, {
    onProgress, onContent, onComplete, onError, onVoiceReady,
    abortSignal, onHumanizedProgress, onReasoning,
  })
  if result.interrupted: HITL UI 弹出
  else: 把 assistant 消息 push 到 messageList
  isProcessing = false
```

### 1.4 Proactive 触发机制

`src/agent/proactive/engine.ts` 是一个**独立的、有自己状态**的引擎。它通过回调（`onTrigger(params)`）通知 UI 层要触发 proactive：

```typescript
export class ProactiveEngine {
  private states = new Map<string, ProactiveState>();  // 每本书一个状态
  private processing = false;
  private lastGlobalTriggerAt: number | null = null;

  // 三种 trigger:
  // 1. 'inspectional' — onBookOpen 时如果条件满足（无历史 + 进度低）
  // 2. 'highlight'    — 同一章节高亮 ≥ 3 次
  // 3. 'chapter'      — onChapterLeave 时如果章节完成度 > 80%

  // 防抖：全局冷却（默认 5 分钟）+ 单本书已触发状态
}
```

**ProactiveParams 结构**：
```typescript
{
  trigger: 'inspectional' | 'highlight' | 'chapter',
  bookId: string,
  chapterId?: string,
  highlightContext?: string[],
}
```

Proactive 引擎的状态序列化到 `.obsidian/plugins/deepreader/proactive/{bookId}.json`（推测，待确认）。

### 1.5 ToolContext 全景

L0 组装的 `ToolContext` 是 L1 唯一接收的运行时上下文，决定了"这次对话是什么模式"：

```typescript
interface ToolContext {
  book: { indexId, pdfName, docDescription, coverUrl, author };
  mode: 'normal' | 'proactive' | 'socratic';
  proactiveTrigger?: { trigger, chapterId, highlightContext };
  highlightContext?: string[];
  crossBook?: { booklistBookIds: string[] };
  ttsConfig?: VoiceConfig;
  llmConfig?: VoiceConfig;
  abortSignal: AbortSignal;
  visual?: { journalDir?: string };
  vault: { app, plugin, adapterBasePath, ... };
}
```

---

## 2. 已知问题

### 2.1 chat-controller 单体膨胀

**现象**：`agent-chat-controller.ts` 已超过 1500 行（估算），承担：
- 消息 CRUD
- 流式控制
- HITL UI 弹窗
- 语音播放
- 高亮提取
- 引用文档压缩（`compressReferencedDoc`）
- 引用链接解析（`parseAndLoadReferences`）
- 引用 wiki 链接验证（`validateWikiLinks`）
- 引用 chapter 提取
- 状态互斥锁

**后果**：
- 任何修改都要碰这个文件
- 单元测试覆盖率难以提高（混合 UI / 业务 / IO）
- 容易出现"互斥锁泄漏"等并发 bug

**证据**：`git log -- src/views/sidebar/agent-chat-controller.ts` 显示高频修改。

### 2.2 Proactive 与手动对话的互斥不严格

**现象**：`isProcessing` 锁防的是"两次手动对话并发"，但 proactive 触发时未与手动锁互斥。`streamController`（手动）和 `proactiveAbortController`（主动）是两个独立 controller，可以同时存在。

**后果**：
- proactive 触发的对话可能与用户正在输入的消息"撞车"
- proactive 取消不会取消手动对话

**建议方向**（优化探讨，见 §3）：
- 统一为单个 `AbortController` pool，按 threadId 区分

### 2.3 `compressReferencedDoc` 在 chat-controller 而非 graph 内

**现象**：当用户引用一个 markdown 文件时，chat-controller 调 LLM 压缩长文档（`compressReferencedDoc` 走 `frontendAgent.getLLMClient()`）。这是**业务逻辑散落在 L0**。

**后果**：
- 同样的压缩需求如果 S2 Analytical 也要做，会导致重复实现
- LLM 客户端被 chat-controller 直接持有（破坏 L1 边界）

**证据**：`agent-chat-controller.ts:80-120` 调 `llmClient.chat([...], [])` 直连。

### 2.4 Proactive 状态无版本兼容

**现象**：`proactive/state.ts` 序列化每本书的状态，但没有 schema version 字段。

**后果**：字段重命名/删除时，老用户的状态文件读取失败/数据丢失。

### 2.5 booklist 模式缺少独立 UI 路径

**现象**：跨书模式只是 `crossBook.booklistBookIds` 字段非空，但 UI 表现、提示、收尾与单书完全一样。

**后果**：用户不知道当前在跨书模式；S4 输出可能错加书名前缀（这是 T1.3 已修的 bug，但 UI 端仍未提示）。

---

## 3. 优化探讨

### 3.1 chat-controller 拆分（架构）

按"职责"切：
- `MessageStreamOrchestrator` — 流控制、AbortController、isProcessing
- `ReferenceParser` — wiki 链接解析、`validateWikiLinks`、`parseAndLoadReferences`
- `VoicePlayerOrchestrator` — `streamingVoicePlayers`、`onVoiceReady`
- `HighlightExtractor` — 引用块/高亮文本
- `HitlUIAdapter` — interrupt 检测 + 弹窗

`AgentChatController` 保留为组合者（Facade）。

**收益**：单元测试可独立写；UI 改动与流控制解耦。

**风险**：拆分时容易把 `host` 引用传递搞乱；建议先抽 `VoicePlayerOrchestrator`（最独立）。

### 3.2 Proactive 引擎的回调契约

当前 proactive 引擎用 `onTrigger(params: ProactiveParams)` 回调驱动 chat-controller。可以演化为：
- 显式 `ProactiveTriggerEvent` 事件总线
- 或把 proactive 状态写入共享 state，由 L1 / L2 主动读

**待讨论**：proactive 应不应该走完整 LangGraph？现在它走的是"绕过 L0→L1 的 fast path"，未经过 `IntentRouter`（注意：`routerNode` 内部还是调了 `IntentRouter` 一次，但触发 proactive 时走 `routeFromStart → INSPECTIONAL`，没有 S0 Router）。这意味着 proactive 触发的对话没经过 depth 分类。

### 3.3 ToolContext 的可观测性

L0 组装 ToolContext 时没有 tracing span——所有上下文构造都在 `agent-chat-controller.ts` 的一个 async 函数里。

**建议**：
- 在 `agent-chat-controller.ts` 顶部用 tracer 包裹（`withSpan('chat-input')`）
- ToolContext 字段（如 `mode`、`crossBook`）写进 span metadata
- 后续 LangSmith 可视化能直接看出"这次对话是 proactive 触发的"还是"用户输入的"

### 3.4 跨书模式的 UI 反馈

T1.3 修了"跨书误加书名前缀"，但 UI 端没体现：
- 用户开启 booklist 模式时，应有显眼的指示
- 输出中每条 wiki 链接应能 hover 出"来自《XX》"
- 推荐加一个"跨书引用"badge

### 3.5 Proactive 状态版本兼容

短期：加 `version: 1` 字段 + 启动时 migration。
长期：参考"线性版本化 + 读时降级"模式（ADR-005 已有类似讨论）。

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/views/sidebar/agent-chat-controller.ts` | L0 主载体（1500+ 行） |
| `src/agent/proactive/engine.ts` | Proactive 引擎 |
| `src/agent/proactive/state.ts` | Proactive 状态持久化 |
| `src/agent/proactive/types.ts` | ProactiveParams 定义 |
| `src/services/context-manager.ts` | （可能）上下文生命周期管理 |

## 5. 关联文档

- L1 FrontendAgent 入口层 — 接收 L0 的 ToolContext
- L2 LangGraph 状态机层 — 实际执行节点
- ADR-008 主动引擎设计 — proactive 引擎的设计决策
