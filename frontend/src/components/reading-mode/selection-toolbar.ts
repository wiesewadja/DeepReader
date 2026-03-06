/**
 * 悬浮工具栏组件
 * 选中文字后显示引用/摘录操作（极简图标模式）
 */

import { App, Notice } from 'obsidian';

// 极简图标（与 AI 回复气泡图标一致）
const Icons = {
    // 引用图标（quote，用于添加到对话上下文）
    quote: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`,
    // 摘录图标（bookmark，与 AI 回复气泡一致）
    excerpt: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`
};

export interface SelectionToolbarOptions {
    app: App;
    onQuote: (text: string) => void;
    onExcerpt: (text: string) => void;
}

export class SelectionToolbar {
    private app: App;
    private options: SelectionToolbarOptions;
    private toolbarEl: HTMLElement | null = null;
    private lastMousePosition: { x: number; y: number } = { x: 0, y: 0 };

    constructor(options: SelectionToolbarOptions) {
        this.app = options.app;
        this.options = options;
    }

    /**
     * 初始化工具栏
     */
    init(): void {
        // 创建工具栏 DOM（极简图标模式）
        this.toolbarEl = document.body.createDiv({ cls: 'deeppdf-selection-toolbar' });
        this.toolbarEl.innerHTML = `
            <button class="deeppdf-toolbar-btn primary" data-action="quote" title="引用">
                ${Icons.quote}
            </button>
            <button class="deeppdf-toolbar-btn" data-action="excerpt" title="摘录">
                ${Icons.excerpt}
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

        // 监听鼠标移动（记录光标位置）
        document.addEventListener('mousemove', this.handleMouseMove);
        // 监听选中事件
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /**
     * 记录鼠标位置
     */
    private handleMouseMove = (e: MouseEvent): void => {
        this.lastMousePosition = { x: e.clientX, y: e.clientY };
    };

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

        // 使用鼠标光标位置定位
        const toolbarRect = this.toolbarEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 基于鼠标位置计算
        let left = this.lastMousePosition.x - toolbarRect.width / 2;
        let top = this.lastMousePosition.y - toolbarRect.height - 12;

        // 边界检查
        if (left < 10) left = 10;
        if (left + toolbarRect.width > viewportWidth - 10) {
            left = viewportWidth - toolbarRect.width - 10;
        }
        if (top < 10) {
            // 显示在鼠标下方
            top = this.lastMousePosition.y + 16;
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
            case 'quote':
                this.options.onQuote(text);
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
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('keydown', this.handleKeyDown);
        this.toolbarEl?.remove();
        this.toolbarEl = null;
    }
}
