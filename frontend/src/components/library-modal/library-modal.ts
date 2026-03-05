/**
 * DeepPDF 文档库弹窗
 * 简约风格设计
 */

import { App, Modal, Notice } from 'obsidian';
import { PDFFileSelectorModal, DocumentFileInfo } from '../../ui/pdf-file-selector.js';
import { IndexListItem } from '../../api/http-client.js';
import { ConfirmModal } from '../confirm-modal.js';
import { error as logError } from '../../utils/logger.js';

// SVG 图标 - 简约风格
const Icons = {
    add: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    empty: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`
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
        item.className = 'deeppdf-lib-item';
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

        // 名称
        let name = index.pdf_name;
        if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);

        // 主信息区
        const main = item.createDiv({ cls: 'deeppdf-lib-item-main' });

        const nameEl = main.createDiv({ cls: 'deeppdf-lib-item-name', text: name });
        nameEl.title = index.pdf_name;

        // 元信息
        const meta = main.createDiv({ cls: 'deeppdf-lib-item-meta' });

        const statusBadge = meta.createSpan({ cls: `deeppdf-lib-status status-${statusClass}` });
        statusBadge.textContent = statusLabel;

        if (index.progress_percent && index.progress_percent > 0 && index.progress_percent < 100) {
            meta.createSpan({ cls: 'deeppdf-lib-progress', text: `${Math.round(index.progress_percent)}%` });
        }

        if (index.node_count && statusClass === 'ready') {
            meta.createSpan({ cls: 'deeppdf-lib-nodes', text: `${index.node_count} 节点` });
        }

        // 操作区
        if (statusClass === 'ready') {
            const actions = item.createDiv({ cls: 'deeppdf-lib-item-actions' });

            const exportBtn = actions.createEl('button', { cls: 'deeppdf-lib-action-btn' });
            exportBtn.innerHTML = Icons.download;
            exportBtn.title = '导出';
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onExportMarkdown?.(index.id);
            });

            const deleteBtn = actions.createEl('button', { cls: 'deeppdf-lib-action-btn delete' });
            deleteBtn.innerHTML = Icons.trash;
            deleteBtn.title = '删除';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleDelete(index);
            });
        }

        // 点击选择
        item.addEventListener('click', () => {
            if (statusClass === 'ready') {
                this.selectedIndexId = index.id;
                this.options.onIndexChange?.(index.id);
                this.close();
            }
        });

        return item;
    }

    private async handleAddDocument(): Promise<void> {
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
                new Notice('索引处理完成', 3000);
            }
        }, 2000);

        // 立即刷新一次
        this.refreshIndexes();
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
