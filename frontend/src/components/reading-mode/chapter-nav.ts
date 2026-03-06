/**
 * 章节导航组件
 * 显示在阅读视图内容区域底部，提供上一章/下一章导航
 */

import { App, TFile } from 'obsidian';

const Icons = {
    prev: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`,
    next: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
};

export interface ChapterNavOptions {
    app: App;
    onNavigatePrev: () => Promise<boolean>;
    onNavigateNext: () => Promise<boolean>;
    getNavigation: () => { prev: TFile | null; next: TFile | null; currentIndex: number; total: number } | null;
}

export class ChapterNav {
    private app: App;
    private options: ChapterNavOptions;
    private navEl: HTMLElement | null = null;
    private boundHandleKeyDown: (e: KeyboardEvent) => void;

    constructor(options: ChapterNavOptions) {
        this.app = options.app;
        this.options = options;
        this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    }

    /**
     * 初始化导航栏
     */
    init(): void {
        // 创建导航栏元素
        this.createNavElement();

        // 键盘快捷键
        document.addEventListener('keydown', this.boundHandleKeyDown);
    }

    /**
     * 创建导航栏 DOM 元素
     */
    private createNavElement(): void {
        this.navEl = document.createElement('div');
        this.navEl.className = 'deeppdf-chapter-nav';
        this.navEl.innerHTML = `
            <button class="deeppdf-nav-btn prev" title="上一章">
                ${Icons.prev}
                <span class="nav-label">上一章</span>
            </button>
            <div class="deeppdf-nav-info">
                <span class="nav-position">-</span>
            </div>
            <button class="deeppdf-nav-btn next" title="下一章">
                <span class="nav-label">下一章</span>
                ${Icons.next}
            </button>
        `;

        // 绑定按钮事件
        const prevBtn = this.navEl.querySelector('.deeppdf-nav-btn.prev');
        const nextBtn = this.navEl.querySelector('.deeppdf-nav-btn.next');

        prevBtn?.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const success = await this.options.onNavigatePrev();
            if (!success) {
                this.showTooltip('已经是第一章了');
            }
        });

        nextBtn?.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const success = await this.options.onNavigateNext();
            if (!success) {
                this.showTooltip('已经是最后一章了');
            }
        });
    }

    /**
     * 处理键盘事件
     */
    private handleKeyDown(e: KeyboardEvent): void {
        // 只在阅读模式下响应
        if (!document.body.classList.contains('deeppdf-reading-mode')) return;

        // 左箭头：上一章
        if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            this.options.onNavigatePrev();
        }
        // 右箭头：下一章
        if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            this.options.onNavigateNext();
        }
    }

    /**
     * 更新导航状态并插入到阅读视图中
     */
    update(): void {
        console.log('[DeepPDF] ChapterNav.update() called');

        if (!this.navEl) {
            this.createNavElement();
            console.log('[DeepPDF] ChapterNav: created nav element');
        }

        const nav = this.options.getNavigation();
        console.log('[DeepPDF] ChapterNav: navigation data:', nav);

        if (!nav) {
            console.log('[DeepPDF] ChapterNav: no navigation data, hiding');
            this.hide();
            return;
        }

        // 更新位置信息
        const positionEl = this.navEl?.querySelector('.nav-position');
        if (positionEl) {
            positionEl.textContent = `${nav.currentIndex} / ${nav.total}`;
        }

        // 更新按钮状态
        const prevBtn = this.navEl?.querySelector('.deeppdf-nav-btn.prev');
        const nextBtn = this.navEl?.querySelector('.deeppdf-nav-btn.next');

        prevBtn?.classList.toggle('disabled', !nav.prev);
        nextBtn?.classList.toggle('disabled', !nav.next);

        // 延迟插入，确保视图已渲染
        requestAnimationFrame(() => {
            this.insertIntoPreview();
        });
    }

    /**
     * 将导航栏插入到阅读视图
     */
    private insertIntoPreview(): void {
        if (!this.navEl) return;

        console.log('[DeepPDF] ChapterNav: trying to insert into preview');

        // 尝试多种选择器，找到阅读视图的内容容器
        const selectors = [
            '.markdown-preview-sizer',
            '.markdown-preview-view',
            '.markdown-reading-view',
            '.view-content'
        ];

        let container: HTMLElement | null = null;
        for (const selector of selectors) {
            container = document.querySelector(selector) as HTMLElement;
            if (container) {
                console.log('[DeepPDF] ChapterNav: found container with selector:', selector);
                break;
            }
        }

        if (!container) {
            console.warn('[DeepPDF] Chapter nav: container not found');
            return;
        }

        // 移除旧的导航栏（如果存在）
        const oldNav = container.querySelector('.deeppdf-chapter-nav');
        if (oldNav && oldNav !== this.navEl) {
            oldNav.remove();
        }

        // 如果当前容器不包含导航栏，插入
        if (!container.contains(this.navEl)) {
            container.appendChild(this.navEl);
            console.log('[DeepPDF] ChapterNav: inserted into container');
        }
    }

    /**
     * 显示提示
     */
    private showTooltip(text: string): void {
        const tooltip = document.createElement('div');
        tooltip.className = 'deeppdf-nav-tooltip';
        tooltip.textContent = text;
        document.body.appendChild(tooltip);

        requestAnimationFrame(() => {
            tooltip.classList.add('visible');
        });

        setTimeout(() => {
            tooltip.classList.remove('visible');
            setTimeout(() => tooltip.remove(), 200);
        }, 1500);
    }

    /**
     * 显示导航栏
     */
    show(): void {
        this.navEl?.classList.add('visible');
    }

    /**
     * 隐藏导航栏
     */
    hide(): void {
        this.navEl?.remove();
    }

    /**
     * 销毁组件
     */
    destroy(): void {
        document.removeEventListener('keydown', this.boundHandleKeyDown);
        this.navEl?.remove();
        this.navEl = null;
    }
}
