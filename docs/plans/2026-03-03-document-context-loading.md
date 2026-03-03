# 章节辅助阅读 - 文档上下文加载功能

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 允许用户将任意 Markdown 文档（章节、笔记等）加载到对话上下文，让 AI 基于这些内容回答问题，并在引用中提供跳转链接。

**Architecture:** 前端新增 `ContextManager` 服务管理已加载文档，扩展 `ChatInput` 组件添加「加载当前文档」按钮和 @ 提及功能，修改消息发送流程将上下文文档传递给后端，后端扩展 API 接收文档内容并在回复中返回带跳转链接的引用。

**Tech Stack:** TypeScript (Obsidian Plugin API), Python FastAPI, 现有 DeepPDF 架构

---

## Phase 1: 基础功能 - ContextManager 服务与「当前文档」按钮

### Task 1: 创建 ContextManager 服务

**Files:**
- Create: `frontend/src/services/context-manager.ts`

**Step 1: 创建 ContextManager 服务基础结构**

```typescript
/**
 * DeepPDF 上下文管理器
 * 管理已加载到对话上下文的文档
 */

import { App, TFile, Notice } from 'obsidian';

/**
 * 已加载的文档信息
 */
export interface LoadedDocument {
    /** 文件路径 */
    path: string;
    /** 显示名称 */
    name: string;
    /** 文件内容 */
    content: string;
    /** 字符数 */
    charCount: number;
    /** 加载方式 */
    source: 'current' | 'mention' | 'wikilink';
    /** 加载时间 */
    loadedAt: Date;
}

/**
 * 上下文管理器选项
 */
export interface ContextManagerOptions {
    app: App;
    /** 最大上下文字符数（默认 50000） */
    maxContextChars?: number;
    /** 内容变更回调 */
    onContextChange?: (docs: Map<string, LoadedDocument>) => void;
}

/**
 * 上下文管理器
 * 管理已加载到对话上下文的文档
 */
export class ContextManager {
    private app: App;
    private loadedDocs: Map<string, LoadedDocument> = new Map();
    private maxContextChars: number;
    private onContextChange?: (docs: Map<string, LoadedDocument>) => void;

    constructor(options: ContextManagerOptions) {
        this.app = options.app;
        this.maxContextChars = options.maxContextChars || 50000;
        this.onContextChange = options.onContextChange;
    }

    /**
     * 加载当前活跃文档
     * @returns 加载的文档信息，如果没有活跃文档则返回 null
     */
    async loadCurrentDocument(): Promise<LoadedDocument | null> {
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile) {
            new Notice('没有打开的文档');
            return null;
        }

        if (activeFile.extension !== 'md') {
            new Notice('只支持 Markdown 文件');
            return null;
        }

        return await this.loadByPath(activeFile.path, 'current');
    }

    /**
     * 通过路径加载文档
     * @param path 文件路径
     * @param source 加载方式
     * @returns 加载的文档信息
     */
    async loadByPath(path: string, source: 'current' | 'mention' | 'wikilink' = 'mention'): Promise<LoadedDocument | null> {
        // 检查是否已加载
        if (this.loadedDocs.has(path)) {
            new Notice('文档已在上下文中');
            return this.loadedDocs.get(path)!;
        }

        // 检查上下文大小限制
        const currentSize = this.getTotalCharCount();
        const file = this.app.vault.getAbstractFileByPath(path);

        if (!(file instanceof TFile)) {
            new Notice('文件不存在');
            return null;
        }

        // 读取文件内容
        let content: string;
        try {
            content = await this.app.vault.read(file);
        } catch (error) {
            new Notice('读取文件失败');
            console.error('[ContextManager] 读取文件失败:', error);
            return null;
        }

        // 检查是否会超过限制
        if (currentSize + content.length > this.maxContextChars) {
            new Notice(`上下文超出限制（最大 ${this.maxContextChars} 字符）`);
            return null;
        }

        const doc: LoadedDocument = {
            path,
            name: file.basename,
            content,
            charCount: content.length,
            source,
            loadedAt: new Date()
        };

        this.loadedDocs.set(path, doc);
        this.notifyChange();
        new Notice(`已加载: ${doc.name}`);

        return doc;
    }

    /**
     * 移除已加载的文档
     * @param path 文件路径
     */
    removeDocument(path: string): void {
        if (this.loadedDocs.has(path)) {
            this.loadedDocs.delete(path);
            this.notifyChange();
        }
    }

    /**
     * 清空所有已加载的文档
     */
    clearAll(): void {
        this.loadedDocs.clear();
        this.notifyChange();
    }

    /**
     * 获取所有已加载的文档
     */
    getLoadedDocuments(): Map<string, LoadedDocument> {
        return new Map(this.loadedDocs);
    }

    /**
     * 获取已加载文档列表（数组形式）
     */
    getLoadedDocumentsArray(): LoadedDocument[] {
        return Array.from(this.loadedDocs.values());
    }

    /**
     * 获取总字符数
     */
    getTotalCharCount(): number {
        let total = 0;
        for (const doc of this.loadedDocs.values()) {
            total += doc.charCount;
        }
        return total;
    }

    /**
     * 检查是否有已加载的文档
     */
    hasDocuments(): boolean {
        return this.loadedDocs.size > 0;
    }

    /**
     * 获取合并后的上下文内容
     * 用于发送给后端
     */
    getCombinedContext(): string {
        if (this.loadedDocs.size === 0) {
            return '';
        }

        const parts: string[] = [];

        for (const doc of this.loadedDocs.values()) {
            parts.push(`---\n文档: ${doc.name}\n路径: ${doc.path}\n---\n${doc.content}`);
        }

        return parts.join('\n\n');
    }

    /**
     * 通知上下文变更
     */
    private notifyChange(): void {
        this.onContextChange?.(this.loadedDocs);
    }
}
```

**Step 2: 验证 ContextManager 编译通过**

Run: `cd frontend && npm run build`
Expected: 编译成功，无错误

**Step 3: Commit**

```bash
git add frontend/src/services/context-manager.ts
git commit -m "feat: 添加 ContextManager 服务管理对话上下文文档

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 创建已加载文档标签组件

**Files:**
- Create: `frontend/src/components/context-tags/context-tags.ts`
- Create: `frontend/src/components/context-tags/context-tags.css`

**Step 1: 创建 ContextTags 组件**

```typescript
/**
 * DeepPDF 上下文标签组件
 * 显示已加载到上下文的文档标签
 */

import { LoadedDocument } from '../../services/context-manager.js';

export interface ContextTagsOptions {
    /** 文档变更回调 */
    onRemove?: (path: string) => void;
}

export class ContextTags {
    private el: HTMLElement | null = null;
    private options: ContextTagsOptions;

    constructor(options: ContextTagsOptions = {}) {
        this.options = options;
        this.el = this.render();
    }

    /**
     * 渲染组件
     */
    private render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'deeppdf-context-tags';
        container.style.display = 'none'; // 默认隐藏

        return container;
    }

    /**
     * 更新显示的文档标签
     */
    updateDocuments(docs: Map<string, LoadedDocument>): void {
        if (!this.el) return;

        // 清空现有内容
        this.el.innerHTML = '';

        if (docs.size === 0) {
            this.el.style.display = 'none';
            return;
        }

        this.el.style.display = 'flex';

        // 添加标签
        for (const doc of docs.values()) {
            const tag = document.createElement('span');
            tag.className = 'deeppdf-context-tag';

            // 图标 + 名称 + 字符数
            tag.innerHTML = `<span class="deeppdf-context-tag-icon">📄</span>
                <span class="deeppdf-context-tag-name">${this.escapeHtml(doc.name)}</span>
                <span class="deeppdf-context-tag-count">${this.formatCharCount(doc.charCount)}</span>
                <button class="deeppdf-context-tag-remove" data-path="${doc.path}">×</button>`;

            // 移除按钮点击事件
            const removeBtn = tag.querySelector('.deeppdf-context-tag-remove');
            removeBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onRemove?.(doc.path);
            });

            this.el.appendChild(tag);
        }

        // 添加总字符数
        const total = this.getTotalCharCount(docs);
        const summary = document.createElement('span');
        summary.className = 'deeppdf-context-summary';
        summary.textContent = `共 ${this.formatCharCount(total)}`;
        this.el.appendChild(summary);
    }

    /**
     * 获取总字符数
     */
    private getTotalCharCount(docs: Map<string, LoadedDocument>): number {
        let total = 0;
        for (const doc of docs.values()) {
            total += doc.charCount;
        }
        return total;
    }

    /**
     * 格式化字符数
     */
    private formatCharCount(count: number): string {
        if (count >= 1000) {
            return `${Math.round(count / 1000)}k字`;
        }
        return `${count}字`;
    }

    /**
     * HTML 转义
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 获取组件元素
     */
    getElement(): HTMLElement | null {
        return this.el;
    }

    /**
     * 销毁组件
     */
    destroy(): void {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}
```

**Step 2: 创建 ContextTags 样式**

```css
/**
 * DeepPDF 上下文标签组件样式
 */

.deeppdf-context-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--background-secondary);
    border-bottom: 1px solid var(--background-modifier-border);
}

.deeppdf-context-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
}

.deeppdf-context-tag-icon {
    font-size: 10px;
}

.deeppdf-context-tag-name {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.deeppdf-context-tag-count {
    opacity: 0.8;
    font-size: 10px;
}

.deeppdf-context-tag-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-left: 2px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    color: inherit;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.15s;
}

.deeppdf-context-tag-remove:hover {
    background: rgba(255, 255, 255, 0.4);
}

.deeppdf-context-summary {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-muted);
}
```

**Step 3: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add frontend/src/components/context-tags/
git commit -m "feat: 添加 ContextTags 组件显示已加载文档标签

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: 扩展 ChatInput 组件添加「当前文档」按钮

**Files:**
- Modify: `frontend/src/components/chat-input/chat-input.ts`
- Modify: `frontend/src/components/chat-input/chat-input.css`

**Step 1: 扩展 ChatInputOptions 接口**

在 `chat-input.ts` 中添加新的选项：

```typescript
// 在 ChatInputOptions 接口中添加
export interface ChatInputOptions {
    // ... 现有字段 ...
    /** 加载当前文档回调 */
    onLoadCurrentDoc?: () => void;
}
```

**Step 2: 在 ChatInput 类中添加加载文档按钮**

```typescript
// 在 ChatInput 类中添加私有属性
private loadDocButton: HTMLButtonElement | null = null;
private loadDocClickHandler: (() => void) | null = null;

// 在 render() 方法中，在 modeButton 之前添加按钮
// 位置：在 rightToolbar 创建后，modeButton 创建前

// 加载当前文档按钮
this.loadDocButton = rightToolbar.createEl('button', {
    cls: 'deeppdf-load-doc-btn'
});
this.loadDocButton.innerHTML = Icons.file; // 使用文件图标
this.loadDocButton.setAttribute('aria-label', '加载当前文档到上下文');
this.loadDocButton.type = 'button';

// 在 attachEventListeners() 方法中添加事件监听
if (this.loadDocButton && this.options.onLoadCurrentDoc) {
    this.loadDocClickHandler = () => {
        this.options.onLoadCurrentDoc?.();
    };
    this.loadDocButton.addEventListener('click', this.loadDocClickHandler);
}

// 在 destroy() 方法中清理
if (this.loadDocButton && this.loadDocClickHandler) {
    this.loadDocButton.removeEventListener('click', this.loadDocClickHandler);
    this.loadDocClickHandler = null;
}
this.loadDocButton = null;
```

**Step 3: 添加按钮样式**

在 `chat-input.css` 中添加：

```css
/* 加载当前文档按钮 */
.deeppdf-load-doc-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
}

.deeppdf-load-doc-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
}

.deeppdf-load-doc-btn svg {
    width: 16px;
    height: 16px;
}
```

**Step 4: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 5: Commit**

```bash
git add frontend/src/components/chat-input/
git commit -m "feat: 在 ChatInput 组件添加加载当前文档按钮

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 集成 ContextManager 到 SidebarView

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 导入 ContextManager 和 ContextTags**

```typescript
// 在文件顶部添加导入
import { ContextManager, LoadedDocument } from '../services/context-manager.js';
import { ContextTags } from '../components/context-tags/context-tags.js';
```

**Step 2: 在 SidebarView 类中添加属性**

```typescript
// 在类属性区域添加
private contextManager: ContextManager | null = null;
private contextTags: ContextTags | null = null;
```

**Step 3: 在构造函数或初始化方法中创建 ContextManager**

```typescript
// 在适当位置（如 onLoad 或构造函数末尾）初始化
this.contextManager = new ContextManager({
    app: this.app,
    maxContextChars: 50000,
    onContextChange: (docs) => this.handleContextChange(docs)
});
```

**Step 4: 添加上下文变更处理方法**

```typescript
/**
 * 处理上下文文档变更
 */
private handleContextChange(docs: Map<string, LoadedDocument>): void {
    // 更新标签显示
    this.contextTags?.updateDocuments(docs);
}
```

**Step 5: 在渲染聊天界面时添加 ContextTags**

在创建 ChatInput 的地方，同时创建 ContextTags 并插入到输入框上方：

```typescript
// 创建上下文标签
this.contextTags = new ContextTags({
    onRemove: (path) => {
        this.contextManager?.removeDocument(path);
    }
});

// 将标签插入到输入框上方
const inputSection = container.querySelector('.deeppdf-chat-input-section');
if (inputSection && this.contextTags.getElement()) {
    inputSection.insertBefore(this.contextTags.getElement(), inputSection.firstChild);
}
```

**Step 6: 在 ChatInput 配置中添加回调**

```typescript
// 创建 ChatInput 时添加配置
this.chatInput = new ChatInput({
    onSend: (message) => this.handleSendMessage(message),
    onLoadCurrentDoc: () => this.handleLoadCurrentDoc(),
    // ... 其他现有配置 ...
});
```

**Step 7: 添加加载当前文档处理方法**

```typescript
/**
 * 处理加载当前文档
 */
private async handleLoadCurrentDoc(): Promise<void> {
    if (!this.contextManager) return;

    const doc = await this.contextManager.loadCurrentDocument();
    if (doc) {
        // 文档已加载，ContextTags 会自动更新
    }
}
```

**Step 8: 修改消息发送逻辑，附加上下文**

找到 `handleSendMessage` 或类似方法，在发送消息时获取上下文：

```typescript
// 在发送消息时
const contextContent = this.contextManager?.getCombinedContext() || '';
const loadedDocs = this.contextManager?.getLoadedDocumentsArray() || [];

// 将上下文附加到请求中（具体实现取决于 API 调用方式）
```

**Step 9: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 10: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 集成 ContextManager 到 SidebarView

- 初始化 ContextManager 服务
- 添加 ContextTags 组件显示已加载文档
- 添加加载当前文档功能
- 消息发送时附加上下文文档

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: 后端 API 扩展 - 接收上下文文档

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/models.py`
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`
- Modify: `backend/deeppdf-api/src/deeppdf/services/querier.py`

**Step 1: 定义新的数据模型**

在 `models.py` 中添加：

```python
from typing import Optional, List
from pydantic import BaseModel

class DocumentContext(BaseModel):
    """用户加载的文档上下文"""
    path: str
    name: str
    content: str

class ChatRequest(BaseModel):
    """聊天请求"""
    # ... 现有字段 ...
    context_documents: Optional[List[DocumentContext]] = None

class CitationInfo(BaseModel):
    """引用信息"""
    # ... 现有字段 ...
    document_path: Optional[str] = None  # 新增：文档路径，用于跳转
    is_loaded_doc: bool = False  # 新增：是否来自用户加载的文档
```

**Step 2: 修改聊天 API 路由**

在 `routes.py` 中修改聊天端点：

```python
@router.post("/chat")
async def chat(request: ChatRequest):
    # ... 现有逻辑 ...

    # 如果有上下文文档，将其注入到查询中
    if request.context_documents:
        context_text = "\n\n".join([
            f"---\n文档: {doc.name}\n---\n{doc.content}"
            for doc in request.context_documents
        ])
        # 将上下文添加到查询或系统提示中
```

**Step 3: 修改 Prompt 模板**

在服务层添加上下文文档的处理逻辑：

```python
def build_system_prompt_with_context(
    base_prompt: str,
    context_documents: Optional[List[DocumentContext]] = None
) -> str:
    """构建包含上下文文档的系统提示"""
    if not context_documents:
        return base_prompt

    context_section = "\n\n## 用户提供的参考文档\n\n"
    context_section += "以下是用户加载到对话中的文档内容，请在回答时优先参考这些内容：\n\n"

    for doc in context_documents:
        context_section += f"### 文档: {doc.name}\n\n{doc.content}\n\n"

    return base_prompt + context_section
```

**Step 4: 验证后端**

Run: `cd backend/deeppdf-api && uv run ruff check .`
Expected: 无错误

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/api/models.py
git add backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat: 后端 API 支持接收上下文文档

- 添加 DocumentContext 模型
- 扩展 ChatRequest 支持 context_documents
- 修改引用模型支持文档路径跳转

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: 前端 HTTP Client 扩展

**Files:**
- Modify: `frontend/src/api/http-client.ts`

**Step 1: 添加 DocumentContext 类型**

```typescript
// 在 http-client.ts 中添加
export interface DocumentContext {
    path: string;
    name: string;
    content: string;
}
```

**Step 2: 修改 chat 或 queryPDF 方法**

根据现有 API 调用方式，添加 `contextDocuments` 参数：

```typescript
async queryPDF(
    indexId: string,
    query: string,
    options?: {
        sessionId?: string;
        stream?: boolean;
        contextDocuments?: DocumentContext[];
    }
): Promise<QueryPDFResult> {
    // ... 现有逻辑 ...

    // 添加上下文文档到请求体
    const body: any = {
        index_id: indexId,
        query,
        session_id: options?.sessionId,
        stream: options?.stream ?? true,
    };

    if (options?.contextDocuments && options.contextDocuments.length > 0) {
        body.context_documents = options.contextDocuments;
    }

    // ... 发送请求 ...
}
```

**Step 3: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add frontend/src/api/http-client.ts
git commit -m "feat: HTTP Client 支持发送上下文文档

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: 增强引用卡片 - 添加跳转链接

**Files:**
- Modify: `frontend/src/components/message/message.ts`
- Modify: `frontend/src/components/message/message.css`

**Step 1: 修改 CitationData 接口**

```typescript
export interface CitationData {
    // ... 现有字段 ...
    document_path?: string;  // 文档路径，用于跳转
    is_loaded_doc?: boolean;  // 是否来自用户加载的文档
}
```

**Step 2: 在引用渲染中添加跳转按钮**

在渲染引用卡片的代码中添加：

```typescript
// 在引用卡片中添加跳转按钮
if (citation.document_path) {
    const jumpBtn = document.createElement('button');
    jumpBtn.className = 'deeppdf-citation-jump-btn';
    jumpBtn.textContent = '打开文档';
    jumpBtn.addEventListener('click', () => {
        // 使用 Obsidian API 打开文档
        const file = this.app.vault.getAbstractFileByPath(citation.document_path!);
        if (file instanceof TFile) {
            this.app.workspace.openLinkText(file.path, '', true);
        }
    });
    citationEl.appendChild(jumpBtn);
}
```

**Step 3: 添加跳转按钮样式**

```css
.deeppdf-citation-jump-btn {
    padding: 2px 8px;
    font-size: 11px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.15s;
}

.deeppdf-citation-jump-btn:hover {
    opacity: 0.9;
}
```

**Step 4: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 5: Commit**

```bash
git add frontend/src/components/message/
git commit -m "feat: 引用卡片添加跳转到原文档按钮

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 2: @ 提及功能

### Task 8: 创建文件搜索下拉组件

**Files:**
- Create: `frontend/src/components/file-suggest/file-suggest.ts`
- Create: `frontend/src/components/file-suggest/file-suggest.css`

**Step 1: 创建 FileSuggest 组件**

```typescript
/**
 * DeepPDF 文件建议下拉组件
 * 用于 @ 提及和 [[]] 链接时的文件搜索
 */

import { App, TFile } from 'obsidian';

export interface FileSuggestOptions {
    app: App;
    /** 选择文件回调 */
    onSelect: (file: TFile) => void;
    /** 最大显示数量 */
    maxResults?: number;
}

export class FileSuggest {
    private app: App;
    private onSelect: (file: TFile) => void;
    private maxResults: number;
    private el: HTMLElement | null = null;
    private visible: boolean = false;
    private files: TFile[] = [];
    private selectedIndex: number = 0;

    constructor(options: FileSuggestOptions) {
        this.app = options.app;
        this.onSelect = options.onSelect;
        this.maxResults = options.maxResults || 10;
        this.el = this.createDropdown();
    }

    private createDropdown(): HTMLElement {
        const dropdown = document.createElement('div');
        dropdown.className = 'deeppdf-file-suggest';
        dropdown.style.display = 'none';
        document.body.appendChild(dropdown);
        return dropdown;
    }

    /**
     * 搜索并显示结果
     */
    search(query: string): void {
        this.files = this.searchFiles(query);
        this.selectedIndex = 0;
        this.renderResults();
        this.show();
    }

    /**
     * 搜索文件
     */
    private searchFiles(query: string): TFile[] {
        const allFiles = this.app.vault.getMarkdownFiles();
        const queryLower = query.toLowerCase();

        return allFiles
            .filter(file => {
                // 搜索文件名和路径
                return file.basename.toLowerCase().includes(queryLower) ||
                       file.path.toLowerCase().includes(queryLower);
            })
            .slice(0, this.maxResults);
    }

    /**
     * 渲染搜索结果
     */
    private renderResults(): void {
        if (!this.el) return;

        this.el.innerHTML = '';

        if (this.files.length === 0) {
            this.el.innerHTML = '<div class="deeppdf-file-suggest-empty">没有找到匹配的文件</div>';
            return;
        }

        this.files.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'deeppdf-file-suggest-item';
            if (index === this.selectedIndex) {
                item.classList.add('selected');
            }

            // 图标 + 文件名 + 路径
            item.innerHTML = `
                <span class="deeppdf-file-suggest-icon">📄</span>
                <span class="deeppdf-file-suggest-name">${this.escapeHtml(file.basename)}</span>
                <span class="deeppdf-file-suggest-path">${this.escapeHtml(file.parent?.path || '/')}</span>
            `;

            item.addEventListener('click', () => {
                this.selectFile(index);
            });

            this.el!.appendChild(item);
        });
    }

    /**
     * 选择文件
     */
    selectFile(index: number): void {
        if (index >= 0 && index < this.files.length) {
            this.onSelect(this.files[index]);
            this.hide();
        }
    }

    /**
     * 键盘导航
     */
    handleKeydown(event: KeyboardEvent): boolean {
        if (!this.visible) return false;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.files.length - 1);
                this.renderResults();
                return true;

            case 'ArrowUp':
                event.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.renderResults();
                return true;

            case 'Enter':
                event.preventDefault();
                this.selectFile(this.selectedIndex);
                return true;

            case 'Escape':
                this.hide();
                return true;

            default:
                return false;
        }
    }

    /**
     * 显示下拉菜单
     */
    show(): void {
        if (this.el && this.files.length > 0) {
            this.el.style.display = 'block';
            this.visible = true;
        }
    }

    /**
     * 隐藏下拉菜单
     */
    hide(): void {
        if (this.el) {
            this.el.style.display = 'none';
            this.visible = false;
        }
    }

    /**
     * 定位下拉菜单
     */
    setPosition(x: number, y: number): void {
        if (this.el) {
            this.el.style.left = `${x}px`;
            this.el.style.top = `${y}px`;
        }
    }

    /**
     * 是否可见
     */
    isVisible(): boolean {
        return this.visible;
    }

    /**
     * HTML 转义
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 销毁组件
     */
    destroy(): void {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}
```

**Step 2: 创建样式**

```css
.deeppdf-file-suggest {
    position: fixed;
    z-index: 1000;
    min-width: 250px;
    max-width: 400px;
    max-height: 300px;
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.deeppdf-file-suggest-empty {
    padding: 12px 16px;
    color: var(--text-muted);
    font-size: 13px;
    text-align: center;
}

.deeppdf-file-suggest-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background 0.15s;
}

.deeppdf-file-suggest-item:hover,
.deeppdf-file-suggest-item.selected {
    background: var(--background-modifier-hover);
}

.deeppdf-file-suggest-icon {
    font-size: 14px;
    flex-shrink: 0;
}

.deeppdf-file-suggest-name {
    flex: 1;
    font-size: 13px;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.deeppdf-file-suggest-path {
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
}
```

**Step 3: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add frontend/src/components/file-suggest/
git commit -m "feat: 添加 FileSuggest 文件搜索下拉组件

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: 在 ChatInput 中集成 @ 提及功能

**Files:**
- Modify: `frontend/src/components/chat-input/chat-input.ts`

**Step 1: 导入 FileSuggest**

```typescript
import { FileSuggest } from '../file-suggest/file-suggest.js';
import { TFile } from 'obsidian';
```

**Step 2: 添加属性和配置**

```typescript
// 在 ChatInput 类中添加
private fileSuggest: FileSuggest | null = null;
private suggestTrigger: { trigger: string; startPos: number } | null = null;

// 在 ChatInputOptions 接口中添加
export interface ChatInputOptions {
    // ... 现有字段 ...
    app?: App;
    onSelectFile?: (file: TFile) => void;
}
```

**Step 3: 初始化 FileSuggest**

在构造函数中：

```typescript
if (this.options.app) {
    this.fileSuggest = new FileSuggest({
        app: this.options.app,
        onSelect: (file) => this.insertMention(file)
    });
}
```

**Step 4: 添加输入监听**

在 `attachEventListeners()` 中修改 input 事件处理：

```typescript
this.inputHandler = () => {
    this.autoResize();
    this.updateSendButtonState();
    this.checkMentionTrigger();
};

// 添加新方法
private checkMentionTrigger(): void {
    if (!this.textarea || !this.fileSuggest) return;

    const value = this.textarea.value;
    const cursorPos = this.textarea.selectionStart;

    const trigger = this.detectMentionTrigger(value, cursorPos);

    if (trigger) {
        this.suggestTrigger = trigger;
        this.fileSuggest.search(trigger.query);
        this.positionSuggest();
    } else {
        this.fileSuggest.hide();
        this.suggestTrigger = null;
    }
}

private detectMentionTrigger(value: string, cursorPos: number): { trigger: string; query: string; startPos: number } | null {
    const beforeCursor = value.substring(0, cursorPos);

    // 匹配 @xxx 或 [[xxx
    const patterns = [
        { trigger: '@', regex: /@([^@\n]*)$/ },
        { trigger: '[[', regex: /\[\[([^\]\n]*)$/ }
    ];

    for (const { trigger, regex } of patterns) {
        const match = beforeCursor.match(regex);
        if (match) {
            return {
                trigger,
                query: match[1],
                startPos: cursorPos - match[1].length - trigger.length
            };
        }
    }

    return null;
}

private positionSuggest(): void {
    if (!this.fileSuggest || !this.textarea) return;

    // 获取光标位置
    const rect = this.textarea.getBoundingClientRect();
    this.fileSuggest.setPosition(rect.left, rect.top - 5);
}
```

**Step 5: 添加键盘事件处理**

在 `handleKeyDown` 中添加：

```typescript
// 处理下拉菜单键盘导航
if (this.fileSuggest?.handleKeydown(event)) {
    return;
}
```

**Step 6: 添加插入提及方法**

```typescript
private insertMention(file: TFile): void {
    if (!this.textarea || !this.suggestTrigger) return;

    const value = this.textarea.value;
    const { startPos, trigger } = this.suggestTrigger;
    const cursorPos = this.textarea.selectionStart;

    // 替换触发器和查询文本为 [[文件名]]
    const before = value.substring(0, startPos);
    const after = value.substring(cursorPos);

    const newText = `${before}[[${file.basename}]]${after}`;
    this.textarea.value = newText;

    // 移动光标到插入内容之后
    const newCursorPos = startPos + file.basename.length + 4; // 4 = [[ ]].length
    this.textarea.setSelectionRange(newCursorPos, newCursorPos);

    // 触发文件选择回调
    this.options.onSelectFile?.(file);

    // 清理状态
    this.suggestTrigger = null;
    this.autoResize();
    this.updateSendButtonState();
}
```

**Step 7: 清理**

在 `destroy()` 方法中：

```typescript
this.fileSuggest?.destroy();
this.fileSuggest = null;
```

**Step 8: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 9: Commit**

```bash
git add frontend/src/components/chat-input/chat-input.ts
git commit -m "feat: ChatInput 集成 @ 提及和 [[]] 链接功能

- 添加 @ 和 [[ 触发检测
- 集成 FileSuggest 下拉菜单
- 支持键盘导航和文件选择

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: 解析消息中的文档引用并加载

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 添加引用解析方法**

```typescript
/**
 * 解析消息中的文档引用
 * 支持 [[文件名]] 格式
 */
private async parseAndLoadReferences(message: string): Promise<void> {
    if (!this.contextManager) return;

    // 匹配 [[文件名]] 格式
    const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
    let match;

    while ((match = wikilinkRegex.exec(message)) !== null) {
        const fileName = match[1];

        // 查找文件
        const files = this.app.vault.getMarkdownFiles();
        const file = files.find(f =>
            f.basename === fileName ||
            f.basename.toLowerCase() === fileName.toLowerCase()
        );

        if (file) {
            await this.contextManager.loadByPath(file.path, 'wikilink');
        }
    }
}
```

**Step 2: 在发送消息时调用**

在 `handleSendMessage` 方法中：

```typescript
// 先解析并加载引用的文档
await this.parseAndLoadReferences(message);

// 然后获取所有已加载的上下文
const contextDocuments = this.contextManager?.getLoadedDocumentsArray().map(doc => ({
    path: doc.path,
    name: doc.name,
    content: doc.content
})) || [];

// 发送请求时附带上下文
```

**Step 3: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 发送消息时解析并加载 [[文件名]] 引用

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 3: 优化与测试

### Task 11: 添加单元测试

**Files:**
- Create: `frontend/src/services/__tests__/context-manager.test.ts`

**Step 1: 创建 ContextManager 测试**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from '../context-manager';

// Mock Obsidian API
vi.mock('obsidian', () => ({
    App: vi.fn(),
    TFile: vi.fn(),
    Notice: vi.fn()
}));

describe('ContextManager', () => {
    let contextManager: ContextManager;
    let mockApp: any;

    beforeEach(() => {
        mockApp = {
            workspace: {
                getActiveFile: vi.fn()
            },
            vault: {
                getAbstractFileByPath: vi.fn(),
                read: vi.fn()
            }
        };

        contextManager = new ContextManager({
            app: mockApp,
            maxContextChars: 1000
        });
    });

    it('should return null when no active file', async () => {
        mockApp.workspace.getActiveFile.mockReturnValue(null);
        const result = await contextManager.loadCurrentDocument();
        expect(result).toBeNull();
    });

    it('should load document successfully', async () => {
        const mockFile = {
            path: 'test.md',
            basename: 'test',
            extension: 'md'
        };

        mockApp.workspace.getActiveFile.mockReturnValue(mockFile);
        mockApp.vault.read.mockResolvedValue('test content');

        const result = await contextManager.loadCurrentDocument();

        expect(result).not.toBeNull();
        expect(result?.name).toBe('test');
        expect(result?.content).toBe('test content');
    });

    it('should not load same document twice', async () => {
        const mockFile = {
            path: 'test.md',
            basename: 'test',
            extension: 'md'
        };

        mockApp.workspace.getActiveFile.mockReturnValue(mockFile);
        mockApp.vault.read.mockResolvedValue('test content');

        await contextManager.loadCurrentDocument();
        await contextManager.loadCurrentDocument();

        expect(contextManager.getLoadedDocumentsArray().length).toBe(1);
    });

    it('should respect max context size', async () => {
        const mockFile = {
            path: 'test.md',
            basename: 'test',
            extension: 'md'
        };

        mockApp.workspace.getActiveFile.mockReturnValue(mockFile);
        mockApp.vault.read.mockResolvedValue('a'.repeat(500));

        await contextManager.loadCurrentDocument();

        // 尝试加载第二个大文件
        mockApp.vault.read.mockResolvedValue('b'.repeat(600));
        const result = await contextManager.loadCurrentDocument();

        // 应该因为超过限制而失败
        expect(contextManager.getLoadedDocumentsArray().length).toBe(1);
    });
});
```

**Step 2: 运行测试**

Run: `cd frontend && npm run test:run`
Expected: 测试通过

**Step 3: Commit**

```bash
git add frontend/src/services/__tests__/
git commit -m "test: 添加 ContextManager 单元测试

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 12: 更新样式导入

**Files:**
- Modify: `frontend/src/styles/main.css`

**Step 1: 添加新组件样式导入**

```css
@import url('../components/context-tags/context-tags.css');
@import url('../components/file-suggest/file-suggest.css');
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add frontend/src/styles/main.css
git commit -m "chore: 添加新组件样式导入

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 最终验证

### Task 13: 完整功能测试

**Step 1: 构建前端**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 2: 构建后端**

Run: `cd backend/deeppdf-api && uv run ruff check . && uv run black . --check`
Expected: 无错误

**Step 3: 手动测试清单**

- [ ] 打开 DeepPDF 侧边栏
- [ ] 打开一个 Markdown 文档
- [ ] 点击「加载当前文档」按钮
- [ ] 确认文档标签显示在输入框上方
- [ ] 输入问题并发送
- [ ] 确认 AI 回答引用了加载的文档内容
- [ ] 点击引用中的「打开文档」按钮
- [ ] 确认跳转到原文档
- [ ] 在输入框中输入 `@` 测试文件搜索下拉
- [ ] 在输入框中输入 `[[` 测试 wikilink 搜索
- [ ] 测试点击标签上的 × 移除文档
- [ ] 测试加载多个文档

---

## 总结

**新增文件:**
- `frontend/src/services/context-manager.ts`
- `frontend/src/components/context-tags/context-tags.ts`
- `frontend/src/components/context-tags/context-tags.css`
- `frontend/src/components/file-suggest/file-suggest.ts`
- `frontend/src/components/file-suggest/file-suggest.css`
- `frontend/src/services/__tests__/context-manager.test.ts`

**修改文件:**
- `frontend/src/components/chat-input/chat-input.ts`
- `frontend/src/components/chat-input/chat-input.css`
- `frontend/src/components/message/message.ts`
- `frontend/src/components/message/message.css`
- `frontend/src/views/sidebar-view.ts`
- `frontend/src/api/http-client.ts`
- `frontend/src/styles/main.css`
- `backend/deeppdf-api/src/deeppdf/api/models.py`
- `backend/deeppdf-api/src/deeppdf/api/routes.py`
