/**
 * DeepPDF 文档库弹窗
 * 简约风格的居中弹窗设计
 */

import { App, Modal, Notice } from 'obsidian';
import { PDFFileSelectorModal, DocumentFileInfo } from '../../ui/pdf-file-selector.js';
import { IndexListItem } from '../../api/http-client.js';
import { ConfirmModal } from '../confirm-modal.js';

export interface LibraryModalOptions {
    app: App;
    indexes: IndexListItem[];
    selectedIndexId: string | null;
    onIndexChange?: (indexId: string) => void;
    onCreateIndex?: () => Promise<void>;
    onExportMarkdown?: (indexId: string) => void;
    onDeleteIndex?: (indexId: string) => void;
    onRefresh?: () => Promise<void>;
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
    private emptyEl: HTMLElement | null = null;

    constructor(app: App, options: LibraryModalOptions) {
        super(app);
        this.options = options;
        this.indexes = [...options.indexes];
        this.selectedIndexId = options.selectedIndexId;
    }

    onOpen() {
        const { contentEl, modalEl } = this;

        // 居中弹窗样式
        modalEl.addClass('deeppdf-library-modal');
        contentEl.empty();
        contentEl.addClass('deeppdf-library-content');

        this.render();
    }

    onClose() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.removeClass('deeppdf-library-modal');
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        // 头部区域
        const header = contentEl.createDiv({ cls: 'deeppdf-library-header' });

        // 标题
        const titleEl = header.createEl('h2', { cls: 'deeppdf-library-title' });
        titleEl.textContent = '在线书库';

        // 文档数量标签
        const countBadge = header.createDiv({ cls: 'deeppdf-library-count' });
        countBadge.textContent = `${this.indexes.length} 个`;

        // 工具栏（搜索 + 添加按钮）
        const toolbar = contentEl.createDiv({ cls: 'deeppdf-library-toolbar' });

        // 搜索框
        const searchWrapper = toolbar.createDiv({ cls: 'deeppdf-library-search-wrapper' });
        searchWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

        this.searchInputEl = searchWrapper.createEl('input', {
            cls: 'deeppdf-library-search-input',
            attr: {
                type: 'text',
                placeholder: '搜索',
                value: this.searchQuery
            }
        });

        this.searchInputEl.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.renderList();
        });

        // 文档列表容器
        const listContainer = contentEl.createDiv({ cls: 'deeppdf-library-list-container' });
        this.listEl = listContainer.createDiv({ cls: 'deeppdf-library-list' });
        this.emptyEl = listContainer.createDiv({ cls: 'deeppdf-library-empty' });
        this.emptyEl.style.display = 'none';

        this.renderList();
    }

    private renderList(): void {
        if (!this.listEl || !this.emptyEl) return;

        this.listEl.innerHTML = '';

        // 过滤文档
        const filteredIndexes = this.searchQuery
            ? this.indexes.filter(idx =>
                  idx.pdf_name.toLowerCase().includes(this.searchQuery.toLowerCase())
              )
            : this.indexes;

        if (filteredIndexes.length === 0) {
            this.listEl.style.display = 'none';
            this.emptyEl.style.display = 'flex';

            if (this.searchQuery) {
                this.emptyEl.innerHTML = `
                    <div class="deeppdf-library-empty-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </div>
                    <div class="deeppdf-library-empty-title">未找到匹配的文档</div>
                `;
            } else {
                this.emptyEl.innerHTML = `
                    <div class="deeppdf-library-empty-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                    </div>
                    <div class="deeppdf-library-empty-title">暂无文档</div>
                    <div class="deeppdf-library-empty-hint">点击右上角 + 添加</div>
                `;
            }
            return;
        }

        this.listEl.style.display = 'flex';
        this.emptyEl.style.display = 'none';

        // 按状态排序
        const sortedIndexes = this.sortIndexes(filteredIndexes);

        sortedIndexes.forEach(index => {
            const item = this.createIndexItem(index);
            this.listEl!.appendChild(item);
        });
    }

    private sortIndexes(indexes: IndexListItem[]): IndexListItem[] {
        const statusPriority: Record<string, number> = {
            'processing': 0,
            'indexing': 0,
            'started': 0,
            'running': 0,
            'pending': 1,
            'queued': 1,
            'ready': 2,
            'completed': 2,
            'success': 2,
            'failed': 3,
            'error': 3
        };

        return [...indexes].sort((a, b) => {
            const priorityA = statusPriority[(a.status || '').toLowerCase()] ?? 4;
            const priorityB = statusPriority[(b.status || '').toLowerCase()] ?? 4;
            return priorityA - priorityB;
        });
    }

    private createIndexItem(index: IndexListItem): HTMLElement {
        const item = document.createElement('div');
        item.className = `deeppdf-library-item ${index.id === this.selectedIndexId ? 'active' : ''}`;
        item.setAttribute('data-index-id', index.id);

        // 状态判断
        const rawStatus = (index.status || 'unknown').toLowerCase();
        let statusClass = 'ready';
        let statusLabel = '就绪';
        let showProgress = false;

        if (['processing', 'indexing', 'started', 'created', 'running', 'active'].includes(rawStatus)) {
            statusClass = 'processing';
            statusLabel = '索引中';
            showProgress = true;
        } else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
            statusClass = 'queued';
            statusLabel = '等待';
        } else if (['failed', 'error'].includes(rawStatus)) {
            statusClass = 'failed';
            statusLabel = '失败';
        }

        if (index.progress_percent && index.progress_percent > 0 && index.progress_percent < 100) {
            showProgress = true;
        }

        // 名称
        let displayName = index.pdf_name;
        if (displayName.toLowerCase().endsWith('.pdf')) {
            displayName = displayName.slice(0, -4);
        }

        const nameEl = item.createDiv({ cls: 'deeppdf-library-item-name', text: displayName });
        nameEl.title = index.pdf_name;

        // 元信息行
        const metaEl = item.createDiv({ cls: 'deeppdf-library-item-meta' });

        // 状态标签
        const statusBadge = metaEl.createDiv({ cls: `deeppdf-library-status ${statusClass}` });
        statusBadge.textContent = statusLabel;

        // 进度
        if (showProgress && index.progress_percent) {
            const progressEl = metaEl.createDiv({ cls: 'deeppdf-library-progress' });
            progressEl.textContent = `${Math.round(index.progress_percent)}%`;
        }

        // 节点数
        if (index.node_count && statusClass === 'ready') {
            const nodesEl = metaEl.createDiv({ cls: 'deeppdf-library-nodes' });
            nodesEl.textContent = `${index.node_count} 节点`;
        }

        // 操作按钮（仅就绪状态显示）
        if (statusClass === 'ready') {
            const actionsEl = item.createDiv({ cls: 'deeppdf-library-item-actions' });

            // 导出按钮
            const exportBtn = actionsEl.createEl('button', { cls: 'deeppdf-library-action-btn' });
            exportBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
            exportBtn.setAttribute('title', '导出');
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onExportMarkdown?.(index.id);
            });

            // 删除按钮
            const deleteBtn = actionsEl.createEl('button', { cls: 'deeppdf-library-action-btn delete' });
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            deleteBtn.setAttribute('title', '删除');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleDelete(index);
            });

            item.appendChild(actionsEl);
        }

        // 点击选择
        item.addEventListener('click', () => {
            if (statusClass === 'ready') {
                this.selectIndex(index.id);
            }
        });

        return item;
    }

    private selectIndex(indexId: string): void {
        this.selectedIndexId = indexId;
        this.options.onIndexChange?.(indexId);
        this.close();
    }

    /**
     * 打开添加文档对话框
     */
    public openAddDocument(): void {
        new PDFFileSelectorModal(this.app, async (fileInfo: DocumentFileInfo) => {
            try {
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

                            if (result.status === 'pending') {
                                new Notice(`索引任务已创建，正在后台处理...`, 4000);
                                await new Promise(resolve => setTimeout(resolve, 500));
                                await this.options.onRefresh?.();
                                await this.refreshIndexes();
                            } else if (result.status === 'success') {
                                new Notice(`索引成功！节点数: ${result.node_count}`, 3000);
                                await this.refreshIndexes();
                            } else {
                                new Notice(`索引状态: ${result.status}`, 3000);
                                await this.refreshIndexes();
                            }
                        } catch (error: any) {
                            let errorMessage = '索引创建失败';
                            if (error.message) {
                                if (error.message.includes('Too Many Requests')) {
                                    errorMessage = '创建索引过于频繁，请稍后再试';
                                } else if (error.message.includes('API key')) {
                                    errorMessage = 'API key 未配置或无效';
                                } else {
                                    errorMessage = `索引创建失败: ${error.message}`;
                                }
                            }
                            new Notice(errorMessage, 5000);
                            console.error('[DeepPDF] 索引创建错误:', error);
                        }
                    },
                    { confirmLabel: '开始索引' }
                ).open();
            } catch (error) {
                console.error('[DeepPDF] 打开文件选择器失败:', error);
            }
        }).open();
    }

    private handleDelete(index: IndexListItem): void {
        new ConfirmModal(
            this.app,
            '删除索引',
            `确定要删除「${index.pdf_name}」的索引吗？此操作不可撤销。`,
            async () => {
                this.options.onDeleteIndex?.(index.id);
                await this.refreshIndexes();
            },
            { confirmLabel: '删除', isDestructive: true }
        ).open();
    }

    private async refreshIndexes(): Promise<void> {
        await this.options.onRefresh?.();
        this.indexes = [...this.options.indexes];
        this.renderList();
    }

    /**
     * 更新索引列表（外部调用）
     */
    public updateIndexes(indexes: IndexListItem[], selectedId?: string): void {
        this.indexes = [...indexes];
        if (selectedId !== undefined) {
            this.selectedIndexId = selectedId;
        }
        this.renderList();
    }
}
