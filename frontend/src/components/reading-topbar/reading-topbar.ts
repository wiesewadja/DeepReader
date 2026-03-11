/**
 * DeepPDF 阅读顶栏组件
 * 极简风格：左侧书籍封面+书名，右侧操作按钮
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';
import { uiLog as log } from '../../utils/logger.js';

export interface ReadingTopbarOptions {
    onOpenLibrary?: () => void;
    onNewChat?: () => void;
    onOpenSettings?: () => void;
    onToggleFocusMode?: () => void;
}

export class ReadingTopbar extends Component {
    private options: ReadingTopbarOptions;
    private bookCoverEl: HTMLElement | null = null;
    private bookTitleEl: HTMLElement | null = null;
    private bookAuthorEl: HTMLElement | null = null;
    private statusDot: HTMLElement | null = null;
    private dropdownMenu: HTMLElement | null = null;
    private isDropdownOpen: boolean = false;
    private focusModeBtn: HTMLElement | null = null;
    private isFocusModeEnabled: boolean = false;
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

        // 左侧：书籍封面 + 书名信息
        const leftSection = document.createElement('div');
        leftSection.className = 'deeppdf-topbar-left';

        // 书籍封面（圆形）
        this.bookCoverEl = document.createElement('div');
        this.bookCoverEl.className = 'deeppdf-book-cover';
        // 默认显示书籍图标
        this.bookCoverEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
        leftSection.appendChild(this.bookCoverEl);

        // 书名和作者信息
        const bookInfo = document.createElement('div');
        bookInfo.className = 'deeppdf-book-info';

        this.bookTitleEl = document.createElement('div');
        this.bookTitleEl.className = 'deeppdf-book-title';
        this.bookTitleEl.textContent = '未选择文档';
        bookInfo.appendChild(this.bookTitleEl);

        this.bookAuthorEl = document.createElement('div');
        this.bookAuthorEl.className = 'deeppdf-book-author';
        this.bookAuthorEl.textContent = '点击选择书籍';
        bookInfo.appendChild(this.bookAuthorEl);

        leftSection.appendChild(bookInfo);

        // 状态点（小圆点，放在封面右下角）
        this.statusDot = document.createElement('span');
        this.statusDot.className = 'deeppdf-status-dot';
        this.statusDot.title = '连接中...';
        leftSection.appendChild(this.statusDot);

        container.appendChild(leftSection);

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
            { icon: Icons.library, label: '在线书库', action: () => this.options.onOpenLibrary?.() },
            { icon: Icons.messageSquare, label: '新对话', action: () => this.options.onNewChat?.() },
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

        // 聚焦模式按钮
        this.focusModeBtn = document.createElement('button');
        this.focusModeBtn.className = 'deeppdf-focus-mode-btn';
        this.focusModeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v2m0 16v2M2 12h2m16 0h2"></path></svg>`;
        this.focusModeBtn.title = '聚焦模式';
        this.focusModeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onToggleFocusMode?.();
        });

        // 先添加聚焦按钮，再添加 actionBtn（这样聚焦按钮在左边）
        rightSection.appendChild(this.focusModeBtn);
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
    public setCurrentBook(name: string | null, author?: string): void {
        if (!this.bookTitleEl || !this.bookAuthorEl) return;

        if (name) {
            let displayName = name;
            if (displayName.toLowerCase().endsWith('.pdf')) {
                displayName = displayName.slice(0, -4);
            }
            if (displayName.toLowerCase().endsWith('.epub')) {
                displayName = displayName.slice(0, -5);
            }
            this.bookTitleEl.textContent = displayName;
            this.bookTitleEl.classList.add('has-book');
            this.bookAuthorEl.textContent = author || '已加载';
        } else {
            this.bookTitleEl.textContent = '未选择文档';
            this.bookTitleEl.classList.remove('has-book');
            this.bookAuthorEl.textContent = '点击选择书籍';
        }
    }

    /**
     * 设置书籍封面
     * @param coverUrl 封面图片 URL（通过 vault.getResourcePath 获取）
     */
    public setBookCover(coverUrl: string | null): void {
        if (!this.bookCoverEl) return;

        if (coverUrl) {
            // 显示封面图片
            this.bookCoverEl.innerHTML = `<img src="${coverUrl}" alt="书籍封面" />`;
            this.bookCoverEl.classList.add('has-cover');
        } else {
            // 回退到默认图标
            this.bookCoverEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
            this.bookCoverEl.classList.remove('has-cover');
        }
    }

    /**
     * 设置跨书籍模式
     */
    public setCrossBookMode(isCrossBook: boolean): void {
        if (!this.bookTitleEl || !this.bookAuthorEl) return;

        if (isCrossBook) {
            this.bookTitleEl.textContent = '跨书籍阅读';
            this.bookTitleEl.classList.add('has-book');
            this.bookAuthorEl.textContent = '多本书籍';
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

    /**
     * 设置聚焦模式状态
     */
    public setFocusMode(enabled: boolean): void {
        this.isFocusModeEnabled = enabled;
        if (this.focusModeBtn) {
            if (enabled) {
                this.focusModeBtn.classList.add('active');
                this.focusModeBtn.title = '聚焦模式 (已启用)';
            } else {
                this.focusModeBtn.classList.remove('active');
                this.focusModeBtn.title = '聚焦模式';
            }
        }
    }

    destroy(): void {
        if (this.handleGlobalClick) {
            document.removeEventListener('click', this.handleGlobalClick);
        }
        this.bookCoverEl = null;
        this.bookTitleEl = null;
        this.bookAuthorEl = null;
        this.statusDot = null;
        this.dropdownMenu = null;
        this.focusModeBtn = null;
        super.destroy();
    }
}
