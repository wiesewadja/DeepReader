/**
 * DeepPDF 阅读顶栏组件
 * 极简风格：左侧书籍封面+书名，右侧我的书库和设置按钮
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
    private progressCircleEl: SVGCircleElement | null = null;
    private progressTextEl: HTMLElement | null = null;
    private progressContainerEl: HTMLElement | null = null;

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

        // 中间：阅读进度圆形指示器
        this.progressContainerEl = document.createElement('div');
        this.progressContainerEl.className = 'deeppdf-topbar-progress';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '22');
        svg.setAttribute('height', '22');
        svg.setAttribute('viewBox', '0 0 22 22');

        // 背景圆
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '11');
        bgCircle.setAttribute('cy', '11');
        bgCircle.setAttribute('r', '9');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--background-modifier-border)');
        bgCircle.setAttribute('stroke-width', '2');
        svg.appendChild(bgCircle);

        // 进度圆（stroke-dasharray = 2πr ≈ 56.55）
        this.progressCircleEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.progressCircleEl.setAttribute('cx', '11');
        this.progressCircleEl.setAttribute('cy', '11');
        this.progressCircleEl.setAttribute('r', '9');
        this.progressCircleEl.setAttribute('fill', 'none');
        this.progressCircleEl.setAttribute('stroke', 'var(--interactive-accent)');
        this.progressCircleEl.setAttribute('stroke-width', '2');
        this.progressCircleEl.setAttribute('stroke-linecap', 'round');
        this.progressCircleEl.setAttribute('stroke-dasharray', '56.55');
        this.progressCircleEl.setAttribute('stroke-dashoffset', '56.55');
        this.progressCircleEl.style.transform = 'rotate(-90deg)';
        this.progressCircleEl.style.transformOrigin = '11px 11px';
        this.progressCircleEl.style.transition = 'stroke-dashoffset 0.4s ease';
        svg.appendChild(this.progressCircleEl);

        // 进度百分比 tooltip（跟随鼠标）
        this.progressTextEl = document.createElement('span');
        this.progressTextEl.className = 'deeppdf-progress-text';
        this.progressTextEl.textContent = '0%';
        container.appendChild(this.progressTextEl);

        // 鼠标事件：进入圆圈显示 tooltip，移动时跟随，离开时隐藏
        this.progressContainerEl.addEventListener('mouseenter', () => {
            this.progressTextEl!.style.opacity = '1';
        });
        this.progressContainerEl.addEventListener('mousemove', (e) => {
            const rect = container.getBoundingClientRect();
            this.progressTextEl!.style.left = (e.clientX - rect.left + 8) + 'px';
            this.progressTextEl!.style.top = (e.clientY - rect.top - 24) + 'px';
        });
        this.progressContainerEl.addEventListener('mouseleave', () => {
            this.progressTextEl!.style.opacity = '0';
        });

        this.progressContainerEl.appendChild(svg);
        container.appendChild(this.progressContainerEl);

        // 右侧：操作按钮（我的书库 + 设置）
        const rightSection = document.createElement('div');
        rightSection.className = 'deeppdf-topbar-right';

        // 我的书库按钮
        const libraryBtn = document.createElement('button');
        libraryBtn.className = 'deeppdf-topbar-action-btn';
        libraryBtn.title = '我的书库';
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
     * 设置阅读进度百分比 (0-100)
     */
    public setProgress(percent: number): void {
        if (!this.progressCircleEl || !this.progressTextEl) return;

        const circumference = 56.55; // 2 * π * 9
        const offset = circumference - (circumference * percent / 100);
        this.progressCircleEl.setAttribute('stroke-dashoffset', String(offset));
        this.progressTextEl.textContent = `${percent}%`;

        // 0% 时隐藏进度圆
        if (this.progressContainerEl) {
            this.progressContainerEl.style.opacity = percent > 0 ? '1' : '0.4';
        }
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
        this.progressCircleEl = null;
        this.progressTextEl = null;
        this.progressContainerEl = null;
        super.destroy();
    }
}
