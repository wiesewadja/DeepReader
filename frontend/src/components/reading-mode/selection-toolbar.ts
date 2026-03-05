/**
 * 悬浮工具栏组件
 * 选中文字后显示翻译/提问/摘录操作
 */

import { App, Notice } from 'obsidian';

// 图标
const Icons = {
    translate: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`,
    chat: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    excerpt: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`
};

export interface SelectionToolbarOptions {
    app: App;
    onTranslate: (text: string) => void;
    onAsk: (text: string) => void;
    onExcerpt: (text: string) => void;
}

export class SelectionToolbar {
    private app: App;
    private options: SelectionToolbarOptions;
    private toolbarEl: HTMLElement | null = null;

    constructor(options: SelectionToolbarOptions) {
        this.app = options.app;
        this.options = options;
    }

    /**
     * 初始化工具栏
     */
    init(): void {
        // 创建工具栏 DOM
        this.toolbarEl = document.body.createDiv({ cls: 'deeppdf-selection-toolbar' });
        this.toolbarEl.innerHTML = `
            <button class="deeppdf-toolbar-btn" data-action="translate">
                ${Icons.translate} 翻译
            </button>
            <button class="deeppdf-toolbar-btn primary" data-action="ask">
                ${Icons.chat} 提问
            </button>
            <button class="deeppdf-toolbar-btn" data-action="excerpt">
                ${Icons.excerpt} 摘录
            </button>
        `;

        // 绑定事件
        this.toolbarEl.querySelectorAll('.deeppdf-toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = (btn as HTMLElement).dataset.action;
                this.handleAction(action!);
            });
        });

        // 监听选中事件
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /**
     * 处理鼠标松开事件
     */
    private handleMouseUp = (e: MouseEvent): void => {
        // 忽略工具栏内的点击
        if (this.toolbarEl?.contains(e.target as Node)) {
            return;
        }

        // 延迟检查选中（等待选中完成）
        setTimeout(() => {
            this.checkSelection();
        }, 10);
    };

    /**
     * 处理键盘事件
     */
    private handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            this.hide();
        }
    };

    /**
     * 检查选中内容
     */
    private checkSelection(): void {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            this.hide();
            return;
        }

        const text = selection.toString().trim();
        if (!text) {
            this.hide();
            return;
        }

        // 检查是否在阅读模式区域内
        const range = selection.getRangeAt(0);
        const readingMode = document.body.classList.contains('deeppdf-reading-mode');
        if (!readingMode) {
            this.hide();
            return;
        }

        // 显示工具栏
        this.show(text, range);
    }

    /**
     * 显示工具栏
     */
    private show(text: string, range: Range): void {
        if (!this.toolbarEl) return;

        // 存储选中文本
        (this.toolbarEl as any).__selectedText = text;

        // 计算位置
        const rect = range.getBoundingClientRect();
        const toolbarRect = this.toolbarEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        let left = rect.left + rect.width / 2 - toolbarRect.width / 2;
        let top = rect.top - toolbarRect.height - 8;

        // 边界检查
        if (left < 10) left = 10;
        if (left + toolbarRect.width > viewportWidth - 10) {
            left = viewportWidth - toolbarRect.width - 10;
        }
        if (top < 10) {
            top = rect.bottom + 8; // 显示在下方
        }

        this.toolbarEl.style.left = `${left}px`;
        this.toolbarEl.style.top = `${top + window.scrollY}px`;
        this.toolbarEl.classList.add('visible');
    }

    /**
     * 隐藏工具栏
     */
    hide(): void {
        this.toolbarEl?.classList.remove('visible');
    }

    /**
     * 处理按钮点击
     */
    private handleAction(action: string): void {
        const text = (this.toolbarEl as any).__selectedText;
        if (!text) return;

        this.hide();

        switch (action) {
            case 'translate':
                this.options.onTranslate(text);
                break;
            case 'ask':
                this.options.onAsk(text);
                break;
            case 'excerpt':
                this.options.onExcerpt(text);
                break;
        }
    }

    /**
     * 销毁组件
     */
    destroy(): void {
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('keydown', this.handleKeyDown);
        this.toolbarEl?.remove();
        this.toolbarEl = null;
    }
}
