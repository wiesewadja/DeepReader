/**
 * DeepPDF 索引管理组件
 * 折叠式面板，用于选择、创建和管理 PDF 索引
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';
import { IndexListItem } from '../../api/http-client.js';

export interface IndexManagerOptions {
    onIndexChange?: (indexId: string) => void;
    onCreateIndex?: () => void;
    onExportMarkdown?: (indexId: string) => void;
    onDeleteIndex?: (indexId: string) => void;
}

export class IndexManager extends Component {
    private options: IndexManagerOptions;
    private isExpanded: boolean = false;
    private indexes: IndexListItem[] = [];
    private selectedIndexId: string = '';

    private headerEl: HTMLElement | null = null;
    private contentEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private toggleIcon: HTMLElement | null = null;

    constructor(options: IndexManagerOptions = {}) {
        super();
        this.options = options;
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
            const emptyState = document.createElement('div');
            emptyState.className = 'deeppdf-index-empty';
            emptyState.textContent = 'No indexes found.';
            this.listEl.appendChild(emptyState);
            return;
        }

        this.indexes.forEach(index => {
            const item = document.createElement('div');
            item.className = `deeppdf-index-item ${index.id === this.selectedIndexId ? 'active' : ''}`;
            item.setAttribute('data-index-id', index.id);

            // 不在这里添加点击事件，因为我们不希望整个项可点击（会干扰按钮）

            // PDF Icon + Name
            const iconAndName = document.createElement('div');
            iconAndName.className = 'deeppdf-index-icon-name';

            const icon = document.createElement('div');
            icon.className = 'deeppdf-index-icon';
            icon.innerHTML = this.getStatusIcon(index.status);

            const name = document.createElement('div');
            name.className = 'deeppdf-index-name-col';
            name.textContent = index.pdf_name;

            iconAndName.appendChild(icon);
            iconAndName.appendChild(name);
            item.appendChild(iconAndName);

            // Status Area (Right Side)
            const statusArea = document.createElement('div');
            statusArea.className = 'deeppdf-index-status-area';

            const status = index.status || 'completed';

            if (status === 'processing' || status === 'indexing') {
                // Show progress bar
                const progressInfo = document.createElement('div');
                progressInfo.className = 'deeppdf-index-progress-info';

                const progressLabel = document.createElement('span');
                progressLabel.className = 'deeppdf-index-progress-label';
                progressLabel.textContent = 'Indexing...';

                const progressPercent = document.createElement('span');
                progressPercent.className = 'deeppdf-index-progress-percent';
                // We'll update this with real progress if available
                progressPercent.textContent = '0%';

                progressInfo.appendChild(progressLabel);
                progressInfo.appendChild(progressPercent);

                const progressBar = document.createElement('div');
                progressBar.className = 'deeppdf-index-progress-bar';
                const progressFill = document.createElement('div');
                progressFill.className = 'deeppdf-index-progress-fill';
                progressFill.style.width = '0%';
                progressBar.appendChild(progressFill);

                statusArea.appendChild(progressInfo);
                statusArea.appendChild(progressBar);
            } else if (status === 'completed' || status === 'ready') {
                // Show "Ready" badge
                const readyBadge = document.createElement('div');
                readyBadge.className = 'deeppdf-index-status-badge ready';
                readyBadge.innerHTML = 'Ready <span class="checkmark">✓</span>';
                statusArea.appendChild(readyBadge);
            } else if (status === 'pending' || status === 'queued') {
                // Show "Queued" badge
                const queuedBadge = document.createElement('div');
                queuedBadge.className = 'deeppdf-index-status-badge queued';
                queuedBadge.innerHTML = 'Queued <span class="clock-icon">⏱️</span>';
                statusArea.appendChild(queuedBadge);
            } else {
                // Unknown status
                const unknownBadge = document.createElement('div');
                unknownBadge.className = 'deeppdf-index-status-badge unknown';
                unknownBadge.textContent = status || 'Unknown';
                statusArea.appendChild(unknownBadge);
            }

            item.appendChild(statusArea);

            // Add click handler to the entire item for selection
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking on action buttons
                const target = e.target as HTMLElement;
                if (!target.closest('button')) {
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
