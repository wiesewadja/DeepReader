# 前后端解耦实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现前端插件完全独立于后端服务，后端作为可选增强功能

**Architecture:** 移除启动时的阻塞式连接检查，改为异步状态管理。添加连接状态指示器，后端依赖功能在未连接时降级或提示。前端 Agent 完全独立运行，后端提供增强工具。

**Tech Stack:** TypeScript, Obsidian Plugin API, FastAPI backend

---

## Task 1: 移除启动阻塞 - main.ts

**Files:**
- Modify: `frontend/src/main.ts:428-449`

**Step 1: 修改 checkServerConnection 为非阻塞**

当前代码（第 428-449 行）：
```typescript
private async checkServerConnection(): Promise<void> {
    // 使用短暂超时，避免阻塞
    const timeout = 3000; // 3 秒超时

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const isHealthy = await this.apiClient!.healthCheck();
        clearTimeout(timeoutId);

        if (!isHealthy) {
            log('Server not running or unhealthy at localhost:' + this.settings.apiPort);
            new Notice(`DeepPDF: 后端服务未响应 (localhost:${this.settings.apiPort})。部分功能不可用。`);
        } else {
            log('Server connected successfully');
        }
    } catch (err) {
        warn('Failed to connect to server:', err);
        new Notice(`DeepPDF: 后端未连接 (localhost:${this.settings.apiPort})。请启动后端服务以使用完整功能。`);
    }
}
```

修改为：
```typescript
private checkServerConnection(): void {
    // 异步检查，不阻塞插件加载
    this.apiClient!.healthCheck()
        .then(isHealthy => {
            if (!isHealthy) {
                log('Server not running or unhealthy at localhost:' + this.settings.apiPort);
                new Notice(`DeepPDF: 后端服务未响应 (localhost:${this.settings.apiPort})。部分功能不可用。`);
            } else {
                log('Server connected successfully');
            }
        })
        .catch(err => {
            warn('Failed to connect to server:', err);
            // 降低提示级别，因为后端是可选的
            log(`DeepPDF: 后端未连接 (localhost:${this.settings.apiPort})。部分功能需要后端支持。`);
        });
}
```

**Step 2: 移除 onload 中的 await**

当前代码（第 65 行）：
```typescript
// 异步检查服务器连接状态（不阻塞插件加载）
this.checkServerConnection();
```

保持不变（已经是非阻塞的）。

**Step 3: 验证插件启动**

测试步骤：
1. 确保后端未运行
2. 在 Obsidian 中重新加载插件（Cmd+R）
3. 验证：插件正常加载，没有卡顿

**Step 4: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat: 移除启动时的阻塞式连接检查

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 移除全屏未连接提示 - sidebar-view.ts

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts:707-713`
- Modify: `frontend/src/views/sidebar-view.ts:729-746`

**Step 1: 修改 checkConnectionAndRender 逻辑**

当前代码（第 707-713 行）：
```typescript
if (connected) {
    // 连接成功，渲染主界面
    this.renderMainUI(container);
} else {
    // 未连接，显示全屏提示
    this.showDisconnectedUI(container);
}
```

修改为：
```typescript
// 无论是否连接，都渲染主界面
this.renderMainUI(container);

// 更新连接状态
this.isConnected = connected;
this.readingTopbar?.setConnectionStatus(connected ? 'connected' : 'disconnected');
```

**Step 2: 删除 showDisconnectedUI 方法**

删除第 729-746 行的 `showDisconnectedUI` 方法。

**Step 3: 删除 showConnectingUI 方法**

删除第 719-726 行的 `showConnectingUI` 方法。

**Step 4: 修改 onOpen 方法**

找到 `onOpen` 方法中调用 `checkConnectionAndRender` 的地方，确保它不会阻塞。

当前应该是：
```typescript
async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    await this.checkConnectionAndRender(container as HTMLElement);
}
```

修改为：
```typescript
async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();

    // 直接渲染主 UI
    this.renderMainUI(container as HTMLElement);

    // 异步检查连接状态
    this.checkConnectionAndRender(container as HTMLElement);
}
```

**Step 5: 验证侧边栏打开**

测试步骤：
1. 确保后端未运行
2. 打开 DeepReader 侧边栏
3. 验证：侧边栏正常打开，显示主界面（而不是全屏提示）

**Step 6: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 移除全屏未连接提示，始终渲染主界面

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 添加连接状态类型定义

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts:88`

**Step 1: 添加连接状态枚举**

在第 88 行附近，将：
```typescript
private isConnected: boolean = false;  // 后端连接状态
```

修改为：
```typescript
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
private connectionStatus: ConnectionStatus = 'connecting';  // 后端连接状态
// 保留 isConnected 用于向后兼容
private get isConnected(): boolean {
    return this.connectionStatus === 'connected';
}
```

**Step 2: 更新所有 connectionStatus 赋值**

搜索所有 `this.isConnected =` 的赋值，改为使用 `this.connectionStatus =`。

例如：
- `this.isConnected = true` → `this.connectionStatus = 'connected'`
- `this.isConnected = false` → `this.connectionStatus = 'disconnected'`

**Step 3: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 添加连接状态枚举类型

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 添加状态指示器样式

**Files:**
- Modify: `frontend/src/styles.css`

**Step 1: 添加状态指示器样式**

在 `styles.css` 末尾添加：
```css
/* 连接状态指示器 */
.deeppdf-connection-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    cursor: help;
    transition: all 0.2s ease;
}

.deeppdf-connection-status--connected {
    background: rgba(76, 175, 80, 0.15);
    color: #4caf50;
}

.deeppdf-connection-status--disconnected {
    background: rgba(244, 67, 54, 0.15);
    color: #f44336;
}

.deeppdf-connection-status--connecting {
    background: rgba(255, 152, 0, 0.15);
    color: #ff9800;
}

.deeppdf-connection-status__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
}

.deeppdf-connection-status--connected .deeppdf-connection-status__dot {
    background: #4caf50;
}

.deeppdf-connection-status--disconnected .deeppdf-connection-status__dot {
    background: #f44336;
}

.deeppdf-connection-status--connecting .deeppdf-connection-status__dot {
    background: #ff9800;
    animation: pulse 1.5s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* 禁用按钮样式 */
.deeppdf-btn--disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
}

.deeppdf-btn--disabled:hover {
    opacity: 0.5;
}
```

**Step 2: Commit**

```bash
git add frontend/src/styles.css
git commit -m "style: 添加连接状态指示器和禁用按钮样式

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: ReadingTopbar 添加状态指示器

**Files:**
- Modify: `frontend/src/components/reading-topbar/reading-topbar.ts`

**Step 1: 添加 setConnectionStatus 方法**

在 `ReadingTopbar` 类中添加：
```typescript
setConnectionStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
    // 查找或创建状态指示器元素
    let statusEl = this.containerEl.querySelector('.deeppdf-connection-status');

    if (!statusEl) {
        statusEl = this.containerEl.createDiv({
            cls: `deeppdf-connection-status deeppdf-connection-status--${status}`
        });
    }

    // 更新类名
    statusEl.className = `deeppdf-connection-status deeppdf-connection-status--${status}`;

    // 更新内容
    const labels = {
        connected: '已连接',
        disconnected: '未连接',
        connecting: '连接中'
    };

    statusEl.empty();
    statusEl.createSpan({ cls: 'deeppdf-connection-status__dot' });
    statusEl.createSpan({ text: labels[status] });

    // 添加 tooltip
    const tooltips = {
        connected: '后端已连接，所有功能可用',
        disconnected: '后端未连接，部分功能不可用',
        connecting: '正在连接后端服务...'
    };
    statusEl.setAttribute('aria-label', tooltips[status]);
}
```

**Step 2: 在 render 方法中初始化状态**

在 `render()` 方法的末尾添加：
```typescript
// 初始化连接状态（默认为 connecting）
this.setConnectionStatus('connecting');
```

**Step 3: Commit**

```bash
git add frontend/src/components/reading-topbar/reading-topbar.ts
git commit -m "feat: ReadingTopbar 添加连接状态指示器

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: 移除硬性拦截 - handleNewChat

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts:247-251`

**Step 1: 移除连接检查**

当前代码：
```typescript
private handleNewChat() {
    if (!this.isConnected) {
        new Notice("后端未连接，请先启动后端服务");
        return;
    }
    // ...
}
```

修改为：
```typescript
private handleNewChat() {
    // 不再检查连接状态，允许用户在未连接时创建新会话
    // ...
}
```

**Step 2: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 移除新建会话的连接状态检查

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: 移除硬性拦截 - toggleSearchMode

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts:1221-1224`

**Step 1: 移除连接检查**

当前代码：
```typescript
private async toggleSearchMode() {
    // 检查后端连接状态
    if (!this.isConnected) {
        new Notice("后端未连接，请先启动后端服务");
        return;
    }
    // ...
}
```

修改为：
```typescript
private async toggleSearchMode() {
    // 跨书籍搜索需要后端支持
    if (!this.isConnected) {
        new Notice("跨书籍搜索需要后端服务。请启动后端以使用此功能。");
        return;
    }
    // ...
}
```

注意：跨书籍搜索确实需要后端，所以保留检查。

**Step 2: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 保留跨书籍搜索的连接检查（确实需要后端）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: 优化消息发送逻辑

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts:1354-1370`

**Step 1: 移除发送消息前的连接检查**

当前代码（第 1354-1370 行）：
```typescript
// 实时检查后端连接状态（不依赖缓存的 isConnected）
try {
    const isHealthy = await this.apiClient?.healthCheck();
    if (!isHealthy) {
        this.isConnected = false;
        this.indexManager?.setConnectionStatus('disconnected');
        new Notice("后端未连接，请先连接后端服务");
        return;
    }
} catch (e) {
    this.isConnected = false;
    this.indexManager?.setConnectionStatus('error');
    new Notice("后端连接失败，请检查后端服务");
    return;
}
```

修改为：
```typescript
// 不再在发送消息前检查连接状态
// 前端 Agent 可以在无后端的情况下工作
```

**Step 2: 在 Agent 系统提示中注入连接状态**

找到调用 Agent 的地方，在系统提示中添加连接状态信息。

例如，在 `handleSendMessage` 方法中，构建系统提示时：
```typescript
const systemPrompt = this.buildSystemPrompt();

// 如果后端未连接，添加提示
if (!this.isConnected) {
    systemPrompt += "\n\n注意：后端服务未连接。你只能使用基础工具，无法访问 PDF 索引、搜索文档等功能。请告知用户连接后端可获得更好的上下文支持。";
}
```

**Step 3: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 移除发送消息前的连接检查，Agent 支持离线模式

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: 索引操作添加弹窗提示

**Files:**
- Modify: `frontend/src/components/index-manager/index-manager.ts`

**Step 1: 添加连接状态检查方法**

在 `IndexManager` 类中添加：
```typescript
private checkConnectionAndAlert(): boolean {
    if (!this.plugin?.apiClient) {
        return false;
    }

    // 这里需要从 SidebarView 获取连接状态
    // 暂时使用简单的健康检查
    return true;
}

private showDisconnectedAlert(): void {
    const modal = new ConfirmModal(
        this.app,
        "需要后端服务",
        "此功能需要连接后端服务才能使用。\n\n请启动后端：\n```bash\nuv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio\n```",
        "知道了",
        () => {}
    );
    modal.open();
}
```

**Step 2: 在索引按钮点击时检查**

找到"索引 PDF"按钮的点击处理函数，添加检查：
```typescript
onClick: async () => {
    if (!this.checkConnectionAndAlert()) {
        this.showDisconnectedAlert();
        return;
    }
    // 原有的索引逻辑
}
```

**Step 3: Commit**

```bash
git add frontend/src/components/index-manager/index-manager.ts
git commit -m "feat: 索引操作添加后端连接检查和弹窗提示

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: 更新健康检查逻辑

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts:2412-2476`

**Step 1: 优化 startHealthCheck 方法**

当前的健康检查逻辑基本正确，但需要确保状态更新时通知 ReadingTopbar。

修改第 2427 行附近：
```typescript
if (isHealthy) {
    this.indexManager.setConnectionStatus('connected');
    this.connectionStatus = 'connected';
    this.chatInput?.setDisabled(false);
}
```

确保调用 ReadingTopbar 的状态更新：
```typescript
if (isHealthy) {
    this.connectionStatus = 'connected';
    this.readingTopbar?.setConnectionStatus('connected');
    this.indexManager?.setConnectionStatus('connected');
    this.chatInput?.setDisabled(false);
} else {
    this.connectionStatus = 'disconnected';
    this.readingTopbar?.setConnectionStatus('disconnected');
    this.indexManager?.setConnectionStatus('disconnected');
}
```

**Step 2: 同样更新第 2453-2474 行的逻辑**

确保所有状态更新都调用 `readingTopbar?.setConnectionStatus()`。

**Step 3: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 健康检查时更新 ReadingTopbar 状态

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: ChatInput 输入框始终可用

**Files:**
- Modify: `frontend/src/components/chat-input/chat-input.ts`

**Step 1: 移除 setDisabled 中的连接检查**

找到 `setDisabled` 方法，确保它不会因为连接状态而禁用输入框。

如果当前有类似这样的逻辑：
```typescript
setDisabled(disabled: boolean) {
    if (this.plugin && !this.plugin.isConnected) {
        disabled = true;
    }
    // ...
}
```

修改为：
```typescript
setDisabled(disabled: boolean) {
    // 输入框始终可用，不再检查连接状态
    // ...
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/chat-input/chat-input.ts
git commit -m "feat: ChatInput 输入框始终可用，不受连接状态影响

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Agent 系统提示注入连接状态

**Files:**
- Modify: `frontend/src/agent/agent-loop.ts`

**Step 1: 添加连接状态参数**

找到 Agent 的初始化或执行方法，添加连接状态参数。

例如，在 `run` 方法中：
```typescript
async run(
    userMessage: string,
    context: ToolContext,
    connectionStatus: 'connected' | 'disconnected' = 'connected'
): Promise<AgentResponse> {
    // 构建系统提示
    let systemPrompt = this.buildSystemPrompt();

    // 注入连接状态信息
    if (connectionStatus === 'disconnected') {
        systemPrompt += `

## 当前状态

⚠️ **后端服务未连接**

你当前运行在基础模式下，只能使用以下工具：
- 基础对话能力
- 用户手动提供的上下文

以下工具不可用：
- search_doc（搜索 PDF 文档）
- get_chapter（获取章节内容）
- get_toc（获取目录）

如果用户的问题需要这些工具，请礼貌地告知用户需要连接后端服务，并说明连接后可以获得更好的回答质量。`;
    }

    // ...
}
```

**Step 2: 在 SidebarView 调用时传递连接状态**

找到调用 Agent 的地方（在 `sidebar-view.ts` 中），传递连接状态：
```typescript
const response = await this.frontendAgent.run(
    userMessage,
    toolContext,
    this.connectionStatus
);
```

**Step 3: Commit**

```bash
git add frontend/src/agent/agent-loop.ts frontend/src/views/sidebar-view.ts
git commit -m "feat: Agent 系统提示注入连接状态，支持离线模式

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 13: 综合测试

**Files:**
- None (manual testing)

**Step 1: 测试后端未启动场景**

1. 确保后端未运行
2. 重新加载 Obsidian 插件
3. 打开 DeepReader 侧边栏
4. 验证：
   - [ ] 插件正常加载，无卡顿
   - [ ] 侧边栏正常打开，显示主界面
   - [ ] 顶部显示"未连接"状态指示器（红色）
   - [ ] 输入框可以输入文字
   - [ ] 发送消息后，Agent 可以回复（带有"基础模式"提示）
   - [ ] 点击"索引 PDF"按钮时，显示弹窗提示

**Step 2: 测试后端启动场景**

1. 启动后端服务
2. 等待 30 秒（健康检查周期）
3. 验证：
   - [ ] 状态指示器自动变为"已连接"（绿色）
   - [ ] 所有功能正常可用
   - [ ] 发送消息时，Agent 可以使用所有工具

**Step 3: 测试后端断开场景**

1. 关闭后端服务
2. 等待 30 秒
3. 验证：
   - [ ] 状态指示器自动变为"未连接"（红色）
   - [ ] 后续操作有合适的降级处理

**Step 4: 创建测试报告**

创建文件 `docs/test-report-2026-03-09.md`：
```markdown
# 前后端解耦功能测试报告

**测试日期**: 2026-03-09
**测试人员**: [你的名字]

## 测试结果

### 后端未启动场景
- [ ] 插件正常加载
- [ ] 侧边栏正常打开
- [ ] 状态指示器显示"未连接"
- [ ] 输入框可用
- [ ] Agent 离线对话正常
- [ ] 索引按钮弹窗提示

### 后端启动场景
- [ ] 状态自动更新
- [ ] 所有功能可用

### 后端断开场景
- [ ] 状态自动更新
- [ ] 降级处理正常

## 问题记录

[记录任何发现的问题]
```

**Step 5: Commit 测试报告**

```bash
git add docs/test-report-2026-03-09.md
git commit -m "docs: 添加前后端解耦功能测试报告

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 14: 更新文档

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Step 1: 更新 README.md**

在 README 中添加关于前后端解耦的说明：
```markdown
## 使用方式

### 基础模式（无需后端）

DeepReader 插件可以独立运行，无需后端服务。在基础模式下，你可以：

- 与 AI 助手对话
- 手动提供上下文进行问答
- 使用基本的笔记功能

### 完整模式（需要后端）

启动后端服务后，你将获得以下增强功能：

- PDF/EPUB 自动索引
- 智能文档搜索
- 章节内容获取
- 跨书籍搜索

启动后端：
\`\`\`bash
cd backend/deeppdf-api
uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio
\`\`\`

### 连接状态指示

插件顶部会显示连接状态：
- 🟢 **已连接**：所有功能可用
- 🔴 **未连接**：仅基础功能可用
- 🔄 **连接中**：正在检查后端状态
```

**Step 2: 更新 CLAUDE.md**

在 `CLAUDE.md` 中添加架构说明：
```markdown
## 架构说明

### 前后端解耦

DeepReader 采用前后端解耦架构：

- **前端（Obsidian 插件）**：完全独立，可以正常加载和运行
- **后端（FastAPI）**：可选的增强服务，提供 PDF 索引、文档搜索等功能
- **前端 Agent**：独立使用 LLM API，后端未连接时仍可工作

### 连接状态管理

- 状态类型：`connected | disconnected | connecting`
- 状态指示器：ReadingTopbar 右侧显示
- 健康检查：每 30 秒自动检查后端状态
```

**Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: 更新文档，说明前后端解耦架构

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 15: 最终提交和清理

**Step 1: 运行前端构建**

```bash
cd frontend
npm run build
```

确保构建成功，无类型错误。

**Step 2: 运行前端测试**

```bash
cd frontend
npm run test:run
```

确保所有测试通过。

**Step 3: 检查代码格式**

```bash
cd frontend
npm run format
```

**Step 4: 最终 commit**

```bash
git add .
git commit -m "chore: 代码格式化和最终清理

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 5: 创建 PR 或合并到主分支**

根据项目流程，创建 PR 或直接合并到 `main` 分支。

---

## 总结

本实施计划包含 15 个任务，涵盖了：

1. **启动流程解耦**（Task 1-2）
2. **状态管理**（Task 3）
3. **UI 组件改造**（Task 4-5）
4. **交互逻辑优化**（Task 6-12）
5. **测试和文档**（Task 13-15）

每个任务都是独立的、可测试的单元，遵循 TDD 原则和频繁提交的最佳实践。
