/**
 * DeepPDF 索引管理组件
 * 折叠式面板，用于选择、创建和管理 PDF 索引
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';
import { IndexListItem } from '../../api/http-client.js';
import { App } from 'obsidian';
import { ConfirmModal } from '../confirm-modal.js';

export interface IndexManagerOptions {
    app: App;
    onIndexChange?: (indexId: string) => void;
    onCreateIndex?: () => void;
    onExportMarkdown?: (indexId: string) => void;
    onDeleteIndex?: (indexId: string) => void;
}

export class IndexManager extends Component {
    private options: IndexManagerOptions;
    private app: App;
    private isExpanded: boolean = false;
    private indexes: IndexListItem[] = [];
    private selectedIndexId: string = '';

    private headerEl: HTMLElement | null = null;
    private contentEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private toggleIcon: HTMLElement | null = null;

    constructor(options: IndexManagerOptions) {
        super();
        this.options = options;
        this.app = options.app;
        this.el = this.render();
    }

    render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'deeppdf-index-manager';

        // 1. Header (Toggle)
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'deeppdf-index-manager-header';
        this.headerEl.addEventListener('click', () => this.toggle());

        const title = document.createElement('span');
        title.className = 'deeppdf-index-manager-title';
        title.textContent = 'Index Management';

        this.toggleIcon = document.createElement('span');
        this.toggleIcon.className = 'deeppdf-index-toggle-icon';
        this.toggleIcon.innerHTML = Icons.chevronRight;

        this.headerEl.appendChild(this.toggleIcon);
        this.headerEl.appendChild(title);

        // 2. Content (Collapsible)
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'deeppdf-index-manager-content';
        this.contentEl.style.display = 'none'; // 默认折叠

        // 工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'deeppdf-index-toolbar';

        const createBtn = document.createElement('button');
        createBtn.className = 'deeppdf-btn deeppdf-btn-sm deeppdf-btn-primary';
        createBtn.innerHTML = `${Icons.plus} New Index`;
        createBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onCreateIndex?.();
        });
        toolbar.appendChild(createBtn);
        this.contentEl.appendChild(toolbar);

        // 索引列表
        this.listEl = document.createElement('div');
        this.listEl.className = 'deeppdf-index-list';
        this.contentEl.appendChild(this.listEl);

        container.appendChild(this.headerEl);
        container.appendChild(this.contentEl);

        return container;
    }

    toggle(force?: boolean): void {
        this.isExpanded = force !== undefined ? force : !this.isExpanded;

        if (this.contentEl && this.toggleIcon) {
            if (this.isExpanded) {
                this.contentEl.style.display = 'block';
                this.contentEl.classList.add('visible');
                this.toggleIcon.style.transform = 'rotate(90deg)';
            } else {
                this.contentEl.style.display = 'none';
                this.contentEl.classList.remove('visible');
                this.toggleIcon.style.transform = 'rotate(0deg)';
            }
        }
    }

    setIndexes(indexes: IndexListItem[], selectedId?: string): void {
        this.indexes = indexes;
        if (selectedId !== undefined) {
            this.selectedIndexId = selectedId;
        }
        this.renderList();
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';

        if (this.indexes.length === 0) {
            // 友好的空状态设计
            const emptyState = document.createElement('div');
            emptyState.className = 'deeppdf-index-empty-friendly';

            emptyState.innerHTML = `
                <div class="empty-icon">📚</div>
                <div class="empty-title">还没有索引</div>
                <div class="empty-hint">索引后可以快速检索 PDF 内容并智能问答</div>
                <button class="deeppdf-btn deeppdf-btn-primary create-first-btn" id="create-first-index">
                    ✨ 创建第一个索引
                </button>
                <div class="empty-features">
                    <div class="feature-item">💡 快速检索 PDF 内容</div>
                    <div class="feature-item">🤖 智能 AI 问答</div>
                    <div class="feature-item">📝 导出 Markdown 笔记</div>
                </div>
            `;

            // 添加点击事件
            emptyState.querySelector('#create-first-index')?.addEventListener('click', () => {
                if (this.options.onCreateIndex) {
                    this.options.onCreateIndex();
                }
            });

            this.listEl.appendChild(emptyState);
            return;
        }

        this.indexes.forEach(index => {
            const item = document.createElement('div');
            item.className = `deeppdf-index-item ${index.id === this.selectedIndexId ? 'active' : ''}`;
            item.setAttribute('data-index-id', index.id);

            // 新设计结构：
            // [图标容器] [中间内容区(标题+进度条)] [右侧状态]

            // 1. 左侧图标容器
            const iconWrapper = document.createElement('div');
            // 根据文件类型设置样式（目前主要是 PDF）
            iconWrapper.className = 'deeppdf-index-icon-wrapper pdf';
            iconWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
            item.appendChild(iconWrapper);

            // 2. 中间内容区
            const content = document.createElement('div');
            content.className = 'deeppdf-index-content';

            const name = document.createElement('div');
            name.className = 'deeppdf-index-name';
            name.textContent = index.pdf_name;
            content.appendChild(name);

            // 进度条容器 (始终存在，但仅在 processing 时显示)
            const progressContainer = document.createElement('div');
            progressContainer.className = 'deeppdf-index-progress-container';
            const progressBar = document.createElement('div');
            progressBar.className = 'deeppdf-index-progress-bar';
            progressContainer.appendChild(progressBar);
            content.appendChild(progressContainer);

            item.appendChild(content);

            // 3. 右侧状态区
            const statusDiv = document.createElement('div');

            // 状态规范化 (转为小写)
            const rawStatus = (index.status || 'unknown').toLowerCase();
            let displayStatus = 'Unknown';
            let statusClass = 'unknown';

            // 详细的索引状态日志
            console.log(`[DeepPDF] [IndexManager] 处理索引状态: id="${index.id}", status="${index.status}", rawStatus="${rawStatus}"`);

            if (['processing', 'indexing', 'started', 'created'].includes(rawStatus)) {
                displayStatus = 'Indexing...';
                statusClass = 'processing';
                console.log(`[DeepPDF] [IndexManager] 索引 ${index.id} 状态为 processing`);
            } else if (['completed', 'ready', 'success'].includes(rawStatus)) {
                displayStatus = 'Ready';
                statusClass = 'ready';
                console.log(`[DeepPDF] [IndexManager] 索引 ${index.id} 状态为 completed/ready`);
            } else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
                displayStatus = 'Queued';
                statusClass = 'queued';
                console.log(`[DeepPDF] [IndexManager] 索引 ${index.id} 状态为 pending/queued`);
            } else if (['failed', 'error'].includes(rawStatus)) {
                displayStatus = 'Failed';
                statusClass = 'failed';
                console.log(`[DeepPDF] [IndexManager] 索引 ${index.id} 状态为 failed`);
            } else {
                // 如果是其他非空状态，默认显示该状态文本
                displayStatus = index.status || 'Unknown';
                console.log(`[DeepPDF] [IndexManager] 索引 ${index.id} 有未知状态: "${index.status}"`);
                console.log(`[DeepPDF] [IndexManager] 完整索引对象:`, JSON.stringify(index, null, 2));
            }

            statusDiv.className = `deeppdf-index-status ${statusClass}`;
            statusDiv.innerHTML = `<span>${displayStatus}</span>`;

            // 状态图标
            if (statusClass === 'processing') {
                const spinner = document.createElement('div');
                spinner.className = 'spinner';
                statusDiv.appendChild(spinner);

                // 设置类名以显示进度条
                item.classList.add('processing');

                // 模拟进度
                setTimeout(() => { progressBar.style.width = '45%'; }, 100);
            } else if (statusClass === 'ready') {
                statusDiv.innerHTML += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            } else if (statusClass === 'queued') {
                statusDiv.innerHTML += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
            } else if (statusClass === 'failed') {
                statusDiv.innerHTML += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            }


            item.appendChild(statusDiv);

            // 4. 操作按钮区 (新增 - 删除按钮)
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'deeppdf-index-actions';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'deeppdf-btn-icon deeppdf-btn-danger';
            deleteBtn.innerHTML = Icons.trash;
            deleteBtn.title = 'Delete Index';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止触发选择

                new ConfirmModal(
                    this.app, // 需要传入 app 实例
                    'Delete Index',
                    `Are you sure you want to delete index "${index.pdf_name}"?\nThis action cannot be undone.`,
                    () => {
                        this.options.onDeleteIndex?.(index.id);
                    },
                    {
                        confirmLabel: 'Delete',
                        isDestructive: true
                    }
                ).open();
            });

            actionsDiv.appendChild(deleteBtn);
            item.appendChild(actionsDiv);

            // Add click handler to the entire item for selection
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking on action buttons or inside actionsDiv
                const target = e.target as HTMLElement;
                if (!target.closest('button') && !target.closest('.deeppdf-index-actions')) {
                    this.selectIndex(index.id);
                }
            });

            this.listEl!.appendChild(item);
        });
    }

    private getStatusIcon(status?: string): string {
        const s = status || 'completed';
        if (s === 'processing' || s === 'indexing') {
            return Icons.file || '📄'; // Blue icon for processing
        } else if (s === 'completed' || s === 'ready') {
            return Icons.checkCircle || '✅'; // Green checkmark for ready
        } else if (s === 'pending' || s === 'queued') {
            return Icons.clock || '⏱️'; // Clock for queued
        } else {
            return Icons.file || '📄';
        }
    }

    /**
     * Update progress for a specific index
     */
    public updateIndexProgress(indexId: string, progressPercent: number): void {
        const item = this.listEl?.querySelector(`[data-index-id="${indexId}"]`);
        if (!item) return;

        const progressFill = item.querySelector('.deeppdf-index-progress-fill') as HTMLElement;
        const progressPercentEl = item.querySelector('.deeppdf-index-progress-percent') as HTMLElement;

        if (progressFill) {
            progressFill.style.width = `${progressPercent}%`;
        }
        if (progressPercentEl) {
            progressPercentEl.textContent = `${Math.round(progressPercent)}%`;
        }
    }

    private selectIndex(id: string): void {
        if (this.selectedIndexId === id) return;
        this.selectedIndexId = id;
        this.renderList(); // 重新渲染以更新状态
        this.options.onIndexChange?.(id);
    }
}
