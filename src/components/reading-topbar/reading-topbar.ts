/**
 * DeepPDF 阅读顶栏组件
 * 布局：左侧（mascot），中间（书籍信息+进度），右侧（操作按钮）
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';
import { uiLog as log } from '../../utils/logger.js';
import { MascotFace, type MascotExpression } from './mascot-face.js';
import type { Booklist } from '../../types/index.js';

export interface ReadingTopbarOptions {
    onOpenLibrary?: () => void;
    onOpenSettings?: () => void;
    onCoverClick?: () => void;
    onExitBooklist?: () => void;
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
        this.bookTitleEl.textContent = '未选择文档';
        bookInfo.appendChild(this.bookTitleEl);

        this.bookAuthorEl = document.createElement('div');
        this.bookAuthorEl.className = 'deeppdf-book-author';
        this.bookAuthorEl.textContent = '点击选择书籍';
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
            this.bookTitleEl.textContent = '未选择文档';
            this.bookTitleEl.classList.remove('has-book');
            this.bookAuthorEl.textContent = '点击选择书籍';
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

    /**
     * 设置书单模式（主题阅读）
     */
    public setCurrentBooklist(booklist: Booklist): void {
        if (!this.bookTitleEl || !this.bookAuthorEl) return;

        this.bookTitleEl.textContent = booklist.name;
        this.bookTitleEl.classList.add('has-book');

        const names = booklist.bookNames || [];
        this.bookAuthorEl.textContent = `${booklist.bookIds.length}本书`;
        this.bookAuthorEl.title = names.join('、');

        this.el?.classList.add('booklist-mode');

        this.showExitButton();
    }

    /**
     * 清除书单模式，恢复默认
     */
    public clearBooklistMode(): void {
        this.el?.classList.remove('booklist-mode');
        this.hideExitButton();
        this.setCurrentBook(null);
        this.setBookCover(null);
    }

    private exitBtnEl: HTMLElement | null = null;

    private showExitButton(): void {
        this.hideExitButton();
        if (!this.el) return;

        const centerSection = this.el.querySelector('.deeppdf-topbar-center');
        if (!centerSection) return;

        this.exitBtnEl = document.createElement('button');
        this.exitBtnEl.className = 'deeppdf-topbar-exit-btn';
        this.exitBtnEl.title = '退出主题阅读';
        this.exitBtnEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        this.exitBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onExitBooklist?.();
        });
        centerSection.appendChild(this.exitBtnEl);
    }

    private hideExitButton(): void {
        if (this.exitBtnEl) {
            this.exitBtnEl.remove();
            this.exitBtnEl = null;
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
        this.exitBtnEl = null;

        super.destroy();
    }
}
