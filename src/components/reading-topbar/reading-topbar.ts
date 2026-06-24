/**
 * DeepPDF 阅读顶栏组件
 * 布局：左侧（mascot），中间（书籍信息+进度），右侧（操作按钮）
 */

import type { Booklist } from '../../types/index.js';
import { Icons } from '../../utils/icons.js';
import { uiLog as log } from '../../utils/logger.js';
import { Component } from '../component.js';
import { MascotFace, type MascotExpression } from './mascot-face.js';

export type ReadingTTSState = 'idle' | 'loading' | 'playing';

export interface ReadingTopbarOptions {
    onOpenLibrary?: () => void;
    onOpenSettings?: () => void;
    onCoverClick?: () => void;
    onExitBooklist?: () => void;
    onBooklistRename?: (newName: string) => void;
    onToggleReadingTTS?: () => void;
}

export class ReadingTopbar extends Component {
    private options: ReadingTopbarOptions;
    private bookCoverEl: HTMLElement | null = null;
    private bookTitleEl: HTMLElement | null = null;
    private bookAuthorEl: HTMLElement | null = null;
    private mascotFace: MascotFace | null = null;
    private ttsBtn: HTMLElement | null = null;
    private ttsState: ReadingTTSState = 'idle';
    private coverRotateTimer: ReturnType<typeof setInterval> | null = null;
    private coverFrontIndex = 0;
    private isEditingTitle = false;
    private titleBeforeEdit = '';

    constructor(options: ReadingTopbarOptions) {
        super();
        this.options = options;
        this.el = this.render();
    }

    render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'deeppdf-reading-topbar';

        // 奚童表情：作为 AI 伴读形象，不再固定于最左侧，而是作为默认的中间头像
        this.mascotFace = new MascotFace();

        // 中间：书籍信息 + 进度
        const centerSection = document.createElement('div');
        centerSection.className = 'deeppdf-topbar-center';

        const bookGroup = document.createElement('div');
        bookGroup.className = 'deeppdf-topbar-book-group';

        this.bookCoverEl = document.createElement('div');
        this.bookCoverEl.className = 'deeppdf-book-cover';
        
        // 默认将奚童头像作为中间的图标
        const mascotEl = this.mascotFace.getElement();
        if (mascotEl) {
            this.bookCoverEl.appendChild(mascotEl);
        }
        
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

        this.ttsBtn = document.createElement('button');
        this.ttsBtn.className = 'deeppdf-topbar-action-btn deeppdf-tts-reading-btn';
        this.ttsBtn.title = '朗读原文';
        this.ttsBtn.innerHTML = Icons.volume2;
        this.ttsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onToggleReadingTTS?.();
        });
        rightSection.appendChild(this.ttsBtn);

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
            this.el?.classList.add('has-book');
            this.bookAuthorEl.textContent = author || '';
        } else {
            this.bookTitleEl.textContent = '奚童 · AI 伴读';
            this.bookTitleEl.classList.remove('has-book');
            this.el?.classList.remove('has-book');
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
            this.bookCoverEl.innerHTML = '';
            if (this.mascotFace) {
                const el = this.mascotFace.getElement();
                if (el) {
                    this.bookCoverEl.appendChild(el);
                }
            }
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
            this.el?.classList.add('has-book');
            this.bookAuthorEl.textContent = '多本书籍';
        }
    }

    /**
     * 设置书单模式（主题阅读）
     */
    public setCurrentBooklist(booklist: Booklist): void {
        if (!this.bookTitleEl || !this.bookAuthorEl) return;

        this.bookTitleEl.textContent = booklist.name || '主题阅读';
        this.bookTitleEl.classList.add('has-book');
        this.el?.classList.add('has-book');

        const names = booklist.bookNames || [];
        this.bookAuthorEl.textContent = names.join('、');
        this.bookAuthorEl.title = names.join('、');

        this.renderStackedCovers(booklist.items);

        this.el?.classList.add('booklist-mode');
        this.startCoverRotation();

        this.setupTitleEditing();
    }

    private renderStackedCovers(items?: import('../../types/index.js').BooklistItemInfo[]): void {
        if (!this.bookCoverEl) return;
        this.bookCoverEl.innerHTML = '';
        this.bookCoverEl.classList.remove('has-cover');
        this.bookCoverEl.classList.remove('stacked');

        if (!items || items.length === 0) {
            this.bookCoverEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
            return;
        }

        this.bookCoverEl.classList.add('stacked');
        const slots = ['back', 'middle', 'front'] as const;
        const maxShow = Math.min(items.length, 3);
        for (let i = 0; i < maxShow; i++) {
            const item = items[i];
            const cover = document.createElement('div');
            cover.className = 'deeppdf-inline-cover';
            cover.dataset.slot = slots[i] || 'back';
            if (item.coverUrl) {
                cover.style.backgroundImage = `url(${item.coverUrl})`;
            }
            this.bookCoverEl.appendChild(cover);
        }
    }

    /** 异步更新书单封面（封面加载完成后调用） */
    public updateBooklistCovers(items: { id: string; name: string; coverUrl?: string }[]): void {
        if (!this.bookCoverEl) return;
        const covers = this.bookCoverEl.querySelectorAll<HTMLElement>('.deeppdf-inline-cover');
        items.forEach((item, i) => {
            if (covers[i] && item.coverUrl) {
                covers[i].style.backgroundImage = `url(${item.coverUrl})`;
            }
        });
    }

    /**
     * 清除书单模式，恢复默认
     */
    public clearBooklistMode(): void {
        this.stopCoverRotation();
        this.el?.classList.remove('booklist-mode');
        this.bookTitleEl?.classList.remove('editable');
        this.setCurrentBook(null);
        this.setBookCover(null);
    }

    /**
     * 书单模式下启用标题双击编辑
     */
    private setupTitleEditing(): void {
        if (!this.bookTitleEl) return;

        this.bookTitleEl.classList.add('editable');

        // 移除旧监听（防止重复绑定）
        this.bookTitleEl.removeEventListener('dblclick', this._onTitleDblClick);
        this.bookTitleEl.removeEventListener('keydown', this._onTitleKeyDown);
        this.bookTitleEl.removeEventListener('blur', this._onTitleBlur);

        this.bookTitleEl.addEventListener('dblclick', this._onTitleDblClick);
        this.bookTitleEl.addEventListener('keydown', this._onTitleKeyDown);
        this.bookTitleEl.addEventListener('blur', this._onTitleBlur);
    }

    private _onTitleDblClick = (e: MouseEvent): void => {
        const el = this.bookTitleEl;
        if (!el) return;
        e.preventDefault();

        this.isEditingTitle = true;
        this.titleBeforeEdit = el.textContent || '';
        el.contentEditable = 'true';
        el.classList.add('editing');
        el.focus();

        // 选中全部文字
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    };

    private _onTitleKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.bookTitleEl?.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (this.bookTitleEl) {
                this.bookTitleEl.textContent = this.titleBeforeEdit;
                this.bookTitleEl.blur();
            }
        }
    };

    private _onTitleBlur = (): void => {
        const el = this.bookTitleEl;
        if (!el || !this.isEditingTitle) return;

        el.contentEditable = 'false';
        el.classList.remove('editing');
        this.isEditingTitle = false;

        const newName = (el.textContent || '').trim();
        if (newName && newName !== this.titleBeforeEdit) {
            this.options.onBooklistRename?.(newName);
        } else if (!newName) {
            el.textContent = this.titleBeforeEdit;
        }
    };

    public selectIndex(indexId: string): void {
        log(`[ReadingTopbar] selectIndex called: ${indexId}`);
    }

    public setIndexes(indexes: any[]): void {
        log(`[ReadingTopbar] setIndexes called with ${indexes.length} indexes`);
    }

    /**
     * 设置朗读按钮状态
     */
    public setReadingTTSState(state: ReadingTTSState): void {
        this.ttsState = state;
        if (!this.ttsBtn) return;

        this.ttsBtn.classList.remove('idle', 'loading', 'playing');
        this.ttsBtn.classList.add(state);

        switch (state) {
            case 'idle':
                this.ttsBtn.innerHTML = Icons.volume2;
                this.ttsBtn.title = '朗读原文';
                break;
            case 'loading':
                this.ttsBtn.innerHTML = Icons.spinner;
                this.ttsBtn.title = '正在加载...';
                break;
            case 'playing':
                this.ttsBtn.innerHTML = Icons.audioWave;
                this.ttsBtn.title = '停止朗读';
                break;
        }
    }

    /**
     * 获取当前朗读按钮状态
     */
    public getReadingTTSState(): ReadingTTSState {
        return this.ttsState;
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
        if (el.parentNode) {
            el.parentNode.removeChild(el);
        }
        // 如果没有封面图片，将奚童头像重新放回 bookCoverEl 中
        if (this.bookCoverEl && !this.bookCoverEl.classList.contains('has-cover')) {
            this.bookCoverEl.innerHTML = '';
            this.bookCoverEl.appendChild(el);
        }
    }

    private startCoverRotation(): void {
        this.stopCoverRotation();
        const covers = this.bookCoverEl?.querySelectorAll<HTMLElement>('.deeppdf-inline-cover');
        if (!covers || covers.length <= 1) return;

        const slotOrder = ['back', 'middle', 'front'] as const;

        this.coverRotateTimer = setInterval(() => {
            covers.forEach(el => {
                const slot = el.dataset.slot;
                if (slot === 'front') el.dataset.slot = 'middle';
                else if (slot === 'middle') el.dataset.slot = 'back';
                else el.dataset.slot = 'front';
            });
        }, 5000);
    }

    private stopCoverRotation(): void {
        if (this.coverRotateTimer) {
            clearInterval(this.coverRotateTimer);
            this.coverRotateTimer = null;
        }
    }

    destroy(): void {
        this.stopCoverRotation();
        this.mascotFace?.destroy();
        this.mascotFace = null;
        this.ttsBtn = null;
        this.bookCoverEl = null;
        this.bookTitleEl = null;
        this.bookAuthorEl = null;

        super.destroy();
    }
}
