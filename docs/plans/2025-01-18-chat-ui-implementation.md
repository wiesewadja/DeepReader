# DeepPDF 对话式搜索界面实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 DeepPDF 前端重构为对话式搜索界面，支持实时索引进度展示和抽屉面板管理。

**Architecture:**
- 侧边栏主界面：对话式搜索界面（类似 ChatGPT）
- 抽屉面板：索引管理（从右侧滑入/滑出）
- 组件化架构：事件驱动的组件间通信
- 本地存储：会话历史持久化

**Tech Stack:**
- TypeScript + Obsidian Plugin API
- CSS 变量（适配 Obsidian 主题）
- Markdown 渲染（Obsidian 内置）
- Event Emitter 模式（组件通信）

---

## 前置准备

### Task 0: 创建必要的目录结构

**Files:**
- Create: `frontend/src/components/`
- Create: `frontend/src/components/drawer/`
- Create: `frontend/src/components/chat/`
- Create: `frontend/src/components/header/`
- Create: `frontend/src/types/`
- Create: `frontend/src/utils/`

**Step 1: 创建组件目录结构**

Run:
```bash
cd /Users/lizhao/workspace/DeepPDF/frontend/src
mkdir -p components/drawer components/chat components/header types utils
```

Expected: 目录创建成功

**Step 2: 验证目录结构**

Run:
```bash
ls -la frontend/src/components/
```

Expected: 显示 `drawer/`, `chat/`, `header/` 目录

**Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: 创建组件目录结构"
```

---

## Phase 1: 抽屉面板基础框架

### Task 1: 创建抽屉面板组件

**Files:**
- Create: `frontend/src/components/drawer/drawer.ts`
- Create: `frontend/src/components/drawer/drawer.css`

**Step 1: 编写抽屉面板测试（手动测试用例描述）**

手动测试场景：
1. 点击"管理索引"按钮，抽屉从右侧滑入
2. 点击遮罩层或关闭按钮，抽屉滑出
3. 抽屉打开时，主界面不可交互（有遮罩）

**Step 2: 创建抽屉面板组件**

```typescript
// frontend/src/components/drawer/drawer.ts
import { Component } from "../component.js";

export interface DrawerOptions {
    position: "left" | "right";
    width: string;
    overlay: boolean;
}

export class Drawer extends Component {
    private isOpen: boolean = false;
    private overlayEl: HTMLElement | null = null;
    private contentEl: HTMLElement | null = null;

    constructor(options: DrawerOptions) {
        super();
        this.options = options;
    }

    render(): HTMLElement {
        // 遮罩层
        this.overlayEl = document.createElement("div");
        this.overlayEl.addClass("deeppdf-drawer-overlay");
        this.overlayEl.onclick = () => this.close();

        // 抽屉内容
        this.contentEl = document.createElement("div");
        this.contentEl.addClass("deeppdf-drawer");
        this.contentEl.addClass(`deeppdf-drawer-${this.options.position}`);
        this.contentEl.style.width = this.options.width;

        const container = document.createElement("div");
        container.addClass("deeppdf-drawer-container");
        container.appendChild(this.overlayEl);
        container.appendChild(this.contentEl);

        this.el = container;
        return this.el;
    }

    open(): void {
        this.isOpen = true;
        this.overlayEl?.addClass("deeppdf-drawer-overlay-open");
        this.contentEl?.addClass("deeppdf-drawer-open");
    }

    close(): void {
        this.isOpen = false;
        this.overlayEl?.removeClass("deeppdf-drawer-overlay-open");
        this.contentEl?.removeClass("deeppdf-drawer-open");
    }

    toggle(): void {
        this.isOpen ? this.close() : this.open();
    }

    setContent(content: HTMLElement | string): void {
        if (!this.contentEl) return;
        this.contentEl.empty();
        if (typeof content === "string") {
            this.contentEl.innerHTML = content;
        } else {
            this.contentEl.appendChild(content);
        }
    }

    getContentEl(): HTMLElement | null {
        return this.contentEl;
    }
}
```

**Step 3: 创建抽屉面板样式**

```css
/* frontend/src/components/drawer/drawer.css */
.deeppdf-drawer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--background-modifier-overlay);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 1000;
}

.deeppdf-drawer-overlay-open {
    opacity: 1;
    pointer-events: auto;
}

.deeppdf-drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    background: var(--background-primary);
    border-left: 1px solid var(--background-modifier-border);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 1001;
    overflow-y: auto;
    padding: 20px;
}

.deeppdf-drawer-right {
    right: 0;
    transform: translateX(100%);
}

.deeppdf-drawer-left {
    left: 0;
    transform: translateX(-100%);
}

.deeppdf-drawer-open {
    transform: translateX(0) !important;
}
```

**Step 4: 更新主样式文件导入**

Edit: `frontend/src/styles/main.css` (在文件末尾添加)
```css
/* 导入抽屉面板样式 */
@import "../components/drawer/drawer.css";
```

**Step 5: Commit**

```bash
git add frontend/src/components/drawer/
git commit -m "feat: 添加抽屉面板组件基础框架"
```

---

### Task 2: 在侧边栏中集成抽屉面板

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 备份当前侧边栏视图**

Run:
```bash
cp frontend/src/views/sidebar-view.ts frontend/src/views/sidebar-view.ts.bak
```

**Step 2: 重构侧边栏视图，添加抽屉面板支持**

Edit: `frontend/src/views/sidebar-view.ts`
```typescript
// 在文件顶部导入
import { Drawer } from "../components/drawer/drawer.js";

// 在 SidebarView 类中添加
private drawer: Drawer | null = null;

// 修改 createHeader 方法，添加管理索引按钮的事件处理
private createHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "deeppdf-header" });

    const headerLeft = header.createDiv({ cls: "deeppdf-header-left" });

    const logo = headerLeft.createDiv({ cls: "deeppdf-logo" });
    logo.innerHTML = Icons.database;

    headerLeft.createEl("h2", { text: "DeepPDF" });

    const headerRight = header.createDiv({ cls: "deeppdf-header-right" });

    // 服务器状态指示器
    this.statusEl = headerRight.createDiv({ cls: "deeppdf-status deeppdf-status-loading" });
    this.statusEl.innerHTML = `<span></span> 检查中...`;

    // 管理索引按钮（改为打开抽屉）
    const manageBtn = headerRight.createEl("button", {
        cls: "deeppdf-btn deeppdf-manage-btn"
    });
    manageBtn.innerHTML = `${Icons.settings} 管理索引`;
    manageBtn.addEventListener("click", () => {
        this.openIndexDrawer();
    });

    // 创建抽屉面板
    this.drawer = new Drawer({
        position: "right",
        width: "400px",
        overlay: true
    });
    this.containerEl.appendChild(this.drawer.render());
}

// 新增：打开索引管理抽屉
private openIndexDrawer() {
    if (!this.drawer) return;

    // 设置抽屉内容
    const drawerContent = this.createIndexManagerContent();
    this.drawer.setContent(drawerContent);
    this.drawer.open();
}

// 新增：创建索引管理内容
private createIndexManagerContent(): HTMLElement {
    const container = document.createElement("div");
    container.addClass("deeppdf-index-manager");

    // 头部
    const header = container.createEl("header");
    header.innerHTML = `
        <div class="deeppdf-drawer-header">
            <h2>📊 索引管理</h2>
            <button class="deeppdf-drawer-close" aria-label="关闭">✕</button>
        </div>
    `;

    // 关闭按钮事件
    const closeBtn = header.querySelector(".deeppdf-drawer-close");
    closeBtn?.addEventListener("click", () => {
        this.drawer?.close();
    });

    // 操作按钮区
    const actions = container.createEl("div", { cls: "deeppdf-drawer-actions" });
    actions.innerHTML = `
        <button class="deeppdf-btn deeppdf-btn-primary">+ 新建索引</button>
        <button class="deeppdf-btn deeppdf-btn-secondary">🔄 刷新</button>
    `;

    // 索引列表容器
    const listContainer = container.createEl("div", { cls: "deeppdf-index-list" });
    listContainer.innerHTML = "<p>加载中...</p>";

    // 加载索引列表
    this.loadIndexesIntoDrawer(listContainer);

    return container;
}

// 新增：加载索引到抽屉
private async loadIndexesIntoDrawer(container: HTMLElement) {
    if (!this.apiClient) {
        container.innerHTML = "<p>未连接到服务器</p>";
        return;
    }

    try {
        const result = await this.apiClient.listIndexes();
        container.empty();

        if (!result.indexes || result.indexes.length === 0) {
            container.innerHTML = "<p>暂无索引</p>";
            return;
        }

        result.indexes.forEach((index: any) => {
            const card = container.createEl("div", { cls: "deeppdf-index-card" });
            card.innerHTML = `
                <div class="deeppdf-index-card-info">
                    <span class="deeppdf-index-card-name">📄 ${index.pdf_name}</span>
                    <span class="deeppdf-index-card-meta">${index.node_count} 节点</span>
                </div>
                <button class="deeppdf-btn deeppdf-btn-sm deeppdf-btn-danger">删除</button>
            `;
        });
    } catch (error) {
        container.innerHTML = `<p>加载失败: ${error}</p>`;
    }
}

// 修改 onClose 方法，清理抽屉
async onClose() {
    // 清理事件监听器
    const submitBtn = this.containerEl.querySelector(".deeppdf-submit-btn");
    const input = this.containerEl.querySelector(".deeppdf-query-input");
    const indexSelect = this.containerEl.querySelector(".deeppdf-index-select");

    if (submitBtn) {
        submitBtn.removeEventListener("click", this.submitHandler);
    }
    if (input) {
        input.removeEventListener("keypress", this.keyPressHandler);
    }
    if (indexSelect) {
        indexSelect.removeEventListener("change", this.indexSelectHandler);
    }

    // 清理抽屉
    if (this.drawer) {
        this.drawer.close();
        this.drawer.el?.remove();
        this.drawer = null;
    }
}
```

**Step 3: 手动测试抽屉功能**

1. 重新加载 Obsidian 插件（Cmd+R）
2. 打开 DeepPDF 侧边栏
3. 点击"管理索引"按钮
4. 验证抽屉从右侧滑入
5. 点击遮罩层或关闭按钮，验证抽屉滑出

**Step 4: Commit**

```bash
git add frontend/src/views/sidebar-view.ts frontend/src/views/sidebar-view.ts.bak
git commit -m "feat: 在侧边栏中集成抽屉面板"
```

---

## Phase 2: 索引任务进度展示

### Task 3: 创建任务进度卡片组件

**Files:**
- Create: `frontend/src/components/task-progress-card.ts`
- Create: `frontend/src/components/task-progress-card.css`

**Step 1: 创建步骤配置常量**

```typescript
// frontend/src/types/index.ts
export interface TaskProgress {
    id: string;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    message: string;
    pdf_name?: string;
    current_step?: string;
    progress_percent?: number;
    total_steps?: number;
    completed_steps?: number;
    error?: string;
}

export const STEP_CONFIG: Record<string, { label: string; icon: string; minPercent: number; maxPercent: number }> = {
    "start": { label: "任务开始", icon: "🚀", minPercent: 0, maxPercent: 5 },
    "init_pageindex": { label: "初始化索引配置", icon: "⚙️", minPercent: 5, maxPercent: 30 },
    "create_llm_client": { label: "连接 LLM 服务", icon: "🔌", minPercent: 30, maxPercent: 40 },
    "parse_pdf": { label: "解析 PDF", icon: "📄", minPercent: 40, maxPercent: 70 },
    "store_chromadb": { label: "存储向量数据", icon: "🗄️", minPercent: 70, maxPercent: 90 },
    "save_metadata": { label: "保存元数据", icon: "💾", minPercent: 90, maxPercent: 95 },
    "completed": { label: "完成", icon: "✅", minPercent: 95, maxPercent: 100 }
};
```

**Step 2: 创建任务进度卡片组件**

```typescript
// frontend/src/components/task-progress-card.ts
import { STEP_CONFIG, TaskProgress } from "../types/index.js";

export class TaskProgressCard {
    private el: HTMLElement;
    private progress: TaskProgress;
    private onCancel?: () => void;

    constructor(progress: TaskProgress, onCancel?: () => void) {
        this.progress = progress;
        this.onCancel = onCancel;
        this.el = this.render();
    }

    private render(): HTMLElement {
        const card = document.createElement("div");
        card.addClass("deeppdf-task-card");

        if (this.progress.status === "failed") {
            card.addClass("deeppdf-task-card-failed");
            this.renderFailedState(card);
        } else if (this.progress.status === "completed") {
            card.addClass("deeppdf-task-card-completed");
            this.renderCompletedState(card);
        } else {
            this.renderProcessingState(card);
        }

        return card;
    }

    private renderProcessingState(card: HTMLElement): void {
        const pdfName = this.progress.pdf_name || "未知文件";
        const percent = this.progress.progress_percent || 0;
        const step = this.progress.current_step || "start";
        const stepConfig = STEP_CONFIG[step] || STEP_CONFIG["start"];

        // PDF 名称
        const nameEl = card.createEl("div", { cls: "deeppdf-task-name" });
        nameEl.innerHTML = `📄 ${this.escapeHtml(pdfName)}`;

        // 进度条
        const progressBar = card.createEl("div", { cls: "deeppdf-task-progress-bar" });
        const progressFill = progressBar.createEl("div", { cls: "deeppdf-task-progress-fill" });
        progressFill.style.width = `${percent}%`;

        // 进度文本
        const progressText = card.createEl("div", { cls: "deeppdf-task-progress-text" });
        progressText.innerHTML = `
            <span>${stepConfig.icon} ${stepConfig.label}</span>
            <span>${percent}%</span>
        `;

        // 取消按钮
        const cancelBtn = card.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-sm deeppdf-btn-text"
        });
        cancelBtn.textContent = "✕ 取消";
        cancelBtn.addEventListener("click", () => {
            if (this.onCancel) this.onCancel();
        });
    }

    private renderCompletedState(card: HTMLElement): void {
        const pdfName = this.progress.pdf_name || "未知文件";

        card.innerHTML = `
            <div class="deeppdf-task-name">✅ ${this.escapeHtml(pdfName)}</div>
            <div class="deeppdf-task-status">索引创建完成</div>
        `;
    }

    private renderFailedState(card: HTMLElement): void {
        const pdfName = this.progress.pdf_name || "未知文件";
        const error = this.progress.error || "未知错误";

        card.innerHTML = `
            <div class="deeppdf-task-name">❌ ${this.escapeHtml(pdfName)}</div>
            <div class="deeppdf-task-error">错误: ${this.escapeHtml(error)}</div>
            <button class="deeppdf-btn deeppdf-btn-sm">🔄 重试</button>
        `;
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    update(progress: TaskProgress): void {
        this.progress = progress;
        this.el.empty();
        this.el.appendChild(this.render().childNodes);
    }

    getElement(): HTMLElement {
        return this.el;
    }
}
```

**Step 3: 创建任务进度卡片样式**

```css
/* frontend/src/components/task-progress-card.css */
.deeppdf-task-card {
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
}

.deeppdf-task-name {
    font-weight: 500;
    margin-bottom: 8px;
}

.deeppdf-task-progress-bar {
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
}

.deeppdf-task-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
}

.deeppdf-task-progress-text {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-smallest);
    color: var(--text-muted);
    margin-bottom: 8px;
}

.deeppdf-task-card-failed {
    border-color: var(--text-error);
}

.deeppdf-task-error {
    color: var(--text-error);
    font-size: var(--font-smallest);
    margin: 8px 0;
}

.deeppdf-task-card-completed {
    border-color: var(--color-success);
}
```

**Step 4: Commit**

```bash
git add frontend/src/components/task-progress-card.ts frontend/src/components/task-progress-card.css frontend/src/types/
git commit -m "feat: 添加任务进度卡片组件"
```

---

### Task 4: 创建任务进度管理器

**Files:**
- Create: `frontend/src/utils/task-polling-manager.ts`

**Step 1: 创建任务轮询管理器**

```typescript
// frontend/src/utils/task-polling-manager.ts
import { DeepPDFClient } from "../api/http-client.js";
import { TaskProgress } from "../types/index.js";

export class TaskPollingManager {
    private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
    private progressCache: Map<string, TaskProgress> = new Map();
    private apiClient: DeepPDFClient;
    private pollInterval: number = 2000; // 2秒

    constructor(apiClient: DeepPDFClient) {
        this.apiClient = apiClient;
    }

    // 开始轮询任务进度
    startPolling(taskId: string, onUpdate: (progress: TaskProgress) => void): void {
        // 清除已有的轮询
        this.stopPolling(taskId);

        const timer = setInterval(async () => {
            try {
                const progress = await this.apiClient.getTaskProgress(taskId);
                this.progressCache.set(taskId, progress);
                onUpdate(progress);

                // 如果任务完成或失败，停止轮询
                if (progress.status === "completed" || progress.status === "failed" || progress.status === "cancelled") {
                    this.stopPolling(taskId);
                }
            } catch (error) {
                console.error(`[任务轮询] 获取任务 ${taskId} 进度失败:`, error);
            }
        }, this.pollInterval);

        this.pollingIntervals.set(taskId, timer);
    }

    // 停止轮询
    stopPolling(taskId: string): void {
        const timer = this.pollingIntervals.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.pollingIntervals.delete(taskId);
        }
    }

    // 获取缓存的进度
    getCachedProgress(taskId: string): TaskProgress | undefined {
        return this.progressCache.get(taskId);
    }

    // 清理所有轮询
    destroy(): void {
        this.pollingIntervals.forEach((timer, taskId) => {
            clearInterval(timer);
        });
        this.pollingIntervals.clear();
        this.progressCache.clear();
    }

    // 获取所有进行中的任务
    getActiveTaskIds(): string[] {
        return Array.from(this.pollingIntervals.keys());
    }
}
```

**Step 2: 在 API 客户端中添加获取任务进度方法**

首先检查现有 API 客户端是否已有此方法：

Run: `grep -n "getTaskProgress" frontend/src/api/http-client.ts`

如果有，跳过此步骤。如果没有，添加：

```typescript
// 在 DeepPDFClient 类中添加
async getTaskProgress(taskId: string): Promise<TaskProgress> {
    const response = await this.request<TaskProgress>(`/tasks/${taskId}/progress`);
    return response;
}
```

**Step 3: Commit**

```bash
git add frontend/src/utils/task-polling-manager.ts
git commit -m "feat: 添加任务轮询管理器"
```

---

### Task 5: 在抽屉中集成任务进度展示

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 在侧边栏中添加任务轮询管理器**

Edit: `frontend/src/views/sidebar-view.ts`
```typescript
// 添加导入
import { TaskPollingManager } from "../utils/task-polling-manager.js";
import { TaskProgressCard } from "../components/task-progress-card.js";
import { TaskProgress } from "../types/index.js";

// 在 SidebarView 类中添加
private taskPollingManager: TaskPollingManager | null = null;
private taskCards: Map<string, TaskProgressCard> = new Map();

// 修改 constructor
constructor(leaf: WorkspaceLeaf, apiClient: DeepPDFClient | null) {
    super(leaf);
    this.apiClient = apiClient;
    this.submitHandler = () => {};
    this.keyPressHandler = () => {};
    this.indexSelectHandler = () => {};

    // 初始化任务轮询管理器
    if (this.apiClient) {
        this.taskPollingManager = new TaskPollingManager(this.apiClient);
    }
}

// 修改 createIndexManagerContent 方法
private createIndexManagerContent(): HTMLElement {
    const container = document.createElement("div");
    container.addClass("deeppdf-index-manager");

    // 头部
    const header = container.createEl("header");
    header.innerHTML = `
        <div class="deeppdf-drawer-header">
            <h2>📊 索引管理</h2>
            <button class="deeppdf-drawer-close" aria-label="关闭">✕</button>
        </div>
    `;

    const closeBtn = header.querySelector(".deeppdf-drawer-close");
    closeBtn?.addEventListener("click", () => {
        this.drawer?.close();
    });

    // 操作按钮区
    const actions = container.createEl("div", { cls: "deeppdf-drawer-actions" });
    actions.innerHTML = `
        <button class="deeppdf-btn deeppdf-btn-primary">+ 新建索引</button>
        <button class="deeppdf-btn deeppdf-btn-secondary">🔄 刷新</button>
    `;

    // 进行中的任务区
    const taskSection = container.createEl("section", { cls: "deeppdf-task-section" });
    taskSection.innerHTML = `
        <h3 class="deeppdf-section-title">⏳ 进行中的任务</h3>
        <div class="deeppdf-task-list" id="deeppdf-task-list"></div>
    `;

    // 已完成索引区
    const indexSection = container.createEl("section", { cls: "deeppdf-index-section" });
    indexSection.innerHTML = `
        <h3 class="deeppdf-section-title">✅ 已完成索引</h3>
        <div class="deeppdf-index-list" id="deeppdf-index-list"></div>
    `;

    // 加载数据
    this.loadDrawerData(container);

    return container;
}

// 新增：加载抽屉数据
private async loadDrawerData(container: HTMLElement): Promise<void> {
    await this.loadIndexesIntoDrawer(container.querySelector("#deeppdf-index-list") as HTMLElement);
    this.loadActiveTasks(container.querySelector("#deeppdf-task-list") as HTMLElement);
}

// 新增：加载进行中的任务
private loadActiveTasks(container: HTMLElement): void {
    if (!this.taskPollingManager) return;

    const activeTaskIds = this.taskPollingManager.getActiveTaskIds();

    if (activeTaskIds.length === 0) {
        container.innerHTML = "<p class='deeppdf-empty-text'>暂无进行中的任务</p>";
        return;
    }

    activeTaskIds.forEach(taskId => {
        const progress = this.taskPollingManager?.getCachedProgress(taskId);
        if (progress) {
            this.addTaskCard(container, progress);
        }
    });
}

// 新增：添加任务卡片
private addTaskCard(container: HTMLElement, progress: TaskProgress): void {
    const card = new TaskProgressCard(
        progress,
        () => this.cancelTask(progress.id)
    );
    this.taskCards.set(progress.id, card);
    container.appendChild(card.getElement());

    // 开始轮询
    if (this.taskPollingManager) {
        this.taskPollingManager.startPolling(progress.id, (updatedProgress) => {
            this.updateTaskCard(updatedProgress);
        });
    }
}

// 新增：更新任务卡片
private updateTaskCard(progress: TaskProgress): void {
    const card = this.taskCards.get(progress.id);
    if (card) {
        card.update(progress);

        // 如果任务完成，从任务列表移到索引列表
        if (progress.status === "completed") {
            this.moveTaskToIndexList(progress);
        }
    }
}

// 新增：取消任务
private async cancelTask(taskId: string): Promise<void> {
    if (!this.apiClient) return;

    try {
        await this.apiClient.cancelTask(taskId);
        if (this.taskPollingManager) {
            this.taskPollingManager.stopPolling(taskId);
        }

        // 移除任务卡片
        const card = this.taskCards.get(taskId);
        if (card) {
            card.getElement().remove();
            this.taskCards.delete(taskId);
        }
    } catch (error) {
        console.error("[DeepPDF] 取消任务失败:", error);
    }
}

// 新增：将完成的任务移到索引列表
private moveTaskToIndexList(progress: TaskProgress): void {
    const card = this.taskCards.get(progress.id);
    if (card) {
        card.getElement().remove();
        this.taskCards.delete(taskId);
    }

    // 刷新索引列表
    const indexList = this.containerEl.querySelector("#deeppdf-index-list");
    if (indexList) {
        this.loadIndexesIntoDrawer(indexList as HTMLElement);
    }
}

// 修改 onClose 方法，清理轮询管理器
async onClose() {
    // ... 现有清理代码 ...

    // 清理任务轮询管理器
    if (this.taskPollingManager) {
        this.taskPollingManager.destroy();
        this.taskPollingManager = null;
    }
}
```

**Step 2: 手动测试任务进度展示**

1. 打开抽屉面板
2. 点击"新建索引"
3. 选择一个 PDF 文件
4. 观察任务进度卡片实时更新

**Step 3: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 在抽屉中集成任务进度展示"
```

---

## Phase 3: 对话界面基础结构

### Task 6: 创建消息组件

**Files:**
- Create: `frontend/src/components/chat/message.ts`
- Create: `frontend/src/components/chat/message.css`
- Create: `frontend/src/components/chat/user-message.ts`
- Create: `frontend/src/components/chat/ai-message.ts`

**Step 1: 创建消息类型定义**

```typescript
// frontend/src/types/chat.ts
export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    citations?: Citation[];
}

export interface Citation {
    text: string;
    page: number;
    section: string;
    pdfName: string;
}
```

**Step 2: 创建基础消息组件**

```typescript
// frontend/src/components/chat/message.ts
import { ChatMessage } from "../../types/chat.js";

export abstract class MessageComponent {
    protected message: ChatMessage;
    protected el: HTMLElement;

    constructor(message: ChatMessage) {
        this.message = message;
        this.el = this.render();
    }

    protected abstract render(): HTMLElement;

    getElement(): HTMLElement {
        return this.el;
    }

    protected escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    protected formatTime(timestamp: string): string {
        const date = new Date(timestamp);
        return date.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit"
        });
    }
}
```

**Step 3: 创建用户消息组件**

```typescript
// frontend/src/components/chat/user-message.ts
import { MessageComponent } from "./message.js";
import { ChatMessage } from "../../types/chat.js";

export class UserMessage extends MessageComponent {
    protected render(): HTMLElement {
        const wrapper = document.createElement("div");
        wrapper.addClass("deeppdf-message-wrapper", "deeppdf-user-message-wrapper");

        const bubble = wrapper.createEl("div", { cls: "deeppdf-message-bubble deeppdf-user-bubble" });

        const content = bubble.createEl("div", { cls: "deeppdf-message-content" });
        content.textContent = this.message.content;

        const timestamp = bubble.createEl("div", { cls: "deeppdf-message-time" });
        timestamp.textContent = this.formatTime(this.message.timestamp);

        return wrapper;
    }
}
```

**Step 4: 创建 AI 消息组件**

```typescript
// frontend/src/components/chat/ai-message.ts
import { MessageComponent } from "./message.js";
import { ChatMessage } from "../../types/chat.js";
import { Icons } from "../../utils/icons.js";

export class AIMessage extends MessageComponent {
    protected render(): HTMLElement {
        const wrapper = document.createElement("div");
        wrapper.addClass("deeppdf-message-wrapper", "deeppdf-ai-message-wrapper");

        const bubble = wrapper.createEl("div", { cls: "deeppdf-message-bubble deeppdf-ai-bubble" });

        // 头像
        const avatar = bubble.createEl("div", { cls: "deeppdf-ai-avatar" });
        avatar.innerHTML = Icons.database;

        // 内容区
        const contentContainer = bubble.createEl("div", { cls: "deeppdf-ai-content-container" });

        // 消息内容（支持 Markdown）
        const content = contentContainer.createEl("div", { cls: "deeppdf-message-content" });
        content.innerHTML = this.escapeHtml(this.message.content); // 后续替换为 Markdown 渲染

        // 引用来源
        if (this.message.citations && this.message.citations.length > 0) {
            const citations = contentContainer.createEl("div", { cls: "deeppdf-citations" });
            citations.innerHTML = `<div class="deeppdf-citations-header">📎 引用来源 (${this.message.citations.length})</div>`;

            this.message.citations.forEach((citation, index) => {
                const citationItem = citations.createEl("div", { cls: "deeppdf-citation-item" });
                citationItem.innerHTML = `
                    <div class="deeppdf-citation-text">${this.escapeHtml(citation.text.substring(0, 100))}...</div>
                    <div class="deeppdf-citation-meta">
                        <span>第 ${citation.page} 页</span>
                        <button class="deeppdf-citation-view-btn">查看</button>
                    </div>
                `;
            });
        }

        // 操作按钮
        const actions = contentContainer.createEl("div", { cls: "deeppdf-message-actions" });
        actions.innerHTML = `
            <button class="deeppdf-btn deeppdf-btn-sm deeppdf-btn-ghost" title="重新生成">🔄</button>
            <button class="deeppdf-btn deeppdf-btn-sm deeppdf-btn-ghost" title="复制">📋</button>
        `;

        const copyBtn = actions.querySelector("button[title='复制']");
        copyBtn?.addEventListener("click", () => this.copyContent());

        return wrapper;
    }

    private copyContent(): void {
        navigator.clipboard.writeText(this.message.content).then(() => {
            // 显示复制成功提示
        });
    }
}
```

**Step 5: 创建消息样式**

```css
/* frontend/src/components/chat/message.css */
.deeppdf-message-wrapper {
    display: flex;
    margin-bottom: 16px;
}

.deeppdf-user-message-wrapper {
    justify-content: flex-end;
}

.deeppdf-ai-message-wrapper {
    justify-content: flex-start;
}

.deeppdf-message-bubble {
    max-width: 80%;
    padding: 12px 16px;
    border-radius: 12px;
}

.deeppdf-user-bubble {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
}

.deeppdf-ai-bubble {
    background: var(--background-secondary);
    display: flex;
    gap: 12px;
}

.deeppdf-ai-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--background-modifier-border);
    border-radius: 50%;
}

.deeppdf-ai-content-container {
    flex: 1;
}

.deeppdf-message-content {
    line-height: 1.6;
}

.deeppdf-message-time {
    font-size: var(--font-smallest);
    opacity: 0.7;
    margin-top: 4px;
}

.deeppdf-citations {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
}

.deeppdf-citations-header {
    font-size: var(--font-smallest);
    color: var(--text-muted);
    margin-bottom: 8px;
}

.deeppdf-citation-item {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 8px;
    margin-bottom: 8px;
}

.deeppdf-citation-text {
    font-size: var(--font-smallest);
    margin-bottom: 4px;
}

.deeppdf-citation-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-smallest);
    color: var(--text-muted);
}

.deeppdf-message-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}
```

**Step 6: Commit**

```bash
git add frontend/src/components/chat/
git commit -m "feat: 添加消息组件"
```

---

### Task 7: 创建消息列表组件

**Files:**
- Create: `frontend/src/components/chat/message-list.ts`

**Step 1: 创建消息列表组件**

```typescript
// frontend/src/components/chat/message-list.ts
import { UserMessage } from "./user-message.js";
import { AIMessage } from "./ai-message.js";
import { ChatMessage } from "../../types/chat.js";

export class MessageList {
    private el: HTMLElement;
    private messages: Map<string, ChatMessage> = new Map();
    private messageComponents: Map<string, HTMLElement> = new Map();

    constructor() {
        this.el = this.render();
    }

    private render(): HTMLElement {
        const container = document.createElement("div");
        container.addClass("deeppdf-message-list");
        return container;
    }

    addMessage(message: ChatMessage): void {
        this.messages.set(message.id, message);

        let messageEl: HTMLElement;
        if (message.role === "user") {
            const component = new UserMessage(message);
            messageEl = component.getElement();
        } else {
            const component = new AIMessage(message);
            messageEl = component.getElement();
        }

        this.messageComponents.set(message.id, messageEl);
        this.el.appendChild(messageEl);

        // 滚动到底部
        this.scrollToBottom();
    }

    updateMessage(messageId: string, updates: Partial<ChatMessage>): void {
        const message = this.messages.get(messageId);
        if (!message) return;

        Object.assign(message, updates);

        const oldEl = this.messageComponents.get(messageId);
        if (oldEl) {
            oldEl.remove();
        }

        let newEl: HTMLElement;
        if (message.role === "user") {
            const component = new UserMessage(message);
            newEl = component.getElement();
        } else {
            const component = new AIMessage(message);
            newEl = component.getElement();
        }

        this.messageComponents.set(messageId, newEl);
        this.el.appendChild(newEl);
        this.scrollToBottom();
    }

    removeMessage(messageId: string): void {
        this.messages.delete(messageId);

        const el = this.messageComponents.get(messageId);
        if (el) {
            el.remove();
            this.messageComponents.delete(messageId);
        }
    }

    clear(): void {
        this.messages.clear();
        this.messageComponents.clear();
        this.el.empty();
    }

    scrollToBottom(): void {
        this.el.scrollTop = this.el.scrollHeight;
    }

    getElement(): HTMLElement {
        return this.el;
    }
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/chat/message-list.ts
git commit -m "feat: 添加消息列表组件"
```

---

### Task 8: 创建聊天输入组件

**Files:**
- Create: `frontend/src/components/chat/chat-input.ts`
- Create: `frontend/src/components/chat/chat-input.css`

**Step 1: 创建聊天输入组件**

```typescript
// frontend/src/components/chat/chat-input.ts
import { Icons } from "../../utils/icons.js";

export interface ChatInputOptions {
    placeholder?: string;
    onSubmit: (text: string) => void;
}

export class ChatInput {
    private el: HTMLElement;
    private textarea: HTMLTextAreaElement;
    private submitBtn: HTMLButtonElement;
    private onSubmit: (text: string) => void;

    constructor(options: ChatInputOptions) {
        this.onSubmit = options.onSubmit;
        this.el = this.render(options.placeholder || "输入问题...");
        this.textarea = this.el.querySelector("textarea") as HTMLTextAreaElement;
        this.submitBtn = this.el.querySelector("button") as HTMLButtonElement;
        this.attachEvents();
    }

    private render(placeholder: string): HTMLElement {
        const container = document.createElement("div");
        container.addClass("deeppdf-chat-input");

        const wrapper = container.createEl("div", { cls: "deeppdf-chat-input-wrapper" });

        this.textarea = wrapper.createEl("textarea", {
            cls: "deeppdf-chat-textarea",
            attr: { placeholder, rows: "1" }
        });

        this.submitBtn = wrapper.createEl("button", {
            cls: "deeppdf-chat-send-btn"
        });
        this.submitBtn.innerHTML = Icons.search;
        this.submitBtn.disabled = true;

        return container;
    }

    private attachEvents(): void {
        // 自动调整高度
        this.textarea.addEventListener("input", () => {
            this.adjustHeight();
            this.updateSubmitButton();
        });

        // 键盘事件
        this.textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.submit();
            }
        });

        // 提交按钮
        this.submitBtn.addEventListener("click", () => this.submit());
    }

    private adjustHeight(): void {
        this.textarea.style.height = "auto";
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 150) + "px";
    }

    private updateSubmitButton(): void {
        this.submitBtn.disabled = !this.textarea.value.trim();
    }

    private submit(): void {
        const text = this.textarea.value.trim();
        if (!text) return;

        this.onSubmit(text);
        this.clear();
    }

    private clear(): void {
        this.textarea.value = "";
        this.textarea.style.height = "auto";
        this.updateSubmitButton();
    }

    focus(): void {
        this.textarea.focus();
    }

    getElement(): HTMLElement {
        return this.el;
    }
}
```

**Step 2: 创建聊天输入样式**

```css
/* frontend/src/components/chat/chat-input.css */
.deeppdf-chat-input {
    padding: 16px;
    border-top: 1px solid var(--background-modifier-border);
}

.deeppdf-chat-input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    padding: 8px 12px;
}

.deeppdf-chat-textarea {
    flex: 1;
    border: none;
    background: transparent;
    resize: none;
    font-family: inherit;
    font-size: var(--font-ui-medium);
    line-height: 1.5;
    min-height: 24px;
    max-height: 150px;
}

.deeppdf-chat-textarea:focus {
    outline: none;
}

.deeppdf-chat-send-btn {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border: none;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.2s;
}

.deeppdf-chat-send-btn:hover:not(:disabled) {
    opacity: 0.9;
}

.deeppdf-chat-send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
```

**Step 3: Commit**

```bash
git add frontend/src/components/chat/chat-input.ts frontend/src/components/chat/chat-input.css
git commit -m "feat: 添加聊天输入组件"
```

---

### Task 9: 重构侧边栏为对话界面

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 重构侧边栏视图**

```typescript
// frontend/src/views/sidebar-view.ts
import { MessageList } from "../components/chat/message-list.js";
import { ChatInput } from "../components/chat/chat-input.js";
import { ChatMessage } from "../types/chat.js";

export class SidebarView extends ItemView {
    // ... 现有属性 ...

    private messageList: MessageList | null = null;
    private chatInput: ChatInput | null = null;
    private messages: ChatMessage[] = [];
    private currentThreadId: string = "default";

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("deeppdf-container");

        // 创建头部
        this.createHeader(container);

        // 创建对话区域
        this.createChatArea(container);

        // 创建抽屉面板
        this.drawer = new Drawer({
            position: "right",
            width: "400px",
            overlay: true
        });
        this.containerEl.appendChild(this.drawer.render());

        // 更新服务器状态
        this.updateStatus();
    }

    private createChatArea(container: HTMLElement): void {
        const chatArea = container.createDiv({ cls: "deeppdf-chat-area" });

        // 消息列表
        this.messageList = new MessageList();
        chatArea.appendChild(this.messageList.getElement());

        // 显示空状态
        this.showEmptyState();

        // 聊天输入
        this.chatInput = new ChatInput({
            placeholder: "输入问题开始查询...",
            onSubmit: (text) => this.handleUserMessage(text)
        });
        chatArea.appendChild(this.chatInput.getElement());
    }

    private showEmptyState(): void {
        if (!this.messageList) return;

        const emptyState = document.createElement("div");
        emptyState.addClass("deeppdf-chat-empty-state");
        emptyState.innerHTML = `
            <div class="deeppdf-empty-icon">💬</div>
            <div class="deeppdf-empty-text">开始对话</div>
            <div class="deeppdf-empty-hint">选择索引后输入问题即可搜索</div>
        `;

        this.messageList.getElement().appendChild(emptyState);
    }

    private async handleUserMessage(text: string): Promise<void> {
        if (!this.apiClient || !this.messageList) return;

        // 移除空状态
        const emptyState = this.messageList.getElement().querySelector(".deeppdf-chat-empty-state");
        emptyState?.remove();

        // 添加用户消息
        const userMessage: ChatMessage = {
            id: this.generateMessageId(),
            role: "user",
            content: text,
            timestamp: new Date().toISOString()
        };
        this.messageList.addMessage(userMessage);
        this.messages.push(userMessage);

        // 显示加载状态
        this.showLoadingState();

        try {
            // 获取当前选择的索引
            const selectedIndexId = this.getCurrentSelectedIndexId();
            if (!selectedIndexId) {
                this.showError("请先选择一个索引");
                return;
            }

            // 调用 API 查询
            const result = await this.apiClient.queryPDF(text, selectedIndexId);
            this.handleQueryResult(result, text);
        } catch (error) {
            this.showError(`查询失败: ${error}`);
        }
    }

    private showLoadingState(): void {
        if (!this.messageList) return;

        const loadingEl = document.createElement("div");
        loadingEl.addClass("deeppdf-message-loading");
        loadingEl.id = "deeppdf-loading-indicator";
        loadingEl.innerHTML = `
            <div class="deeppdf-loading-spinner"></div>
            <span>正在搜索...</span>
        `;
        this.messageList.getElement().appendChild(loadingEl);
        this.messageList.scrollToBottom();
    }

    private removeLoadingState(): void {
        const loadingEl = this.messageList?.getElement().querySelector("#deeppdf-loading-indicator");
        loadingEl?.remove();
    }

    private handleQueryResult(result: any, query: string): void {
        this.removeLoadingState();

        if (!this.messageList) return;

        // 提取引用来源
        const citations = result.results?.map((item: any) => ({
            text: item.text,
            page: item.metadata?.page || 0,
            section: item.metadata?.section || "",
            pdfName: result.results?.[0]?.metadata?.pdf_name || ""
        })) || [];

        // 构建回复内容
        let content = "";
        if (result.results && result.results.length > 0) {
            content = result.results.map((item: any) => item.text).join("\n\n");
        } else {
            content = "未找到相关内容，请尝试使用不同的关键词。";
        }

        // 添加 AI 回复
        const aiMessage: ChatMessage = {
            id: this.generateMessageId(),
            role: "assistant",
            content,
            timestamp: new Date().toISOString(),
            citations: citations.length > 0 ? citations : undefined
        };
        this.messageList.addMessage(aiMessage);
        this.messages.push(aiMessage);
    }

    private showError(message: string): void {
        this.removeLoadingState();

        if (!this.messageList) return;

        const errorMessage: ChatMessage = {
            id: this.generateMessageId(),
            role: "assistant",
            content: `❌ ${message}`,
            timestamp: new Date().toISOString()
        };
        this.messageList.addMessage(errorMessage);
    }

    private getCurrentSelectedIndexId(): string | null {
        // 从索引选择器获取当前选择的索引 ID
        const selector = this.containerEl.querySelector(".deeppdf-index-select") as HTMLSelectElement;
        return selector?.value || null;
    }

    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // ... 其他现有方法 ...
}
```

**Step 2: 添加聊天界面样式**

```css
/* 在 frontend/src/styles/main.css 添加 */
.deeppdf-chat-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.deeppdf-message-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
}

.deeppdf-chat-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
}

.deeppdf-empty-icon {
    font-size: 48px;
    opacity: 0.5;
    margin-bottom: 16px;
}

.deeppdf-empty-text {
    font-size: var(--font-ui-medium);
    font-weight: 500;
    margin-bottom: 8px;
}

.deeppdf-empty-hint {
    font-size: var(--font-smallest);
    opacity: 0.7;
}

.deeppdf-message-loading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    color: var(--text-muted);
}

.deeppdf-loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: deeppdf-spin 1s linear infinite;
}

@keyframes deeppdf-spin {
    to { transform: rotate(360deg); }
}
```

**Step 3: 导入新样式**

Edit: `frontend/src/styles/main.css`
```css
/* 导入组件样式 */
@import "../components/drawer/drawer.css";
@import "../components/task-progress-card.css";
@import "../components/chat/message.css";
@import "../components/chat/chat-input.css";
```

**Step 4: 手动测试对话界面**

1. 重新加载 Obsidian 插件
2. 打开 DeepPDF 侧边栏
3. 选择一个索引
4. 输入问题并观察对话界面

**Step 5: Commit**

```bash
git add frontend/src/views/sidebar-view.ts frontend/src/styles/main.css
git commit -m "feat: 重构侧边栏为对话界面"
```

---

## Phase 4: 顶部导航优化

### Task 10: 创建顶部导航组件

**Files:**
- Create: `frontend/src/components/header/chat-header.ts`
- Create: `frontend/src/components/header/chat-header.css`

**Step 1: 创建顶部导航组件**

```typescript
// frontend/src/components/header/chat-header.ts
import { Icons } from "../../utils/icons.js";

export interface ChatHeaderOptions {
    apiClient: any;
    onOpenDrawer: () => void;
}

export class ChatHeader {
    private el: HTMLElement;
    private statusEl: HTMLElement;
    private indexSelect: HTMLSelectElement;
    private apiClient: any;

    constructor(options: ChatHeaderOptions) {
        this.apiClient = options.apiClient;
        this.el = this.render();
        this.statusEl = this.el.querySelector(".deeppdf-status") as HTMLElement;
        this.indexSelect = this.el.querySelector(".deeppdf-index-select") as HTMLSelectElement;

        // 绑定事件
        this.el.querySelector(".deeppdf-manage-btn")?.addEventListener("click", () => {
            options.onOpenDrawer();
        });

        // 加载索引列表
        this.loadIndexes();
    }

    private render(): HTMLElement {
        const container = document.createElement("header");
        container.addClass("deeppdf-chat-header");

        container.innerHTML = `
            <div class="deeppdf-header-left">
                <div class="deeppdf-logo">${Icons.database}</div>
                <h2>DeepPDF</h2>
            </div>
            <div class="deeppdf-header-center">
                <div class="deeppdf-status deeppdf-status-loading">
                    <span></span> 检查中...
                </div>
                <select class="deeppdf-index-select">
                    <option value="">选择索引...</option>
                </select>
            </div>
            <div class="deeppdf-header-right">
                <button class="deeppdf-btn deeppdf-manage-btn">${Icons.database} 管理索引</button>
            </div>
        `;

        return container;
    }

    private async loadIndexes(): Promise<void> {
        if (!this.apiClient) {
            this.indexSelect.innerHTML = '<option value="">未连接</option>';
            return;
        }

        try {
            const result = await this.apiClient.listIndexes();
            this.indexSelect.innerHTML = '';

            if (!result.indexes || result.indexes.length === 0) {
                this.indexSelect.add(new Option("暂无索引", ""));
                return;
            }

            result.indexes.forEach((index: any) => {
                const option = new Option(
                    `${index.pdf_name} (${index.node_count} 节点)`,
                    index.id
                );
                this.indexSelect.add(option);
            });
        } catch (error) {
            this.indexSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    async updateStatus(): Promise<void> {
        if (!this.apiClient) {
            this.setStatus("warning", "未连接");
            return;
        }

        this.setStatus("loading", "检查中...");

        try {
            const isHealthy = await this.apiClient.healthCheck();
            if (isHealthy) {
                this.setStatus("ok", "已连接");
            } else {
                this.setStatus("warning", "未连接");
            }
        } catch (error) {
            this.setStatus("error", "连接失败");
        }
    }

    private setStatus(type: string, text: string): void {
        this.statusEl.className = `deeppdf-status deeppdf-status-${type}`;
        this.statusEl.innerHTML = `<span></span> ${text}`;
    }

    getSelectedIndexId(): string | null {
        return this.indexSelect.value || null;
    }

    refreshIndexes(): void {
        this.loadIndexes();
    }

    getElement(): HTMLElement {
        return this.el;
    }
}
```

**Step 2: 创建顶部导航样式**

```css
/* frontend/src/components/header/chat-header.css */
.deeppdf-chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
}

.deeppdf-header-left,
.deeppdf-header-center,
.deeppdf-header-right {
    display: flex;
    align-items: center;
    gap: 12px;
}

.deeppdf-header-left h2 {
    margin: 0;
    font-size: var(--font-ui-medium);
    font-weight: 600;
}

.deeppdf-header-center {
    flex: 1;
    justify-content: center;
}

.deeppdf-index-select {
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: var(--font-smallest);
    min-width: 200px;
}

.deeppdf-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-smallest);
    padding: 4px 8px;
    border-radius: 12px;
}

.deeppdf-status-loading {
    color: var(--text-muted);
}

.deeppdf-status-ok {
    color: var(--color-success);
}

.deeppdf-status-warning {
    color: var(--color-warning);
}

.deeppdf-status-error {
    color: var(--text-error);
}

.deeppdf-status span {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.deeppdf-status-ok span {
    background: var(--color-success);
}

.deeppdf-status-warning span {
    background: var(--color-warning);
}

.deeppdf-status-error span {
    background: var(--text-error);
}

.deeppdf-status-loading span {
    background: var(--text-muted);
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
```

**Step 3: 在侧边栏中集成新顶部导航**

Edit: `frontend/src/views/sidebar-view.ts`
```typescript
import { ChatHeader } from "../components/header/chat-header.js";

// 修改 createHeader 方法
private createHeader(container: HTMLElement): void {
    const header = new ChatHeader({
        apiClient: this.apiClient,
        onOpenDrawer: () => this.openIndexDrawer()
    });
    container.appendChild(header.getElement());

    // 保存引用以便后续使用
    this.chatHeader = header;

    // 更新状态
    header.updateStatus();
}
```

**Step 4: 导入样式**

Edit: `frontend/src/styles/main.css`
```css
@import "../components/header/chat-header.css";
```

**Step 5: Commit**

```bash
git add frontend/src/components/header/ frontend/src/views/sidebar-view.ts frontend/src/styles/main.css
git commit -m "feat: 添加顶部导航组件"
```

---

## Phase 5: 错误处理和优化

### Task 11: 添加错误处理

**Files:**
- Create: `frontend/src/utils/error-handler.ts`
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 创建错误处理器**

```typescript
// frontend/src/utils/error-handler.ts
import { Notice } from "obsidian";

export class ErrorHandler {
    static handle(error: unknown, context: string): void {
        console.error(`[DeepPDF] ${context}:`, error);

        let message = "操作失败";

        if (error instanceof Error) {
            message = error.message;
        } else if (typeof error === "string") {
            message = error;
        }

        new Notice(`DeepPDF: ${message}`, 5000);
    }

    static networkError(): void {
        new Notice("DeepPDF: 网络连接失败，请检查后端服务", 5000);
    }

    static apiError(error: string): void {
        new Notice(`DeepPDF: ${error}`, 5000);
    }
}
```

**Step 2: 在侧边栏中集成错误处理**

Edit: `frontend/src/views/sidebar-view.ts`
```typescript
import { ErrorHandler } from "../utils/error-handler.js";

// 替换现有的错误处理
private async handleUserMessage(text: string): Promise<void> {
    try {
        // ... 现有代码 ...
    } catch (error) {
        ErrorHandler.handle(error, "查询失败");
    }
}
```

**Step 3: Commit**

```bash
git add frontend/src/utils/error-handler.ts frontend/src/views/sidebar-view.ts
git commit -m "feat: 添加统一错误处理"
```

---

### Task 12: 添加图标工具类

**Files:**
- Create: `frontend/src/utils/icons.ts`

**Step 1: 创建图标工具类**

```typescript
// frontend/src/utils/icons.ts
export const Icons = {
    // 基础图标
    database: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s 9-1.34 9-3V5"/></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    close: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
};
```

**Step 2: Commit**

```bash
git add frontend/src/utils/icons.ts
git commit -m "feat: 添加图标工具类"
```

---

## Phase 6: 最终集成和测试

### Task 13: 集成所有组件并测试

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`
- Modify: `frontend/src/styles/main.css`

**Step 1: 完整导入所有样式**

Edit: `frontend/src/styles/main.css`
```css
/* ========================================
   DeepPDF 对话式搜索界面样式
   ======================================== */

/* 导入所有组件样式 */
@import "../components/drawer/drawer.css";
@import "../components/task-progress-card.css";
@import "../components/chat/message.css";
@import "../components/chat/chat-input.css";
@import "../components/header/chat-header.css";

/* ========================================
   主容器样式
   ======================================== */
.deeppdf-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-primary);
}

/* ========================================
   侧边栏重构
   ======================================== */
.deeppdf-header {
    /* 已移到 chat-header.css */
}

.deeppdf-query-section {
    /* 已移除，使用聊天界面 */
}

.deeppdf-results-section {
    /* 已移除，使用消息列表 */
}

/* ========================================
   按钮样式
   ======================================== */
.deeppdf-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: var(--interactive-normal);
    color: var(--text-normal);
    font-size: var(--font-smallest);
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
}

.deeppdf-btn:hover {
    background: var(--interactive-hover);
}

.deeppdf-btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
}

.deeppdf-btn-primary:hover {
    background: var(--interactive-accent-hover);
}

.deeppdf-btn-secondary {
    background: var(--background-modifier-border);
}

.deeppdf-btn-ghost {
    background: transparent;
}

.deeppdf-btn-danger {
    background: var(--text-error);
    color: var(--text-on-accent);
}

.deeppdf-btn-text {
    background: transparent;
    padding: 4px 8px;
}

.deeppdf-btn-sm {
    padding: 4px 8px;
    font-size: var(--font-smallest);
}

.deeppdf-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* ========================================
   抽屉面板内容样式
   ======================================== */
.deeppdf-index-manager {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.deeppdf-drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.deeppdf-drawer-header h2 {
    margin: 0;
    font-size: var(--font-ui-large);
}

.deeppdf-drawer-close {
    background: transparent;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
    color: var(--text-muted);
}

.deeppdf-drawer-actions {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
}

.deeppdf-section-title {
    font-size: var(--font-ui-medium);
    font-weight: 600;
    margin: 20px 0 12px;
}

.deeppdf-empty-text {
    color: var(--text-muted);
    text-align: center;
    padding: 20px;
}

/* ========================================
   索引卡片样式
   ======================================== */
.deeppdf-index-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 8px;
}

.deeppdf-index-card-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.deeppdf-index-card-name {
    font-weight: 500;
}

.deeppdf-index-card-meta {
    font-size: var(--font-smallest);
    color: var(--text-muted);
}

/* ========================================
   工具类
   ======================================== */
.deeppdf-hidden {
    display: none !important;
}

.deeppdf-animate-fade-in {
    animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
```

**Step 2: 最终手动测试**

测试清单：
- [ ] 打开侧边栏，验证对话界面显示正常
- [ ] 验证顶部导航显示状态、索引选择器
- [ ] 点击"管理索引"，验证抽屉滑入
- [ ] 在抽屉中点击"新建索引"
- [ ] 选择 PDF 文件，验证任务进度显示
- [ ] 关闭抽屉，选择索引
- [ ] 输入问题，验证 AI 回复显示
- [ ] 验证引用来源显示
- [ ] 测试复制功能
- [ ] 测试网络错误处理

**Step 3: 修复发现的问题**

根据测试结果修复任何发现的问题。

**Step 4: 最终 Commit**

```bash
git add frontend/src/
git commit -m "feat: 完成对话式搜索界面实现"
```

---

## 总结

### 实现的功能

1. ✅ 抽屉面板组件
2. ✅ 任务进度卡片和轮询
3. ✅ 对话界面（消息列表、用户消息、AI 消息）
4. ✅ 聊天输入组件
5. ✅ 顶部导航组件
6. ✅ 错误处理
7. ✅ 图标工具类

### 待实现的功能（后续版本）

- [ ] Markdown 渲染
- [ ] 引用来源跳转到 PDF
- [ ] 会话历史管理
- [ ] 消息重新生成
- [ ] 批量索引创建
- [ ] 索引搜索和过滤

### 测试指南

1. 确保后端服务运行在 `localhost:6088`
2. 在 Obsidian 中重新加载插件（Cmd+R）
3. 打开 DeepPDF 侧边栏
4. 按照测试清单逐项验证
