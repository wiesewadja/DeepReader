# BookDomain ↔ SessionDomain 双向委托解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 BookDomain 对 SessionDomain 的 delegates 依赖，将"切换书籍时创建/恢复会话"的协调逻辑上移到 SidebarView（Orchestrator 层），使依赖方向变为 SidebarView → BookDomain → SessionDomain（单向）。

**Architecture:** BookDomain 只关心书籍/索引管理，发布 `book:changed` 事件。SidebarView 监听事件后调用 SessionDomain 的方法完成会话协调。BookDomain 不再持有任何 SessionDomain 的 delegates。

**Tech Stack:** TypeScript, EventBus (typed pub/sub), Obsidian Plugin API

## Global Constraints

- 不使用前端框架（React/Vue/Svelte），全部原生 DOM API
- 所有 Vault 文件操作通过 `app.vault.adapter` 或 `app.vault` API
- 统一日志使用 `src/utils/logger.ts`
- 业务代码禁止静态 `import` Node 核心模块
- 测试必须分模块执行，先评估影响范围

## 当前耦合分析

### BookDomain 调用 SessionDomain 的 14 处

| 方法 | 调用次数 | 位置 |
|------|---------|------|
| `startNewSession(indexId)` | 5 | selectIndex, selectBooklist |
| `restoreFromSessionStore(sessionId)` | 1 | selectIndex |
| `getSessionId()` / `setSessionId()` | 3 | selectIndex, clearBooklist |
| `getSessionStore()` | 1 | selectIndex |
| `ensureSessionStore()` | 1 | selectIndex |
| `cancelActiveStream()` | 4 | selectIndex, restoreBooklist, selectBooklist, clearBooklist |

### 核心问题

`BookDomain.selectIndex()` 方法（L495-557）承担了大量会话编排逻辑：
1. 取消活跃流
2. 查找保存的会话
3. 确保会话存储存在
4. 检查会话是否匹配当前书籍
5. 启动新会话或从存储恢复
6. 发射 book:changed 事件

这些逻辑应由 SidebarView（Orchestrator）协调，而非 BookDomain 直接操作。

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/views/sidebar/domains/book-domain.ts` | 书籍/索引管理 | 修改：移除 SessionDomain delegates，简化 selectIndex |
| `src/views/sidebar/domains/session-domain.ts` | 会话生命周期管理 | 修改：新增 handleBookChanged 方法 |
| `src/views/sidebar/sidebar-view.ts` | Orchestrator：lifecycle + wiring | 修改：监听 book:changed 并协调会话 |
| `src/views/sidebar/events.ts` | 事件类型定义 | 可能修改：扩展 book:changed 事件 |
| `tests/unit/views/sidebar/book-domain.test.ts` | BookDomain 单元测试 | 修改：移除 SessionDomain mock |

---

## Task 1: 分析并记录需要迁移的逻辑

**Covers:** 分析当前耦合点

**Files:**
- Read: `src/views/sidebar/domains/book-domain.ts:495-557`
- Read: `src/views/sidebar/domains/book-domain.ts:819-868`
- Read: `src/views/sidebar/sidebar-view.ts:151-218`

**Interfaces:**
- Consumes: BookDomain.selectIndex, BookDomain.selectBooklist, BookDomain.clearBooklist
- Produces: 逻辑迁移清单

- [ ] **Step 1: 读取 selectIndex 方法的会话编排逻辑**

读取 `book-domain.ts:495-557`，识别所有需要迁移到 SidebarView 的逻辑：
- `this.options.cancelActiveStream()` → 迁移到 SidebarView
- `this.options.ensureSessionStore()` → 迁移到 SidebarView
- `this.options.getSessionStore()` → 迁移到 SidebarView
- `this.options.startNewSession()` → 迁移到 SidebarView
- `this.options.restoreFromSessionStore()` → 迁移到 SidebarView
- `this.options.setSessionId()` → 迁移到 SidebarView

- [ ] **Step 2: 读取 selectBooklist 和 clearBooklist 方法**

确认这两个方法的委托调用：
- selectBooklist: `cancelActiveStream()` + `startNewSession()`
- clearBooklist: `cancelActiveStream()` + `setSessionId(null)`

- [ ] **Step 3: 记录迁移清单**

确认需要迁移的逻辑：
1. 会话取消（cancelActiveStream）
2. 会话存储访问（ensureSessionStore, getSessionStore）
3. 会话创建/恢复（startNewSession, restoreFromSessionStore）
4. 会话 ID 管理（getSessionId, setSessionId）

---

## Task 2: 简化 BookDomain — 移除 SessionDomain delegates

**Covers:** BookDomain 解耦

**Files:**
- Modify: `src/views/sidebar/domains/book-domain.ts:30-43`
- Modify: `src/views/sidebar/domains/book-domain.ts:495-557`
- Modify: `src/views/sidebar/domains/book-domain.ts:819-868`

**Interfaces:**
- Consumes: 无
- Produces: 简化的 BookDomain（无 SessionDomain 依赖）

- [ ] **Step 1: 修改 BookDomainOptions 接口**

移除所有 SessionDomain delegates：

```typescript
// Before
export interface BookDomainOptions {
  app: App;
  plugin: DeepReaderPluginInterface;
  eventBus: EventBus<SidebarEventMap>;
  
  // Delegations
  startNewSession(indexId: string): Promise<void>;
  restoreFromSessionStore(sessionId: string): Promise<boolean>;
  getSessionId(): string | null;
  setSessionId(id: string | null): void;
  getSessionStore(): any;
  ensureSessionStore(): Promise<void>;
  cancelActiveStream(): void;
}

// After
export interface BookDomainOptions {
  app: App;
  plugin: DeepReaderPluginInterface;
  eventBus: EventBus<SidebarEventMap>;
}
```

- [ ] **Step 2: 简化 selectIndex 方法**

将 `selectIndex` 中的会话编排逻辑替换为仅发射事件：

```typescript
async selectIndex(indexId: string): Promise<void> {
  // ... 前面的书籍加载逻辑保持不变 ...
  
  // 移除会话编排逻辑，改为发射事件
  // SidebarView 将监听此事件并协调会话
  this.emitChanged(true);
}
```

具体移除的代码块（L495-557）：
- `this.options.cancelActiveStream()` → 移除
- `this.options.ensureSessionStore()` → 移除
- `this.options.getSessionStore()` → 移除
- `this.options.startNewSession()` → 移除
- `this.options.setSessionId()` → 移除
- `this.options.restoreFromSessionStore()` → 移除

- [ ] **Step 3: 简化 selectBooklist 方法**

移除 `selectBooklist` 中的会话编排逻辑（L849-851）：

```typescript
async selectBooklist(booklist: Booklist): Promise<void> {
  // ... 书籍状态设置保持不变 ...
  
  // 移除: this.options.cancelActiveStream();
  // 移除: await this.options.startNewSession(booklist.id);
  
  this.emitChanged(true);
}
```

- [ ] **Step 4: 简化 clearBooklist 方法**

移除 `clearBooklist` 中的会话编排逻辑（L857, L866）：

```typescript
clearBooklist(): void {
  if (!this._currentBooklist) return;
  
  // 移除: this.options.cancelActiveStream();
  this._currentBooklist = null;
  // ... 其他状态清理 ...
  
  // 移除: this.options.setSessionId(null);
  this.emitChanged(true);
}
```

- [ ] **Step 5: 简化 restoreBooklist 方法**

移除 `restoreBooklist` 中的会话编排逻辑（L744）：

```typescript
restoreBooklist(booklist: Booklist): void {
  // ... 状态设置保持不变 ...
  
  // 移除: this.options.cancelActiveStream();
  this.emitChanged(true);
  this.loadAndApplyBooklistCovers(booklist);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/views/sidebar/domains/book-domain.ts
git commit -m "refactor(book-domain): remove SessionDomain delegates from BookDomainOptions"
```

---

## Task 3: 更新 SidebarView — 添加会话协调逻辑

**Covers:** SidebarView Orchestrator 职责

**Files:**
- Modify: `src/views/sidebar/sidebar-view.ts:71-139`
- Modify: `src/views/sidebar/sidebar-view.ts:151-218`

**Interfaces:**
- Consumes: 简化的 BookDomain, SessionDomain
- Produces: SidebarView 监听 book:changed 并协调会话

- [ ] **Step 1: 修改 BookDomain 构造函数调用**

移除所有 SessionDomain delegates：

```typescript
// Before
this.bookDomain = new BookDomain({
  app: this.app,
  plugin: this.plugin,
  eventBus: this.eventBus,
  startNewSession: (indexId) => self.sessionDomain?.startNewSession(indexId) ?? Promise.resolve(),
  restoreFromSessionStore: (sessionId) => self.sessionDomain?.restoreSession(sessionId) ?? Promise.resolve(false),
  getSessionId: () => self.sessionDomain?.sessionId ?? null,
  setSessionId: (id) => { if (self.sessionDomain) self.sessionDomain.sessionId = id; },
  getSessionStore: () => self.sessionDomain?.sessionStore ?? null,
  ensureSessionStore: () => self.sessionDomain?.ensureSessionStore() ?? Promise.resolve(),
  cancelActiveStream: () => self.sessionDomain?.cancelStream(),
});

// After
this.bookDomain = new BookDomain({
  app: this.app,
  plugin: this.plugin,
  eventBus: this.eventBus,
});
```

- [ ] **Step 2: 添加 book:changed 事件监听**

在 `renderMainUI` 方法中，创建 SessionDomain 后添加事件监听：

```typescript
// 在 renderMainUI 中，sessionDomain 创建后添加
this.eventBus.on("book:changed", async (event) => {
  await this.handleBookChanged(event);
});
```

- [ ] **Step 3: 实现 handleBookChanged 方法**

添加新的私有方法处理会话协调：

```typescript
private async handleBookChanged(event: BookChangedEvent): Promise<void> {
  if (!this.sessionDomain) return;
  
  // 取消活跃流
  if (this.sessionDomain.currentStreamController) {
    this.sessionDomain.cancelStream();
  }
  
  // 如果是跨书籍模式，创建新会话
  if (event.currentBooklist) {
    await this.sessionDomain.startNewSession(event.currentBooklist.id);
    return;
  }
  
  // 单书籍模式：查找保存的会话
  if (event.indexId) {
    const savedSessions = this.plugin.settings.savedSessions || {};
    const normalizedBookName = (event.pdfName || "")
      .replace(/\.pdf$/i, "")
      .replace(/\.epub$/i, "") || event.indexId;
    const savedSessionId = savedSessions[normalizedBookName] || savedSessions[event.indexId];
    
    if (savedSessionId) {
      // 尝试恢复会话
      await this.sessionDomain.ensureSessionStore();
      const restored = await this.sessionDomain.restoreSession(savedSessionId);
      if (restored) {
        this.sessionDomain.sessionId = savedSessionId;
        return;
      }
    }
    
    // 无保存会话或恢复失败，创建新会话
    await this.sessionDomain.startNewSession(event.indexId);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/views/sidebar/sidebar-view.ts
git commit -m "refactor(sidebar-view): add session coordination in book:changed handler"
```

---

## Task 4: 更新 SessionDomain — 添加 ensureSessionStore 公共方法

**Covers:** SessionDomain 接口扩展

**Files:**
- Modify: `src/views/sidebar/domains/session-domain.ts`

**Interfaces:**
- Consumes: 无
- Produces: SessionDomain.ensureSessionStore 公共方法

- [ ] **Step 1: 检查 ensureSessionStore 是否已存在**

读取 `session-domain.ts` 确认 `ensureSessionStore` 方法的可见性。

- [ ] **Step 2: 如果是私有方法，改为公共方法**

```typescript
// 如果 ensureSessionStore 是私有方法，改为公共
async ensureSessionStore(): Promise<void> {
  // ... 现有实现 ...
}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/sidebar/domains/session-domain.ts
git commit -m "refactor(session-domain): expose ensureSessionStore as public method"
```

---

## Task 5: 更新测试 — 移除 SessionDomain mock

**Covers:** 测试更新

**Files:**
- Modify: `tests/unit/views/sidebar/book-domain.test.ts`

**Interfaces:**
- Consumes: 简化的 BookDomain
- Produces: 更新的测试用例

- [ ] **Step 1: 读取当前测试**

读取 `book-domain.test.ts` 了解当前 mock 结构。

- [ ] **Step 2: 移除 SessionDomain 相关 mock**

移除所有 `startNewSession`, `restoreFromSessionStore`, `getSessionId` 等 mock。

- [ ] **Step 3: 更新测试断言**

确认测试仍然通过，验证 BookDomain 不再依赖 SessionDomain。

- [ ] **Step 4: 运行测试验证**

```bash
npm run test:run -- tests/unit/views/sidebar/book-domain.test.ts
```

预期：测试通过

- [ ] **Step 5: Commit**

```bash
git add tests/unit/views/sidebar/book-domain.test.ts
git commit -m "test(book-domain): remove SessionDomain mocks after decoupling"
```

---

## Task 6: 端到端验证

**Covers:** 完整功能验证

**Files:**
- 无文件修改

**Interfaces:**
- Consumes: 完整的 SidebarView
- Produces: 功能验证通过

- [ ] **Step 1: 构建项目**

```bash
npm run build
```

预期：构建成功

- [ ] **Step 2: 运行全量测试**

```bash
npm run test:run
```

预期：所有测试通过

- [ ] **Step 3: 部署到测试环境**

```bash
npm run deploy
```

- [ ] **Step 4: 手动验证**

在 Obsidian 测试库中验证：
1. 选择书籍 → 会话正确创建/恢复
2. 切换书籍 → 会话正确切换
3. 退出书单 → 会话正确清理
4. 重新进入历史书单 → 会话正确恢复

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "refactor(sidebar): complete BookDomain-SessionDomain decoupling

- Remove SessionDomain delegates from BookDomainOptions
- Move session coordination logic to SidebarView
- BookDomain now only publishes book:changed events
- SidebarView listens and coordinates session lifecycle
- Dependency direction: SidebarView → BookDomain → SessionDomain (unidirectional)"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ BookDomain 不再持有 SessionDomain delegates
- ✅ SidebarView 监听 book:changed 并协调会话
- ✅ 依赖方向变为单向

**2. Placeholder scan:** 无 TBD/TODO

**3. Type consistency:**
- BookChangedEvent 包含 indexId, pdfName, currentBooklist
- SessionDomain 接口保持不变
- SidebarView.handleBookChanged 使用正确的事件类型
