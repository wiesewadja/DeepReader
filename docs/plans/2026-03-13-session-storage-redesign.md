# Session Storage 存储机制重设计

## 概述

将 DeepReader 的会话存储从 `data.json` 中的 `chatCache` 迁移到独立的 JSONL 文件，解决文件膨胀、加载变慢和并发冲突问题。

## 背景

### 当前问题

1. **文件膨胀** - 所有会话消息存储在 `data.json` 的 `chatCache` 字段中
2. **加载变慢** - 每次启动都要加载全部历史
3. **无并发保护** - 快速连续对话时可能整合冲突
4. **单轮整合** - 不够智能，可能无法有效压缩

### 参考

- nanobot 的 `session/manager.py` 和 `agent/memory.py`
- JSONL 格式：每行一条消息，追加写入

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 存储位置 | `.obsidian/plugins/deepreader/sessions/` | 插件私有目录，保持用户工作区整洁 |
| 会话保留 | 永久保留 | 用户完全控制数据 |
| 数据迁移 | **不迁移** | 直接删除旧 `chatCache`，用户从新会话开始 |
| 实现方案 | 轻量级改进 | 改动最小，风险最低 |

## 存储结构

### 目录布局

```
.obsidian/plugins/deepreader/
├── data.json              # 插件设置（不再存储 chatCache）
├── sessions/
│   ├── index.json         # 会话索引（元数据）
│   ├── sess_abc123.jsonl  # 会话文件（每行一条消息）
│   ├── sess_def456.jsonl
│   └── ...
└── ...
```

### JSONL 文件格式

```jsonl
{"_type":"metadata","sessionId":"sess_abc123","indexId":"book-xxx","createdAt":"2026-03-13T10:00:00Z","lastConsolidated":5}
{"role":"user","content":"这本书主要讲什么？","timestamp":"2026-03-13T10:01:00Z"}
{"role":"assistant","content":"这是一本关于...","timestamp":"2026-03-13T10:01:30Z"}
{"role":"user","content":"继续","timestamp":"2026-03-13T10:02:00Z"}
```

**关键点：**
- 第一行是元数据，后续行是消息（追加写入）
- `lastConsolidated` 记录已整合的消息行号
- 每行独立，追加写入高效且安全

### 索引文件格式

```json
{
  "sessions": [
    {"sessionId": "sess_abc123", "indexId": "book-xxx", "updatedAt": "2026-03-13T10:05:00Z", "messageCount": 12},
    {"sessionId": "sess_def456", "indexId": "cross-book", "updatedAt": "2026-03-12T15:00:00Z", "messageCount": 8}
  ],
  "version": 1
}
```

**用途：** 快速加载会话列表，无需扫描所有 JSONL 文件

## 核心组件

### SessionStore 类

**文件位置：** `frontend/src/agent/session/store.ts`

```typescript
export interface Session {
  sessionId: string;
  indexId: string;
  createdAt: number;
  updatedAt: number;
  lastConsolidated: number;  // 已整合的消息索引
  isCrossBook?: boolean;
  messages: ChatMessage[];   // 内存缓存，按需加载
}

export interface SessionMeta {
  sessionId: string;
  indexId: string;
  updatedAt: number;
  messageCount: number;
}

export class SessionStore {
  private sessionsDir: string;
  private indexPath: string;
  private cache: Map<string, Session> = new Map();
  private locks: Map<string, Promise<void>> = new Map();

  constructor(app: App);

  // 基础 CRUD
  get(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;

  // 消息操作（追加写入）
  appendMessage(sessionId: string, message: ChatMessage): Promise<void>;

  // 会话列表
  listSessions(): Promise<SessionMeta[]>;

  // 整合相关
  getLock(sessionId: string): Promise<void>;
  releaseLock(sessionId: string): void;
  updateLastConsolidated(sessionId: string, index: number): Promise<void>;

  // 迁移
  migrateFromChatCache(chatCache: Record<string, ChatCacheEntry>): Promise<number>;
}
```

### 关键实现细节

1. **追加写入**
   - `appendMessage` 只在文件末尾追加一行，不重写整个文件
   - 同时更新内存缓存和索引文件

2. **内存缓存**
   - 活跃会话缓存在 `cache` 中，减少文件读取
   - 非活跃会话从缓存中移除，按需加载

3. **会话锁**
   ```typescript
   async getLock(sessionId: string): Promise<void> {
     const existing = this.locks.get(sessionId);
     let releaseLock: () => void;

     const promise = new Promise<void>((resolve) => {
       releaseLock = () => {
         this.locks.delete(sessionId);
         resolve();
       };
     });

     if (existing) {
       await existing;
     }

     this.locks.set(sessionId, promise);
     return promise;
   }
   ```

4. **懒加载**
   - `get()` 优先从缓存读取
   - 缓存未命中时从 JSONL 文件加载

## 数据流

### 消息追加流程

```
用户发送消息
    ↓
sidebar-view.handleAgentQuery()
    ↓
sessionStore.appendMessage(sessionId, userMessage)
    ↓
1. 追加消息到 JSONL 文件
2. 更新内存缓存
3. 更新索引文件中的 updatedAt 和 messageCount
```

### 整合流程改进

```typescript
async maybeConsolidateMemory(): Promise<void> {
  // 1. 获取会话锁
  const lock = await this.sessionStore.getLock(this.sessionId);

  try {
    // 2. 重新加载会话（防止并发修改）
    const session = await this.sessionStore.get(this.sessionId);

    // 3. 多轮整合直到满足目标
    while (this.needsConsolidation(session)) {
      const chunk = this.pickConsolidationChunk(session);
      if (!chunk) break;

      await this.consolidateChunk(chunk);
      session.lastConsolidated = chunk.endIndex;
      await this.sessionStore.updateLastConsolidated(this.sessionId, chunk.endIndex);
    }
  } finally {
    this.sessionStore.releaseLock(this.sessionId);
  }
}
```

### 消息对齐（修复 orphaned tool_result）

```typescript
getHistory(session: Session): ChatMessage[] {
  const unconsolidated = session.messages.slice(session.lastConsolidated);

  // 丢弃开头的非 user 消息，避免 orphaned tool_result
  for (let i = 0; i < unconsolidated.length; i++) {
    if (unconsolidated[i].role === 'user') {
      return unconsolidated.slice(i);
    }
  }
  return [];
}
```

## 旧代码清理

### 需要删除的代码

**1. `main.ts` - 移除 `chatCache` 相关**
```typescript
// 删除 DeepPDFSettings 中的
chatCache?: Record<string, any>;
```

**2. `sidebar-view.ts` - 移除所有 `chatCache` 操作**
- `saveToCache()` 方法中的 `this.plugin.settings.chatCache` 操作
- `restoreHistoryToView()` 中从 `chatCache` 恢复的逻辑
- 所有 `this.plugin.settings.chatCache?.[sessionId]` 引用

**3. `agent/memory/types.ts` - 简化类型**
```typescript
// 删除 ChatCacheEntry 接口（或保留但标记废弃）
```

### 清理后的简化流程

```
用户发送消息
    ↓
sessionStore.appendMessage(sessionId, message)
    ↓
用户切换书籍/重启插件
    ↓
sessionStore.get(sessionId) → 恢复历史
```

## 实现计划

### Phase 1: 基础设施 (1-2 小时)

1. 创建 `frontend/src/agent/session/store.ts`
2. 实现 `SessionStore` 类的基本 CRUD
3. 实现 JSONL 文件读写
4. 实现索引文件管理

### Phase 2: 集成 (1-2 小时)

1. 修改 `sidebar-view.ts` 使用 `SessionStore`
2. 添加会话锁机制
3. 改进整合流程（多轮整合）
4. 实现消息对齐

### Phase 3: 清理 (30 分钟)

1. 移除 `data.json` 中的 `chatCache` 相关代码
2. 移除 `main.ts` 中的 `chatCache` 设置项
3. 清理 `sidebar-view.ts` 中的旧缓存逻辑
4. 更新类型定义

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 旧数据丢失 | **用户已知并接受**，升级后从新会话开始 |
| 并发写入冲突 | 会话锁机制 |
| 文件损坏 | 每行独立 JSON，单行损坏不影响其他行 |
| 索引与文件不同步 | 提供索引重建功能 |

## 历史恢复与整合机制

### 核心概念

| 术语 | 含义 |
|------|------|
| **lastConsolidated** | 已整合到 `MEMORY.md` 的消息索引 |
| **unconsolidated** | 未整合的消息（需要加载到 LLM 上下文） |
| **整合触发** | 当 unconsolidated 消息 token 超过阈值时 |

### 消息生命周期

```
用户发送消息
    ↓
追加到 JSONL 文件 (appendMessage)
    ↓
会话增长... [msg0, msg1, ..., msg99]
    ↓
token 估算超过阈值 (8000 tokens)
    ↓
触发整合 (maybeConsolidate)
    ↓
LLM 提取关键信息 → 写入 MEMORY.md
    ↓
更新 lastConsolidated = 50
    ↓
下次加载只加载 [msg51...msg99] (unconsolidated)
```

### 新设计恢复流程

```typescript
// SessionStore.getLLMHistory() - 加载到 LLM 上下文的历史
async getLLMHistory(sessionId: string): Promise<ChatMessage[]> {
  const session = await this.get(sessionId);

  // 1. 只加载未整合的消息
  const unconsolidated = session.messages.slice(session.lastConsolidated);

  // 2. 限制最大消息数（安全边界）
  const trimmed = unconsolidated.slice(-500);

  // 3. 对齐到用户消息边界（避免 orphaned tool_result）
  const alignedStart = trimmed.findIndex(m => m.role === 'user');
  const aligned = alignedStart >= 0 ? trimmed.slice(alignedStart) : trimmed;

  return aligned;
}

// SessionStore.getMessages() - 加载到 UI 的完整历史
async getMessages(sessionId: string): Promise<ChatMessage[]> {
  const session = await this.get(sessionId);
  return session.messages;  // UI 显示全部消息
}
```

### 整合触发机制

```typescript
// sidebar-view.ts 中的 maybeConsolidateMemory
async maybeConsolidateMemory(): Promise<void> {
  const session = await this.sessionStore.get(this.sessionId);
  const unconsolidated = session.messages.slice(session.lastConsolidated);

  // 估算 token 数
  const tokens = estimateTokens(unconsolidated);

  if (tokens < CONSOLIDATION_THRESHOLD) {
    return;  // 未达到阈值，不整合
  }

  // 获取会话锁（防止并发整合）
  await this.sessionStore.acquireLock(this.sessionId);

  try {
    // 多轮整合直到满足目标
    while (this.needsConsolidation(session)) {
      const chunk = this.pickConsolidationChunk(session);
      if (!chunk) break;

      // 调用 LLM 整合
      const result = await this.memoryConsolidator.consolidate(chunk);

      // 写入 MEMORY.md
      await this.memoryStore.appendHistory(result.historyEntry);
      await this.memoryStore.writeLongTermMemory(result.memoryUpdate);

      // 更新 lastConsolidated
      session.lastConsolidated = chunk.endIndex;
      await this.sessionStore.updateLastConsolidated(
        this.sessionId,
        chunk.endIndex
      );
    }
  } finally {
    this.sessionStore.releaseLock(this.sessionId);
  }
}
```

### 消息对齐（修复 orphaned tool_result）

```typescript
// 丢弃开头的非 user 消息，避免 LLM 收到不完整的工具调用
getHistory(session: Session): ChatMessage[] {
  const unconsolidated = session.messages.slice(session.lastConsolidated);

  for (let i = 0; i < unconsolidated.length; i++) {
    if (unconsolidated[i].role === 'user') {
      return unconsolidated.slice(i);
    }
  }
  return [];
}
```

### 与 UI 恢复的区别

| 场景 | 加载内容 | 方法 |
|------|----------|------|
| **UI 显示** | 全部消息 | `sessionStore.getMessages()` |
| **LLM 上下文** | unconsolidated + 对齐 | `sessionStore.getLLMHistory()` |

```typescript
// sidebar-view.ts 恢复历史
async restoreHistoryToView(sessionId: string) {
  // 1. UI 显示全部历史
  const allMessages = await this.sessionStore.getMessages(sessionId);
  this.messageList.renderMessages(allMessages);

  // 2. LLM 上下文只加载 unconsolidated
  const llmHistory = await this.sessionStore.getLLMHistory(sessionId);
  const systemPrompt = await this.frontendAgent.getSystemPromptAsync();
  this.agentChatHistory = [
    { role: 'system', content: systemPrompt },
    ...llmHistory
  ];
}
```

### SessionStore 完整接口

```typescript
export class SessionStore {
  // 基础 CRUD
  get(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;

  // 消息操作
  appendMessage(sessionId: string, message: ChatMessage): Promise<void>;

  // 历史加载（区分 UI 和 LLM）
  getMessages(sessionId: string): Promise<ChatMessage[]>;      // UI 用
  getLLMHistory(sessionId: string): Promise<ChatMessage[]>;    // LLM 用

  // 会话查找
  findSessionByIndexId(indexId: string): Promise<SessionMeta | null>;
  getCrossBookSession(): Promise<SessionMeta | null>;

  // 整合相关
  updateLastConsolidated(sessionId: string, index: number): Promise<void>;

  // 并发控制
  acquireLock(sessionId: string): Promise<void>;
  releaseLock(sessionId: string): void;
}
```

## 测试计划

1. **基础功能测试**
   - 创建新会话
   - 追加消息
   - 加载会话

2. **并发测试**
   - 快速连续发送消息
   - 同时触发整合

3. **边界测试**
   - 空会话
   - 超长消息
   - 特殊字符处理

4. **恢复测试**
   - 切换书籍后恢复历史
   - 重启插件后恢复历史
   - 跨书籍模式恢复
