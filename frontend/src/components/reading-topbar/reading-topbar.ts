/**
 * DeepPDF 阅读顶栏组件
 * 极简透明风格：只显示当前书籍名称、操作入口和连接状态
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';
import { log } from '../../utils/logger.js';

export interface ReadingTopbarOptions {
    onOpenLibrary?: () => void;
    onNewChat?: () => void;
    onOpenBookManagement?: () => void;
    onOpenSettings?: () => void;
}

export class ReadingTopbar extends Component {
    private options: ReadingTopbarOptions;
    private currentBookEl: HTMLElement | null = null;
    private statusDot: HTMLElement | null = null;
    private dropdownMenu: HTMLElement | null = null;
    private isDropdownOpen: boolean = false;
    private handleGlobalClick: (e: MouseEvent) => void;

    constructor(options: ReadingTopbarOptions) {
        super();
        this.options = options;
        this.el = this.render();

        this.handleGlobalClick = this.handleGlobalClickImpl.bind(this);
        document.addEventListener('click', this.handleGlobalClick);

        // 初始化连接状态（默认为 connecting）
        this.setConnectionStatus('connecting');
    }

    render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'deeppdf-reading-topbar';

        // 左侧：占位（保持平衡）
        const leftSection = document.createElement('div');
        leftSection.className = 'deeppdf-topbar-left';

        // 状态点放在左侧
        this.statusDot = document.createElement('span');
        this.statusDot.className = 'deeppdf-status-dot';
        this.statusDot.title = '连接中...';
        leftSection.appendChild(this.statusDot);

        container.appendChild(leftSection);

        // 中间：当前书籍名称（居中）
        const centerSection = document.createElement('div');
        centerSection.className = 'deeppdf-topbar-center';

        this.currentBookEl = document.createElement('div');
        this.currentBookEl.className = 'deeppdf-current-book';
        this.currentBookEl.textContent = '未选择文档';
        centerSection.appendChild(this.currentBookEl);

        container.appendChild(centerSection);

        // 右侧：操作按钮
        const rightSection = document.createElement('div');
        rightSection.className = 'deeppdf-topbar-right';

        // 操作按钮（简约三点图标）
        const actionBtn = document.createElement('button');
        actionBtn.className = 'deeppdf-topbar-action-btn';
        actionBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`;
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // 下拉菜单
        this.dropdownMenu = document.createElement('div');
        this.dropdownMenu.className = 'deeppdf-topbar-dropdown';

        const menuItems = [
            { icon: Icons.library, label: '切换书籍', action: () => this.options.onOpenLibrary?.() },
            { icon: Icons.messageSquare, label: '新对话', action: () => this.options.onNewChat?.() },
            { icon: Icons.bookworm, label: '同步图书', action: () => this.options.onOpenBookManagement?.() },
            { divider: true },
            { icon: Icons.settings, label: '设置', action: () => this.options.onOpenSettings?.() }
        ];

        menuItems.forEach(item => {
            if ('divider' in item && item.divider) {
                const divider = document.createElement('div');
                divider.className = 'deeppdf-dropdown-divider';
                this.dropdownMenu?.appendChild(divider);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'deeppdf-dropdown-item';
                menuItem.innerHTML = `${item.icon} ${item.label}`;
                menuItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeDropdown();
                    item.action?.();
                });
                this.dropdownMenu?.appendChild(menuItem);
            }
        });

        rightSection.appendChild(actionBtn);
        rightSection.appendChild(this.dropdownMenu);
        container.appendChild(rightSection);

        return container;
    }

    private handleGlobalClickImpl(e: MouseEvent): void {
        if (this.isDropdownOpen && this.el && !this.el.contains(e.target as Node)) {
            this.closeDropdown();
        }
    }

    private toggleDropdown(): void {
        this.isDropdownOpen = !this.isDropdownOpen;
        if (this.dropdownMenu) {
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
            this.dropdownMenu.classList.remove('open');
        }
    }

    /**
     * 设置当前书籍名称
     */
    public setCurrentBook(name: string | null): void {
        if (!this.currentBookEl) return;

        if (name) {
            let displayName = name;
            if (displayName.toLowerCase().endsWith('.pdf')) {
                displayName = displayName.slice(0, -4);
            }
            this.currentBookEl.textContent = displayName;
            this.currentBookEl.classList.add('has-book');
        } else {
            this.currentBookEl.textContent = '未选择文档';
            this.currentBookEl.classList.remove('has-book');
        }
    }

    /**
     * 设置跨书籍模式
     */
    public setCrossBookMode(isCrossBook: boolean): void {
        if (!this.currentBookEl) return;

        if (isCrossBook) {
            this.currentBookEl.textContent = '跨书籍阅读';
            this.currentBookEl.classList.add('has-book');
        }
        // 注意：当 isCrossBook 为 false 时，不在这里更新显示
        // 应该由调用方通过 setCurrentBook() 设置正确的书籍名称
    }

    /**
     * 选择索引（兼容接口）
     */
    public selectIndex(indexId: string): void {
        log(`[ReadingTopbar] selectIndex called: ${indexId}`);
    }

    /**
     * 设置索引列表（兼容接口）
     */
    public setIndexes(indexes: any[]): void {
        log(`[ReadingTopbar] setIndexes called with ${indexes.length} indexes`);
    }

    /**
     * 设置连接状态
     */
    public setConnectionStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
        if (!this.statusDot) return;

        // 更新状态点的样式
        this.statusDot.className = `deeppdf-status-dot deeppdf-status-dot--${status}`;

        // 更新 tooltip
        const tooltips: Record<string, string> = {
            connected: '后端已连接，所有功能可用',
            disconnected: '后端未连接，部分功能不可用',
            connecting: '正在连接后端服务...'
        };
        this.statusDot.title = tooltips[status];
    }

    destroy(): void {
        if (this.handleGlobalClick) {
            document.removeEventListener('click', this.handleGlobalClick);
        }
        this.currentBookEl = null;
        this.statusDot = null;
        this.dropdownMenu = null;
        super.destroy();
    }
}
