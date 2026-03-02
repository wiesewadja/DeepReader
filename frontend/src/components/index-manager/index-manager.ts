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
    onNewChat?: () => void;
    onOpenReadingPortal?: () => void;
    onOpenBookManagement?: () => void;
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
    private currentPdfEl: HTMLElement | null = null;
    private statusDot: HTMLElement | null = null;
    private dropdownMenu: HTMLElement | null = null;
    private isDropdownOpen: boolean = false;

    // 全局点击监听器（绑定方法）
    private handleGlobalClick: (e: MouseEvent) => void;

    constructor(options: IndexManagerOptions) {
        super();
        this.options = options;
        this.app = options.app;
        this.el = this.render();

        // 绑定全局点击监听器，用于关闭下拉菜单
        this.handleGlobalClick = this.handleGlobalClickImpl.bind(this);
        document.addEventListener('click', this.handleGlobalClick);
    }

    /**
     * 全局点击处理实现
     * 当点击下拉菜单外部时关闭菜单
     */
    private handleGlobalClickImpl(e: MouseEvent): void {
        if (this.isDropdownOpen && this.dropdownMenu && this.headerEl) {
            if (!this.headerEl.contains(e.target as Node)) {
                this.closeDropdown();
            }
        }
    }

    render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'deeppdf-index-manager';

        // 1. Header (Toggle + New Index Button)
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'deeppdf-index-manager-header';

        // 左侧：折叠图标 + 标题
        const leftSection = document.createElement('div');
        leftSection.className = 'deeppdf-index-header-left';
        leftSection.addEventListener('click', () => this.toggle());

        this.toggleIcon = document.createElement('span');
        this.toggleIcon.className = 'deeppdf-index-toggle-icon';
        this.toggleIcon.innerHTML = Icons.chevronRight;

        const titleWrapper = document.createElement('div');
        titleWrapper.className = 'deeppdf-index-title-wrapper';

        // 第一行：标题 + 状态点
        const titleRow = document.createElement('div');
        titleRow.className = 'deeppdf-index-title-row';

        const title = document.createElement('span');
        title.className = 'deeppdf-index-manager-title';
        title.textContent = '文档库';

        // 连接状态指示器
        this.statusDot = document.createElement('span');
        this.statusDot.className = 'deeppdf-connection-status';
        this.statusDot.title = '连接中...';

        titleRow.appendChild(title);
        titleRow.appendChild(this.statusDot);

        titleWrapper.appendChild(titleRow);

        leftSection.appendChild(this.toggleIcon);
        leftSection.appendChild(titleWrapper);

        // 右侧：操作下拉菜单按钮
        const actionBtn = document.createElement('button');
        actionBtn.className = 'deeppdf-btn deeppdf-btn-sm deeppdf-btn-primary deeppdf-index-action-btn';
        actionBtn.innerHTML = `${Icons.plus} 操作`;
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // 创建下拉菜单
        this.dropdownMenu = document.createElement('div');
        this.dropdownMenu.className = 'deeppdf-dropdown-menu';
        this.dropdownMenu.style.display = 'none';

        // 菜单项
        const menuItems = [
            { icon: Icons.plus, label: '添加文档', action: () => this.options.onCreateIndex?.() },
            { icon: Icons.messageSquare, label: '新增对话', action: () => this.options.onNewChat?.() },
            { icon: Icons.library, label: '图书管理', action: () => this.options.onOpenBookManagement?.() }
        ];

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'deeppdf-dropdown-item';
            menuItem.innerHTML = `${item.icon} ${item.label}`;
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeDropdown();
                item.action();
            });
            if (this.dropdownMenu) {
                this.dropdownMenu.appendChild(menuItem);
            }
        });

        // 中央：当前 PDF 名称（绝对定位居中）
        this.currentPdfEl = document.createElement('div');
        this.currentPdfEl.className = 'deeppdf-current-pdf';
        this.currentPdfEl.style.display = 'none';

        this.headerEl.appendChild(leftSection);
        this.headerEl.appendChild(this.currentPdfEl);
        this.headerEl.appendChild(actionBtn);
        this.headerEl.appendChild(this.dropdownMenu);

        // 2. Content (Collapsible)
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'deeppdf-index-manager-content';
        this.contentEl.style.display = 'none'; // 默认折叠

        // 索引列表（移除 toolbar）
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

    private toggleDropdown(): void {
        this.isDropdownOpen = !this.isDropdownOpen;
        if (this.dropdownMenu) {
            this.dropdownMenu.style.display = this.isDropdownOpen ? 'block' : 'none';
            if (this.isDropdownOpen) {
                this.dropdownMenu.classList.add('open');
            } else {
                this.dropdownMenu.classList.remove('open');
            }
        }
    }

    private closeDropdown(): void {
        this.isDropdownOpen = false;
        if (this.dropdownMenu) {
            this.dropdownMenu.style.display = 'none';
            this.dropdownMenu.classList.remove('open');
        }
    }

    setIndexes(indexes: IndexListItem[], selectedId?: string): void {
        this.indexes = indexes;
        if (selectedId !== undefined) {
            this.selectedIndexId = selectedId;
        }
        this.renderList();
        this.updateCurrentPdfIndicator();
    }

    private updateCurrentPdfIndicator(): void {
        if (!this.currentPdfEl) return;

        const selectedIndex = this.indexes.find(idx => idx.id === this.selectedIndexId);

        if (selectedIndex) {
            // 移除 .pdf 后缀
            let displayName = selectedIndex.pdf_name;
            if (displayName.toLowerCase().endsWith('.pdf')) {
                displayName = displayName.slice(0, -4);
            }
            this.currentPdfEl.textContent = displayName;
            this.currentPdfEl.style.display = 'inline-block';
        } else {
            this.currentPdfEl.style.display = 'none';
        }
    }

    /**
     * 设置跨书籍模式显示
     * @param isCrossBook 是否为跨书籍模式
     */
    public setCrossBookMode(isCrossBook: boolean): void {
        if (!this.currentPdfEl) return;

        if (isCrossBook) {
            this.currentPdfEl.textContent = '📚 跨书籍阅读';
            this.currentPdfEl.style.display = 'inline-block';
        } else {
            this.updateCurrentPdfIndicator();
        }
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';

        if (this.indexes.length === 0) {
            // 简化的空状态
            const emptyState = document.createElement('div');
            emptyState.className = 'deeppdf-index-empty-compact';

            emptyState.innerHTML = `
                <div class="empty-icon">📚</div>
                <div class="empty-hint">还没有索引文档</div>
                <button class="deeppdf-btn deeppdf-btn-primary deeppdf-btn-sm" id="create-first-index">
                    添加文档
                </button>
            `;

            emptyState.querySelector('#create-first-index')?.addEventListener('click', () => {
                if (this.options.onCreateIndex) {
                    this.options.onCreateIndex();
                }
            });

            this.listEl.appendChild(emptyState);
            return;
        }

        // 简化的紧凑列表
        this.indexes.forEach(index => {
            const item = document.createElement('div');
            item.className = `deeppdf-index-item-compact ${index.id === this.selectedIndexId ? 'active' : ''}`;
            item.setAttribute('data-index-id', index.id);

            // 状态判断
            const rawStatus = (index.status || 'unknown').toLowerCase();
            let statusClass = 'ready';
            let showProgress = false;

            if (['processing', 'indexing', 'started', 'created'].includes(rawStatus)) {
                statusClass = 'processing';
                showProgress = true;
            } else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
                statusClass = 'queued';
            } else if (['failed', 'error'].includes(rawStatus)) {
                statusClass = 'failed';
            }

            // 简化结构：[状态图标] [书名] [操作按钮]
            const statusIcon = document.createElement('span');
            statusIcon.className = `deeppdf-index-status-icon ${statusClass}`;
            if (statusClass === 'processing') {
                statusIcon.innerHTML = '<div class="spinner-small"></div>';
            } else if (statusClass === 'ready') {
                statusIcon.innerHTML = '✓';
            } else if (statusClass === 'failed') {
                statusIcon.innerHTML = '✗';
            } else {
                statusIcon.innerHTML = '○';
            }

            const name = document.createElement('span');
            name.className = 'deeppdf-index-name-compact';
            // 移除 .pdf 后缀
            let displayName = index.pdf_name;
            if (displayName.toLowerCase().endsWith('.pdf')) {
                displayName = displayName.slice(0, -4);
            }
            name.textContent = displayName;
            name.title = index.pdf_name; // 完整名称在 tooltip 中

            // 进度条（仅索引进度中时显示）
            if (showProgress) {
                const progressEl = document.createElement('span');
                progressEl.className = 'deeppdf-index-progress-text';
                const percent = index.progress_percent || 0;
                progressEl.textContent = `${Math.round(percent)}%`;
                name.appendChild(progressEl);
            }

            item.appendChild(statusIcon);
            item.appendChild(name);

            // 悬停时显示操作按钮
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'deeppdf-index-actions-compact';

            // 导出 Markdown 按钮
            const exportBtn = document.createElement('button');
            exportBtn.className = 'deeppdf-btn-icon-small';
            exportBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
            exportBtn.title = '导出章节';
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onExportMarkdown?.(index.id);
            });

            // 删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'deeppdf-btn-icon-small delete';
            deleteBtn.innerHTML = Icons.trash;
            deleteBtn.title = '删除';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                new ConfirmModal(
                    this.app,
                    '删除索引',
                    `确定要删除「${index.pdf_name}」的索引吗？`,
                    () => {
                        this.options.onDeleteIndex?.(index.id);
                    },
                    {
                        confirmLabel: '删除',
                        isDestructive: true
                    }
                ).open();
            });

            actionsDiv.appendChild(exportBtn);
            actionsDiv.appendChild(deleteBtn);
            item.appendChild(actionsDiv);

            // 点击选择
            item.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('button')) {
                    this.selectIndex(index.id);
                }
            });

            this.listEl!.appendChild(item);
        });
    }

    /**
     * Update progress for a specific index
     */
    public updateIndexProgress(indexId: string, progressPercent: number): void {
        const item = this.listEl?.querySelector(`[data-index-id="${indexId}"]`);
        if (!item) return;

        // 更新进度文本
        const progressText = item.querySelector('.deeppdf-index-progress-text') as HTMLElement;
        if (progressText) {
            progressText.textContent = `${Math.round(progressPercent)}%`;
        }
    }

    setConnectionStatus(status: 'loading' | 'connected' | 'disconnected' | 'error'): void {
        if (!this.statusDot) return;

        // Remove all status classes
        this.statusDot.removeClass('status-loading');
        this.statusDot.removeClass('status-ok');
        this.statusDot.removeClass('status-error');

        // Add appropriate class and update title
        switch (status) {
            case 'loading':
                this.statusDot.addClass('status-loading');
                this.statusDot.title = 'Connecting...';
                break;
            case 'connected':
                this.statusDot.addClass('status-ok');
                this.statusDot.title = 'Connected';
                break;
            case 'disconnected':
            case 'error':
                this.statusDot.addClass('status-error');
                this.statusDot.title = 'Disconnected';
                break;
        }
    }

    public selectIndex(id: string): void {
        if (this.selectedIndexId === id) return;
        this.selectedIndexId = id;
        this.renderList(); // 重新渲染以更新状态
        this.updateCurrentPdfIndicator(); // 更新当前 PDF 指示器
        this.options.onIndexChange?.(id);
    }

    destroy(): void {
        // 移除全局点击监听器
        if (this.handleGlobalClick) {
            document.removeEventListener('click', this.handleGlobalClick);
            this.handleGlobalClick = null as any;
        }

        // 清空所有 DOM 引用，避免内存泄漏
        this.headerEl = null;
        this.contentEl = null;
        this.listEl = null;
        this.toggleIcon = null;
        this.currentPdfEl = null;
        this.statusDot = null;
        this.dropdownMenu = null;

        super.destroy();
    }
}
