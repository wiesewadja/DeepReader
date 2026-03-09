/**
 * DeepPDF 文档库弹窗
 * 卡片网格布局设计
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import { PDFFileSelectorModal, DocumentFileInfo } from '../../ui/pdf-file-selector.js';
import { IndexListItem } from '../../api/http-client.js';
import { ConfirmModal } from '../confirm-modal.js';
import { error as logError } from '../../utils/logger.js';

// SVG 图标
const Icons = {
    add: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
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
    onExportMarkdown?: (indexId: string) => void;
    onDeleteIndex?: (indexId: string) => Promise<IndexListItem[] | undefined>;
    onRefresh?: () => Promise<IndexListItem[]>;
    apiClient: any;
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
        card.className = 'deeppdf-book-card';

        // 状态判断
        const rawStatus = (index.status || 'unknown').toLowerCase();
        let statusClass = 'ready';
        let statusLabel = '就绪';

        if (['processing', 'indexing', 'started', 'created', 'running', 'active'].includes(rawStatus)) {
            statusClass = 'processing';
            statusLabel = '索引中';
        } else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
            statusClass = 'queued';
            statusLabel = '等待中';
        } else if (['failed', 'error'].includes(rawStatus)) {
            statusClass = 'failed';
            statusLabel = '失败';
        }

        // 选中状态
        if (index.id === this.selectedIndexId) {
            card.classList.add('selected');
        }

        // 书名处理
        let bookName = index.pdf_name;
        if (bookName.toLowerCase().endsWith('.pdf')) bookName = bookName.slice(0, -4);
        if (bookName.toLowerCase().endsWith('.epub')) bookName = bookName.slice(0, -5);

        // 封面区域
        const coverEl = card.createDiv({ cls: 'deeppdf-book-cover' });

        if (statusClass === 'processing') {
            // 索引中显示加载动画
            coverEl.innerHTML = `<div class="deeppdf-cover-loading">${Icons.loading}</div>`;
        } else {
            // 尝试加载封面图片
            const coverPath = `DeepReader/covers/${bookName}.png`;
            const coverFile = this.app.vault.getAbstractFileByPath(coverPath);

            if (coverFile && coverFile instanceof TFile) {
                const imgEl = coverEl.createEl('img', { cls: 'deeppdf-cover-img' });
                imgEl.src = this.app.vault.getResourcePath(coverFile);
                imgEl.alt = bookName;
                imgEl.onerror = () => {
                    // 图片加载失败，显示占位符
                    coverEl.innerHTML = this.createCoverPlaceholder(bookName);
                };
            } else {
                // 显示占位符
                coverEl.innerHTML = this.createCoverPlaceholder(bookName);
            }
        }

        // 信息区域
        const infoEl = card.createDiv({ cls: 'deeppdf-book-info' });

        // 书名
        const titleEl = infoEl.createDiv({ cls: 'deeppdf-book-title', text: bookName });
        titleEl.title = index.pdf_name;

        // 作者
        if (index.author) {
            infoEl.createDiv({ cls: 'deeppdf-book-author', text: index.author });
        }

        // 元信息
        const metaEl = infoEl.createDiv({ cls: 'deeppdf-book-meta' });

        const statusBadge = metaEl.createSpan({ cls: `deeppdf-book-status status-${statusClass}` });
        statusBadge.textContent = statusLabel;

        if (statusClass === 'processing' && index.progress_percent && index.progress_percent > 0) {
            statusBadge.textContent = `索引中 ${Math.round(index.progress_percent)}%`;
        }

        if (index.node_count && statusClass === 'ready') {
            metaEl.createSpan({ cls: 'deeppdf-book-nodes', text: `${index.node_count} 节` });
        }

        // 失败时显示错误
        if (statusClass === 'failed' && index.message) {
            const errorEl = infoEl.createDiv({ cls: 'deeppdf-book-error', text: index.message });
            errorEl.title = index.message;
        }

        // 操作按钮（悬停显示）
        if (statusClass === 'ready') {
            const actionsEl = card.createDiv({ cls: 'deeppdf-book-actions' });

            const selectBtn = actionsEl.createEl('button', { cls: 'deeppdf-action-btn primary' });
            selectBtn.innerHTML = Icons.check;
            selectBtn.title = '选择';
            selectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleSelect(index);
            });

            const exportBtn = actionsEl.createEl('button', { cls: 'deeppdf-action-btn' });
            exportBtn.innerHTML = Icons.download;
            exportBtn.title = '导出';
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onExportMarkdown?.(index.id);
            });

            const deleteBtn = actionsEl.createEl('button', { cls: 'deeppdf-action-btn danger' });
            deleteBtn.innerHTML = Icons.trash;
            deleteBtn.title = '删除';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleDelete(index);
            });
        } else if (statusClass === 'failed') {
            const actionsEl = card.createDiv({ cls: 'deeppdf-book-actions' });
            const retryBtn = actionsEl.createEl('button', { cls: 'deeppdf-action-btn primary' });
            retryBtn.textContent = '重试';
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.retryIndex(index);
            });
        }

        return card;
    }

    private createCoverPlaceholder(bookName: string): string {
        // 生成基于书名的占位符
        const displayName = bookName.length > 6 ? bookName.substring(0, 6) : bookName;
        return `
            <div class="deeppdf-cover-placeholder">
                <div class="deeppdf-cover-icon">${Icons.book}</div>
                <div class="deeppdf-cover-text">${displayName}</div>
            </div>
        `;
    }

    private handleSelect(index: IndexListItem): void {
        const chaptersExist = this.checkBookChaptersExist(index.pdf_name);

        if (!chaptersExist) {
            // 章节不存在，直接下载并选择（无弹窗提示）
            new Notice('章节下载中...', 3000);
            this.options.onExportMarkdown?.(index.id);
            this.selectedIndexId = index.id;
            this.options.onIndexChange?.(index.id);
            this.close();
        } else {
            this.selectedIndexId = index.id;
            this.options.onIndexChange?.(index.id);
            this.close();
        }
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
        if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
        if (name.toLowerCase().endsWith('.epub')) name = name.slice(0, -5);
        return name;
    }

    private async handleAddDocument(): Promise<void> {
        if (!this.options.apiClient) {
            new ConfirmModal(
                this.app,
                "需要后端服务",
                "此功能需要连接后端服务才能使用。\n\n请启动后端：\n```bash\nuv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio\n```",
                () => {},
                { confirmLabel: "知道了", cancelLabel: "取消" }
            ).open();
            return;
        }

        new PDFFileSelectorModal(this.app, async (fileInfo: DocumentFileInfo) => {
            // 直接开始索引，无需确认弹窗
            new Notice(`开始索引「${fileInfo.name}」...`);
            try {
                const result = await this.options.apiClient.indexPDF(fileInfo.path, {
                    llmProvider: this.options.plugin.settings.llmProvider,
                    llmModel: this.options.plugin.settings.llmModel,
                    deepseekApiKey: this.options.plugin.settings.deepseekApiKey,
                    openaiApiKey: this.options.plugin.settings.openaiApiKey,
                    apiUrl: this.options.plugin.settings.apiUrl,
                    maxPagesPerNode: this.options.plugin.settings.maxPagesPerNode,
                    maxTokensPerNode: this.options.plugin.settings.maxTokensPerNode,
                    ifAddNodeSummary: this.options.plugin.settings.ifAddNodeSummary
                });

                if (result.status === 'pending' || result.status === 'processing') {
                    new Notice(`索引任务已创建，正在后台处理...`, 4000);
                    this.startProgressPolling();
                } else if (result.status === 'success') {
                    new Notice(`索引成功！节点数: ${result.node_count}`, 3000);
                    await this.refreshIndexes();
                } else {
                    new Notice(`索引状态: ${result.status}`, 3000);
                    await this.refreshIndexes();
                }
            } catch (error: any) {
                let msg = '索引创建失败';
                if (error.message?.includes('Too Many Requests')) msg = '创建索引过于频繁，请稍后再试';
                else if (error.message?.includes('API key')) msg = 'API key 未配置或无效';
                else if (error.message) msg = `索引创建失败: ${error.message}`;
                new Notice(msg, 5000);
                logError('[DeepPDF] 索引创建错误:', error);
            }
        }).open();
    }

    private startProgressPolling(): void {
        if (this.pollingInterval) {
            window.clearInterval(this.pollingInterval);
        }

        this.pollingInterval = window.setInterval(async () => {
            await this.refreshIndexes();

            const hasProcessing = this.indexes.some(idx => {
                const status = (idx.status || '').toLowerCase();
                return ['processing', 'indexing', 'started', 'created', 'running', 'active', 'pending', 'queued'].includes(status);
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
        new Notice(`请重新添加「${this.getDisplayName(index.pdf_name)}」进行索引`, 5000);
        this.handleAddDocument();
    }

    private handleDelete(index: IndexListItem): void {
        new ConfirmModal(
            this.app,
            '删除索引',
            `确定要删除「${index.pdf_name}」的索引吗？此操作不可撤销。`,
            async () => {
                await this.options.onDeleteIndex?.(index.id);
                await this.refreshIndexes();
            },
            { confirmLabel: '删除', isDestructive: true }
        ).open();
    }

    private async refreshIndexes(): Promise<void> {
        const newIndexes = await this.options.onRefresh?.();
        if (newIndexes) {
            this.indexes = [...newIndexes];
        } else {
            this.indexes = [...this.options.indexes];
        }
        this.renderGrid();
    }

    public updateIndexes(indexes: IndexListItem[], selectedId?: string): void {
        this.indexes = [...indexes];
        if (selectedId !== undefined) this.selectedIndexId = selectedId;
        this.renderGrid();
    }
}
