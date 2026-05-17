/**
 * DeepReader 书库视图
 * 在主面板全屏展示书库，支持自适应宽度布局
 */

import { ItemView, WorkspaceLeaf, Notice, TFile, TFolder } from 'obsidian';
import { sanitizeFileName } from '../weread/utils/file';
import { IndexListItem } from '../types/index.js';
import { PDFFileSelectorModal, DocumentFileInfo, SystemFileInfo, FileSelectResult, isSystemFileInfo } from '../ui/pdf-file-selector.js';
import { ConfirmModal } from '../components/confirm-modal.js';
import { error as logError, serviceLog } from '../utils/logger.js';
import { indexBook, isBookIndexed, deleteBookIndex, generateBookId } from '../pageindex/book-indexer.js';
import type { BookIndexProgress, BookMeta } from '../pageindex/book-types.js';
import { resolveRoleConfig } from '../config/providers.js';
import { toEmbeddingOptions, toPropositionConfig } from '../config/role-adapters.js';
import { loadProgress, getProgressPercent, createEmptyProgress } from '../pageindex/reading-progress.js';
import { DEFAULT_EXPORT_DIR, DEFAULT_ASSETS_PATH } from '../pageindex/defaults.js';
import * as path from 'path';
import * as fs from 'fs/promises';

export const LIBRARY_VIEW_TYPE = 'deeppdf-library-view';

/** Proposition 功能开关 — token 成本过高，优化后重新启用 */
const PROPOSITION_ENABLED = false;

const PROCESSING_STATUSES = new Set([
    'processing', 'indexing', 'started', 'created',
    'running', 'active', 'pending', 'queued', 'uploading',
]);
const READY_STATUSES = new Set(['ready', 'completed', 'success']);
const FAILED_STATUSES = new Set(['failed', 'error']);

// SVG 图标
const Icons = {
    add: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
    checkCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" fill="#10b981" stroke="#10b981"/><polyline points="16 9 10.5 14.5 8 12" stroke="white" stroke-width="2.5"/></svg>`,
    book: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    loading: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    empty: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
};

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
    private indexes: IndexListItem[] = [];
    private selectedIndexId: string | null = null;
    private searchQuery: string = '';
    private gridEl: HTMLElement | null = null;
    private searchInputEl: HTMLInputElement | null = null;
    private pollingInterval: number | null = null;
    private coverCache: Map<string, string> = new Map();
    private loadingCovers: Set<string> = new Set();
    private lastIndexStates: Map<string, { status: string; progress: number; message: string }> = new Map();
    private cardElements: Map<string, HTMLElement> = new Map();
    private readingProgressCache: Map<string, number> = new Map();
    private wereadMappingCache: Set<string> = new Set(); // 已关联微信读书的 deepReaderBookId 集合
    private resizeObserver: ResizeObserver | null = null;
    private _searchDebounce: number | null = null;

    constructor(leaf: WorkspaceLeaf, options: LibraryViewOptions) {
        super(leaf);
        this.options = options;
        // 不在 constructor 中初始化 indexes，因为 setViewState 的 state 还未应用
        // 改在 onOpen 中从 state 初始化
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
        
        // 从 state 初始化数据（如果有的话）
        const state = this.getState() as { indexes?: IndexListItem[]; selectedIndexId?: string | null } | null;
        if (state?.indexes) {
            this.indexes = state.indexes;
            this.selectedIndexId = state.selectedIndexId ?? null;
        }
        
        await this.loadReadingProgresses();
        this.render();
    }

    async onClose(): Promise<void> {
        this.cleanup();
    }

    async setState(state: any): Promise<void> {
        // 当 setViewState 被调用时，会触发 setState
        // 更新数据并重新渲染
        if (state?.indexes) {
            this.indexes = state.indexes as IndexListItem[];
            this.selectedIndexId = (state.selectedIndexId as string) ?? null;
            
            // 如果视图已打开，重新加载进度并渲染
            if (this.gridEl) {
                await this.loadReadingProgresses();
                this.render();
            }
        }
    }

    private cleanup(): void {
        if (this.pollingInterval) {
            window.clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    private render(): void {
        const container = this.containerEl.children[1];
        container.empty();

        // 标题行
        const header = container.createDiv({ cls: 'deeppdf-lib-header' });
        header.createEl('h2', { text: '我的书库', cls: 'deeppdf-lib-title' });

        // 工具栏：搜索 + 添加
        const toolbar = container.createDiv({ cls: 'deeppdf-lib-toolbar' });

        const searchWrap = toolbar.createDiv({ cls: 'deeppdf-lib-search' });
        this.searchInputEl = searchWrap.createEl('input', {
            cls: 'deeppdf-lib-search-input',
            attr: { type: 'text', placeholder: '搜索书籍...' }
        });
        this.searchInputEl.addEventListener('input', () => {
            if (this._searchDebounce != null) clearTimeout(this._searchDebounce);
            this._searchDebounce = window.setTimeout(() => {
                this.searchQuery = this.searchInputEl?.value || '';
                this.renderGrid();
            }, 300);
        });

        const addBtn = toolbar.createEl('button', { cls: 'deeppdf-lib-add-btn' });
        addBtn.innerHTML = Icons.add;
        addBtn.title = '添加书籍';
        addBtn.addEventListener('click', () => this.handleAddDocument());

        // 卡片网格
        this.gridEl = container.createDiv({ cls: 'deeppdf-lib-grid' });
        this.renderGrid();
    }

    private renderGrid(): void {
        if (!this.gridEl) return;

        // 首次渲染时异步加载微信读书映射，加载完后刷新徽章
        if (this.wereadMappingCache.size === 0) {
            this.loadWereadMapping().then(() => this.refreshWereadBadges());
        }

        // 清空所有缓存和引用
        this.cardElements.clear();
        this.lastIndexStates.clear();

        this.gridEl.innerHTML = '';

        // 过滤
        const filtered = this.searchQuery
            ? this.indexes.filter(idx =>
                  idx.pdf_name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                  (idx.author && idx.author.toLowerCase().includes(this.searchQuery.toLowerCase()))
              )
            : this.indexes;

        if (filtered.length === 0) {
            this.gridEl.innerHTML = `
                <div class="deeppdf-lib-empty">
                    <div class="deeppdf-lib-empty-icon">${Icons.empty}</div>
                    <div class="deeppdf-lib-empty-text">${this.searchQuery ? '未找到匹配书籍' : '书架空空如也'}</div>
                    <div class="deeppdf-lib-empty-hint">${this.searchQuery ? '' : '点击右上角 + 添加第一本书'}</div>
                </div>
            `;
            return;
        }

        // 按状态排序
        const sorted = this.sortIndexes(filtered);
        sorted.forEach(index => {
            const card = this.createBookCard(index);
            this.gridEl!.appendChild(card);
            // 保存卡片引用
            this.cardElements.set(index.id, card);
            // 保存初始状态
            this.lastIndexStates.set(index.id, {
                status: index.status || 'unknown',
                progress: index.progress_percent || 0,
                message: index.message || ''
            });
        });

        // Start polling if any indexes are in progress
        const hasProcessing = filtered.some(idx => {
            const rawStatus = (idx.status || '').toLowerCase();
            return PROCESSING_STATUSES.has(rawStatus);
        });
        if (hasProcessing) {
            this.startProgressPolling();
        }

        // 设置封面高度（JS 动态计算，避免 CSS aspect-ratio 在 Obsidian 中不生效）
        requestAnimationFrame(() => this.updateCoverHeights());

        // 监听容器尺寸变化，实时重新计算封面高度
        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                requestAnimationFrame(() => this.updateCoverHeights());
            });
        }
        this.resizeObserver.observe(this.gridEl);
    }

/**
     * 动态计算封面高度：遍历所有卡片，根据宽度 × 4/3 设置封面高度
     * 用于替代 CSS aspect-ratio（在 Obsidian 的 flex 布局中不生效）
     */
    private updateCoverHeights(): void {
        if (!this.gridEl) return;
        const cards = this.gridEl.querySelectorAll('.deeppdf-lib-book-card');
        cards.forEach(card => {
            const coverEl = card.querySelector('.deeppdf-lib-book-cover') as HTMLElement;
            if (!coverEl) return;
            const cardWidth = (card as HTMLElement).offsetWidth;
            if (cardWidth > 0) {
                const height = Math.round(cardWidth * 4 / 3);
                coverEl.style.height = `${height}px`;
            }
        });
    }

    private sortIndexes(indexes: IndexListItem[]): IndexListItem[] {
        const priority: Record<string, number> = {
            'processing': 0, 'indexing': 0, 'started': 0, 'running': 0,
            'pending': 1, 'queued': 1,
            'ready': 2, 'completed': 2, 'success': 2,
            'failed': 3, 'error': 3
        };
        return [...indexes].sort((a, b) =>
            (priority[(a.status || '').toLowerCase()] ?? 4) -
            (priority[(b.status || '').toLowerCase()] ?? 4)
        );
    }

    private createBookCard(index: IndexListItem): HTMLElement {
        const card = document.createElement('div');
        card.className = 'deeppdf-lib-book-card';

        const isSelected = index.id === this.selectedIndexId;
        if (isSelected) {
            card.classList.add('selected');
        }

        // 状态判断
        const rawStatus = (index.status || 'unknown').toLowerCase();
        let statusClass = 'ready';

        if (PROCESSING_STATUSES.has(rawStatus)) {
            statusClass = 'processing';
        } else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
            statusClass = 'queued';
        } else if (FAILED_STATUSES.has(rawStatus)) {
            statusClass = 'failed';
        }

        // 书名处理
        let bookName = index.pdf_name;
        if (bookName.toLowerCase().endsWith('.pdf')) bookName = bookName.slice(0, -4);
        if (bookName.toLowerCase().endsWith('.epub')) bookName = bookName.slice(0, -5);
        // Simplified name for cover lookup (matches exportName used during indexing)
        const coverName = this.getDisplayName(bookName);

        // 封面区域
        const coverEl = card.createDiv({ cls: 'deeppdf-lib-book-cover' });

        if (statusClass === 'processing') {
            // 索引中显示加载动画 + 进度
            coverEl.innerHTML = `<div class="deeppdf-lib-cover-loading">${Icons.loading}</div>`;

            // 进度条 + 详细消息
            const progress = index.progress_percent || 0;
            const message = index.message || '';
            const progressEl = coverEl.createDiv({ cls: 'deeppdf-lib-progress-overlay' });
            progressEl.createDiv({ cls: 'deeppdf-lib-progress-bar', attr: { style: `width: ${progress}%` } });

            // 进度信息容器
            const progressInfo = progressEl.createDiv({ cls: 'deeppdf-lib-progress-info' });
            progressInfo.createDiv({ cls: 'deeppdf-lib-progress-text', text: `${Math.round(progress)}%` });

            // 详细消息（如"正在生成摘要 (5/20)"）
            if (message) {
                progressInfo.createDiv({ cls: 'deeppdf-lib-progress-message', text: message });
            }
        } else if (statusClass === 'failed') {
            // 失败状态显示错误图标
            coverEl.innerHTML = this.createCoverPlaceholder(coverName, true);

            // 重试按钮
            const retryBtn = coverEl.createDiv({ cls: 'deeppdf-lib-cover-btn retry' });
            retryBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
            retryBtn.title = '重试索引';
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.retryIndex(index);
            });
        } else {
            // 索引完成状态：显示封面或占位符
            // 先检查缓存
            const cachedCover = this.coverCache.get(index.id);
            if (cachedCover) {
                // 使用缓存的封面
                coverEl.innerHTML = '';
                const imgEl = coverEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
                imgEl.src = cachedCover;
                imgEl.alt = bookName;
            } else {
                // 没有缓存，先显示占位符
                coverEl.innerHTML = this.createCoverPlaceholder(coverName);

                // 只在缓存中没有且不在加载中时才请求封面
                if (!this.loadingCovers.has(index.id)) {
                    this.loadingCovers.add(index.id);

                    // 异步加载封面（不阻塞渲染）
                    this.loadCoverAndDisplay(index.id, coverName, coverEl);
                }
            }

            // 添加操作按钮（下载、删除）
            this.addCoverActions(coverEl, index.id);
        }

        // 选中时在封面上显示绿色对勾
        if (isSelected && statusClass === 'ready') {
            const checkMark = coverEl.createDiv({ cls: 'deeppdf-lib-cover-check' });
            checkMark.innerHTML = Icons.checkCircle;
        }

        // 信息区域：书名 + 作者 + 元信息
        const infoEl = card.createDiv({ cls: 'deeppdf-lib-book-info' });

        // 书名行（标题 + 类型标签）
        const titleRow = infoEl.createDiv({ cls: 'deeppdf-lib-book-title-row' });
        const titleEl = titleRow.createDiv({ cls: 'deeppdf-lib-book-title', text: bookName });
        titleEl.title = index.pdf_name;

        // 文件类型标签
        const typeTag = index.fileType?.toUpperCase() || 'PDF';
        titleRow.createDiv({ cls: `deeppdf-lib-type-tag deeppdf-lib-type-${typeTag.toLowerCase()}`, text: typeTag });

        // 微信读书标签（已关联时显示）
        if (this.wereadMappingCache.has(index.id)) {
            titleRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-weread', text: '微信读书' });
        }

        // 作者
        if (index.author) {
            infoEl.createDiv({ cls: 'deeppdf-lib-book-author', text: index.author });
        }

        // 元信息行：章节数 + 索引日期
        const metaParts: string[] = [];
        if (index.node_count > 0) {
            metaParts.push(`${index.node_count} 章节`);
        }
        if (index.created_at) {
            const date = new Date(index.created_at);
            metaParts.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
        }
        if (metaParts.length > 0) {
            infoEl.createDiv({ cls: 'deeppdf-lib-book-meta', text: metaParts.join(' · ') });
        }

        // 阅读进度条（仅 ready 状态显示）
        if (statusClass === 'ready') {
            const progressPercent = this.readingProgressCache.get(index.id) || 0;
            if (progressPercent > 0) {
                const progressRow = infoEl.createDiv({ cls: 'deeppdf-lib-reading-progress' });
                const barBg = progressRow.createDiv({ cls: 'deeppdf-lib-reading-bar-bg' });
                barBg.createDiv({ cls: 'deeppdf-lib-reading-bar-fill', attr: { style: `width: ${progressPercent}%` } });
                progressRow.createDiv({ cls: 'deeppdf-lib-reading-bar-text', text: `${progressPercent}%` });
            }
        }

        // 点击选择
        card.addEventListener('click', () => {
            if (statusClass === 'ready') {
                this.handleSelect(index);
            }
        });

        return card;
    }

    /**
     * 异步加载封面并更新显示
     * 从本地 Obsidian vault 加载 (DeepReader/covers/{bookName}.png)
     *
     * 优先从 book-meta.json 读取 exportName（与 book-indexer.ts 保存封面时使用的名称一致），
     * 回退到 getDisplayName(bookName) 和原始 bookName。
     */
    /** 从 .pageindex/weread/mapping.json 加载已关联书籍 ID 集合 */
    private async loadWereadMapping(): Promise<void> {
        try {
            const adapter = (this.app as any).vault?.adapter;
            if (!adapter) return;
            const mappingPath = '.pageindex/weread/mapping.json';
            if (!(await adapter.exists(mappingPath))) return;
            const raw = await adapter.read(mappingPath);
            const mapping = JSON.parse(raw);
            this.wereadMappingCache = new Set(
                Object.values(mapping.mappings || {}).map((m: any) => m.deepReaderBookId),
            );
        } catch {
            // 静默失败
        }
    }

    /** mapping 加载完成后，为已渲染的卡片补充微信读书徽章 */
    private refreshWereadBadges(): void {
        for (const [bookId, card] of this.cardElements) {
            const titleRow = card.querySelector('.deeppdf-lib-book-title-row');
            if (!titleRow) continue;
            // 已有徽章则跳过
            if (titleRow.querySelector('.deeppdf-lib-type-weread')) continue;
            if (this.wereadMappingCache.has(bookId)) {
                titleRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-weread', text: '微信读书' });
            }
        }
    }

    private async loadCoverAndDisplay(indexId: string, bookName: string, coverEl: HTMLElement): Promise<void> {
        try {
            // 收集所有可能的书名（按优先级排序）
            const possibleNames: string[] = [];

            // 1. 优先从 book-meta.json 读取 exportName（与 indexer 保存封面时一致）
            try {
                const vaultPath = (this.app.vault.adapter as any).getBasePath?.() || (this.app.vault.adapter as any).basePath;
                const fs = await import('fs/promises');
                const metaRaw = await fs.readFile(`${vaultPath}/.pageindex/${indexId}/book-meta.json`, 'utf-8');
                const meta = JSON.parse(metaRaw);
                if (meta.exportName) {
                    possibleNames.push(meta.exportName);
                }
            } catch { /* ignore */ }

            // 2. getDisplayName 结果（截取副标题后的主标题）
            const displayName = this.getDisplayName(bookName);
            if (displayName && !possibleNames.includes(displayName)) {
                possibleNames.push(displayName);
            }

            // 3. 原始 bookName（不截断）
            if (bookName && !possibleNames.includes(bookName)) {
                possibleNames.push(bookName);
            }

            // 4. sanitize 后的书名（微信读书封面保存时用了 sanitize）
            const sanitizedName = sanitizeFileName(bookName);
            if (sanitizedName && !possibleNames.includes(sanitizedName)) {
                possibleNames.push(sanitizedName);
            }

            // 5. 去掉扩展名的原始文件名（来自 index.pdf_name）
            const index = this.indexes.find(idx => idx.id === indexId);
            if (index) {
                let rawName = index.pdf_name;
                if (rawName.toLowerCase().endsWith('.pdf')) rawName = rawName.slice(0, -4);
                if (rawName.toLowerCase().endsWith('.epub')) rawName = rawName.slice(0, -5);
                if (rawName && !possibleNames.includes(rawName)) {
                    possibleNames.push(rawName);
                }
            }

            // 尝试所有可能的书名 + 所有图片扩展名
            const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
            let coverFile: TFile | null = null;
            let foundName: string = '';

            for (const name of possibleNames) {
                for (const ext of extensions) {
                    const coverPath = `DeepReader/covers/${name}.${ext}`;
                    const file = this.app.vault.getAbstractFileByPath(coverPath);
                    if (file && file instanceof TFile) {
                        coverFile = file;
                        foundName = name;
                        break;
                    }
                }
                if (coverFile) break;
            }

            if (coverFile) {
                const localCoverUrl = this.app.vault.getResourcePath(coverFile);
                this.coverCache.set(indexId, localCoverUrl);

                // 保留选中对勾（如果存在）
                const checkMark = coverEl.querySelector('.deeppdf-lib-cover-check');

                coverEl.innerHTML = '';
                const imgEl = coverEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
                imgEl.src = localCoverUrl;
                imgEl.alt = foundName || bookName;

                // 恢复选中对勾
                if (checkMark) {
                    coverEl.appendChild(checkMark);
                }

                // 重新添加操作按钮
                this.addCoverActions(coverEl, indexId);
            }
        } catch (error) {
            // 加载失败，保持占位符
        } finally {
            this.loadingCovers.delete(indexId);
        }
    }

    /**
     * 添加封面操作按钮（删除）
     */
    private addCoverActions(coverEl: HTMLElement, indexId: string): void {
        const actionsOverlay = coverEl.createDiv({ cls: 'deeppdf-lib-cover-actions' });

        // 删除按钮
        const deleteBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn delete' });
        deleteBtn.innerHTML = Icons.trash;
        deleteBtn.title = '删除索引';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = this.indexes.find(idx => idx.id === indexId);
            if (index) {
                this.confirmDelete(index);
            }
        });
    }

    private createCoverPlaceholder(bookName: string, isFailed: boolean = false): string {
        // 生成基于书名的占位符
        const displayName = bookName.length > 6 ? bookName.substring(0, 6) : bookName;
        if (isFailed) {
            return `
                <div class="deeppdf-lib-cover-placeholder failed">
                    <div class="deeppdf-lib-cover-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    </div>
                    <div class="deeppdf-lib-cover-text">索引失败</div>
                </div>
            `;
        }
        return `
            <div class="deeppdf-lib-cover-placeholder">
                <div class="deeppdf-lib-cover-icon">${Icons.book}</div>
                <div class="deeppdf-lib-cover-text">${displayName}</div>
            </div>
        `;
    }

    private handleSelect(index: IndexListItem): void {
		const rawStatus = (index.status || 'unknown').toLowerCase();
		const isProcessing = PROCESSING_STATUSES.has(rawStatus);

		if (isProcessing) {
			return;
		}

		// 微信读书：直接打开笔记文件
		if (index.fileType === 'weread') {
			const notePath = `书籍摘录/${index.pdf_name}/${index.pdf_name}.md`;
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (file) {
				this.app.workspace.getLeaf(false).openFile(file as TFile);
			} else {
				new Notice('笔记文件不存在，请重新同步', 3000);
			}
			return;
		}

		const chaptersExist = this.checkBookChaptersExist(index.pdf_name);

		if (!chaptersExist) {
			new Notice('章节文件不存在，请重新索引书籍', 3000);
			return;
		}

		this.selectedIndexId = index.id;
		this.options.onIndexChange?.(index.id);
	}

    private checkBookChaptersExist(pdfName: string): boolean {
        const folderName = this.getDisplayName(pdfName);
        const folderPath = `DeepReader/${folderName}`;

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) return false;

        const files = this.app.vault.getMarkdownFiles();
        const chapterFiles = files.filter(f => f.path.startsWith(folderPath + '/'));

        return chapterFiles.length > 3;
    }

    private getDisplayName(pdfName: string): string {
        let name = pdfName;
        // 移除文件扩展名
        if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
        if (name.toLowerCase().endsWith('.epub')) name = name.slice(0, -5);

        // 简化书名：截取冒号/破折号前的主标题
        // 例如 "遥远的救世主：根据本书改编..." -> "遥远的救世主"
        const separators = ['：', ':', '—', '-', '｜', '|'];
        for (const sep of separators) {
            if (name.includes(sep)) {
                name = name.split(sep)[0].trim();
                break;
            }
        }

        return name;
    }

    /**
     * 加载所有已索引书籍的阅读进度
     */
    private async loadReadingProgresses(): Promise<void> {
        this.readingProgressCache.clear();
        const vaultPath = (this.app.vault.adapter as any).getBasePath?.() || (this.app.vault.adapter as any).basePath;

        const readyIndexes = this.indexes.filter(idx => {
            const status = (idx.status || '').toLowerCase();
            return READY_STATUSES.has(status);
        });

        const results = await Promise.allSettled(
            readyIndexes.map(async (idx) => {
                const progress = await loadProgress(vaultPath, idx.id);
                const totalChapters = this.getChapterCount(idx);
                const percent = progress && totalChapters > 0
                    ? getProgressPercent(progress, totalChapters)
                    : 0;
                return { id: idx.id, percent };
            })
        );

        for (const r of results) {
            if (r.status === 'fulfilled' && r.value.percent > 0) {
                this.readingProgressCache.set(r.value.id, r.value.percent);
            }
        }
    }

    /**
     * 获取书籍的总章节数（索引 node_count 回退到 vault 文件计数）
     */
    private getChapterCount(index: IndexListItem): number {
        if (index.node_count > 0) return index.node_count;

        // 回退：统计 DeepReader/{displayName}/ 下的 md 文件数量
        const folderName = this.getDisplayName(index.pdf_name);
        const folderPath = `DeepReader/${folderName}`;
        const folder = this.app.vault.getAbstractFileByPath(folderPath);

        if (folder && 'children' in folder) {
            const children = (folder as any).children as any[];
            return children.filter((f: any) =>
                f instanceof TFile && f.extension === 'md'
            ).length;
        }
        return 0;
    }

    private async handleAddDocument(): Promise<void> {
        new PDFFileSelectorModal(this.app, async (fileInfo: FileSelectResult) => {
            const displayName = this.getDisplayName(fileInfo.name);

            try {
                const vaultPath = (this.app.vault.adapter as any).getBasePath?.() || (this.app.vault.adapter as any).basePath;
                let filePath: string;
                
                if (isSystemFileInfo(fileInfo)) {
                    // 系统上传的文件：保存到 DeepReader/assets/ 子目录，避免污染 vault 根目录
                    const systemFile = fileInfo as SystemFileInfo;
                    const arrayBuffer = await systemFile.file.arrayBuffer();
                    const fileName = systemFile.file.name;
                    const vaultRelativeDir = `${DEFAULT_EXPORT_DIR}/${DEFAULT_ASSETS_PATH}`;
                    const vaultRelativePath = `${vaultRelativeDir}/${fileName}`;

                    // 确保 DeepReader/assets/ 目录存在
                    if (!(this.app.vault.getAbstractFileByPath(vaultRelativeDir) instanceof TFolder)) {
                        await this.app.vault.createFolder(vaultRelativeDir);
                    }

                    // 检查文件是否已存在，同名文件覆盖更新
                    const existingFile = this.app.vault.getAbstractFileByPath(vaultRelativePath);
                    if (existingFile instanceof TFile) {
                        await this.app.vault.modifyBinary(existingFile, arrayBuffer);
                    } else {
                        await this.app.vault.createBinary(vaultRelativePath, arrayBuffer);
                    }
                    new Notice(`文件已保存到 ${vaultRelativePath}`);

                    filePath = `${vaultPath}/${vaultRelativePath}`;
                } else {
                    // Vault 中的文件：path 已经是绝对路径（由 PDFFileSelectorModal 构建）
                    filePath = fileInfo.path;
                }
                
                // 计算真实的 bookId，避免临时 ID 导致卡片重复
                const bookId = await generateBookId(filePath);

                // 移除同名文件的旧索引项或旧状态卡片，避免重复
                this.indexes = this.indexes.filter(idx => {
                    const idxName = idx.pdf_name || '';
                    return idxName !== fileInfo.name && idx.id !== bookId;
                });
                this.cardElements.delete(bookId);

                const newIndex: IndexListItem = {
                    id: bookId,
                    pdf_name: fileInfo.name,
                    node_count: 0,
                    created_at: new Date().toISOString(),
                    status: 'processing',
                    progress_percent: 0,
                    message: '准备索引...'
                };

                this.indexes.unshift(newIndex);
                this.renderGrid();

                new Notice(`开始索引「${displayName}」...`);
                
                const fileType = (fileInfo as any).docType === 'epub' ? 'epub' : 'pdf';

                const settings = this.options.plugin.settings;
                const pageindexRole = resolveRoleConfig('pageindex', settings);
                const apiKey = pageindexRole?.apiKey || '';
                const baseUrl = pageindexRole?.baseUrl || '';
                const model = pageindexRole?.model || 'deepseek-chat';

                // Embedding 配置
                const embeddingRole = resolveRoleConfig('embedding', settings);
                const embeddingOpts = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;

                // Proposition: disabled — see file-level PROPOSITION_ENABLED
                const propositionRole = PROPOSITION_ENABLED ? resolveRoleConfig('proposition', settings) : null;
                const propositionOpts = propositionRole
                    ? toPropositionConfig(propositionRole, settings.propositionCardsPer500Words)
                    : undefined;

                const result = await indexBook({
                    filePath,
                    fileType,
                    outputDir: vaultPath,
                    embedding: embeddingOpts,
                    model: model,
                    apiKey: apiKey,
                    baseUrl: baseUrl,
                    addNodeSummary: settings.ifAddNodeSummary,
                    propositions: propositionOpts,
                    onProgress: (progress: BookIndexProgress) => {
                        newIndex.progress_percent = progress.percent;
                        newIndex.status = 'processing';
                        newIndex.message = progress.stepLabel;
                        this.updateCardProgress(bookId, progress.percent, 'processing', progress.stepLabel);
                    },
                });

                new Notice(`索引成功！章节: ${result.chaptersCount}`, 3000);
                await this.refreshIndexes();
            } catch (error: any) {
                // 如果出错，刷新列表以显示正确的 failed 状态
                await this.refreshIndexes();

                let msg = '索引创建失败';
                if (error.message?.includes('API key')) msg = 'API key 未配置或无效';
                else if (error.message) msg = `索引创建失败: ${error.message}`;
                new Notice(msg, 5000);
                logError('[DeepPDF] 索引创建错误:', error);
            }
        }).open();
    }

    /**
     * 更新卡片进度显示
     */
    private updateCardProgress(indexId: string, progress: number, status: string, message?: string): void {
        const card = this.cardElements.get(indexId);
        if (!card) return;

        // 更新进度条
        const progressBar = card.querySelector('.deeppdf-lib-progress-bar') as HTMLElement;
        const progressText = card.querySelector('.deeppdf-lib-progress-text') as HTMLElement;
        const progressMessage = card.querySelector('.deeppdf-lib-progress-message') as HTMLElement;

        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
        if (progressText) {
            progressText.textContent = `${Math.round(progress)}%`;
        }
        if (progressMessage && message) {
            progressMessage.textContent = message;
        }
    }

    private startProgressPolling(): void {
        if (this.pollingInterval) {
            window.clearInterval(this.pollingInterval);
        }

        this.pollingInterval = window.setInterval(async () => {
            await this.refreshIndexes();

            const hasProcessing = this.indexes.some(idx => {
                const status = (idx.status || '').toLowerCase();
                return PROCESSING_STATUSES.has(status);
            });

            if (!hasProcessing) {
                if (this.pollingInterval) {
                    window.clearInterval(this.pollingInterval);
                    this.pollingInterval = null;
                }

                const failedIndexes = this.indexes.filter(idx => {
                    const status = (idx.status || '').toLowerCase();
                    return FAILED_STATUSES.has(status);
                });

                if (failedIndexes.length > 0) {
                    const failedNames = failedIndexes.map(idx => this.getDisplayName(idx.pdf_name)).join('、');
                    new Notice(`索引失败: ${failedNames}，请检查 API Key 配置`, 5000);
                } else {
                    new Notice('索引处理完成', 3000);
                }
            }
        }, 2000);

        this.refreshIndexes();
    }

    private retryIndex(index: IndexListItem): void {
        // 移除 failed 索引项，避免重新索引时出现重复卡片
        this.indexes = this.indexes.filter(idx => idx.id !== index.id);
        this.cardElements.delete(index.id);
        this.lastIndexStates.delete(index.id);
        this.renderGrid();

        new Notice(`请重新添加「${this.getDisplayName(index.pdf_name)}」进行索引`, 5000);
        this.handleAddDocument();
    }

    private confirmDelete(index: IndexListItem): void {
        const displayName = this.getDisplayName(index.pdf_name);

        new ConfirmModal(
            this.app,
            '删除索引',
            `确定要删除「${displayName}」吗？此操作将同时删除索引数据和本地导出文件。`,
            async () => {
                const indexToRemove = index.id;
                this.indexes = this.indexes.filter(idx => idx.id !== indexToRemove);

                if (this.selectedIndexId === indexToRemove) {
                    this.selectedIndexId = null;
                }

                this.renderGrid();

                try {
                    // Delegate actual deletion to parent (sidebar-view.handleDeleteIndex)
                    // which handles file cleanup AND UI reset for the reading panel
                    if (this.options.onDeleteIndex) {
                        const updatedIndexes = await this.options.onDeleteIndex(indexToRemove);
                        if (updatedIndexes) {
                            this.indexes = updatedIndexes;
                            this.renderGrid();
                        }
                    } else {
                        await this.options.onRefresh?.();
                    }

                    new Notice(`已删除「${displayName}」的索引和导出数据`);
                } catch (error) {
                    console.error('[LibraryView] 删除失败:', error);
                    new Notice('删除失败');
                }
            },
            {
                confirmLabel: '删除',
                isDestructive: true,
            }
        ).open();
    }

    private async refreshIndexes(): Promise<void> {
        const newIndexes = await this.options.onRefresh?.();

        if (newIndexes) {
            // 去重：移除 this.indexes 中的 tempIndex（其 bookId 已出现在 newIndexes 中）
            // 这样 tempIndex 会被实际的 bookId 索引项替代，避免同一本书出现两个卡片
            const realBookIds = new Set(newIndexes.map(idx => idx.id));
            const tempIndexesToKeep = this.indexes.filter(idx =>
                idx.id.startsWith('temp_') && !realBookIds.has(idx.id)
            );

            // 合并：实际索引项 + 仍在处理中的 tempIndex（尚未生成 bookId）
            this.indexes = [...newIndexes, ...tempIndexesToKeep];

            // 检测新增的索引
            const newAddedIndexes = this.detectNewIndexes(this.indexes);
            // 检测状态变化的索引
            const changedIndexes = this.detectChangedIndexes(this.indexes);
            // 检测刚完成的索引
            const completedIndexes = this.detectCompletedIndexes(this.indexes);

            if (newAddedIndexes.length > 0) {
                this.renderGrid();
            } else if (changedIndexes.length > 0 || completedIndexes.length > 0) {
                this.updateCardsIncrementally(changedIndexes, completedIndexes);
            }
        } else {
            this.indexes = [...this.options.indexes];
        }
    }

    /**
     * 检测新增的索引
     */
    private detectNewIndexes(newIndexes: IndexListItem[]): IndexListItem[] {
        return newIndexes.filter(idx => !this.lastIndexStates.has(idx.id));
    }

    /**
     * 检测状态或进度变化的索引（已存在的）
     */
    private detectChangedIndexes(newIndexes: IndexListItem[]): IndexListItem[] {
        return newIndexes.filter(idx => {
            const lastState = this.lastIndexStates.get(idx.id);
            if (!lastState) return false; // 新索引不在这里处理

            const newStatus = (idx.status || 'unknown').toLowerCase();
            const newProgress = idx.progress_percent || 0;
            const newMessage = idx.message || '';

            // 状态变化、进度变化超过 5%、或消息变化时更新
            return lastState.status.toLowerCase() !== newStatus ||
                   Math.abs(lastState.progress - newProgress) >= 5 ||
                   (lastState.message || '') !== newMessage;
        });
    }

    /**
     * 检测从处理中变为完成的索引
     */
    private detectCompletedIndexes(newIndexes: IndexListItem[]): IndexListItem[] {
        const completedIds: string[] = [];

        newIndexes.forEach(idx => {
            const lastState = this.lastIndexStates.get(idx.id);

            if (lastState) {
                const wasProcessing = PROCESSING_STATUSES.has(lastState.status.toLowerCase());
                const isNowReady = READY_STATUSES.has((idx.status || '').toLowerCase());

                if (wasProcessing && isNowReady) {
                    completedIds.push(idx.id);
                }
            }
        });

        return newIndexes.filter(idx => completedIds.includes(idx.id));
    }

    /**
     * 增量更新卡片
     */
    private async updateCardsIncrementally(changedIndexes: IndexListItem[], completedIndexes: IndexListItem[]): Promise<void> {
        // 更新变化的卡片
        changedIndexes.forEach(idx => {
            const card = this.cardElements.get(idx.id);
            if (card) {
                // 重新创建该卡片
                const newCard = this.createBookCard(idx);
                card.replaceWith(newCard);
                this.cardElements.set(idx.id, newCard);
            }
        });

        // 更新状态快照
        changedIndexes.forEach(idx => {
            this.lastIndexStates.set(idx.id, {
                status: idx.status || 'unknown',
                progress: idx.progress_percent || 0,
                message: idx.message || ''
            });
        });

        // 对刚完成的索引，先下载封面到本地，然后显示
        for (const idx of completedIndexes) {
            if (!this.coverCache.has(idx.id) && !this.loadingCovers.has(idx.id)) {
                this.loadingCovers.add(idx.id);
                const card = this.cardElements.get(idx.id);
                if (card) {
                    const coverEl = card.querySelector('.deeppdf-lib-book-cover');
                    if (coverEl) {
                        const bookName = this.getDisplayName(idx.pdf_name);
                        // 先下载封面到本地
                        if (this.options.onDownloadCover) {
                            await this.options.onDownloadCover(idx.id, idx.pdf_name);
                        }
                        // 然后从本地加载显示
                        await this.loadCoverAndDisplay(idx.id, bookName, coverEl as HTMLElement);
                    }
                }
            }
        }

        // 对正在进行中且进度 >= 50 的索引，也加载封面（后端已提前提取）
        for (const idx of changedIndexes) {
            // 检查是否是正在处理中且进度 >= 50
            const progress = idx.progress_percent || 0;
            const isProcessing = PROCESSING_STATUSES.has((idx.status || '').toLowerCase());

            if (isProcessing && progress >= 50 && !this.coverCache.has(idx.id) && !this.loadingCovers.has(idx.id)) {
                this.loadingCovers.add(idx.id);
                const card = this.cardElements.get(idx.id);
                if (card) {
                    const coverEl = card.querySelector('.deeppdf-lib-book-cover');
                    if (coverEl) {
                        const bookName = this.getDisplayName(idx.pdf_name);
                        // 从后端加载封面（后端在 50% 时已提取）
                        await this.loadCoverAndDisplay(idx.id, bookName, coverEl as HTMLElement);
                    }
                }
            }
        }
    }

    public updateIndexes(indexes: IndexListItem[], selectedId?: string): void {
        this.indexes = [...indexes];
        if (selectedId !== undefined) this.selectedIndexId = selectedId;
        this.renderGrid();
    }
}
