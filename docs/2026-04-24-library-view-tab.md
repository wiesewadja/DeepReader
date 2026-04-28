# 书库模态弹窗改 Tab 视图实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将书库从模态弹窗改为 Obsidian 原生 Tab 视图，在主面板全屏展示，支持自适应宽度布局

**Architecture:** 创建新的 `LibraryView` 类继承 `ItemView`，复用 `LibraryModal` 的渲染逻辑，注册为独立视图类型，在主面板打开

**Tech Stack:** TypeScript, Obsidian API (ItemView, WorkspaceLeaf), 原生 DOM

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/views/library-view.ts` | 创建 | 新的 Tab 视图实现 |
| `src/views/library-view.css` | 创建 | Tab 视图样式 |
| `src/main.ts` | 修改 | 注册新视图类型，添加命令 |
| `src/views/sidebar-view.ts` | 修改 | 修改触发方式，从打开 Modal 改为打开 Tab |
| `src/components/library-modal/index.ts` | 修改 | 更新导出，移除 Modal 类导出 |
| `src/components/library-modal/library-modal.ts` | 保留 | 保留核心渲染逻辑供复用 |

---

## Chunk 1: 创建 LibraryView 基础结构

### Task 1: 创建 LibraryView 类基础框架

**Files:**
- Create: `src/views/library-view.ts`

- [ ] **Step 1: 创建 LibraryView 基础类**

```typescript
/**
 * DeepReader 书库视图
 * 在主面板全屏展示书库，支持自适应宽度布局
 */

import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { IndexListItem } from '../types/index.js';
import { PDFFileSelectorModal, DocumentFileInfo, SystemFileInfo, FileSelectResult, isSystemFileInfo } from '../ui/pdf-file-selector.js';
import { ConfirmModal } from '../components/confirm-modal.js';
import { error as logError, serviceLog } from '../utils/logger.js';
import { indexBook, isBookIndexed, deleteBookIndex, generateBookId } from '../pageindex/book-indexer.js';
import type { BookIndexProgress, BookMeta } from '../pageindex/book-types.js';
import { resolveRoleConfig } from '../config/providers.js';
import { toEmbeddingOptions, toPropositionConfig } from '../config/role-adapters.js';
import { loadProgress, getProgressPercent, createEmptyProgress } from '../pageindex/reading-progress.js';
import * as path from 'path';
import * as fs from 'fs/promises';

export const LIBRARY_VIEW_TYPE = 'deeppdf-library-view';

export interface LibraryViewOptions {
    indexes: IndexListItem[];
    selectedIndexId: string | null;
    onIndexChange?: (indexId: string) => void;
    onCreateIndex?: () => Promise<void>;
    onDeleteIndex?: (indexId: string) => Promise<IndexListItem[] | undefined>;
    onRefresh?: () => Promise<IndexListItem[]>;
    onDownloadCover?: (indexId: string, pdfName: string) => Promise<string | null>;
    plugin: any;
}

export class LibraryView extends ItemView {
    private options: LibraryViewOptions;
    private indexes: IndexListItem[];
    private selectedIndexId: string | null;
    private searchQuery: string = '';
    private gridEl: HTMLElement | null = null;
    private searchInputEl: HTMLInputElement | null = null;
    private pollingInterval: number | null = null;
    private coverCache: Map<string, string> = new Map();
    private loadingCovers: Set<string> = new Set();
    private lastIndexStates: Map<string, { status: string; progress: number; message: string }> = new Map();
    private cardElements: Map<string, HTMLElement> = new Map();
    private readingProgressCache: Map<string, number> = new Map();

    constructor(leaf: WorkspaceLeaf, options: LibraryViewOptions) {
        super(leaf);
        this.options = options;
        this.indexes = [...options.indexes];
        this.selectedIndexId = options.selectedIndexId;
    }

    getViewType(): string {
        return LIBRARY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '书库';
    }

    getIcon(): string {
        return 'lucide-library';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1]; // 跳过 nav-header
        container.empty();
        container.addClass('deeppdf-library-view');
        
        await this.loadReadingProgresses();
        this.render();
    }

    async onClose(): Promise<void> {
        this.cleanup();
    }

    private render(): void {
        const container = this.containerEl.children[1];
        container.empty();

        // 标题行
        const header = container.createDiv({ cls: 'deeppdf-lib-header' });
        header.createEl('h2', { text: '我的书库', cls: 'deeppdf-lib-title' });

        // 工具栏：搜索 + 添加
        const toolbar = container.createDiv({ cls: 'deeppdf-lib-toolbar' });
        // ... (复用 LibraryModal 的工具栏渲染逻辑)

        // 卡片网格
        this.gridEl = container.createDiv({ cls: 'deeppdf-lib-grid' });
        this.renderGrid();

        // 启动进度轮询
        this.startProgressPolling();
    }

    private renderGrid(): void {
        // ... (复用 LibraryModal 的网格渲染逻辑)
    }

    // ... (其他方法)
}
```

- [ ] **Step 2: 运行类型检查确认无语法错误**

Run: `npm run build`
Expected: 构建成功，无类型错误

### Task 2: 实现核心渲染逻辑

**Files:**
- Modify: `src/views/library-view.ts`

- [ ] **Step 1: 从 LibraryModal 复制渲染逻辑**

从 `library-modal.ts` 复制以下方法到 `LibraryView`：
- `renderGrid()` - 渲染卡片网格
- `createBookCard()` - 创建单个书籍卡片
- `renderCoverArea()` - 渲染封面区域
- `loadCoverAndDisplay()` - 加载封面图片
- `getDisplayName()` - 获取显示名称
- `getChapterCount()` - 获取章节数
- `sortIndexes()` - 排序索引列表
- `loadReadingProgresses()` - 加载阅读进度
- `updateCardsIncrementally()` - 增量更新卡片

- [ ] **Step 2: 运行类型检查确认无语法错误**

Run: `npm run build`
Expected: 构建成功，无类型错误

### Task 3: 实现交互逻辑

**Files:**
- Modify: `src/views/library-view.ts`

- [ ] **Step 1: 从 LibraryModal 复制交互逻辑**

从 `library-modal.ts` 复制以下方法到 `LibraryView`：
- `handleSelect()` - 处理书籍选择（修改为不调用 `this.close()`）
- `handleAddDocument()` - 添加书籍
- `confirmDelete()` - 确认删除
- `retryIndex()` - 重试索引
- `checkBookChaptersExist()` - 检查章节是否存在
- `startProgressPolling()` - 启动进度轮询
- `stopProgressPolling()` - 停止进度轮询

- [ ] **Step 2: 修改 handleSelect 方法**

将 `this.close()` 替换为切换回聊天视图的逻辑：

```typescript
private handleSelect(index: IndexListItem): void {
    // ... (原有逻辑)
    
    this.selectedIndexId = index.id;
    this.options.onIndexChange?.(index.id);
    
    // 不再关闭弹窗，而是切换回聊天视图
    // this.close(); // 移除这行
}
```

- [ ] **Step 3: 运行类型检查确认无语法错误**

Run: `npm run build`
Expected: 构建成功，无类型错误

---

## Chunk 2: 创建样式和注册视图

### Task 4: 创建 LibraryView 样式

**Files:**
- Create: `src/views/library-view.css`

- [ ] **Step 1: 创建全宽自适应样式**

```css
/**
 * DeepReader 书库视图样式
 * 全宽自适应布局，卡片网格根据面板宽度自适应列数
 */

/* 视图容器 */
.deeppdf-library-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

/* 头部 */
.deeppdf-lib-header {
    padding: 16px 24px 0;
    flex-shrink: 0;
}

.deeppdf-lib-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
    color: var(--text-normal);
}

/* 工具栏 */
.deeppdf-lib-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
}

.deeppdf-lib-search {
    flex: 1;
    max-width: 400px;
}

.deeppdf-lib-search-input {
    width: 100%;
    padding: 10px 16px;
    font-size: 14px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-primary);
    color: var(--text-normal);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
}

.deeppdf-lib-search-input::placeholder {
    color: var(--text-faint);
}

.deeppdf-lib-search-input:focus {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 3px rgba(var(--interactive-accent-rgb, 84, 109, 229), 0.1);
}

.deeppdf-lib-add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-primary);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
}

.deeppdf-lib-add-btn:hover {
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
    color: #fff;
}

/* 卡片网格 - 自适应列数 */
.deeppdf-lib-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 20px;
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
}

.deeppdf-lib-grid::-webkit-scrollbar {
    width: 8px;
}

.deeppdf-lib-grid::-webkit-scrollbar-track {
    background: transparent;
}

.deeppdf-lib-grid::-webkit-scrollbar-thumb {
    background: var(--background-modifier-border);
    border-radius: 4px;
}

.deeppdf-lib-grid::-webkit-scrollbar-thumb:hover {
    background: var(--text-faint);
}

/* 书籍卡片 */
.deeppdf-lib-card {
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    overflow: hidden;
    transition: all 0.2s ease;
    cursor: pointer;
}

.deeppdf-lib-card:hover {
    border-color: var(--interactive-accent);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
}

.deeppdf-lib-card.selected {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px var(--interactive-accent);
}

/* 封面区域 */
.deeppdf-lib-cover {
    position: relative;
    aspect-ratio: 3/4;
    background: var(--background-secondary);
    overflow: hidden;
}

.deeppdf-lib-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.deeppdf-lib-cover-text {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 16px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-muted);
    text-align: center;
    word-break: break-word;
}

/* 书籍信息 */
.deeppdf-lib-info {
    padding: 12px;
}

.deeppdf-lib-name {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
}

.deeppdf-lib-name-text {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.deeppdf-lib-type-tag {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    flex-shrink: 0;
}

.deeppdf-lib-author {
    font-size: 12px;
    color: var(--text-faint);
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.deeppdf-lib-meta {
    font-size: 11px;
    color: var(--text-faint);
    margin-bottom: 8px;
}

/* 阅读进度条 */
.deeppdf-lib-progress {
    height: 4px;
    background: var(--background-modifier-border);
    border-radius: 2px;
    overflow: hidden;
}

.deeppdf-lib-progress-bar {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 2px;
    transition: width 0.3s ease;
}

/* 操作按钮 */
.deeppdf-lib-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.deeppdf-lib-card:hover .deeppdf-lib-actions {
    opacity: 1;
}

.deeppdf-lib-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
}

.deeppdf-lib-action-btn:hover {
    background: rgba(0, 0, 0, 0.8);
}

.deeppdf-lib-action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.8);
}

/* 加载状态 */
.deeppdf-lib-loading {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
}

.deeppdf-lib-loading svg {
    animation: deeppdf-spin 1s linear infinite;
    color: #fff;
}

@keyframes deeppdf-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* 空状态 */
.deeppdf-lib-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--text-faint);
}

.deeppdf-lib-empty svg {
    margin-bottom: 16px;
    opacity: 0.5;
}

.deeppdf-lib-empty-title {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 8px;
    color: var(--text-normal);
}

.deeppdf-lib-empty-desc {
    font-size: 13px;
    text-align: center;
    max-width: 300px;
}
```

- [ ] **Step 2: 在 main.ts 中导入样式**

```typescript
// 在 main.ts 顶部添加
import './views/library-view.css';
```

- [ ] **Step 3: 运行构建确认样式生效**

Run: `npm run build`
Expected: 构建成功，styles.css 包含新的样式

### Task 5: 注册视图和命令

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 导入 LibraryView**

```typescript
import { LibraryView, LIBRARY_VIEW_TYPE } from "./views/library-view.js";
```

- [ ] **Step 2: 注册视图类型**

在 `registerView` 调用后添加：

```typescript
// 注册书库视图
this.registerView(
    LIBRARY_VIEW_TYPE,
    (leaf) => new LibraryView(leaf, {
        indexes: [],
        selectedIndexId: null,
        onIndexChange: (indexId) => {
            // 找到 SidebarView 并调用 selectIndex
            const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
            if (sidebarLeaves.length > 0) {
                const sidebarView = sidebarLeaves[0].view as SidebarView;
                sidebarView.selectIndex(indexId);
            }
        },
        onDeleteIndex: async (indexId) => {
            const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
            if (sidebarLeaves.length > 0) {
                const sidebarView = sidebarLeaves[0].view as SidebarView;
                await sidebarView.handleDeleteIndex(indexId);
                return sidebarView.indexes;
            }
            return [];
        },
        onRefresh: async () => {
            const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
            if (sidebarLeaves.length > 0) {
                const sidebarView = sidebarLeaves[0].view as SidebarView;
                await sidebarView.loadIndexes();
                return sidebarView.indexes;
            }
            return [];
        },
        plugin: this
    })
);
```

- [ ] **Step 3: 添加打开书库的命令**

```typescript
// 添加打开书库的命令
this.addCommand({
    id: "open-library",
    name: "Open Library",
    callback: () => this.openLibraryView()
});
```

- [ ] **Step 4: 添加打开书库的方法**

```typescript
/**
 * 打开书库视图
 */
async openLibraryView(): Promise<void> {
    // 检查是否已有书库视图
    const existingLeaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
    if (existingLeaves.length > 0) {
        // 聚焦现有视图
        this.app.workspace.revealLeaf(existingLeaves[0]);
        return;
    }

    // 获取 SidebarView 的 indexes 数据
    const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    let indexes: IndexListItem[] = [];
    if (sidebarLeaves.length > 0) {
        const sidebarView = sidebarLeaves[0].view as SidebarView;
        await sidebarView.loadIndexes();
        indexes = sidebarView.indexes;
    }

    // 在主面板打开书库视图
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
        type: LIBRARY_VIEW_TYPE,
        state: { indexes, selectedIndexId: null }
    });
}
```

- [ ] **Step 5: 运行类型检查确认无语法错误**

Run: `npm run build`
Expected: 构建成功，无类型错误

### Task 6: 修改 SidebarView 触发方式

**Files:**
- Modify: `src/views/sidebar-view.ts`

- [ ] **Step 1: 导入 LIBRARY_VIEW_TYPE**

```typescript
import { LIBRARY_VIEW_TYPE } from './library-view.js';
```

- [ ] **Step 2: 修改 openLibraryModal 方法**

将打开 Modal 改为打开 Tab 视图：

```typescript
/**
 * 打开书库（改为 Tab 视图）
 */
private async openLibrary(): Promise<void> {
    await this.loadIndexes();

    // 检查是否已有书库视图
    const existingLeaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
    if (existingLeaves.length > 0) {
        // 聚焦现有视图
        this.app.workspace.revealLeaf(existingLeaves[0]);
        return;
    }

    // 在主面板打开书库视图
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
        type: LIBRARY_VIEW_TYPE,
        state: { indexes: this.indexes, selectedIndexId: this.currentIndexId }
    });
}
```

- [ ] **Step 3: 更新所有调用点**

搜索并替换所有 `openLibraryModal()` 调用为 `openLibrary()`：

```typescript
// 在 ReadingTopbar 的 onOpenLibrary 回调中
onOpenLibrary: () => {
    this.openLibrary();
}
```

- [ ] **Step 4: 运行类型检查确认无语法错误**

Run: `npm run build`
Expected: 构建成功，无类型错误

---

## Chunk 3: 验证和清理

### Task 7: 测试完整流程

- [ ] **Step 1: 部署到测试 Vault**

Run: `npm run deploy`

- [ ] **Step 2: 在 Obsidian 中测试**

1. 打开 DeepReader 侧边栏
2. 点击 "我的书库" 按钮
3. 验证书库在主面板以 Tab 形式打开
4. 验证卡片网格自适应宽度
5. 点击书籍卡片，验证能正确选择书籍
6. 验证搜索功能正常
7. 验证添加书籍功能正常
8. 验证删除书籍功能正常

- [ ] **Step 3: 验证命令面板**

1. 打开命令面板 (Cmd/Ctrl + P)
2. 搜索 "Open Library"
3. 验证能正确打开书库视图

### Task 8: 清理旧代码

**Files:**
- Modify: `src/components/library-modal/index.ts`

- [ ] **Step 1: 更新导出**

移除 `LibraryModal` 的导出，保留类型定义：

```typescript
// 只导出类型定义，不再导出 Modal 类
export type { LibraryModalOptions } from './library-modal.js';
```

- [ ] **Step 2: 更新 library-modal.ts**

添加注释说明已废弃：

```typescript
/**
 * @deprecated 此类已废弃，请使用 LibraryView 代替
 * 保留此文件是为了复用其渲染逻辑
 */
export class LibraryModal extends Modal {
    // ... (保持不变)
}
```

- [ ] **Step 3: 运行构建确认无错误**

Run: `npm run build`
Expected: 构建成功，无类型错误

---

## 验证清单

- [ ] 书库在主面板以 Tab 形式打开
- [ ] 卡片网格根据面板宽度自适应列数
- [ ] 搜索功能正常工作
- [ ] 添加书籍功能正常工作
- [ ] 删除书籍功能正常工作
- [ ] 选择书籍后能正确切换到聊天视图
- [ ] 进度轮询正常工作
- [ ] 封面图片正常显示
- [ ] 阅读进度条正常显示
- [ ] 命令面板 "Open Library" 命令正常工作
- [ ] 无类型错误
- [ ] 无运行时错误
