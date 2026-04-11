/**
 * DeepPDF 阅读顶栏组件
 * 极简风格：左侧书籍封面+书名，右侧在线书库和设置按钮
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';
import { uiLog as log } from '../../utils/logger.js';

export interface ReadingTopbarOptions {
    onOpenLibrary?: () => void;
    onOpenSettings?: () => void;
}

export class ReadingTopbar extends Component {
    private options: ReadingTopbarOptions;
    private bookCoverEl: HTMLElement | null = null;
    private bookTitleEl: HTMLElement | null = null;
    private bookAuthorEl: HTMLElement | null = null;

    constructor(options: ReadingTopbarOptions) {
        super();
        this.options = options;
        this.el = this.render();
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

        container.appendChild(leftSection);

        // 右侧：操作按钮（在线书库 + 设置）
        const rightSection = document.createElement('div');
        rightSection.className = 'deeppdf-topbar-right';

        // 在线书库按钮
        const libraryBtn = document.createElement('button');
        libraryBtn.className = 'deeppdf-topbar-action-btn';
        libraryBtn.title = '在线书库';
        libraryBtn.innerHTML = Icons.library;
        libraryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onOpenLibrary?.();
        });
        rightSection.appendChild(libraryBtn);

        // 设置按钮
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'deeppdf-topbar-action-btn';
        settingsBtn.title = '设置';
        settingsBtn.innerHTML = Icons.settings;
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onOpenSettings?.();
        });
        rightSection.appendChild(settingsBtn);

        container.appendChild(rightSection);

        return container;
    }

    /**
     * 设置当前书籍名称
     */
    public setCurrentBook(name: string | null, author?: string): void {
        if (!this.bookTitleEl || !this.bookAuthorEl) return;

        if (name) {
            // Name is already simplified by caller
            this.bookTitleEl.textContent = name;
            this.bookTitleEl.classList.add('has-book');
            this.bookAuthorEl.textContent = author || '';
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
            this.bookCoverEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
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
     * 选择索引（兼容接口)
     */
    public selectIndex(indexId: string): void {
        log(`[ReadingTopbar] selectIndex called: ${indexId}`);
    }

    /**
     * 设置索引列表（兼容接口)
     */
    public setIndexes(indexes: any[]): void {
        log(`[ReadingTopbar] setIndexes called with ${indexes.length} indexes`);
    }

    destroy(): void {
        this.bookCoverEl = null;
        this.bookTitleEl = null;
        this.bookAuthorEl = null;
        super.destroy();
    }
}
