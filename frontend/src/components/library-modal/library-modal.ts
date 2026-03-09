/**
 * DeepPDF 文档库弹窗
 * 简约风格设计
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import { PDFFileSelectorModal, DocumentFileInfo } from '../../ui/pdf-file-selector.js';
import { IndexListItem } from '../../api/http-client.js';
import { ConfirmModal } from '../confirm-modal.js';
import { error as logError } from '../../utils/logger.js';

// SVG 图标 - 简约风格（与 pdf-file-selector 保持一致）
const Icons = {
    add: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    empty: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    filePdf: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="17" font-size="8" fill="currentColor" stroke="none">PDF</text></svg>`,
    fileEpub: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><text x="6" y="17" font-size="6" fill="currentColor" stroke="none">EPUB</text></svg>`,
    loading: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
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
    private listEl: HTMLElement | null = null;
    private searchInputEl: HTMLInputElement | null = null;

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
        const { contentEl, modalEl } = this;
        // 清除轮询
        if (this.pollingInterval) {
            window.clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
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
            attr: { type: 'text', placeholder: '搜索...' }
        });
        this.searchInputEl.addEventListener('input', () => {
            this.searchQuery = this.searchInputEl?.value || '';
            this.renderList();
        });

        const addBtn = toolbar.createEl('button', { cls: 'deeppdf-lib-add-btn' });
        addBtn.innerHTML = Icons.add;
        addBtn.title = '添加文档';
        addBtn.addEventListener('click', () => this.handleAddDocument());

        // 文档列表
        this.listEl = contentEl.createDiv({ cls: 'deeppdf-lib-list' });
        this.renderList();
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';

        // 过滤
        const filtered = this.searchQuery
            ? this.indexes.filter(idx =>
                  idx.pdf_name.toLowerCase().includes(this.searchQuery.toLowerCase())
              )
            : this.indexes;

        if (filtered.length === 0) {
            this.listEl.innerHTML = `
                <div class="deeppdf-lib-empty">
                    <div class="deeppdf-lib-empty-icon">${Icons.empty}</div>
                    <div class="deeppdf-lib-empty-text">${this.searchQuery ? '未找到匹配文档' : '暂无文档'}</div>
                </div>
            `;
            return;
        }

        // 按状态排序
        const sorted = this.sortIndexes(filtered);
        sorted.forEach(index => {
            const item = this.createIndexItem(index);
            this.listEl!.appendChild(item);
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

    private createIndexItem(index: IndexListItem): HTMLElement {
        const item = document.createElement('div');
        item.className = 'deeppdf-file-item';
        if (index.id === this.selectedIndexId) item.classList.add('active');

        // 状态判断
        const rawStatus = (index.status || 'unknown').toLowerCase();
        let statusClass = 'ready';
        let statusLabel = '就绪';

        if (['processing', 'indexing', 'started', 'created', 'running', 'active'].includes(rawStatus)) {
            statusClass = 'processing';
            statusLabel = '索引中';
        } else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
            statusClass = 'queued';
            statusLabel = '等待';
        } else if (['failed', 'error'].includes(rawStatus)) {
            statusClass = 'failed';
            statusLabel = '失败';
        }

        // 名称处理
        let name = index.pdf_name;
        if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
        if (name.toLowerCase().endsWith('.epub')) name = name.slice(0, -5);

        // 图标和文件名（与 pdf-file-selector 保持一致的结构）
        const infoWrapper = item.createDiv({ cls: 'deeppdf-file-item-info' });

        const icon = infoWrapper.createDiv({ cls: 'deeppdf-file-icon' });
        // 根据文档类型选择图标
        const docType = index.pdf_name.toLowerCase().endsWith('.epub') ? 'epub' : 'pdf';

        // 尝试加载书籍封面图
        const coverPath = `DeepReader/covers/${name}.png`;
        const coverFile = this.app.vault.getAbstractFileByPath(coverPath);

        if (coverFile && statusClass !== 'processing') {
            // 显示书籍封面图
            const imgEl = icon.createEl('img', { cls: 'deeppdf-cover-img' });
            imgEl.src = this.app.vault.getResourcePath(coverFile as TFile);
            imgEl.alt = name;
        } else {
            // 回退到图标
            icon.innerHTML = statusClass === 'processing' ? Icons.loading : (docType === 'epub' ? Icons.fileEpub : Icons.filePdf);
        }

        const details = infoWrapper.createDiv({ cls: 'deeppdf-file-details' });

        // 名称
        const nameEl = details.createDiv({ cls: 'deeppdf-file-name', text: name });
        // 失败时显示错误信息
        if (statusClass === 'failed' && index.message) {
            nameEl.title = `${index.pdf_name}\n错误: ${index.message}`;
        } else {
            nameEl.title = index.pdf_name;
        }

        // 元信息行
        const meta = details.createDiv({ cls: 'deeppdf-file-meta' });

        const statusBadge = meta.createSpan({ cls: `deeppdf-lib-status status-${statusClass}` });
        statusBadge.textContent = statusLabel;

        if (index.progress_percent && index.progress_percent > 0 && index.progress_percent < 100) {
            meta.createSpan({ cls: 'deeppdf-lib-progress', text: `${Math.round(index.progress_percent)}%` });
        }

        if (index.node_count && statusClass === 'ready') {
            meta.createSpan({ cls: 'deeppdf-lib-nodes', text: `${index.node_count} 节点` });
        }

        // 失败时显示错误信息和重试按钮
        if (statusClass === 'failed' && index.message) {
            const errorEl = details.createDiv({ cls: 'deeppdf-lib-error' });
            errorEl.textContent = index.message;

            // 重试按钮
            const retryBtn = item.createEl('button', { cls: 'deeppdf-btn deeppdf-btn-secondary' });
            retryBtn.textContent = '重试';
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 重新触发索引
                this.retryIndex(index);
            });
        }

        // 右侧: 操作按钮
        if (statusClass === 'ready') {
            const selectBtn = item.createEl('button', { cls: 'deeppdf-btn deeppdf-btn-primary' });
            selectBtn.textContent = '选择';
            selectBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                // 检查书籍章节是否存在
                const chaptersExist = this.checkBookChaptersExist(index.pdf_name);
                if (!chaptersExist) {
                    // 章节不存在，显示下载确认弹窗
                    new ConfirmModal(
                        this.app,
                        '下载书籍章节',
                        `「${this.getDisplayName(index.pdf_name)}」的章节尚未下载到本地。\n\n是否立即下载章节？下载后可以在离线状态下阅读和引用。`,
                        async () => {
                            await this.options.onExportMarkdown?.(index.id);
                            new Notice('章节下载中...', 3000);
                            // 下载完成后自动选择
                            this.selectedIndexId = index.id;
                            this.options.onIndexChange?.(index.id);
                            this.close();
                        },
                        { confirmLabel: '下载章节' }
                    ).open();
                } else {
                    // 章节存在，直接选择
                    this.selectedIndexId = index.id;
                    this.options.onIndexChange?.(index.id);
                    this.close();
                }
            });

            const exportBtn = item.createEl('button', { cls: 'deeppdf-btn deeppdf-btn-secondary' });
            exportBtn.innerHTML = Icons.download;
            exportBtn.title = '导出';
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onExportMarkdown?.(index.id);
            });

            const deleteBtn = item.createEl('button', { cls: 'deeppdf-btn deeppdf-btn-ghost' });
            deleteBtn.innerHTML = Icons.trash;
            deleteBtn.title = '删除';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleDelete(index);
            });
        }

        return item;
    }

    /**
     * 检查书籍章节是否已下载到本地
     * 直接检查本地 DeepReader 文件夹中是否存在章节文件
     */
    private checkBookChaptersExist(pdfName: string): boolean {
        const folderName = this.getFolderName(pdfName);
        const folderPath = `DeepReader/${folderName}`;

        // 检查文件夹是否存在
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
            return false;
        }

        // 检查文件夹中是否有 .md 章节文件
        // 章节文件命名格式: 01-章节名.md, 02-章节名.md, ...
        const files = this.app.vault.getMarkdownFiles();
        const chapterFiles = files.filter(f =>
            f.path.startsWith(folderPath + '/')
        );

        // 至少有 3 个章节文件才算已下载
        return chapterFiles.length > 3;
    }

    /**
     * 获取书籍文件夹名称（去掉扩展名）
     */
    private getFolderName(pdfName: string): string {
        let name = pdfName;
        if (name.toLowerCase().endsWith('.pdf')) {
            name = name.slice(0, -4);
        }
        if (name.toLowerCase().endsWith('.epub')) {
            name = name.slice(0, -5);
        }
        return name;
    }

    /**
     * 获取显示名称
     */
    private getDisplayName(pdfName: string): string {
        return this.getFolderName(pdfName);
    }

    private async handleAddDocument(): Promise<void> {
        // 检查后端连接状态
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
            new ConfirmModal(
                this.app,
                '确认索引',
                `确定要索引「${fileInfo.name}」吗？\n\n文件大小: ${fileInfo.sizeFormatted}\n索引完成后即可开始 AI 问答。`,
                async () => {
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
                            // 开始轮询更新进度
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
                },
                { confirmLabel: '开始索引' }
            ).open();
        }).open();
    }

    private pollingInterval: number | null = null;

    private startProgressPolling(): void {
        // 清除之前的轮询
        if (this.pollingInterval) {
            window.clearInterval(this.pollingInterval);
        }

        // 每 2 秒刷新一次进度
        this.pollingInterval = window.setInterval(async () => {
            await this.refreshIndexes();

            // 检查是否所有索引都已完成（没有 processing 状态的）
            const hasProcessing = this.indexes.some(idx => {
                const status = (idx.status || '').toLowerCase();
                return ['processing', 'indexing', 'started', 'created', 'running', 'active', 'pending', 'queued'].includes(status);
            });

            if (!hasProcessing) {
                // 所有索引都已完成，停止轮询
                if (this.pollingInterval) {
                    window.clearInterval(this.pollingInterval);
                    this.pollingInterval = null;
                }

                // 检查是否有失败的索引
                const failedIndexes = this.indexes.filter(idx => {
                    const status = (idx.status || '').toLowerCase();
                    return ['failed', 'error'].includes(status);
                });

                if (failedIndexes.length > 0) {
                    // 有失败的索引
                    const failedNames = failedIndexes.map(idx => this.getDisplayName(idx.pdf_name)).join('、');
                    new Notice(`索引失败: ${failedNames}，请检查 API Key 配置`, 5000);
                } else {
                    new Notice('索引处理完成', 3000);
                }
            }
        }, 2000);

        // 立即刷新一次
        this.refreshIndexes();
    }

    private retryIndex(index: IndexListItem): void {
        // 提示用户重新添加文档
        new Notice(`请重新添加「${this.getDisplayName(index.pdf_name)}」进行索引`, 5000);
        // 触发添加文档流程
        this.handleAddDocument();
    }

    private handleDelete(index: IndexListItem): void {
        new ConfirmModal(
            this.app,
            '删除索引',
            `确定要删除「${index.pdf_name}」的索引吗？此操作不可撤销。`,
            async () => {
                await this.options.onDeleteIndex?.(index.id);
                // onDeleteIndex 已经调用了 loadIndexes，这里直接用返回的最新数据
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
        this.renderList();
    }

    public updateIndexes(indexes: IndexListItem[], selectedId?: string): void {
        this.indexes = [...indexes];
        if (selectedId !== undefined) this.selectedIndexId = selectedId;
        this.renderList();
    }
}
