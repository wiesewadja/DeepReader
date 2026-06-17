# Session Manager 会话管理

> DeepReader Sidebar 的"会话生命周期 + 模式切换"控制层——封装 `SessionStore`（存储）、
> `MemoryStore`（记忆）、`ContextManager`（上下文）三大基础服务，向 SidebarView 提供
> "新建 / 恢复 / 切模式 / 跨书 / 闲聊"等高级操作。
>
> 配套阅读：[session-and-memory.md §SessionStore](./session-and-memory.md)（JSONL + LRU 底层）、
> [system-overview.md 第 2 层 UI 层"ReadingMode Service"](../architecture/system-overview.md#layers)、
> [features/ai-dialogue.md F-07~F-11](../features/ai-dialogue.md)（产品视角）、
> [context-manager.md](./context-manager.md)（上下文层）。

---

## 目录

1. [Why：为什么需要 Sidebar 会话管理层](#why)
2. [3 大基础服务的封装](#layers)
3. [SessionManagerHost 接口：解耦 SidebarView](#host)
4. [会话生命周期：6 个 API](#lifecycle)
5. [3 种对话模式：current / cross-book / general](#modes)
6. [记忆整合：MemoryConsolidator 集成](#consolidation)
7. [会话恢复：从 SessionStore 重建](#restore)
8. [关键源文件](#files)
9. [已知限制 Limitations](#limitations-inference)

---

## Why

`SessionStore`（611 行 JSONL 存储）已经是底层服务——**但它只管"存"**。

**Sidebar UI 需要**：
- **新建会话**——用户点"+ 新对话"按钮时
- **切换书**——开新书时清消息 + 新会话
- **切到跨书模式**——主题阅读入口
- **切到闲聊模式**——不绑书的通用对话
- **恢复历史**——重启 Obsidian 后回填 UI
- **记忆整合**——长期会话触顶时调 `MemoryConsolidator`

**这些场景**涉及：
- `SessionStore`（持久化）
- `MemoryStore`（MEMORY.md / HISTORY.md）
- `ContextManager`（已加载文档）
- `agentChatHistory`（UI 状态）
- `plugin.settings.savedSessions`（设置持久化）
- `Notice`（用户提示）
- `ReadingTopbar`（UI 模式切换）

**8+ 个对象**——没有"管理层"会**散落各调用方**。

**`SessionManager` 解决**：
- **封装 8 个对象**到 1 个
- **提供 6 个高级 API**（新建 / 恢复 / 切模式 / 等）
- **通过 `SessionManagerHost` 接口**与 SidebarView **解耦**（测试时 mock host）

---

## Layers

```
┌─────────────────────────────────────────────────────┐
│  SidebarView (UI 容器)                              │
│  └─→ SessionManager (本层，550 行)                  │
│        ├─→ SessionStore   (JSONL 持久化 + LRU)      │
│        ├─→ MemoryStore    (MEMORY.md + HISTORY.md)   │
│        ├─→ MemoryConsolidator (整合算法)            │
│        ├─→ ContextManager (已加载文档 Map)          │
│        ├─→ FrontendAgent  (Agent 实例，懒初始化)    │
│        └─→ plugin.settings (savedSessions 持久化)   │
└─────────────────────────────────────────────────────┘
```

**职责分配**：

| 模块 | 职责 | 不做什么 |
|---|---|---|
| **`SessionStore`** | JSONL 追加 + LRU + 会话锁 | UI 状态管理 |
| **`MemoryStore`** | MEMORY.md / HISTORY.md | 会话级消息 |
| **`MemoryConsolidator`** | 摘要 + 原子写 | 实时响应 |
| **`ContextManager`** | 文档加载状态 | 跨会话 |
| **`FrontendAgent`** | 实际 LLM 调用 | 会话元数据 |
| **`SessionManager`** | **编排**上述 + UI 集成 | 单独做任何一件 |

---

## Host

**位置**：`session-manager.ts:19-39`

```typescript
export interface SessionManagerHost {
  get app(): App;
  get plugin(): DeepReaderPluginInterface;
  get messageList(): MessageList | null;
  get readingTopbar(): ReadingTopbar | null;
  get contextManager(): ContextManager | null;
  get frontendAgent(): FrontendAgent | null;
  get currentIndexId(): string | null;
  get currentPdfName(): string | null;
  get currentBookCoverUrl(): string | null;
  get currentBookAuthor(): string | null;
  get agentChatHistory(): ChatMessage[];
  setAgentChatHistory(history: ChatMessage[]): void;
  get isProcessing(): boolean;
  get isAiStreaming(): boolean;
  cancelActiveStream(): void;
  initializeFrontendAgent(): Promise<void>;
  get currentBooklistItems(): BooklistItemInfo[] | null;
  restoreBooklist(booklist: Booklist): void;
}
```

**18 个 getter / setter**——SessionManager 用的所有 Sidebar 状态。

### 为什么用 Host 接口？

**3 个好处**：
1. **测试可 mock**——单测 SessionManager 不需要真实 SidebarView
2. **依赖注入**——Host 是 `getter`，SidebarView 可换"实现"
3. **接口分离**——SessionManager 不直接 import SidebarView（**避免循环依赖**）

---

## Lifecycle

**位置**：`session-manager.ts:71-249`

### 1. `startNewSession(indexId)` —— 新建会话

```typescript
async startNewSession(indexId: string): Promise<void> {
  this.host.cancelActiveStream();              // 1. 取消进行中的流
  this._sessionId = this.generateSessionId(); // 2. 生成新 ID
  this.host.setAgentChatHistory([]);         // 3. 清空消息
  this.host.contextManager?.clearAll();       // 4. 清空已加载文档
  await this._sessionStore!.create(           // 5. 写 SessionStore
    this._sessionId,
    effectiveIndexId,
    this._crossBookMode,
  );
  // 6. 写 savedSessions 映射（恢复用）
  this.host.plugin.settings.savedSessions[sessionKey] = this._sessionId;
  this.showWelcomeMessage();                  // 7. 显示欢迎消息
}
```

**7 步**——彻底重置 + 持久化 + UI。

### 2. `restoreFromSessionStore(sessionId)` —— 恢复历史

```typescript
async restoreFromSessionStore(sessionId: string): Promise<boolean> {
  const session = await this._sessionStore!.get(sessionId);
  if (!session || session.messages.length === 0) return false;

  // 过滤 + 去重
  const displayMessages = session.messages.filter(m => ...);

  // 重建 messageList
  for (const msg of displayMessages) {
    this.host.messageList!.addMessage({
      id: `restored-${Date.now()}-${index}`,
      role: msg.role,
      content: msg.content,
      // ...
    });
  }
}
```

**关键过滤**：
- `user` 消息全保留
- `assistant` 消息跳过带 `tool_calls`（**工具调用是中间过程，不显示**）
- 连续两条 assistant 保留最后一条（**避免重复**）

### 3. `switchToCrossBookMode()` —— 切到跨书模式

**位置**：`session-manager.ts:181-198`

```typescript
async switchToCrossBookMode({ clearMessages = true, showWelcome = true } = {}) {
  this._crossBookMode = true;
  this.host.readingTopbar?.setCrossBookMode(true);
  this.host.plugin.settings.lastCrossBookMode = true;  // 持久化
  await this.host.plugin.saveSettings();
  if (clearMessages) {
    this.host.cancelActiveStream();
    this.host.messageList?.clear();
  }
  if (showWelcome) this.showWelcomeMessage();
}
```

**模式切换**——影响后续 LLM 调用的 `crossBookMode` 上下文。

### 4. `switchToGeneralChatMode()` —— 切到闲聊模式

**位置**：`session-manager.ts:200-231`

**与 crossBookMode 区别**：
- **不持久化** `lastCrossBookMode`（不写 settings）
- **一定** 新建 `sessionId`（**不混在书会话里**）
- **showWelcome** 不同文案

### 5. `restoreGeneralChatSession()` —— 恢复闲聊会话

```typescript
async restoreGeneralChatSession(): Promise<void> {
  const sessionId = this.host.plugin.settings.savedSessions[GENERAL_MODE_INDEX_ID];
  if (sessionId) {
    this._sessionId = sessionId;
    const restored = await this.restoreFromSessionStore(sessionId);
    if (restored) return;
  }
  await this.switchToGeneralChatMode({ clearMessages: true });
}
```

**2 路径**：
- 找到 savedSession → 从 SessionStore 恢复
- 没找到 → 直接进闲聊模式（新会话）

### 6. `handleNewChat()` —— "+ 新对话" 按钮

```typescript
handleNewChat(): void {
  this.startNewSession(this.host.currentIndexId || GENERAL_MODE_INDEX_ID);
}
```

**UI 绑定**——SidebarView 的"+ 新对话"按钮。

---

## Modes

**位置**：`session-manager.ts` + `src/agent/config/agent-constants.ts`

### 模式枚举

| 模式 | 触发 | `indexId` | savedSessionKey |
|---|---|---|---|
| `current` | 默认（有书） | `bookId` | `bookName` |
| `crossBook` | 主题阅读入口 | `__cross_book__` | `bookId`（共享） |
| `general` | 无书时的对话 | `GENERAL_MODE_INDEX_ID` | `GENERAL_MODE_INDEX_ID` |

### `GENERAL_MODE_INDEX_ID`

**位置**：`src/agent/config/agent-constants.ts`

```typescript
export const GENERAL_MODE_INDEX_ID = '__general_chat__';
```

**特殊值**——"没有书" 的标识。

### 模式切换的副作用

| 副作用 | current → crossBook | current → general | crossBook → current |
|---|---|---|---|
| **清消息** | ✓ | ✓ | ✗ |
| **新建 sessionId** | ✓（新书） | ✓ | ✗ |
| **写 savedSessions** | ✓ | ✓（写到 GENERAL key） | ✓ |
| **持久化 lastCrossBookMode** | ✓ | — | ✗ |
| **改 ReadingTopbar 状态** | ✓ | — | ✓ |
| **showWelcome** | ✓（"主题阅读" 文案） | ✓（"无书闲聊" 文案） | ✗ |

### 模式状态字段

```typescript
class SessionManager {
  private _sessionId: string | null = null;
  private _sessionStore: SessionStore | null = null;
  private _crossBookMode: boolean = false;
  private _generalChatMode: boolean = false;
  private _searchFilters: { booklists: string[]; tags: string[] } = { booklists: [], tags: [] };
  private _useLLMTreeSearch: boolean = false;
}
```

**6 字段**——模式 / 状态 / 过滤器 / 搜索策略。

---

## Consolidation

**位置**：`session-manager.ts` + `src/agent/memory/consolidator.ts`

### 整合触发

`SessionManager` 在某些场景会触发**记忆整合**（`MemoryConsolidator`）：
- 长时间不活动后用户主动"整理"按钮
- 长期会话达到 `MAX_MEMORY_CHARS` 阈值（8000 字）
- 用户在设置中开启"自动整理"

### 整合算法

**详见** [session-and-memory.md §MemoryStore](./session-and-memory.md)

**简述**：
1. 读 MEMORY.md 当前内容
2. 读最近 5 个历史归档
3. 调 LLM 总结 → 哪些进 MEMORY.md（提炼 / 去重 / 合并）
4. **原子写**：`MEMORY.md.tmp` → 校验 → 替换原文件

### `DEFAULT_CONSOLIDATOR_CONFIG`

```typescript
import { DEFAULT_CONSOLIDATOR_CONFIG } from '../../agent/memory/types.js';
```

**默认配置**：
- `targetMaxChars: 8000`
- `retainHistoryDays: 30`
- `autoTrigger: false`（手动触发）

---

## Restore

**位置**：`session-manager.ts:251-331`

### 流程

```
Sidebar 打开
  └─→ initializeSessionStore()   ←  懒加载
        └─→ new SessionStore(app, undefined, plugin.manifest.id)
              └─→ getSession(savedSessionId)
                    └─→ JSONL 读
                          └─→ restoreFromSessionStore
                                ├─→ 过滤消息（跳过 tool_calls）
                                ├─→ 去重（连续 assistant 留最后）
                                └─→ messageList.addMessage()
```

### 关键过滤逻辑

```typescript
// 1. 跳过 tool_calls 消息
const allDisplayMessages = session.messages.filter(msg => {
  if (msg.role === 'user') return true;
  if (msg.role === 'assistant') {
    return !msg.tool_calls || msg.tool_calls.length === 0;
  }
  return false;
});

// 2. 连续 assistant 留最后一条
for (let i = 0; i < allDisplayMessages.length; i++) {
  const msg = allDisplayMessages[i];
  const nextMsg = allDisplayMessages[i + 1];
  if (msg.role === 'assistant' && nextMsg?.role === 'assistant') {
    continue;  // 跳过前一条
  }
  displayMessages.push(msg);
}
```

### 失败兜底

```typescript
const session = await this._sessionStore!.get(sessionId);
if (!session || session.messages.length === 0) {
  log('[DeepPDF] SessionStore 中没有找到会话或会话为空:', sessionId);
  return false;  // 失败：调用方处理（一般 start new session）
}
```

**3 种恢复结果**：
- 成功 → UI 显示历史消息
- 会话不存在 → 静默 false
- 会话为空 → 静默 false

---

## Files

| 文件 | 职责 |
|---|---|
| `src/views/sidebar/session-manager.ts` | SessionManager 主类（550 行） |
| `src/agent/session/store.ts` | SessionStore JSONL 持久化（611 行） |
| `src/agent/memory/store.ts` | MemoryStore MEMORY.md / HISTORY.md（393 行） |
| `src/agent/memory/consolidator.ts` | 记忆整合算法（391 行） |
| `src/agent/config/agent-constants.ts` | `GENERAL_MODE_INDEX_ID` 常量 |
| `src/views/sidebar/sidebar-view.ts` | SidebarView 持有 SessionManager 实例 |
| `src/components/reading-topbar/reading-topbar.ts` | ReadingTopbar（cross-book 模式按钮） |
| `tests/unit/views/sidebar/session-manager.test.ts` | SessionManager 单测 |

---

## Limitations [INFERENCE]

### 模式管理

- **`_crossBookMode` 和 `_generalChatMode` 不互斥检查** —— 理论上可以同时为 true（实际不可能但**未断言**）
- **不实现"恢复未完成会话"** —— Obsidian 崩溃后**正在进行的对话丢失**
- **不支持"暂停会话"** —— 只有"新建" / "恢复"，**没有"挂起"**
- **不支持"会话分组"** —— 按书分组，**没有"文件夹"层级**
- **不支持"会话标签"** —— 用户不能给会话打标签
- **不支持"会话搜索"** —— 历史会话**只能时间排序找**
- **不支持"会话导出"** —— 用户不能"导出这个对话为 .md"

### 会话 ID

- **`sessionId` 用 `Date.now() + Math.random()`** —— 不保证全局唯一
- **sessionId 跨重启不感知** —— `plugin.manifest.id` 变了**老会话找不到**
- **不实现 sessionId 索引** —— `savedSessions` 是 Object 字典，**O(n) 查找**

### savedSessions 持久化

- **Object 键冲突** —— 不同模式共用 `savedSessions[bookId]`，**覆盖风险**
- **JSON.stringify 失败兜底不全** —— `plugin.saveSettings()` 失败**不重试**
- **不实现"会话迁移"** —— 用户切换 vault / 同步设置时，**会话留在旧 vault**

### MemoryConsolidator 集成

- **不实现"自动触发"** —— `autoTrigger: false`，**用户必须手动整理**
- **整合阈值硬编码 8000 字** —— 用户不能调
- **整合失败不重试** —— LLM 调用失败**静默**继续
- **不实现"按章节整合"** —— 一次整合**全量 MEMORY.md**

### 与 FrontendAgent 集成

- **不主动创建 FrontendAgent** —— `host.initializeFrontendAgent()` 是**外部触发**（懒初始化）
- **agentChatHistory 双向同步** —— `get/set` 都调，**可能导致双重保存**（Setter 写一份 + SessionStore 又写一份）
- **不监听 isAiStreaming 变化** —— SessionManager 不感知流状态，**靠 cancelActiveStream 调一次**
- **cancelActiveStream 不等流真正停止** —— 同步调用，**可能流仍写消息历史**

### 跨平台兼容

- **依赖 Obsidian App** —— 测试 / 移动端**没 fallback**
- **依赖 plugin.manifest.id** —— 跨设备同步时如果 manifest 变了**找不到原会话**

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/views/sidebar/session-manager.ts` 550 行的架构视角文档。3 大基础服务封装 + SessionManagerHost 接口 + 6 API 生命周期 + 3 对话模式 + MemoryConsolidator 集成 + 7 子主题 31 条已知限制 |
