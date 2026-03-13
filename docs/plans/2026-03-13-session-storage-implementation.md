# Session Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 DeepReader 的会话存储从 `data.json` 中的 `chatCache` 迁移到独立的 JSONL 文件存储系统。

**Architecture:** 创建 `SessionStore` 类管理 JSONL 文件存储，实现追加写入、懒加载和会话锁机制。区分 UI 历史加载（全部消息）和 LLM 历史加载（unconsolidated + 对齐）。

**Tech Stack:** TypeScript, Obsidian Plugin API, JSONL 文件格式

---

## Task 1: 创建 Session 类型定义

**Files:**
- Create: `frontend/src/agent/session/types.ts`

**Step 1: 创建类型文件**

```typescript
/**
 * Session Storage 类型定义
 *
 * JSONL 文件存储会话消息，支持追加写入和懒加载
 */

import type { ChatMessage } from '../types.js';

/**
 * 会话元数据（存储在 JSONL 第一行和 index.json 中）
 */
export interface SessionMeta {
  sessionId: string;
  indexId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** 已整合到长期记忆的消息索引 */
  lastConsolidated: number;
  isCrossBook?: boolean;
}

/**
 * 完整会话对象（内存中使用）
 */
export interface Session extends SessionMeta {
  messages: ChatMessage[];
}

/**
 * JSONL 文件中的元数据行
 */
export interface SessionMetadataLine {
  _type: 'metadata';
  sessionId: string;
  indexId: string;
  createdAt: string;
  lastConsolidated: number;
  isCrossBook?: boolean;
}

/**
 * JSONL 文件中的消息行
 */
export interface SessionMessageLine {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  tool_calls?: ChatMessage['tool_calls'];
  tool_call_id?: string;
  name?: string;
  hidden?: boolean;
}

/**
 * 索引文件结构
 */
export interface SessionsIndex {
  sessions: SessionMeta[];
  version: number;
}

/**
 * SessionStore 配置
 */
export interface SessionStoreConfig {
  /** 最大缓存会话数 */
  maxCacheSize?: number;
  /** 最大加载消息数（LLM 历史） */
  maxLLMMessages?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_SESSION_STORE_CONFIG: Required<SessionStoreConfig> = {
  maxCacheSize: 10,
  maxLLMMessages: 500,
};
```

**Step 2: 验证类型编译**

Run: `cd frontend && npm run build`
Expected: 无类型错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/types.ts
git commit -m "feat(session): 添加 Session Storage 类型定义"
```

---

## Task 2: 创建 SessionStore 基础类

**Files:**
- Create: `frontend/src/agent/session/store.ts`

**Step 1: 创建 SessionStore 类骨架**

```typescript
/**
 * SessionStore - JSONL 文件会话存储
 *
 * 特性：
 * - 追加写入：只追加新消息，不重写整个文件
 * - 懒加载：按需加载会话，活跃会话缓存
 * - 会话锁：防止并发整合冲突
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type { ChatMessage } from '../types.js';
import { agentLog as log } from '../../utils/logger.js';
import {
  type Session,
  type SessionMeta,
  type SessionMetadataLine,
  type SessionMessageLine,
  type SessionsIndex,
  type SessionStoreConfig,
  DEFAULT_SESSION_STORE_CONFIG,
} from './types.js';

/** Sessions 目录路径 */
const SESSIONS_DIR = '.obsidian/plugins/deepreader/sessions';

/** 索引文件名 */
const INDEX_FILE = 'index.json';

export class SessionStore {
  private app: App;
  private config: Required<SessionStoreConfig>;
  private sessionsDir: string;
  private indexPath: string;

  /** 内存缓存 */
  private cache: Map<string, Session> = new Map();

  /** 会话锁（Promise 链） */
  private locks: Map<string, Promise<void>> = new Map();

  /** 索引缓存 */
  private indexCache: SessionsIndex | null = null;

  constructor(app: App, config?: SessionStoreConfig) {
    this.app = app;
    this.config = { ...DEFAULT_SESSION_STORE_CONFIG, ...config };
    this.sessionsDir = normalizePath(SESSIONS_DIR);
    this.indexPath = normalizePath(`${SESSIONS_DIR}/${INDEX_FILE}`);
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(): Promise<void> {
    const exists = await this.app.vault.adapter.exists(this.sessionsDir);
    if (!exists) {
      await this.app.vault.adapter.mkdir(this.sessionsDir);
      log('[SessionStore] 创建 sessions 目录');
    }
  }

  /**
   * 获取会话文件路径
   */
  private getSessionPath(sessionId: string): string {
    return normalizePath(`${SESSIONS_DIR}/${sessionId}.jsonl`);
  }

  // 后续方法在此添加...
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/store.ts
git commit -m "feat(session): 创建 SessionStore 类骨架"
```

---

## Task 3: 实现会话创建和保存

**Files:**
- Modify: `frontend/src/agent/session/store.ts`

**Step 1: 实现 create 和 save 方法**

在 `SessionStore` 类中添加：

```typescript
/**
 * 创建新会话
 */
async create(sessionId: string, indexId: string, isCrossBook?: boolean): Promise<Session> {
  await this.ensureDir();

  const now = Date.now();
  const session: Session = {
    sessionId,
    indexId,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    lastConsolidated: 0,
    isCrossBook,
    messages: [],
  };

  // 写入 JSONL 文件（只有元数据行）
  await this.writeSessionFile(session);

  // 更新索引
  await this.addToIndex(session);

  // 加入缓存
  this.cache.set(sessionId, session);

  log(`[SessionStore] 创建会话: ${sessionId}`);
  return session;
}

/**
 * 保存会话（重写整个文件）
 */
async save(session: Session): Promise<void> {
  await this.ensureDir();
  await this.writeSessionFile(session);
  await this.updateIndex(session);
  this.cache.set(session.sessionId, session);
}

/**
 * 写入会话文件
 */
private async writeSessionFile(session: Session): Promise<void> {
  const path = this.getSessionPath(session.sessionId);
  const lines: string[] = [];

  // 第一行：元数据
  const metaLine: SessionMetadataLine = {
    _type: 'metadata',
    sessionId: session.sessionId,
    indexId: session.indexId,
    createdAt: new Date(session.createdAt).toISOString(),
    lastConsolidated: session.lastConsolidated,
    isCrossBook: session.isCrossBook,
  };
  lines.push(JSON.stringify(metaLine));

  // 后续行：消息
  for (const msg of session.messages) {
    const msgLine: SessionMessageLine = {
      role: msg.role as 'user' | 'assistant' | 'tool',
      content: msg.content,
      timestamp: new Date().toISOString(),
      tool_calls: msg.tool_calls,
      tool_call_id: msg.tool_call_id,
      name: msg.name,
      hidden: msg.hidden,
    };
    lines.push(JSON.stringify(msgLine));
  }

  await this.app.vault.adapter.write(path, lines.join('\n') + '\n');
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/store.ts
git commit -m "feat(session): 实现 create 和 save 方法"
```

---

## Task 4: 实现索引文件管理

**Files:**
- Modify: `frontend/src/agent/session/store.ts`

**Step 1: 实现索引文件读写**

在 `SessionStore` 类中添加：

```typescript
/**
 * 读取索引文件
 */
private async readIndex(): Promise<SessionsIndex> {
  if (this.indexCache) {
    return this.indexCache;
  }

  try {
    const exists = await this.app.vault.adapter.exists(this.indexPath);
    if (!exists) {
      return { sessions: [], version: 1 };
    }

    const content = await this.app.vault.adapter.read(this.indexPath);
    this.indexCache = JSON.parse(content);
    return this.indexCache!;
  } catch (err) {
    log('[SessionStore] 读取索引失败:', err);
    return { sessions: [], version: 1 };
  }
}

/**
 * 写入索引文件
 */
private async writeIndex(index: SessionsIndex): Promise<void> {
  await this.ensureDir();
  await this.app.vault.adapter.write(this.indexPath, JSON.stringify(index, null, 2));
  this.indexCache = index;
}

/**
 * 添加会话到索引
 */
private async addToIndex(session: Session): Promise<void> {
  const index = await this.readIndex();

  // 检查是否已存在
  const existingIdx = index.sessions.findIndex(s => s.sessionId === session.sessionId);
  const meta = this.sessionToMeta(session);

  if (existingIdx >= 0) {
    index.sessions[existingIdx] = meta;
  } else {
    index.sessions.push(meta);
  }

  // 按更新时间排序（最新的在前）
  index.sessions.sort((a, b) => b.updatedAt - a.updatedAt);

  await this.writeIndex(index);
}

/**
 * 更新索引中的会话
 */
private async updateIndex(session: Session): Promise<void> {
  await this.addToIndex(session);
}

/**
 * 从索引移除会话
 */
private async removeFromIndex(sessionId: string): Promise<void> {
  const index = await this.readIndex();
  index.sessions = index.sessions.filter(s => s.sessionId !== sessionId);
  await this.writeIndex(index);
}

/**
 * Session 转 SessionMeta
 */
private sessionToMeta(session: Session): SessionMeta {
  return {
    sessionId: session.sessionId,
    indexId: session.indexId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    lastConsolidated: session.lastConsolidated,
    isCrossBook: session.isCrossBook,
  };
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/store.ts
git commit -m "feat(session): 实现索引文件管理"
```

---

## Task 5: 实现消息追加

**Files:**
- Modify: `frontend/src/agent/session/store.ts`

**Step 1: 实现 appendMessage 方法**

在 `SessionStore` 类中添加：

```typescript
/**
 * 追加消息到会话（高效追加写入）
 */
async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
  await this.ensureDir();

  // 获取会话（优先从缓存）
  let session = this.cache.get(sessionId);
  if (!session) {
    session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
  }

  // 更新内存中的会话
  session.messages.push(message);
  session.messageCount++;
  session.updatedAt = Date.now();

  // 追加到文件（只追加一行）
  const path = this.getSessionPath(sessionId);
  const msgLine: SessionMessageLine = {
    role: message.role as 'user' | 'assistant' | 'tool',
    content: message.content,
    timestamp: new Date().toISOString(),
    tool_calls: message.tool_calls,
    tool_call_id: message.tool_call_id,
    name: message.name,
    hidden: message.hidden,
  };

  // 检查文件是否存在
  const exists = await this.app.vault.adapter.exists(path);
  if (!exists) {
    // 文件不存在，创建完整文件
    await this.writeSessionFile(session);
  } else {
    // 追加一行
    const line = JSON.stringify(msgLine) + '\n';
    const existing = await this.app.vault.adapter.read(path);
    await this.app.vault.adapter.write(path, existing + line);
  }

  // 更新索引
  await this.updateIndex(session);

  // 更新缓存
  this.cache.set(sessionId, session);
}

/**
 * 批量追加消息
 */
async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
  for (const msg of messages) {
    await this.appendMessage(sessionId, msg);
  }
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/store.ts
git commit -m "feat(session): 实现消息追加写入"
```

---

## Task 6: 实现会话加载

**Files:**
- Modify: `frontend/src/agent/session/store.ts`

**Step 1: 实现 get 和 getMessages 方法**

在 `SessionStore` 类中添加：

```typescript
/**
 * 获取会话（懒加载）
 */
async get(sessionId: string): Promise<Session | null> {
  // 优先从缓存读取
  const cached = this.cache.get(sessionId);
  if (cached) {
    return cached;
  }

  // 从文件加载
  const path = this.getSessionPath(sessionId);
  const exists = await this.app.vault.adapter.exists(path);
  if (!exists) {
    return null;
  }

  try {
    const content = await this.app.vault.adapter.read(path);
    const lines = content.trim().split('\n');

    if (lines.length === 0) {
      return null;
    }

    // 第一行是元数据
    const metaLine = JSON.parse(lines[0]) as SessionMetadataLine;

    // 后续行是消息
    const messages: ChatMessage[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        const msgLine = JSON.parse(lines[i]) as SessionMessageLine;
        messages.push({
          role: msgLine.role,
          content: msgLine.content,
          tool_calls: msgLine.tool_calls,
          tool_call_id: msgLine.tool_call_id,
          name: msgLine.name,
          hidden: msgLine.hidden,
        });
      } catch (e) {
        log(`[SessionStore] 解析消息行失败: ${i}`, e);
      }
    }

    const session: Session = {
      sessionId: metaLine.sessionId,
      indexId: metaLine.indexId,
      createdAt: new Date(metaLine.createdAt).getTime(),
      updatedAt: Date.now(),
      messageCount: messages.length,
      lastConsolidated: metaLine.lastConsolidated,
      isCrossBook: metaLine.isCrossBook,
      messages,
    };

    // 加入缓存
    this.cache.set(sessionId, session);

    // 限制缓存大小
    if (this.cache.size > this.config.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    return session;
  } catch (err) {
    log(`[SessionStore] 加载会话失败: ${sessionId}`, err);
    return null;
  }
}

/**
 * 获取会话的全部消息（UI 用）
 */
async getMessages(sessionId: string): Promise<ChatMessage[]> {
  const session = await this.get(sessionId);
  return session?.messages || [];
}

/**
 * 获取会话的 LLM 历史格式（unconsolidated + 对齐）
 */
async getLLMHistory(sessionId: string): Promise<ChatMessage[]> {
  const session = await this.get(sessionId);
  if (!session) {
    return [];
  }

  // 1. 只加载未整合的消息
  const unconsolidated = session.messages.slice(session.lastConsolidated);

  // 2. 限制最大消息数
  const trimmed = unconsolidated.slice(-this.config.maxLLMMessages);

  // 3. 对齐到用户消息边界（避免 orphaned tool_result）
  const alignedStart = trimmed.findIndex(m => m.role === 'user');
  const aligned = alignedStart >= 0 ? trimmed.slice(alignedStart) : trimmed;

  return aligned;
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/store.ts
git commit -m "feat(session): 实现会话加载和 LLM 历史格式"
```

---

## Task 7: 实现会话查找

**Files:**
- Modify: `frontend/src/agent/session/store.ts`

**Step 1: 实现会话查找方法**

在 `SessionStore` 类中添加：

```typescript
/**
 * 根据书籍 indexId 查找最近的会话
 */
async findSessionByIndexId(indexId: string): Promise<SessionMeta | null> {
  const index = await this.readIndex();
  return index.sessions.find(s => s.indexId === indexId) || null;
}

/**
 * 获取跨书籍模式的最近会话
 */
async getCrossBookSession(): Promise<SessionMeta | null> {
  const index = await this.readIndex();
  return index.sessions.find(s => s.isCrossBook) || null;
}

/**
 * 列出所有会话
 */
async listSessions(): Promise<SessionMeta[]> {
  const index = await this.readIndex();
  return index.sessions;
}

/**
 * 删除会话
 */
async delete(sessionId: string): Promise<void> {
  // 删除文件
  const path = this.getSessionPath(sessionId);
  const exists = await this.app.vault.adapter.exists(path);
  if (exists) {
    await this.app.vault.adapter.remove(path);
  }

  // 从索引移除
  await this.removeFromIndex(sessionId);

  // 从缓存移除
  this.cache.delete(sessionId);

  log(`[SessionStore] 删除会话: ${sessionId}`);
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/store.ts
git commit -m "feat(session): 实现会话查找和删除"
```

---

## Task 8: 实现会话锁机制

**Files:**
- Modify: `frontend/src/agent/session/store.ts`

**Step 1: 实现并发锁**

在 `SessionStore` 类中添加：

```typescript
/**
 * 获取会话锁（用于防止并发整合）
 */
async acquireLock(sessionId: string): Promise<void> {
  const existing = this.locks.get(sessionId);

  // 等待现有锁释放
  if (existing) {
    await existing;
  }

  // 创建新锁
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  // 存储释放函数
  (lockPromise as any).release = releaseLock!;

  this.locks.set(sessionId, lockPromise);
}

/**
 * 释放会话锁
 */
releaseLock(sessionId: string): void {
  const lock = this.locks.get(sessionId);
  if (lock && (lock as any).release) {
    (lock as any).release();
  }
  this.locks.delete(sessionId);
}

/**
 * 更新 lastConsolidated（整合完成后调用）
 */
async updateLastConsolidated(sessionId: string, index: number): Promise<void> {
  const session = await this.get(sessionId);
  if (!session) {
    return;
  }

  session.lastConsolidated = index;

  // 只更新元数据行（第一行）
  const path = this.getSessionPath(sessionId);
  const content = await this.app.vault.adapter.read(path);
  const lines = content.split('\n');

  if (lines.length > 0) {
    const metaLine = JSON.parse(lines[0]) as SessionMetadataLine;
    metaLine.lastConsolidated = index;
    lines[0] = JSON.stringify(metaLine);
    await this.app.vault.adapter.write(path, lines.join('\n'));
  }

  // 更新缓存
  this.cache.set(sessionId, session);

  // 更新索引
  await this.updateIndex(session);

  log(`[SessionStore] 更新 lastConsolidated: ${sessionId} -> ${index}`);
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/store.ts
git commit -m "feat(session): 实现会话锁和 lastConsolidated 更新"
```

---

## Task 9: 创建 session 模块导出

**Files:**
- Create: `frontend/src/agent/session/index.ts`

**Step 1: 创建导出文件**

```typescript
/**
 * Session Storage 模块
 */

export { SessionStore } from './store.js';
export type {
  Session,
  SessionMeta,
  SessionMetadataLine,
  SessionMessageLine,
  SessionsIndex,
  SessionStoreConfig,
} from './types.js';
export { DEFAULT_SESSION_STORE_CONFIG } from './types.js';
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/agent/session/index.ts
git commit -m "feat(session): 创建 session 模块导出"
```

---

## Task 10: 集成到 sidebar-view（保存消息）

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 添加 SessionStore 导入和初始化**

在文件顶部添加导入：

```typescript
import { SessionStore } from '../agent/session/index.js';
```

在 `SidebarView` 类中添加属性：

```typescript
private sessionStore: SessionStore | null = null;
```

在 `onViewReady` 或 `initializeFrontendAgent` 附近初始化：

```typescript
private async initializeSessionStore(): Promise<void> {
  if (this.sessionStore) return;
  this.sessionStore = new SessionStore(this.app);
  log('[DeepPDF] SessionStore 已初始化');
}
```

**Step 2: 修改 saveToCache 方法**

找到 `saveToCache` 方法，替换为：

```typescript
private async saveToCache(): Promise<void> {
  log('[DeepPDF] saveToCache called, sessionId:', this.sessionId);
  if (!this.sessionId || !this.messageList) {
    log('[DeepPDF] saveToCache early return: no sessionId or messageList');
    return;
  }

  // 确保 SessionStore 已初始化
  await this.initializeSessionStore();

  const effectiveIndexId = this.crossBookMode
    ? '__cross_book__'
    : this.currentIndexId;

  if (!effectiveIndexId) {
    log('[DeepPDF] saveToCache early return: no effectiveIndexId');
    return;
  }

  // 获取当前消息
  const messages = this.messageList.getMessages();

  // 检查会话是否存在，不存在则创建
  let session = await this.sessionStore!.get(this.sessionId);
  if (!session) {
    session = await this.sessionStore!.create(
      this.sessionId,
      effectiveIndexId,
      this.crossBookMode
    );
  }

  // 只追加新消息（比较 messageCount）
  const newMessages = messages.slice(session.messageCount);
  for (const msg of newMessages) {
    await this.sessionStore!.appendMessage(this.sessionId, {
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  log(`[DeepPDF] 保存 ${newMessages.length} 条新消息到 SessionStore`);
}
```

**Step 3: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 4: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(session): 集成 SessionStore 到 saveToCache"
```

---

## Task 11: 集成到 sidebar-view（恢复历史）

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 修改 restoreHistoryToView 方法**

找到 `restoreHistoryToView` 方法，重构为使用 SessionStore：

```typescript
private async restoreHistoryToView(sessionId: string): Promise<void> {
  if (!this.messageList) return;

  await this.initializeSessionStore();

  const session = await this.sessionStore!.get(sessionId);
  if (!session || session.messages.length === 0) {
    this.showWelcomeMessage();
    return;
  }

  // 1. UI 显示全部历史
  for (const msg of session.messages) {
    this.messageList.addMessage({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      timestamp: new Date().toISOString(),
      isAgentMessage: msg.role === 'assistant',
    });
  }

  // 2. LLM 上下文只加载 unconsolidated
  const llmHistory = await this.sessionStore!.getLLMHistory(sessionId);

  if (llmHistory.length > 0 && this.frontendAgent) {
    const systemPrompt = await this.frontendAgent.getSystemPromptAsync();
    this.agentChatHistory = [
      { role: 'system', content: systemPrompt },
      ...llmHistory,
    ];
    log('[DeepPDF] 恢复 agentChatHistory，消息数:', this.agentChatHistory.length);
  }
}
```

**Step 2: 修改 selectIndex 中的历史恢复调用**

找到 `selectIndex` 方法中调用 `restoreHistoryToView` 的地方，改为：

```typescript
// 从 SessionStore 恢复
await this.initializeSessionStore();
const sessionMeta = await this.sessionStore!.findSessionByIndexId(indexId);
if (sessionMeta) {
  this.sessionId = sessionMeta.sessionId;
  await this.restoreHistoryToView(sessionMeta.sessionId);
  return;
}

// 没有历史，开始新会话
await this.startNewSession(indexId);
this.showWelcomeMessage();
```

**Step 3: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 4: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(session): 集成 SessionStore 到历史恢复"
```

---

## Task 12: 修改 maybeConsolidateMemory

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 更新整合方法使用 SessionStore**

找到 `maybeConsolidateMemory` 方法，更新为使用 SessionStore：

```typescript
private async maybeConsolidateMemory(): Promise<void> {
  try {
    if (!this.sessionId || !this.sessionStore) {
      return;
    }

    const session = await this.sessionStore.get(this.sessionId);
    if (!session || session.messages.length === 0) {
      return;
    }

    const unconsolidated = session.messages.slice(session.lastConsolidated);

    // 简单的 token 估算
    const estimateTokens = (msgs: ChatMessage[]): number => {
      let totalChars = 0;
      for (const msg of msgs) {
        if (typeof msg.content === 'string') {
          totalChars += msg.content.length;
        }
      }
      return Math.round(totalChars / 2);
    };

    const currentTokens = estimateTokens(unconsolidated);

    log(`[DeepPDF] Memory 状态: ${currentTokens} tokens (阈值: ${DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold})`);

    if (currentTokens < DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold) {
      return;
    }

    log(`[DeepPDF] ✅ Memory 整合触发: ${currentTokens} tokens`);

    // 获取会话锁
    await this.sessionStore.acquireLock(this.sessionId);

    try {
      const store = new MemoryStore(this.app);
      const consolidator = new MemoryConsolidator(
        store,
        this.frontendAgent?.getLLMClient() as any,
        DEFAULT_CONSOLIDATOR_CONFIG
      );

      const newIndex = await consolidator.maybeConsolidate(
        unconsolidated,
        session.lastConsolidated,
        (newIdx) => {
          this.sessionStore!.updateLastConsolidated(this.sessionId!, newIdx);
          log(`[DeepPDF] lastConsolidated 更新为 ${newIdx}`);
        }
      );

      if (newIndex > session.lastConsolidated) {
        log(`[DeepPDF] 记忆整合完成: ${session.lastConsolidated} -> ${newIndex}`);
      }
    } finally {
      this.sessionStore.releaseLock(this.sessionId);
    }
  } catch (err) {
    logError('[DeepPDF] 记忆整合失败:', err);
  }
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(session): 更新 maybeConsolidateMemory 使用 SessionStore"
```

---

## Task 13: 清理旧 chatCache 代码

**Files:**
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/views/sidebar-view.ts`
- Modify: `frontend/src/agent/memory/types.ts`

**Step 1: 从 main.ts 移除 chatCache 设置**

在 `DeepPDFSettings` 接口中删除：

```typescript
chatCache?: Record<string, any>;
```

**Step 2: 从 sidebar-view.ts 移除旧 chatCache 引用**

删除所有 `this.plugin.settings.chatCache` 相关代码：
- `restoreHistoryToView` 中从 `chatCache` 恢复的分支
- 所有 `this.plugin.settings.chatCache?.[sessionId]` 引用

**Step 3: 标记 ChatCacheEntry 为废弃**

在 `frontend/src/agent/memory/types.ts` 中：

```typescript
/**
 * @deprecated 使用 SessionStore 替代
 */
export interface ChatCacheEntry {
  // ... 保留但标记废弃
}
```

**Step 4: 验证编译**

Run: `cd frontend && npm run build`
Expected: 无错误

**Step 5: Commit**

```bash
git add frontend/src/main.ts frontend/src/views/sidebar-view.ts frontend/src/agent/memory/types.ts
git commit -m "refactor(session): 清理旧 chatCache 代码"
```

---

## Task 14: 最终验证和提交

**Step 1: 完整构建测试**

Run: `cd frontend && npm run build`
Expected: 构建成功，无错误

**Step 2: 功能测试清单**

手动测试：
- [ ] 创建新会话
- [ ] 发送消息并保存
- [ ] 切换书籍后恢复历史
- [ ] 重启插件后恢复历史
- [ ] 跨书籍模式切换
- [ ] 触发记忆整合

**Step 3: 最终提交**

```bash
git add -A
git commit -m "feat(session): 完成 Session Storage 重设计

- 创建 SessionStore 类管理 JSONL 文件存储
- 实现追加写入、懒加载、会话锁机制
- 区分 UI 历史加载（全部）和 LLM 历史加载（unconsolidated）
- 移除旧 chatCache 代码

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 实现总结

| Task | 描述 | 文件 |
|------|------|------|
| 1 | 类型定义 | `session/types.ts` |
| 2 | 类骨架 | `session/store.ts` |
| 3 | 创建/保存 | `session/store.ts` |
| 4 | 索引管理 | `session/store.ts` |
| 5 | 消息追加 | `session/store.ts` |
| 6 | 会话加载 | `session/store.ts` |
| 7 | 会话查找 | `session/store.ts` |
| 8 | 并发锁 | `session/store.ts` |
| 9 | 模块导出 | `session/index.ts` |
| 10 | 集成保存 | `sidebar-view.ts` |
| 11 | 集成恢复 | `sidebar-view.ts` |
| 12 | 集成整合 | `sidebar-view.ts` |
| 13 | 清理旧代码 | 多文件 |
| 14 | 最终验证 | - |
