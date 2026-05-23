/**
 * DeepReader 书库视图
 * 在主面板全屏展示书库，支持自适应宽度布局
 */

import { ItemView, WorkspaceLeaf, Notice, TFile, TFolder } from 'obsidian';
import { sanitizeFileName } from '../weread/utils/file';
import { IndexListItem, Booklist } from '../types/index.js';
import { PDFFileSelectorModal, DocumentFileInfo, SystemFileInfo, FileSelectResult, isSystemFileInfo } from '../ui/pdf-file-selector.js';
import { ConfirmModal } from '../components/confirm-modal.js';
import { error as logError, serviceLog } from '../utils/logger.js';
import { indexBook, isBookIndexed, deleteBookIndex, generateBookId } from '../pageindex/book-indexer.js';
import type { BookIndexProgress, BookMeta } from '../pageindex/book-types.js';
import { resolveRoleConfig } from '../config/providers.js';
import { toEmbeddingOptions, toPropositionConfig } from '../config/role-adapters.js';
import { loadProgress, getProgressPercent, createEmptyProgress } from '../pageindex/reading-progress.js';
import { DEFAULT_EXPORT_DIR, DEFAULT_ASSETS_PATH } from '../pageindex/defaults.js';
import { ZLibrarySearchModal } from './zlibrary-search-modal.js';
import { ZLibraryClient } from '../zlibrary/client.js';
import { buildZlibClient } from '../zlibrary/build-client.js';
import type { ZLibraryBook } from '../zlibrary/types.js';
import { DEFAULT_DOMAINS } from '../zlibrary/constants.js';
import { SyncStateManager } from '../weread/sync/state.js';
import type { MappingStats } from '../weread/types.js';
import { downloadWereadCover } from '../weread/utils/cover.js';
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
    empty: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    booksStacked: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M2 7v14.5A2.5 2.5 0 0 0 4.5 22H8" opacity="0.5"/></svg>`
};

export interface LibraryViewOptions {
    indexes: IndexListItem[];
    selectedIndexId: string | null;
    onIndexChange?: (indexId: string) => void;
    onCreateIndex?: () => Promise<void>;
    onDeleteIndex?: (indexId: string) => Promise<IndexListItem[] | undefined>;
    onRefresh?: () => Promise<IndexListItem[]>;
    onDownloadCover?: (indexId: string, pdfName: string) => Promise<string | null>;
    onStartThematicReading?: (booklist: Booklist) => void;
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
    private wereadMappingCache: Set<string> = new Set(); // 已关联的 weread bookId 集合
    private associatedDeepReaderIds: Set<string> = new Set(); // 已关联的 deepReader bookId（用于去重）
    private activelyIndexingBookId: string | null = null; // handleAddDocument 正在管理的索引 ID
    private wereadStatsCache: Map<string, MappingStats> = new Map();
    private resizeObserver: ResizeObserver | null = null;
    private _searchDebounce: number | null = null;
    private _multiSelectMode: boolean = false;
    private _selectedBookIds: Set<string> = new Set();
    private _confirmBarEl: HTMLElement | null = null;
    private static readonly MAX_MULTI_SELECT = 5;

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

        // 清除封面缓存，强制重新检查封面文件是否完整
        this.coverCache.clear();
        this.loadingCovers.clear();

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

        const thematicBtn = toolbar.createEl('button', { cls: 'deeppdf-lib-add-btn' });
        thematicBtn.innerHTML = Icons.booksStacked;
        thematicBtn.title = '主题阅读';
        thematicBtn.addEventListener('click', () => this.toggleMultiSelectMode());

        // 卡片网格
        this.gridEl = container.createDiv({ cls: 'deeppdf-lib-grid' });
        this.renderGrid();
    }

    private renderGrid(): void {
        if (!this.gridEl) return;

        // 首次渲染时异步加载微信读书映射，加载完后刷新徽章
        if (this.wereadMappingCache.size === 0) {
            this.loadWereadMapping().then(() => this.refreshWereadCardInfo());
        }

        // 清空所有缓存和引用
        this.cardElements.clear();
        this.lastIndexStates.clear();

        this.gridEl.innerHTML = '';

        // 过滤 + 去重已关联的 deepReader 索引
        const filtered = (this.searchQuery
            ? this.indexes.filter(idx =>
                  idx.pdf_name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                  (idx.author && idx.author.toLowerCase().includes(this.searchQuery.toLowerCase()))
              )
            : this.indexes
        ).filter(idx => !this.associatedDeepReaderIds.has(idx.id));

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
                // 缓存封面加载失败 → 清除缓存并重新尝试
                imgEl.addEventListener('error', () => {
                    this.coverCache.delete(index.id);
                    if (!this.loadingCovers.has(index.id)) {
                        this.loadingCovers.add(index.id);
                        this.loadCoverAndDisplay(index.id, coverName, coverEl);
                    }
                });
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

        // 信息区域：书名 + 标签行 + 作者 + 元信息
        const infoEl = card.createDiv({ cls: 'deeppdf-lib-book-info' });

        // 书名（独占一行，不截断）
        const titleEl = infoEl.createDiv({ cls: 'deeppdf-lib-book-title', text: bookName });
        titleEl.title = index.pdf_name;

        // 标签行：类型 + 状态 + 统计
        const tagParts: string[] = [];
        const typeTag = index.fileType?.toUpperCase() || 'PDF';

        const tagRow = infoEl.createDiv({ cls: 'deeppdf-lib-book-tag-row' });
        tagRow.createDiv({ cls: `deeppdf-lib-type-tag deeppdf-lib-type-${typeTag.toLowerCase()}`, text: typeTag });

        if (this.wereadMappingCache.has(index.id)) {
            const linkedText = index.fileType === 'weread' ? '已关联' : '微信读书';
            tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-weread', text: linkedText });
        }

        if (index.fileType === 'weread' && !this.wereadMappingCache.has(index.id)) {
            tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-zlibrary', text: '待下载' });
        }

        // 统计标签（笔记/评论/时长）
        const wereadStats = this.wereadStatsCache.get(index.id);
        if (wereadStats) {
            if (wereadStats.noteCount > 0) {
                tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${wereadStats.noteCount} 笔记` });
            }
            if (wereadStats.reviewCount > 0) {
                tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${wereadStats.reviewCount} 评论` });
            }
        }

        // 作者
        if (index.author) {
            infoEl.createDiv({ cls: 'deeppdf-lib-book-author', text: index.author });
        }

        // 元信息行：章节数 + 阅读时长 + 索引日期
        const metaParts: string[] = [];
        if (index.node_count > 0) {
            metaParts.push(`${index.node_count} 章节`);
        }
        if (wereadStats?.readingTime) {
            metaParts.push(wereadStats.readingTime);
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
            const deepReaderProgress = this.readingProgressCache.get(index.id) || 0;
            const wereadProgress = wereadStats?.progress || 0;
            const progressPercent = Math.max(deepReaderProgress, wereadProgress);
            if (progressPercent > 0) {
                const progressRow = infoEl.createDiv({ cls: 'deeppdf-lib-reading-progress' });
                const barBg = progressRow.createDiv({ cls: 'deeppdf-lib-reading-bar-bg' });
                barBg.createDiv({ cls: 'deeppdf-lib-reading-bar-fill', attr: { style: `width: ${progressPercent}%` } });
                progressRow.createDiv({ cls: 'deeppdf-lib-reading-bar-text', text: `${progressPercent}%` });
            }
        }

        // 点击选择
        card.addEventListener('click', () => {
            if (this._multiSelectMode) {
                if (statusClass !== 'ready') return;
                this.toggleBookSelection(index.id, card);
            } else {
                if (statusClass === 'ready') {
                    this.handleSelect(index);
                }
            }
        });

        // 多选模式：添加勾选框 + 状态
        if (this._multiSelectMode && statusClass === 'ready') {
            card.classList.add('deeppdf-lib-multi-selectable');
            if (this._selectedBookIds.has(index.id)) {
                card.classList.add('deeppdf-lib-multi-selected');
            }
            if (this._selectedBookIds.size >= LibraryView.MAX_MULTI_SELECT && !this._selectedBookIds.has(index.id)) {
                card.classList.add('deeppdf-lib-multi-disabled');
            }
            const checkbox = card.createDiv({ cls: 'deeppdf-lib-checkbox' });
            if (this._selectedBookIds.has(index.id)) {
                checkbox.classList.add('checked');
                checkbox.innerHTML = Icons.check;
            }
        }

        return card;
    }

    /**
     * 异步加载封面并更新显示
     * 从本地 Obsidian vault 加载 (DeepReader/covers/{bookName}.png)
     *
     * 优先从 book-meta.json 读取 exportName（与 book-indexer.ts 保存封面时使用的名称一致），
     * 回退到 getDisplayName(bookName) 和原始 bookName。
     */
    /** 从 .pageindex/weread/mapping.json 加载已关联书籍 ID 集合 + 统计 */
    private async loadWereadMapping(): Promise<void> {
        try {
            const adapter = (this.app as any).vault?.adapter;
            if (!adapter) return;
            const mappingPath = '.pageindex/weread/mapping.json';
            if (!(await adapter.exists(mappingPath))) return;
            const raw = await adapter.read(mappingPath);
            const mapping = JSON.parse(raw);
            const entries = Object.entries(mapping.mappings || {}) as [string, any][];
            this.wereadMappingCache = new Set(entries.map(([key]) => key));
            this.associatedDeepReaderIds = new Set(
                entries.map(([, m]) => m.deepReaderBookId).filter(Boolean),
            );
            this.wereadStatsCache.clear();
            for (const [key, entry] of entries) {
                if (entry.stats) {
                    this.wereadStatsCache.set(key, entry.stats);
                }
            }
        } catch {
            // 静默失败
        }
    }

    /** mapping 加载完成后，为已渲染的卡片补充微信读书徽章、统计标签和进度条 */
    private refreshWereadCardInfo(): void {
        for (const [bookId, card] of this.cardElements) {
            // 注入标签到 tag-row
            const tagRow = card.querySelector('.deeppdf-lib-book-tag-row');
            if (tagRow && !tagRow.querySelector('.deeppdf-lib-type-weread')) {
                if (this.wereadMappingCache.has(bookId)) {
                    tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-weread', text: '微信读书' });
                }
            }

            // 注入统计标签
            const stats = this.wereadStatsCache.get(bookId);
            if (stats && tagRow && !(tagRow as HTMLElement).dataset.wereadStatsInjected) {
                (tagRow as HTMLElement).dataset.wereadStatsInjected = '1';
                if (stats.noteCount > 0) {
                    tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${stats.noteCount} 笔记` });
                }
                if (stats.reviewCount > 0) {
                    tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${stats.reviewCount} 评论` });
                }
            }

            // 注入进度条
            if (stats && stats.progress > 0 && !card.querySelector('.deeppdf-lib-reading-progress')) {
                const infoEl = card.querySelector('.deeppdf-lib-book-info');
                if (infoEl) {
                    const progressRow = infoEl.createDiv({ cls: 'deeppdf-lib-reading-progress' });
                    const barBg = progressRow.createDiv({ cls: 'deeppdf-lib-reading-bar-bg' });
                    barBg.createDiv({ cls: 'deeppdf-lib-reading-bar-fill', attr: { style: `width: ${stats.progress}%` } });
                    progressRow.createDiv({ cls: 'deeppdf-lib-reading-bar-text', text: `${stats.progress}%` });
                }
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
                // sanitize 全标题（和封面下载时一致，处理特殊字符和长度）
                const sanitizedRaw = sanitizeFileName(rawName);
                if (sanitizedRaw && !possibleNames.includes(sanitizedRaw)) {
                    possibleNames.push(sanitizedRaw);
                }
            }

            // 尝试所有可能的书名 + 所有图片扩展名
            const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
            let coverFile: TFile | null = null;
            let foundPath: string = '';
            let foundName: string = '';

            for (const name of possibleNames) {
                for (const ext of extensions) {
                    const coverPath = `DeepReader/covers/${name}.${ext}`;
                    const file = this.app.vault.getAbstractFileByPath(coverPath);
                    if (file && file instanceof TFile) {
                        coverFile = file;
                        foundPath = coverPath;
                        foundName = name;
                        break;
                    }
                }
                if (coverFile) break;
            }

            // Fallback: vault 缓存未更新时，直接用 adapter 检查文件是否存在
            if (!coverFile) {
                const adapter = this.app.vault.adapter as any;
                for (const name of possibleNames) {
                    for (const ext of extensions) {
                        const coverPath = `DeepReader/covers/${name}.${ext}`;
                        try {
                            if (await adapter.exists(coverPath)) {
                                foundPath = coverPath;
                                foundName = name;
                                break;
                            }
                        } catch { continue; }
                    }
                    if (foundPath) break;
                }
            }

            if (coverFile || foundPath) {
                const localCoverUrl = coverFile
                    ? this.app.vault.getResourcePath(coverFile)
                    : this.app.vault.getResourcePath(foundPath as any);
                this.coverCache.set(indexId, localCoverUrl);

                // 检查文件大小，0 字节视为无效
                if (coverFile && coverFile.stat?.size === 0) {
                    this.coverCache.delete(indexId);
                    this.retryCoverDownload(indexId, bookName, coverEl);
                    return;
                }

                // 保留选中对勾（如果存在）
                const checkMark = coverEl.querySelector('.deeppdf-lib-cover-check');

                coverEl.innerHTML = '';
                const imgEl = coverEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
                imgEl.src = localCoverUrl;
                imgEl.alt = foundName || bookName;

                // 封面加载失败（文件损坏/不完整）→ 清除缓存并尝试重新下载
                imgEl.addEventListener('error', () => {
                    this.coverCache.delete(indexId);
                    this.retryCoverDownload(indexId, bookName, coverEl);
                });

                // 恢复选中对勾
                if (checkMark) {
                    coverEl.appendChild(checkMark);
                }

                // 重新添加操作按钮
                this.addCoverActions(coverEl, indexId);
            } else {
                // 封面文件不存在 → 尝试重新下载
                this.retryCoverDownload(indexId, bookName, coverEl);
            }
        } catch (error) {
            // 加载失败，保持占位符
        } finally {
            this.loadingCovers.delete(indexId);
        }
    }

    /**
     * 封面图片加载失败时，尝试重新下载封面
     * 优先从 syncState 获取 cover URL 下载微信读书封面
     */
    private async retryCoverDownload(indexId: string, bookName: string, coverEl: HTMLElement): Promise<void> {
        const displayName = this.getDisplayName(bookName);
        const checkMark = coverEl.querySelector('.deeppdf-lib-cover-check');

        // 显示加载中占位符
        coverEl.innerHTML = `<div class="deeppdf-lib-cover-loading">${Icons.loading}</div>`;

        try {
            // 从 syncState 获取 cover URL，重新下载微信读书封面
            const adapter = this.app.vault.adapter as any;
            const stateManager = new SyncStateManager(adapter);
            const syncState = await stateManager.loadSyncState();
            const entry = syncState.syncedBooks[indexId];
            if (entry?.cover) {
                const newCoverPath = await downloadWereadCover(entry.cover, entry.title, adapter);
                if (newCoverPath) {
                    // vault 需要刷新才能识别新文件
                    await this.app.vault.adapter.stat(newCoverPath);
                    const file = this.app.vault.getAbstractFileByPath(newCoverPath);
                    if (file && file instanceof TFile) {
                        const url = this.app.vault.getResourcePath(file);
                        this.coverCache.set(indexId, url);

                        coverEl.innerHTML = '';
                        const imgEl = coverEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
                        imgEl.src = url;
                        imgEl.alt = bookName;
                        if (checkMark) coverEl.appendChild(checkMark);
                        this.addCoverActions(coverEl, indexId);
                        return;
                    }
                }
            }
        } catch { /* ignore */ }

        // 重新下载失败，显示占位符
        coverEl.innerHTML = this.createCoverPlaceholder(displayName);
        if (checkMark) coverEl.appendChild(checkMark);
        this.addCoverActions(coverEl, indexId);
    }

    /**
     * 添加封面操作按钮（删除）
     */
    private addCoverActions(coverEl: HTMLElement, indexId: string): void {
        const actionsOverlay = coverEl.createDiv({ cls: 'deeppdf-lib-cover-actions' });

        // 关联按钮组（未关联的微信读书书籍）
        const index = this.indexes.find(idx => idx.id === indexId);
        if (index?.fileType === 'weread' && !this.wereadMappingCache.has(indexId)) {
            // Z-Library 下载按钮
            const cloudBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn cloud' });
            cloudBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
            cloudBtn.title = '从 Z-Library 下载';
            cloudBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleZlibDownload(index);
            });

            // 本地文件关联按钮
            const linkBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn link' });
            linkBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
            linkBtn.title = '从本地文件关联';
            linkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleLocalAssociate(index);
            });
        }

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

    private handleZlibDownload(index: IndexListItem): void {
        const settings = this.options.plugin?.settings;
        if (!settings?.zlibraryUserId || !settings?.zlibraryUserKey) {
            new Notice('请先在设置中登录 Z-Library 账号', 3000);
            return;
        }

        const client = buildZlibClient(settings);

        const bookTitle = this.getDisplayName(index.pdf_name);
        const bookAuthor = index.author || '';
        new ZLibrarySearchModal(this.app, bookTitle, bookAuthor, client, async (book) => {
            await this.downloadIndexAndAssociate(index, book, client);
        }).open();
    }

    /** 将微信读书卡片切换为 processing 状态以显示进度条 */
    private setWereadCardProcessing(index: IndexListItem, percent: number, message: string): void {
        const idx = this.indexes.find(i => i.id === index.id);
        if (idx) {
            idx.status = 'processing';
            idx.progress_percent = percent;
            idx.message = message;
        }
        const oldCard = this.cardElements.get(index.id);
        if (oldCard) {
            const newCard = this.createBookCard(idx || index);
            oldCard.replaceWith(newCard);
            this.cardElements.set(index.id, newCard);
        }
    }

    /** 失败时恢复卡片为原始状态 */
    private restoreWereadCard(index: IndexListItem): void {
        const idx = this.indexes.find(i => i.id === index.id);
        if (idx) {
            idx.status = 'ready';
            idx.progress_percent = undefined;
            idx.message = undefined;
        }
        const oldCard = this.cardElements.get(index.id);
        if (oldCard) {
            const newCard = this.createBookCard(idx || index);
            oldCard.replaceWith(newCard);
            this.cardElements.set(index.id, newCard);
        }
    }

    private handleLocalAssociate(index: IndexListItem): void {
        new PDFFileSelectorModal(this.app, async (fileInfo) => {
            await this.associateLocalFile(index, fileInfo);
        }).open();
    }

    private async associateLocalFile(
        wereadIndex: IndexListItem,
        fileInfo: FileSelectResult,
    ): Promise<void> {
        const adapter = (this.app as any).vault?.adapter;
        if (!adapter) {
            new Notice('Vault 不可用');
            return;
        }

        const vaultBase = (adapter as any).getBasePath?.() || (adapter as any).basePath;
        if (!vaultBase) {
            new Notice('无法获取 Vault 路径');
            return;
        }

        let filePath: string;
        let fileType: 'pdf' | 'epub';
        let localVaultPath: string | undefined;

        this.setWereadCardProcessing(wereadIndex, 5, '准备文件...');

        if (isSystemFileInfo(fileInfo)) {
            // 系统文件：先复制到 Vault
            const ext = fileInfo.docType;
            const safeName = sanitizeFileName(fileInfo.name);
            const assetsDir = `${DEFAULT_EXPORT_DIR}/${DEFAULT_ASSETS_PATH}`;
            const vaultRelativePath = `${assetsDir}/${safeName}.${ext}`;

            if (!(await adapter.exists(assetsDir))) {
                await adapter.mkdir(assetsDir);
            }

            const buffer = await fileInfo.file.arrayBuffer();
            await adapter.writeBinary(vaultRelativePath, buffer);
            filePath = `${vaultBase}/${vaultRelativePath}`;
            fileType = ext;
            localVaultPath = vaultRelativePath;
        } else {
            // Vault 内文件：直接使用
            filePath = `${vaultBase}/${fileInfo.file.path}`;
            fileType = fileInfo.docType;
            localVaultPath = fileInfo.file.path;
        }

        // 检查是否已索引
        let bookId: string;
        const alreadyIndexed = await isBookIndexed(filePath, vaultBase);

        if (alreadyIndexed) {
            bookId = await generateBookId(filePath);
        } else {
            // 需要索引
            const settings = this.options.plugin.settings;
            const pageindexRole = resolveRoleConfig('pageindex', settings);
            const embeddingRole = resolveRoleConfig('embedding', settings);
            const embeddingOpts = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;

            try {
                const result = await indexBook({
                    filePath,
                    fileType,
                    outputDir: vaultBase,
                    embedding: embeddingOpts,
                    model: pageindexRole?.model || 'deepseek-chat',
                    apiKey: pageindexRole?.apiKey || '',
                    baseUrl: pageindexRole?.baseUrl || '',
                    addNodeSummary: settings.ifAddNodeSummary,
                    onProgress: (p) => {
                        this.updateCardProgress(wereadIndex.id, p.percent, 'processing', p.stepLabel);
                    },
                });
                bookId = result.bookId;
            } catch (e: any) {
                this.restoreWereadCard(wereadIndex);
                new Notice(`索引失败：${e.message}`, 5000);
                return;
            }
        }

        // 写 mapping 关联
        this.updateCardProgress(wereadIndex.id, 100, 'processing', '关联中...');
        try {
            const mappingPath = '.pageindex/weread/mapping.json';
            let mapping = { mappings: {} as Record<string, any> };
            if (await adapter.exists(mappingPath)) {
                const raw = await adapter.read(mappingPath);
                mapping = JSON.parse(raw);
            }
            mapping.mappings[wereadIndex.id] = {
                deepReaderBookId: bookId,
                title: wereadIndex.pdf_name,
                filePath,
                localFile: localVaultPath,
            };
            await adapter.write(mappingPath, JSON.stringify(mapping, null, 2));
            this.wereadMappingCache.add(wereadIndex.id);
        } catch (e: any) {
            this.restoreWereadCard(wereadIndex);
            new Notice(`关联写入失败：${e.message}`, 5000);
            return;
        }

        new Notice(`「${wereadIndex.pdf_name}」关联成功`);
        await this.refreshIndexes();
        await this.loadWereadMapping();
        this.renderGrid();
    }
    private async downloadIndexAndAssociate(
        wereadIndex: IndexListItem,
        zlibBook: ZLibraryBook,
        client: ZLibraryClient,
    ): Promise<void> {
        const adapter = (this.app as any).vault?.adapter;
        if (!adapter) {
            new Notice('Vault 不可用');
            return;
        }

        const safeTitle = sanitizeFileName(zlibBook.title);
        const assetsDir = `${DEFAULT_EXPORT_DIR}/${DEFAULT_ASSETS_PATH}`;

        // 将卡片切换为 processing 状态以显示进度条
        this.setWereadCardProcessing(wereadIndex, 5, '正在下载...');

        // ── Phase 1: 下载 ──────────────────────────────
        let downloadPath: string;
        try {
            const { data, extension } = await client.downloadBook(zlibBook.id, zlibBook.hash);
            const fileName = `${safeTitle}.${extension}`;
            const vaultRelativePath = `${assetsDir}/${fileName}`;

            if (!(await adapter.exists(assetsDir))) {
                await adapter.mkdir(assetsDir);
            }
            await adapter.writeBinary(vaultRelativePath, data);
            const vaultBase = (adapter as any).getBasePath?.() || (adapter as any).basePath;
            downloadPath = `${vaultBase}/${vaultRelativePath}`;
            new Notice(`已保存到 ${vaultRelativePath}`);
        } catch (e: any) {
            this.restoreWereadCard(wereadIndex);
            new Notice(`下载失败：${e.message}`, 5000);
            return;
        }

        // ── Phase 2: 索引 ──────────────────────────────
        const settings = this.options.plugin.settings;
        const pageindexRole = resolveRoleConfig('pageindex', settings);
        const embeddingRole = resolveRoleConfig('embedding', settings);
        const embeddingOpts = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;

        let bookId: string;
        try {
            const result = await indexBook({
                filePath: downloadPath,
                fileType: (zlibBook.extension || 'pdf') as 'pdf' | 'epub',
                outputDir: (adapter as any).getBasePath?.() || (adapter as any).basePath,
                embedding: embeddingOpts,
                model: pageindexRole?.model || 'deepseek-chat',
                apiKey: pageindexRole?.apiKey || '',
                baseUrl: pageindexRole?.baseUrl || '',
                addNodeSummary: settings.ifAddNodeSummary,
                onProgress: (p) => {
                    this.updateCardProgress(wereadIndex.id, p.percent, 'processing', p.stepLabel);
                },
            });
            bookId = result.bookId;
        } catch (e: any) {
            this.restoreWereadCard(wereadIndex);
            new Notice(`索引失败：${e.message}`, 5000);
            return;
        }

        // ── Phase 3: 关联 ──────────────────────────────
        this.updateCardProgress(wereadIndex.id, 100, 'processing', '关联中...');
        try {
            const mappingPath = '.pageindex/weread/mapping.json';
            let mapping = { mappings: {} as Record<string, any> };
            if (await adapter.exists(mappingPath)) {
                const raw = await adapter.read(mappingPath);
                mapping = JSON.parse(raw);
            }
            mapping.mappings[wereadIndex.id] = {
                deepReaderBookId: bookId,
                title: wereadIndex.pdf_name,
                filePath: downloadPath,
                zlibraryBookId: zlibBook.id,
            };
            await adapter.write(mappingPath, JSON.stringify(mapping, null, 2));
            this.wereadMappingCache.add(wereadIndex.id);
        } catch (e: any) {
            this.restoreWereadCard(wereadIndex);
            new Notice(`关联写入失败：${e.message}`, 5000);
            return;
        }

        // ── Phase 4: 刷新 ──────────────────────────────
        new Notice(`「${zlibBook.title}」下载并索引成功！`);
        await this.refreshIndexes();
        await this.loadWereadMapping();
        this.renderGrid();
    }

    private toggleMultiSelectMode(): void {
        if (this._multiSelectMode) {
            this.exitMultiSelectMode();
        } else {
            this._multiSelectMode = true;
            this._selectedBookIds.clear();
            this.renderGrid();
            this.showConfirmBar();
        }
    }

    private exitMultiSelectMode(): void {
        this._multiSelectMode = false;
        this._selectedBookIds.clear();
        this.hideConfirmBar();
        this.renderGrid();
    }

    private toggleBookSelection(indexId: string, card: HTMLElement): void {
        if (this._selectedBookIds.has(indexId)) {
            this._selectedBookIds.delete(indexId);
        } else {
            if (this._selectedBookIds.size >= LibraryView.MAX_MULTI_SELECT) return;
            this._selectedBookIds.add(indexId);
        }
        this.renderGrid();
        this.updateConfirmBar();
    }

    private showConfirmBar(): void {
        this.hideConfirmBar();
        const container = this.containerEl.children[1] as HTMLElement;
        this._confirmBarEl = container.createDiv({ cls: 'deeppdf-lib-multi-confirm-bar' });
        this.updateConfirmBar();
    }

    private updateConfirmBar(): void {
        if (!this._confirmBarEl) return;
        const count = this._selectedBookIds.size;
        this._confirmBarEl.empty();

        this._confirmBarEl.createDiv({ cls: 'deeppdf-lib-multi-count', text: `已选 ${count} 本` });

        if (count >= 2) {
            const startBtn = this._confirmBarEl.createEl('button', { cls: 'deeppdf-lib-multi-start-btn' });
            startBtn.textContent = '开始主题阅读';
            startBtn.addEventListener('click', () => this.confirmThematicReading());
        }

        const cancelBtn = this._confirmBarEl.createEl('button', { cls: 'deeppdf-lib-multi-cancel-btn' });
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => this.exitMultiSelectMode());
    }

    private hideConfirmBar(): void {
        if (this._confirmBarEl) {
            this._confirmBarEl.remove();
            this._confirmBarEl = null;
        }
    }

    private confirmThematicReading(): void {
        if (this._selectedBookIds.size < 2) return;
        const bookIds = Array.from(this._selectedBookIds);
        const bookNames = bookIds.map(id => {
            const idx = this.indexes.find(i => i.id === id);
            let name = idx?.pdf_name || id;
            if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
            if (name.toLowerCase().endsWith('.epub')) name = name.slice(0, -5);
            return name;
        });
        const displayName = `${bookNames[0]}等${bookNames.length}本书`;
        const booklist: Booklist = {
            id: `booklist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: displayName,
            bookIds,
            bookNames,
            createdAt: new Date().toISOString(),
        };
        this.options.onStartThematicReading?.(booklist);
        this.exitMultiSelectMode();
    }

    private async handleSelect(index: IndexListItem): Promise<void> {
		const rawStatus = (index.status || 'unknown').toLowerCase();
		const isProcessing = PROCESSING_STATUSES.has(rawStatus);

		if (isProcessing) {
			return;
		}

		// 微信读书：已关联则打开阅读，未关联则打开笔记
		if (index.fileType === 'weread') {
			if (this.wereadMappingCache.has(index.id)) {
				// 已关联：用 deepReaderBookId 打开阅读
				const adapter = (this.app as any).vault?.adapter;
				if (adapter) {
					try {
						const mappingPath = '.pageindex/weread/mapping.json';
						if (await adapter.exists(mappingPath)) {
							const raw = await adapter.read(mappingPath);
							const mapping = JSON.parse(raw);
							const m = mapping.mappings?.[index.id];
							if (m?.deepReaderBookId) {
								this.selectedIndexId = m.deepReaderBookId;
								this.options.onIndexChange?.(m.deepReaderBookId);
								return;
							}
						}
					} catch { /* fallthrough */ }
				}
			}
			// 未关联：打开笔记
			const safeName = sanitizeFileName(index.pdf_name);
			const notePath = `书籍摘录/${safeName}/${safeName}.md`;
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
            let bookId = '';
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
                bookId = await generateBookId(filePath);

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

                // 标记正在主动管理索引，防止轮询弹出重复通知
                this.activelyIndexingBookId = bookId;

                const result = await indexBook({
                    filePath,
                    fileType,
                    outputDir: vaultPath,
                    embedding: embeddingOpts,
                    model: model,
                    apiKey: apiKey,
                    baseUrl: baseUrl,
                    mineruApiKey: settings.providers?.['mineru']?.apiKey || '',
                    addNodeSummary: settings.ifAddNodeSummary,
                    propositions: propositionOpts,
                    onProgress: (progress: BookIndexProgress) => {
                        newIndex.progress_percent = progress.percent;
                        newIndex.status = 'processing';
                        newIndex.message = progress.stepLabel;
                        this.updateCardProgress(bookId, progress.percent, 'processing', progress.stepLabel);
                    },
                });

                // 先刷新索引数据（从磁盘读取最终状态）
                await this.refreshIndexes();

                // 确保卡片更新为 ready 状态
                const doneIdx = this.indexes.find(idx => idx.id === bookId);
                if (doneIdx) {
                    doneIdx.status = 'ready';
                    doneIdx.progress_percent = 100;
                    const card = this.cardElements.get(bookId);
                    if (card) {
                        const newCard = this.createBookCard(doneIdx);
                        card.replaceWith(newCard);
                        this.cardElements.set(bookId, newCard);
                    }
                }

                this.activelyIndexingBookId = null;
                new Notice(`索引成功！章节: ${result.chaptersCount}`, 3000);
            } catch (error: any) {
                this.activelyIndexingBookId = null;
                // 将 temp 索引标记为失败状态
                const errIdx = this.indexes.find(idx => idx.id === bookId);
                if (errIdx) {
                    errIdx.status = 'failed';
                    errIdx.message = error.message || '索引失败';
                    // 重新渲染该卡片为失败状态
                    const card = this.cardElements.get(bookId);
                    if (card) {
                        const newCard = this.createBookCard(errIdx);
                        card.replaceWith(newCard);
                        this.cardElements.set(bookId, newCard);
                    }
                }

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

            // handleAddDocument 正在管理时，防止轮询将卡片提前变为 ready
            if (this.activelyIndexingBookId) {
                const activeIdx = this.indexes.find(idx => idx.id === this.activelyIndexingBookId);
                if (activeIdx && READY_STATUSES.has((activeIdx.status || '').toLowerCase())) {
                    activeIdx.status = 'processing';
                    const card = this.cardElements.get(this.activelyIndexingBookId);
                    if (card) {
                        const newCard = this.createBookCard(activeIdx);
                        card.replaceWith(newCard);
                        this.cardElements.set(this.activelyIndexingBookId, newCard);
                    }
                }
            }

            const hasProcessing = this.indexes.some(idx => {
                const status = (idx.status || '').toLowerCase();
                return PROCESSING_STATUSES.has(status);
            });

            if (!hasProcessing) {
                if (this.pollingInterval) {
                    window.clearInterval(this.pollingInterval);
                    this.pollingInterval = null;
                }

                // handleAddDocument 正在管理时，由它自己负责通知
                if (!this.activelyIndexingBookId) {
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
                    // 微信读书书籍：加入排除列表，后续同步跳过
                    if (index.fileType === 'weread') {
                        const adapter = (this.app as any).vault?.adapter;
                        if (adapter) {
                            const stateManager = new SyncStateManager(adapter);
                            await stateManager.excludeBook(index.id);
                        }
                    }

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
