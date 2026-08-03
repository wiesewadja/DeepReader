# ADR-011: SidebarView 域拆分 — 从上帝视图到 Domain + Presenter + EventBus

## 状态
Accepted

## 日期
2026-07

## 背景

`SidebarView` 增长到 1,537 行，通过 15+ 个双向 getter 协调 8+ 个职责（聊天、会话、TTS、书籍、引用、语音输入、阅读上下文）。这导致：
- 单文件过大，难以理解、测试、维护
- 业务逻辑与 UI 耦合，无法单元测试
- 双向 getter 形成隐式依赖网，变更极易产生副作用
- 新增功能需修改核心视图类，违反开闭原则

## 决策

将 `SidebarView` 收缩为**视图外壳**，仅保留：
- 生命周期（`onOpen`/`onClose`）
- DOM 创建与布局
- 依赖注入与组装
- 事件清理

业务逻辑拆分为四个**领域**：

| Domain | 职责 | 关键状态 |
|--------|------|----------|
| **SessionDomain** | 拥有聊天会话，含最终消息 + 瞬态 `pendingAssistantMessage`。编排 AgentDomain 调用，将原始 `AgentEvent` 翻译为 UI 语义事件 | `sessionId`、`messages`、`pendingAssistantMessage` |
| **AgentDomain** | 无状态思考引擎：接收 `AgentRequest`，返回 `AsyncIterable<AgentEvent>`。不拥有历史或 UI 状态 | 纯函数式，无实例状态 |
| **BookDomain** | 拥有当前书籍、索引列表、书单。选书变化时发布 `book:changed` | `currentBook`、`indexList`、`booklists` |
| **TTSDomain** | 拥有 TTS 播放状态（消息朗读 + 页面朗读两源），发布类型化事件供 UI 更新 | `playing`、`source`、`progress` |

新增两个协作层：
- **ChatDocumentService**（原 ContextManager）：管理当前聊天会话挂载的 Markdown 文档（当前文件、显式路径、wikilink 引用）。由 SessionDomain 持有。
- **ChatPresenter**：订阅 Domain 事件，将其映射为对 MessageList、ChatInput、ReadingTopbar 的命令式更新。**单一映射入口**，避免 UI 逻辑散落在组件中。

通信机制：
- **EventBus**：每个 SidebarView 实例一个。Domain 发布；Presenter 与跨域订阅者消费。同步编排（如 SessionDomain 调用 AgentDomain.stream）用直接方法调用，不走总线。

## 替代方案

### 方案 A：纯 EventBus 做所有域通信
- 拒绝：SessionDomain 调用 AgentDomain.stream 是固有编排，非通知。强行进事件会把控制流变成隐式状态机，复杂化错误处理。

### 方案 B：MessageList/Message 组件直接订阅 EventBus
- 拒绝：会把 UI 更新逻辑分散到各组件，重新引入领域事件词汇与组件内部的耦合。Presenter 给出单一映射位置。

## 后果

**收益：**
- SidebarView 降为生命周期、DOM 创建、装配、清理——约 300 行。
- Domain 可用模拟协作者单测，无需完整 Obsidian ItemView。
- `AgentRequest` 对象替代 11 字段 SharedContext，收窄每个消费者的接口面。

**风险与缓解：**
- 事件词汇表膨胀 → 统一在 `events.ts` 定义 `SidebarEventMap`，类型安全。
- 跨域调用（如 SessionDomain 需 BookDomain 当前书）→ 通过构造器注入 Domain 引用，显式依赖。

**架构约束：**
- Domain 不直接操作 DOM，只发布事件。
- Presenter 不包含业务规则，只做"事件 → UI 命令"映射。
- 同步编排走直接调用，异步通知走 EventBus。