# 章节阅读优化 - 前端实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DeepReader 章节文件提供书籍化阅读体验，支持选中文本的翻译、提问和摘录操作。

**Architecture:** 监听 Obsidian 文件打开事件，自动识别章节文件并注入阅读样式；创建悬浮工具栏组件，支持选中文字后的翻译、提问、摘录操作；复用现有右侧边栏进行 AI 对话。

**Tech Stack:** TypeScript, Obsidian Plugin API, CSS

---

## Phase 1: 阅读模式基础

### Task 1.1: 创建阅读模式服务

**Files:**
- Create: `frontend/src/services/reading-mode-service.ts`

**Step 1: 创建 ReadingModeService 类**

```typescript
/**
 * 阅读模式服务
 * 管理章节文件的书籍化阅读体验
 */

import { App, TFile, EventRef } from 'obsidian';
import { log } from '../utils/logger.js';

export class ReadingModeService {
    private app: App;
    private isActive: boolean = false;
    private currentFile: TFile | null = null;
    private fileOpenHandler: EventRef | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 判断文件是否为 DeepReader 章节文件
     */
    isChapterFile(file: TFile): boolean {
        // 1. 路径以 DeepReader/ 开头
        if (!file.path.startsWith('DeepReader/')) {
            return false;
        }

        // 2. 文件名格式为 NN-章节名.md
        if (!/^\d{2}-/.test(file.name)) {
            return false;
        }

        // 3. 检查 frontmatter 是否包含 node_id 或 pdf_name
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) {
            return false;
        }

        return !!(cache.frontmatter.node_id || cache.frontmatter.pdf_name);
    }

    /**
     * 激活阅读模式
     */
    activate(file: TFile): void {
        if (this.isActive && this.currentFile?.path === file.path) {
            return; // 已经激活
        }

        this.deactivate();
        this.currentFile = file;
        this.isActive = true;

        // 添加阅读模式 CSS 类
        document.body.classList.add('deeppdf-reading-mode');
        log('[ReadingMode] Activated for:', file.path);
    }

    /**
     * 停用阅读模式
     */
    deactivate(): void {
        if (!this.isActive) return;

        document.body.classList.remove('deeppdf-reading-mode');
        this.isActive = false;
        this.currentFile = null;
        log('[ReadingMode] Deactivated');
    }

    /**
     * 启动服务（监听文件打开事件）
     */
    start(): void {
        this.fileOpenHandler = this.app.workspace.on('file-open', (file) => {
            if (file && this.isChapterFile(file)) {
                this.activate(file);
            } else {
                this.deactivate();
            }
        });

        // 检查当前打开的文件
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && this.isChapterFile(activeFile)) {
            this.activate(activeFile);
        }
    }

    /**
     * 停止服务
     */
    stop(): void {
        this.deactivate();
        if (this.fileOpenHandler) {
            this.app.workspace.offref(this.fileOpenHandler);
            this.fileOpenHandler = null;
        }
    }

    /**
     * 获取当前文件信息
     */
    getCurrentFile(): TFile | null {
        return this.currentFile;
    }

    /**
     * 获取当前文件的 index_id
     */
    getCurrentIndexId(): string | null {
        if (!this.currentFile) return null;
        const cache = this.app.metadataCache.getFileCache(this.currentFile);
        return cache?.frontmatter?.index_id || null;
    }
}
```

**Step 2: 保存文件**

**Step 3: 验证 TypeScript 编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功，无错误

---

### Task 1.2: 创建阅读模式样式

**Files:**
- Create: `frontend/src/components/reading-mode/reading-mode.css`

**Step 1: 创建样式文件**

```css
/**
 * DeepReader 阅读模式样式
 * 为章节文件提供书籍化阅读体验
 */

/* ==================== 阅读模式容器 ==================== */

.deeppdf-reading-mode .markdown-preview-view {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 24px;
    font-family: var(--font-text);
}

.deeppdf-reading-mode .markdown-source-view {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px 24px;
}

/* ==================== 标题样式 ==================== */

.deeppdf-reading-mode .markdown-preview-view h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 24px;
    color: var(--text-normal);
    line-height: 1.3;
}

.deeppdf-reading-mode .markdown-preview-view h2 {
    font-size: 22px;
    font-weight: 600;
    margin-top: 36px;
    margin-bottom: 16px;
    color: var(--text-normal);
    border-bottom: 1px solid var(--background-modifier-border);
    padding-bottom: 8px;
}

.deeppdf-reading-mode .markdown-preview-view h3 {
    font-size: 18px;
    font-weight: 600;
    margin-top: 28px;
    margin-bottom: 12px;
    color: var(--text-muted);
    padding-left: 12px;
    border-left: 3px solid var(--interactive-accent);
}

/* ==================== 段落样式 ==================== */

.deeppdf-reading-mode .markdown-preview-view p {
    line-height: 1.8;
    font-size: 16px;
    text-align: justify;
    margin-bottom: 16px;
    color: var(--text-normal);
}

/* 首行缩进（可选） */
.deeppdf-reading-mode .markdown-preview-view p:first-of-type {
    text-indent: 2em;
}

/* ==================== 列表样式 ==================== */

.deeppdf-reading-mode .markdown-preview-view ul,
.deeppdf-reading-mode .markdown-preview-view ol {
    line-height: 1.8;
    margin-bottom: 16px;
    padding-left: 24px;
}

.deeppdf-reading-mode .markdown-preview-view li {
    margin-bottom: 8px;
}

/* ==================== 引用块样式 ==================== */

.deeppdf-reading-mode .markdown-preview-view blockquote {
    margin: 16px 0;
    padding: 12px 16px;
    border-left: 4px solid var(--interactive-accent);
    background: var(--background-secondary);
    border-radius: 0 8px 8px 0;
}

.deeppdf-reading-mode .markdown-preview-view blockquote p {
    margin-bottom: 0;
    color: var(--text-muted);
}

/* ==================== 代码块样式 ==================== */

.deeppdf-reading-mode .markdown-preview-view pre {
    margin: 16px 0;
    padding: 16px;
    border-radius: 8px;
    background: var(--background-secondary);
    font-size: 14px;
    line-height: 1.6;
}

.deeppdf-reading-mode .markdown-preview-view code {
    font-family: var(--font-monospace);
    background: var(--background-secondary-alt);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
}

/* ==================== 链接样式 ==================== */

.deeppdf-reading-mode .markdown-preview-view a {
    color: var(--link-color);
    text-decoration: underline;
    text-underline-offset: 2px;
}

.deeppdf-reading-mode .markdown-preview-view a:hover {
    color: var(--link-color-hover);
}

/* ==================== 选中文本样式 ==================== */

.deeppdf-reading-mode ::selection {
    background: rgba(var(--interactive-accent-rgb, 84, 109, 229), 0.3);
}

/* ==================== 水平分隔线 ==================== */

.deeppdf-reading-mode .markdown-preview-view hr {
    margin: 32px 0;
    border: none;
    border-top: 1px solid var(--background-modifier-border);
}

/* ==================== 表格样式 ==================== */

.deeppdf-reading-mode .markdown-preview-view table {
    width: 100%;
    margin: 16px 0;
    border-collapse: collapse;
}

.deeppdf-reading-mode .markdown-preview-view th,
.deeppdf-reading-mode .markdown-preview-view td {
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    text-align: left;
}

.deeppdf-reading-mode .markdown-preview-view th {
    background: var(--background-secondary);
    font-weight: 600;
}
```

**Step 2: 保存文件**

---

### Task 1.3: 创建组件入口文件

**Files:**
- Create: `frontend/src/components/reading-mode/index.ts`

**Step 1: 创建导出入口**

```typescript
/**
 * 阅读模式组件
 */

export { ReadingModeService } from '../../services/reading-mode-service.js';
```

**Step 2: 保存文件**

---

### Task 1.4: 集成到主插件

**Files:**
- Modify: `frontend/src/main.ts`

**Step 1: 在 main.ts 中导入并初始化服务**

找到 `DeepPDFPlugin` 类，添加以下代码：

```typescript
// 在文件顶部添加导入
import { ReadingModeService } from './components/reading-mode/index.js';

// 在 DeepPDFPlugin 类中添加属性
export default class DeepPDFPlugin extends Plugin {
    // ... 现有属性 ...
    private readingModeService: ReadingModeService | null = null;

    // 在 onload 方法中初始化
    async onload() {
        // ... 现有代码 ...

        // 初始化阅读模式服务
        this.readingModeService = new ReadingModeService(this.app);
        this.readingModeService.start();
        console.log('[DeepPDF] Reading mode service started');
    }

    // 在 onunload 方法中清理
    onunload() {
        // ... 现有代码 ...

        // 清理阅读模式服务
        if (this.readingModeService) {
            this.readingModeService.stop();
            this.readingModeService = null;
        }
    }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 3: 提交**

```bash
git add frontend/src/services/reading-mode-service.ts frontend/src/components/reading-mode/ frontend/src/main.ts
git commit -m "feat: 添加阅读模式基础服务和样式

- 创建 ReadingModeService 自动识别章节文件
- 添加书籍化阅读 CSS 样式
- 集成到主插件生命周期

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 2: 悬浮工具栏

### Task 2.1: 创建悬浮工具栏组件

**Files:**
- Create: `frontend/src/components/reading-mode/selection-toolbar.ts`
- Create: `frontend/src/components/reading-mode/selection-toolbar.css`

**Step 1: 创建工具栏样式文件**

```css
/**
 * 悬浮工具栏样式
 */

.deeppdf-selection-toolbar {
    position: fixed;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s, visibility 0.15s;
}

.deeppdf-selection-toolbar.visible {
    opacity: 1;
    visibility: visible;
}

.deeppdf-toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}

.deeppdf-toolbar-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
}

.deeppdf-toolbar-btn.primary:hover {
    background: var(--interactive-accent);
    color: #fff;
}

.deeppdf-toolbar-btn svg {
    width: 16px;
    height: 16px;
}
```

**Step 2: 创建工具栏组件**

```typescript
/**
 * 悬浮工具栏组件
 * 选中文字后显示翻译/提问/摘录操作
 */

import { App, Notice } from 'obsidian';

// 图标
const Icons = {
    translate: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`,
    chat: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    excerpt: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`
};

export interface SelectionToolbarOptions {
    app: App;
    onTranslate: (text: string) => void;
    onAsk: (text: string) => void;
    onExcerpt: (text: string) => void;
}

export class SelectionToolbar {
    private app: App;
    private options: SelectionToolbarOptions;
    private toolbarEl: HTMLElement | null = null;
    private isActive: boolean = false;

    constructor(options: SelectionToolbarOptions) {
        this.app = options.app;
        this.options = options;
    }

    /**
     * 初始化工具栏
     */
    init(): void {
        // 创建工具栏 DOM
        this.toolbarEl = document.body.createDiv({ cls: 'deeppdf-selection-toolbar' });
        this.toolbarEl.innerHTML = `
            <button class="deeppdf-toolbar-btn" data-action="translate">
                ${Icons.translate} 翻译
            </button>
            <button class="deeppdf-toolbar-btn primary" data-action="ask">
                ${Icons.chat} 提问
            </button>
            <button class="deeppdf-toolbar-btn" data-action="excerpt">
                ${Icons.excerpt} 摘录
            </button>
        `;

        // 绑定事件
        this.toolbarEl.querySelectorAll('.deeppdf-toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = (btn as HTMLElement).dataset.action;
                this.handleAction(action!);
            });
        });

        // 监听选中事件
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /**
     * 处理鼠标松开事件
     */
    private handleMouseUp = (e: MouseEvent): void => {
        // 忽略工具栏内的点击
        if (this.toolbarEl?.contains(e.target as Node)) {
            return;
        }

        // 延迟检查选中（等待选中完成）
        setTimeout(() => {
            this.checkSelection();
        }, 10);
    };

    /**
     * 处理键盘事件
     */
    private handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            this.hide();
        }
    };

    /**
     * 检查选中内容
     */
    private checkSelection(): void {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            this.hide();
            return;
        }

        const text = selection.toString().trim();
        if (!text) {
            this.hide();
            return;
        }

        // 检查是否在阅读模式区域内
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const readingMode = document.body.classList.contains('deeppdf-reading-mode');
        if (!readingMode) {
            this.hide();
            return;
        }

        // 显示工具栏
        this.show(text, range);
    }

    /**
     * 显示工具栏
     */
    private show(text: string, range: Range): void {
        if (!this.toolbarEl) return;

        // 存储选中文本
        (this.toolbarEl as any).__selectedText = text;

        // 计算位置
        const rect = range.getBoundingClientRect();
        const toolbarRect = this.toolbarEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = rect.left + rect.width / 2 - toolbarRect.width / 2;
        let top = rect.top - toolbarRect.height - 8;

        // 边界检查
        if (left < 10) left = 10;
        if (left + toolbarRect.width > viewportWidth - 10) {
            left = viewportWidth - toolbarRect.width - 10;
        }
        if (top < 10) {
            top = rect.bottom + 8; // 显示在下方
        }

        this.toolbarEl.style.left = `${left}px`;
        this.toolbarEl.style.top = `${top + window.scrollY}px`;
        this.toolbarEl.classList.add('visible');
    }

    /**
     * 隐藏工具栏
     */
    hide(): void {
        this.toolbarEl?.classList.remove('visible');
    }

    /**
     * 处理按钮点击
     */
    private handleAction(action: string): void {
        const text = (this.toolbarEl as any).__selectedText;
        if (!text) return;

        this.hide();

        switch (action) {
            case 'translate':
                this.options.onTranslate(text);
                break;
            case 'ask':
                this.options.onAsk(text);
                break;
            case 'excerpt':
                this.options.onExcerpt(text);
                break;
        }
    }

    /**
     * 销毁组件
     */
    destroy(): void {
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('keydown', this.handleKeyDown);
        this.toolbarEl?.remove();
        this.toolbarEl = null;
    }
}
```

**Step 3: 保存两个文件**

**Step 4: 更新 index.ts 导出**

```typescript
/**
 * 阅读模式组件
 */

export { ReadingModeService } from '../../services/reading-mode-service.js';
export { SelectionToolbar } from './selection-toolbar.js';
export type { SelectionToolbarOptions } from './selection-toolbar.js';
```

---

### Task 2.2: 集成工具栏到阅读模式服务

**Files:**
- Modify: `frontend/src/services/reading-mode-service.ts`

**Step 1: 更新 ReadingModeService 集成工具栏**

```typescript
// 在文件顶部添加导入
import { SelectionToolbar, SelectionToolbarOptions } from '../components/reading-mode/index.js';

// 在 ReadingModeService 类中添加属性
export class ReadingModeService {
    // ... 现有属性 ...
    private toolbar: SelectionToolbar | null = null;
    private onTranslate: (text: string) => void;
    private onAsk: (text: string) => void;
    private onExcerpt: (text: string) => void;

    constructor(
        app: App,
        callbacks: {
            onTranslate: (text: string) => void;
            onAsk: (text: string) => void;
            onExcerpt: (text: string) => void;
        }
    ) {
        this.app = app;
        this.onTranslate = callbacks.onTranslate;
        this.onAsk = callbacks.onAsk;
        this.onExcerpt = callbacks.onExcerpt;
    }

    // 修改 start 方法
    start(): void {
        // 初始化工具栏
        this.toolbar = new SelectionToolbar({
            app: this.app,
            onTranslate: this.onTranslate,
            onAsk: this.onAsk,
            onExcerpt: this.onExcerpt
        });
        this.toolbar.init();

        // ... 原有的文件监听代码 ...
    }

    // 修改 stop 方法
    stop(): void {
        this.deactivate();
        if (this.toolbar) {
            this.toolbar.destroy();
            this.toolbar = null;
        }
        // ... 原有的清理代码 ...
    }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

### Task 2.3: 在 main.ts 中连接回调

**Files:**
- Modify: `frontend/src/main.ts`

**Step 1: 添加回调处理**

```typescript
// 在初始化 readingModeService 的地方修改
this.readingModeService = new ReadingModeService(this.app, {
    onTranslate: (text: string) => {
        this.handleTranslate(text);
    },
    onAsk: (text: string) => {
        this.handleAsk(text);
    },
    onExcerpt: (text: string) => {
        this.handleExcerpt(text);
    }
});
this.readingModeService.start();

// 添加处理方法
private async handleTranslate(text: string): Promise<void> {
    // 打开侧边栏并发送翻译请求
    await this.openSidebar();
    // TODO: 发送翻译消息
    new Notice('正在翻译...');
}

private async handleAsk(text: string): Promise<void> {
    // 打开侧边栏并填充问题
    await this.openSidebar();
    // TODO: 填充选中文本作为上下文
}

private async handleExcerpt(text: string): Promise<void> {
    // 复用现有摘录功能
    const { ExcerptModal } = await import('./components/excerpt/excerpt-modal.js');
    new ExcerptModal(
        this.app,
        text,
        { source: 'reading-mode' }
    ).open();
}

private async openSidebar(): Promise<void> {
    // 确保侧边栏打开
    const leaf = this.app.workspace.getLeavesOfType('deeppdf-sidebar');
    if (leaf.length === 0) {
        await this.app.workspace.getRightLeaf(false)?.setViewState({
            type: 'deeppdf-sidebar',
            active: true
        });
    } else {
        this.app.workspace.revealLeaf(leaf[0]);
    }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 3: 提交**

```bash
git add frontend/src/components/reading-mode/ frontend/src/services/reading-mode-service.ts frontend/src/main.ts
git commit -m "feat: 添加悬浮工具栏组件

- 创建 SelectionToolbar 组件
- 支持翻译、提问、摘录操作
- 集成到阅读模式服务

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 3: 目录导航 (P1)

> 注：此阶段为可选优化，可后续实现

### Task 3.1: 创建目录导航组件

**Files:**
- Create: `frontend/src/components/reading-mode/reading-outline.ts`
- Create: `frontend/src/components/reading-mode/reading-outline.css`

> 详细实现代码略，参考设计文档

---

## 验收标准

- [ ] 打开章节文件时自动应用阅读样式
- [ ] 选中文字后显示悬浮工具栏
- [ ] 点击「翻译」打开侧边栏
- [ ] 点击「提问」打开侧边栏并填充上下文
- [ ] 点击「摘录」打开摘录模态框
- [ ] 关闭章节文件或打开其他文件时退出阅读模式
