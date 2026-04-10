/**
 * DeepPDF 文档库弹窗
 * 卡片网格布局设计
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import { PDFFileSelectorModal, DocumentFileInfo, SystemFileInfo, FileSelectResult, isSystemFileInfo } from '../../ui/pdf-file-selector.js';
import { IndexListItem } from '../../types/index.js';
import { ConfirmModal } from '../confirm-modal.js';
import { error as logError, serviceLog } from '../../utils/logger.js';
import { indexBook, isBookIndexed, deleteBookIndex, generateBookId } from '../../pageindex/book-indexer.js';
import type { BookIndexProgress, BookMeta } from '../../pageindex/book-types.js';
import { getProviderConfig } from '../../config/providers.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// SVG 图标
const Icons = {
    add: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
    checkCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" fill="#10b981" stroke="#10b981"/><polyline points="16 9 10.5 14.5 8 12" stroke="white" stroke-width="2.5"/></svg>`,
    book: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    loading: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    empty: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
};

export interface LibraryModalOptions {
    app: App;
    indexes: IndexListItem[];
    selectedIndexId: string | null;
    onIndexChange?: (indexId: string) => void;
    onCreateIndex?: () => Promise<void>;
    onDeleteIndex?: (indexId: string) => Promise<IndexListItem[] | undefined>;
    onRefresh?: () => Promise<IndexListItem[]>;
    onDownloadCover?: (indexId: string, pdfName: string) => Promise<string | null>;
    plugin: any;
}

export class LibraryModal extends Modal {
    private options: LibraryModalOptions;
    private indexes: IndexListItem[];
    private selectedIndexId: string | null;
    private searchQuery: string = '';
    private gridEl: HTMLElement | null = null;
    private searchInputEl: HTMLInputElement | null = null;
    private pollingInterval: number | null = null;
    // 封面缓存：避免重复请求
    private coverCache: Map<string, string> = new Map();
    // 正在加载封面的索引 ID 集合
    private loadingCovers: Set<string> = new Set();
    // 上一次的索引状态快照（用于增量更新）
    private lastIndexStates: Map<string, { status: string; progress: number; message: string }> = new Map();
    // 卡片 DOM 引用（用于增量更新）
    private cardElements: Map<string, HTMLElement> = new Map();

    constructor(app: App, options: LibraryModalOptions) {
        super(app);
        this.options = options;
        this.indexes = [...options.indexes];
        this.selectedIndexId = options.selectedIndexId;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass('deeppdf-library-modal');
        this.render();
    }

    onClose() {
        if (this.pollingInterval) {
            window.clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.removeClass('deeppdf-library-modal');
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        // 标题行
        const header = contentEl.createDiv({ cls: 'deeppdf-lib-header' });
        header.createEl('h2', { text: '在线书库', cls: 'deeppdf-lib-title' });

        // 工具栏：搜索 + 添加
        const toolbar = contentEl.createDiv({ cls: 'deeppdf-lib-toolbar' });

        const searchWrap = toolbar.createDiv({ cls: 'deeppdf-lib-search' });
        this.searchInputEl = searchWrap.createEl('input', {
            cls: 'deeppdf-lib-search-input',
            attr: { type: 'text', placeholder: '搜索书籍...' }
        });
        this.searchInputEl.addEventListener('input', () => {
            this.searchQuery = this.searchInputEl?.value || '';
            this.renderGrid();
        });

        const addBtn = toolbar.createEl('button', { cls: 'deeppdf-lib-add-btn' });
        addBtn.innerHTML = Icons.add;
        addBtn.title = '添加书籍';
        addBtn.addEventListener('click', () => this.handleAddDocument());

        // 卡片网格
        this.gridEl = contentEl.createDiv({ cls: 'deeppdf-lib-grid' });
        this.renderGrid();
    }

    private renderGrid(): void {
        if (!this.gridEl) return;

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
            return ['processing', 'indexing', 'started', 'created', 'running', 'active', 'pending', 'queued'].includes(rawStatus);
        });
        if (hasProcessing) {
            this.startProgressPolling();
        }
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

        if (['processing', 'indexing', 'started', 'created', 'running', 'active', 'uploading'].includes(rawStatus)) {
            statusClass = 'processing';
        } else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
            statusClass = 'queued';
        } else if (['failed', 'error'].includes(rawStatus)) {
            statusClass = 'failed';
        }

        // 书名处理
        let bookName = index.pdf_name;
        if (bookName.toLowerCase().endsWith('.pdf')) bookName = bookName.slice(0, -4);
        if (bookName.toLowerCase().endsWith('.epub')) bookName = bookName.slice(0, -5);

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
            coverEl.innerHTML = this.createCoverPlaceholder(bookName, true);

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
                coverEl.innerHTML = this.createCoverPlaceholder(bookName);

                // 只在缓存中没有且不在加载中时才请求封面
                if (!this.loadingCovers.has(index.id)) {
                    this.loadingCovers.add(index.id);

                    // 异步加载封面（不阻塞渲染）
                    this.loadCoverAndDisplay(index.id, bookName, coverEl);
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

        // 信息区域：书名 + 作者
        const infoEl = card.createDiv({ cls: 'deeppdf-lib-book-info' });

        // 书名
        const titleEl = infoEl.createDiv({ cls: 'deeppdf-lib-book-title', text: bookName });
        titleEl.title = index.pdf_name;

        // 作者
        if (index.author) {
            infoEl.createDiv({ cls: 'deeppdf-lib-book-author', text: index.author });
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
     */
    private async loadCoverAndDisplay(indexId: string, bookName: string, coverEl: HTMLElement): Promise<void> {
        try {
            // Try multiple image extensions for the cover
            const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
            let coverFile: TFile | null = null;
            for (const ext of extensions) {
                const coverPath = `DeepReader/covers/${bookName}.${ext}`;
                const file = this.app.vault.getAbstractFileByPath(coverPath);
                if (file && file instanceof TFile) {
                    coverFile = file;
                    break;
                }
            }

            if (coverFile && coverFile instanceof TFile) {
                const localCoverUrl = this.app.vault.getResourcePath(coverFile);
                this.coverCache.set(indexId, localCoverUrl);
                coverEl.innerHTML = '';
                const imgEl = coverEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
                imgEl.src = localCoverUrl;
                imgEl.alt = bookName;
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
     * 添加封面操作按钮（下载、删除）
     */
    private addCoverActions(coverEl: HTMLElement, indexId: string): void {
        const actionsOverlay = coverEl.createDiv({ cls: 'deeppdf-lib-cover-actions' });

        // 下载按钮
        const downloadBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn download' });
        downloadBtn.innerHTML = Icons.download;
        downloadBtn.title = 'Markdown 已自动导出';
        downloadBtn.style.opacity = '0.5';
        downloadBtn.style.cursor = 'default';
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            new Notice('Markdown 已在索引时自动导出', 3000);
        });

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

    /**
     * 更新单个卡片的封面显示
     */
    private updateCardCover(indexId: string, coverUrl: string, bookName: string): void {
        if (!this.gridEl) return;

        // 查找对应的卡片
        const cards = this.gridEl.querySelectorAll('.deeppdf-lib-book-card');
        cards.forEach(card => {
            // 通过卡片中的书名或其他标识找到对应的卡片
            const titleEl = card.querySelector('.deeppdf-lib-book-title');
            if (titleEl && titleEl.textContent === bookName) {
                const coverEl = card.querySelector('.deeppdf-lib-book-cover');
                if (coverEl) {
                    coverEl.innerHTML = '';
                    const imgEl = document.createElement('img');
                    imgEl.className = 'deeppdf-lib-cover-img';
                    imgEl.src = coverUrl;
                    imgEl.alt = bookName;
                    imgEl.onerror = () => {
                        coverEl.innerHTML = this.createCoverPlaceholder(bookName);
                    };
                    coverEl.prepend(imgEl);
                }
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
        // 检查索引状态
        const rawStatus = (index.status || 'unknown').toLowerCase();
        const isProcessing = ['processing', 'indexing', 'started', 'created', 'running', 'active', 'pending', 'queued'].includes(rawStatus);

        if (isProcessing) {
            // 索引还在处理中，不响应点击
            return;
        }

        const chaptersExist = this.checkBookChaptersExist(index.pdf_name);

        if (!chaptersExist) {
            new Notice('章节文件不存在，请重新索引书籍', 3000);
            this.close();
            return;
        }

        this.selectedIndexId = index.id;
        this.options.onIndexChange?.(index.id);
        this.close();
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

    private async handleAddDocument(): Promise<void> {
        new PDFFileSelectorModal(this.app, async (fileInfo: FileSelectResult) => {
            const displayName = this.getDisplayName(fileInfo.name);

            try {
                const vaultPath = (this.app.vault.adapter as any).getBasePath?.() || (this.app.vault.adapter as any).basePath;
                let filePath: string;
                
                if (isSystemFileInfo(fileInfo)) {
                    // 系统上传的文件：需要先保存到 vault
                    const systemFile = fileInfo as SystemFileInfo;
                    const arrayBuffer = await systemFile.file.arrayBuffer();
                    const fileName = systemFile.file.name;
                    
                    // 检查文件是否已存在
                    const existingFile = this.app.vault.getAbstractFileByPath(fileName);
                    if (!existingFile) {
                        await this.app.vault.createBinary(fileName, arrayBuffer);
                        new Notice(`文件已保存到 vault: ${fileName}`);
                    }
                    
                    filePath = `${vaultPath}/${fileName}`;
                } else {
                    // Vault 中的文件：path 已经是绝对路径（由 PDFFileSelectorModal 构建）
                    filePath = fileInfo.path;
                }
                
                // 计算真实的 bookId，避免临时 ID 导致卡片重复
                const bookId = generateBookId(filePath);

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

                const providerConfig = getProviderConfig(this.options.plugin.settings);
                const apiKey = this.options.plugin.settings[providerConfig.apiKeyField] as string || '';

                const result = await indexBook({
                    filePath,
                    fileType,
                    outputDir: vaultPath,
                    embedding: this.options.plugin.settings.embedding,
                    model: this.options.plugin.settings.llmModel || providerConfig.defaultModel,
                    apiKey: apiKey,
                    baseUrl: providerConfig.baseUrl,
                    addNodeSummary: this.options.plugin.settings.ifAddNodeSummary,
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
                return ['processing', 'indexing', 'started', 'created', 'running', 'active', 'pending', 'queued', 'uploading'].includes(status);
            });

            if (!hasProcessing) {
                if (this.pollingInterval) {
                    window.clearInterval(this.pollingInterval);
                    this.pollingInterval = null;
                }

                const failedIndexes = this.indexes.filter(idx => {
                    const status = (idx.status || '').toLowerCase();
                    return ['failed', 'error'].includes(status);
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
                    const vaultPath = (this.app.vault.adapter as any).basePath;
                    const bookId = index.id;

                    // 1. 删除索引数据 (.pageindex/{bookId}/)
                    const indexDir = path.join(vaultPath, '.pageindex', bookId);
                    await fs.rm(indexDir, { recursive: true, force: true });

                    // 2. 删除本地导出文件夹 (DeepReader/{bookName}/)
                    const exportDir = path.join(vaultPath, 'DeepReader', displayName);
                    await fs.rm(exportDir, { recursive: true, force: true });

                    // 3. 删除封面图片
                    const coversDir = path.join(vaultPath, 'DeepReader', 'covers');
                    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
                        const coverPath = path.join(coversDir, `${displayName}.${ext}`);
                        try { await fs.unlink(coverPath); } catch { /* not found */ }
                    }

                    new Notice(`已删除「${displayName}」的索引和导出数据`);
                    serviceLog(`[LibraryModal] Deleted: index=${indexDir}, export=${exportDir}`);

                    await this.options.onRefresh?.();
                } catch (error) {
                    console.error('[LibraryModal] 删除失败:', error);
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
            const processingStatuses = ['processing', 'indexing', 'started', 'created', 'running', 'active', 'pending', 'queued'];
            const readyStatuses = ['ready', 'completed', 'success'];

            if (lastState) {
                const wasProcessing = processingStatuses.includes(lastState.status.toLowerCase());
                const isNowReady = readyStatuses.includes((idx.status || '').toLowerCase());

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
            const processingStatuses = ['processing', 'indexing', 'started', 'created', 'running', 'active', 'pending', 'queued'];
            const isProcessing = processingStatuses.includes((idx.status || '').toLowerCase());

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
