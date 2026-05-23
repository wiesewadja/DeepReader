/**
 * DeepPDF 阅读顶栏组件
 * 布局：左侧（mascot），中间（书籍信息+进度），右侧（操作按钮）
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';
import { uiLog as log } from '../../utils/logger.js';
import { MascotFace, type MascotExpression } from './mascot-face.js';

export interface ReadingTopbarOptions {
    onOpenLibrary?: () => void;
    onOpenSettings?: () => void;
    onCoverClick?: () => void;
}

export class ReadingTopbar extends Component {
    private options: ReadingTopbarOptions;
    private bookCoverEl: HTMLElement | null = null;
    private bookTitleEl: HTMLElement | null = null;
    private bookAuthorEl: HTMLElement | null = null;
    private mascotFace: MascotFace | null = null;

    constructor(options: ReadingTopbarOptions) {
        super();
        this.options = options;
        this.el = this.render();
    }

    render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'deeppdf-reading-topbar';

        // 左侧：奚童表情（固定）
        this.mascotFace = new MascotFace();
        container.appendChild(this.mascotFace.getElement()!);

        // 中间：书籍信息 + 进度
        const centerSection = document.createElement('div');
        centerSection.className = 'deeppdf-topbar-center';

        const bookGroup = document.createElement('div');
        bookGroup.className = 'deeppdf-topbar-book-group';

        this.bookCoverEl = document.createElement('div');
        this.bookCoverEl.className = 'deeppdf-book-cover';
        this.bookCoverEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
        this.bookCoverEl.addEventListener('click', () => {
            this.options.onCoverClick?.();
        });
        bookGroup.appendChild(this.bookCoverEl);

        const bookInfo = document.createElement('div');
        bookInfo.className = 'deeppdf-book-info';

        this.bookTitleEl = document.createElement('div');
        this.bookTitleEl.className = 'deeppdf-book-title';
        this.bookTitleEl.textContent = '奚童 · AI 伴读';
        bookInfo.appendChild(this.bookTitleEl);

        this.bookAuthorEl = document.createElement('div');
        this.bookAuthorEl.className = 'deeppdf-book-author';
        this.bookAuthorEl.textContent = '';
        bookInfo.appendChild(this.bookAuthorEl);

        bookGroup.appendChild(bookInfo);
        centerSection.appendChild(bookGroup);
        container.appendChild(centerSection);

        // 右侧：操作按钮
        const rightSection = document.createElement('div');
        rightSection.className = 'deeppdf-topbar-right';

        const libraryBtn = document.createElement('button');
        libraryBtn.className = 'deeppdf-topbar-action-btn';
        libraryBtn.title = '我的书库';
        libraryBtn.innerHTML = Icons.library;
        libraryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onOpenLibrary?.();
        });
        rightSection.appendChild(libraryBtn);

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
            this.bookTitleEl.textContent = name;
            this.bookTitleEl.classList.add('has-book');
            this.bookAuthorEl.textContent = author || '';
        } else {
            this.bookTitleEl.textContent = '奚童 · AI 伴读';
            this.bookTitleEl.classList.remove('has-book');
            this.bookAuthorEl.textContent = '';
        }
    }

    /**
     * 设置书籍封面
     */
    public setBookCover(coverUrl: string | null): void {
        if (!this.bookCoverEl) return;

        if (coverUrl) {
            this.bookCoverEl.innerHTML = `<img src="${coverUrl}" alt="书籍封面" />`;
            this.bookCoverEl.classList.add('has-cover');
        } else {
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
    }

    public selectIndex(indexId: string): void {
        log(`[ReadingTopbar] selectIndex called: ${indexId}`);
    }

    public setIndexes(indexes: any[]): void {
        log(`[ReadingTopbar] setIndexes called with ${indexes.length} indexes`);
    }

    public setMascotExpression(expr: MascotExpression): void {
        this.mascotFace?.setExpression(expr);
    }

    public onMascotUserActivity(): void {
        this.mascotFace?.onUserActivity();
    }

    public detachMascot(): HTMLElement | null {
        if (!this.mascotFace) return null;
        const el = this.mascotFace.getElement();
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
        return el;
    }

    public reattachMascot(el: HTMLElement): void {
        if (!el.parentNode && this.el) {
            this.el.insertBefore(el, this.el.firstChild);
        }
    }

    destroy(): void {
        this.mascotFace?.destroy();
        this.mascotFace = null;
        this.bookCoverEl = null;
        this.bookTitleEl = null;
        this.bookAuthorEl = null;

        super.destroy();
    }
}
