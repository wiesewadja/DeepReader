# DeepReader — 领域语言

## Sidebar 上下文

Sidebar 聊天/阅读界面的领域语言，用于奚童（AI 伴读）交互、书籍管理、会话和 TTS 播放。

> 架构决策：[ADR-011](./docs/decisions/ADR-011-sidebar-view-domain-split.md) — SidebarView 域拆分：Domain + Presenter + EventBus

**SidebarView**:
The Obsidian ItemView subclass that owns the sidebar DOM lifecycle and wires together the domain layer and the presenter layer.
_Avoid_: God object, coordinator, view controller

**Domain**:
A stateful object that owns a specific area of sidebar behavior and business rules. Domains orchestrate their own operations and publish events when state changes.
_Avoid_: Controller, manager, service (when referring to the sidebar behavioral objects)

**BookDomain**:
The domain that owns the current book, index list, booklists, and bookshelf metadata.
_Avoid_: BookManager, book controller

**SessionDomain**:
The domain that owns the current chat session, including finalized messages, the transient streaming assistant message, and attached reference documents.
_Avoid_: SessionManager, chat controller

**AgentDomain**:
The stateless thinking engine that turns a request (messages + context) into a stream of agent events. It does not own history or UI state.
_Avoid_: Agent controller, chat logic

**TTSDomain**:
The domain that owns TTS playback state and logic for both message reading and page reading.
_Avoid_: TTS controller, voice controller

**ChatDocumentService**:
The service that manages Markdown documents attached to the current chat session (loaded via current file, mention, or wikilink).
_Avoid_: ContextManager, context service

**ChatPresenter**:
The object that subscribes to domain events and maps them to imperative updates on the concrete UI components (MessageList, ChatInput, ReadingTopbar).
_Avoid_: View controller, UI manager

**EventBus**:
The per-SidebarView typed pub/sub channel used to decouple domains from the presenter and from each other for notification-style communication.
_Avoid_: Global event bus, emitter

**AgentRequest**:
The single input object passed to AgentDomain, containing messages plus narrowly-scoped context (runtime, book, search, prompt).
_Avoid_: SharedContext, config bag

**AgentEvent**:
The raw output event from AgentDomain describing a step in the thinking process, such as a text chunk, a reference, or a diagram completion.
_Avoid_: Stream chunk, raw output

**UI-semantic event**:
An event published by SessionDomain that translates raw AgentEvent into a user-interface meaning, such as "assistant text chunk" or "diagram ready".
_Avoid_: Domain event (ambiguous), raw event

**pendingAssistantMessage**:
The transient slot in SessionDomain that holds the assistant message currently being streamed, before it is finalized into the session history.
_Avoid_: streaming message, partial message

---

## Agent 认知引擎上下文

LangGraph 四层认知引擎 + FrontendAgent 的领域语言。本节只记录**本上下文特有的术语**，不收录通用编程概念。

**SharedContext**:
通过 `config.configurable.sharedContext` 注入所有图节点的**不可变请求上下文**。只放本次对话的输入与依赖（query / history / memory / profile / tool 依赖 / abort 信号）。节点执行中产生、向下游流转的可变数据不在此处，归 LangGraph State。
_Avoid_: 全局状态、god context、runtime config（后者指 mainModel/fastModel 等执行依赖，留 configurable 顶层）

**LangGraph State** (`CognitiveEngineState`):
图执行中节点之间流转的可变数据，由 LangGraph 的 reducer/checkpoint 管理。例如 `tocSummary`、`betterQuestion` 由 inspectional 产出供下游消费，`prevSearchedBlockIds` 在节点间累积。
_Avoid_: 把它和 SharedContext 混称"状态"——前者是运行态、后者是输入

**双轨制** (Dual-track):
同一数据同时挂在 `config.configurable` 顶层和 `configurable.sharedContext` 内部、节点取法不一的反模式。已在 ADR-010 中收敛为单一来源（sharedContext）。

**输入 = Context / 产出 = State**:
SharedContext 与 LangGraph State 的划界规则。请求的不可变输入归 Context；节点产出且向下流转的可变数据归 State。

**初始种子 vs 运行态** (initial seed vs runtime):
`initialPrevSearchedBlockIds`（Context，从历史抽取的上一轮已检索 block）是种子；`State.prevSearchedBlockIds` 是本轮节点间累积的去重集合。前者只读，后者随执行增长。

**可配置运行时依赖** (configurable runtime deps):
`mainModel` / `fastModel` / `callbacks` / `enableHumanReview` 等 LangGraph 执行依赖，留在 `config.configurable` 顶层，不并入 SharedContext——它们与具体某次对话的业务上下文无关。

**FrontendAgent**:
Agent 的唯一入口（`FrontendAgent.chat()` → `runGraphEngine()` → `stream()`），负责装配 SharedContext 并驱动图执行。

**安全边界** (Security Boundary):
系统提示词、内部规则、运作机制、开发信息等敏感内容的保护机制。当用户试图获取这些信息时，Agent 必须拒绝并返回固定的安全消息。
_Avoid_: 直接泄露系统提示词、列出内部功能/工具/原则

**安全拦截** (Security Interception):
在 inspectional 节点（有书籍时）或 advisor 节点（无书籍时）检测到安全触发词时，绕过 LLM 直接返回安全消息的机制。formatter 节点作为兜底，确保即使 LLM 忽略安全规则也不会泄露。
_Aypass_: 跳过 LLM 调用、直接返回固定消息

## Decisions

- [ADR-010: SharedContext 收敛](./docs/decisions/ADR-010-shared-context-convergence.md) — 消除双轨制，确立 State/Context 划界，删除 4 个死字段。
- [ADR-012: 安全边界机制](./docs/decisions/ADR-012-security-boundary-mechanism.md) — 三层防御防止系统提示词泄露。
