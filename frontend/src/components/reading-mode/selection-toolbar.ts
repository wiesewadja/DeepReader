/**
 * 悬浮工具栏组件
 * 选中文字后显示引用/摘录/高亮操作（极简图标模式）
 */

import { App, Notice } from 'obsidian';
import { uiLog } from '../../utils/logger.js';

// 极简图标（与 AI 回复气泡图标一致）
const Icons = {
    // 引用图标（quote，用于添加到对话上下文）
    quote: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`,
    // 摘录图标（bookmark，与 AI 回复气泡一致）
    excerpt: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    // 高亮图标（荧光笔）
    highlight: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`,
    // 移除高亮图标（橡皮擦）
    removeHighlight: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`
};

// 高亮颜色配置
export const HIGHLIGHT_COLORS = [
    { id: 'yellow', label: '黄色', color: '#ffeb3b', bg: 'rgba(255, 235, 59, 0.4)' },
    { id: 'green', label: '绿色', color: '#4caf50', bg: 'rgba(76, 175, 80, 0.4)' },
    { id: 'blue', label: '蓝色', color: '#2196f3', bg: 'rgba(33, 150, 243, 0.4)' },
    { id: 'pink', label: '粉色', color: '#e91e63', bg: 'rgba(233, 30, 99, 0.4)' },
    { id: 'orange', label: '橙色', color: '#ff9800', bg: 'rgba(255, 152, 0, 0.4)' },
] as const;

export type HighlightColorId = typeof HIGHLIGHT_COLORS[number]['id'];

export interface SelectionToolbarOptions {
    app: App;
    onQuote: (text: string) => void;
    onExcerpt: (text: string) => void;
    onSaveHighlight?: (text: string, color: HighlightColorId) => Promise<void>;
    onRemoveHighlight?: (text: string) => Promise<void>;
}

export class SelectionToolbar {
    private app: App;
    private options: SelectionToolbarOptions;
    private toolbarEl: HTMLElement | null = null;
    private colorPickerEl: HTMLElement | null = null;
    private lastMousePosition: { x: number; y: number } = { x: 0, y: 0 };
    private savedRange: Range | null = null;  // 保存选中范围
    private existingHighlight: HTMLElement | null = null;  // 已存在的高亮元素（用于移除）

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
            <button class="deeppdf-toolbar-btn highlight-trigger" data-action="highlight" title="高亮">
                ${Icons.highlight}
            </button>
        `;

        // 创建颜色选择器
        this.colorPickerEl = document.body.createDiv({ cls: 'deeppdf-highlight-picker' });
        this.colorPickerEl.innerHTML = HIGHLIGHT_COLORS.map(c =>
            `<button class="deeppdf-highlight-color" data-color="${c.id}" title="${c.label}" style="--highlight-color: ${c.bg}">
                <span class="color-dot" style="background: ${c.color}"></span>
            </button>`
        ).join('');

        // 绑定工具栏按钮事件
        this.toolbarEl.querySelectorAll('.deeppdf-toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = (btn as HTMLElement).dataset.action;
                if (action === 'highlight') {
                    this.handleHighlight(this.getRandomColor());
                } else {
                    this.handleAction(action!);
                }
            });
        });

        // 绑定颜色选择器事件
        this.colorPickerEl.querySelectorAll('.deeppdf-highlight-color').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const color = (btn as HTMLElement).dataset.color as HighlightColorId;
                this.handleHighlight(color);
            });
        });

        // 监听鼠标移动（记录光标位置）
        document.addEventListener('mousemove', this.handleMouseMove);
        // 监听选中事件
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('keydown', this.handleKeyDown);
        // 点击其他区域关闭颜色选择器
        document.addEventListener('click', this.handleOutsideClick);
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
        // 忽略工具栏和颜色选择器内的点击
        if (this.toolbarEl?.contains(e.target as Node) || this.colorPickerEl?.contains(e.target as Node)) {
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
            this.hideColorPicker();
            this.hide();
        }
    };

    /**
     * 处理点击外部区域
     */
    private handleOutsideClick = (e: MouseEvent): void => {
        if (this.colorPickerEl?.classList.contains('visible') &&
            !this.colorPickerEl.contains(e.target as Node) &&
            !this.toolbarEl?.querySelector('.highlight-trigger')?.contains(e.target as Node)) {
            this.hideColorPicker();
        }
    };

    /**
     * 切换颜色选择器显示
     */
    private toggleColorPicker(): void {
        if (!this.colorPickerEl || !this.toolbarEl) return;

        if (this.colorPickerEl.classList.contains('visible')) {
            this.hideColorPicker();
        } else {
            this.showColorPicker();
        }
    }

    /**
     * 显示颜色选择器
     */
    private showColorPicker(): void {
        if (!this.colorPickerEl || !this.toolbarEl) return;

        // 定位在工具栏下方
        const toolbarRect = this.toolbarEl.getBoundingClientRect();
        this.colorPickerEl.style.left = `${toolbarRect.left}px`;
        this.colorPickerEl.style.top = `${toolbarRect.bottom + 8}px`;
        this.colorPickerEl.classList.add('visible');
    }

    /**
     * 隐藏颜色选择器
     */
    private hideColorPicker(): void {
        this.colorPickerEl?.classList.remove('visible');
    }

    /**
     * 处理高亮操作
     */
    private handleHighlight(color: HighlightColorId): void {
        const text = (this.toolbarEl as any).__selectedText;
        if (!text || !this.savedRange) return;

        this.hideColorPicker();
        this.hide();

        // 直接在 DOM 上应用高亮
        try {
            const range = this.savedRange;
            const highlightSpan = document.createElement('mark');
            highlightSpan.setAttribute('data-highlight', color);
            highlightSpan.style.backgroundColor = this.getHighlightColor(color);

            // 使用 extractContents 和 insertNode 来包装选中内容
            const fragment = range.extractContents();
            highlightSpan.appendChild(fragment);
            range.insertNode(highlightSpan);

            // 调用保存回调（持久化到文件）
            if (this.options.onSaveHighlight) {
                this.options.onSaveHighlight(text, color);
            }
        } catch (err) {
            uiLog.error('[DeepPDF] Failed to highlight text:', err);
            new Notice('高亮失败');
        }
    }

    /**
     * 获取高亮颜色
     */
    private getHighlightColor(color: HighlightColorId): string {
        const colors: Record<HighlightColorId, string> = {
            yellow: 'rgba(255, 235, 59, 0.5)',
            green: 'rgba(76, 175, 80, 0.4)',
            blue: 'rgba(33, 150, 243, 0.4)',
            pink: 'rgba(233, 30, 99, 0.4)',
            orange: 'rgba(255, 152, 0, 0.4)',
        };
        return colors[color] || colors.yellow;
    }

    /**
     * 随机获取一个高亮颜色
     */
    private getRandomColor(): HighlightColorId {
        const colorIds = HIGHLIGHT_COLORS.map(c => c.id);
        const randomIndex = Math.floor(Math.random() * colorIds.length);
        return colorIds[randomIndex];
    }

    /**
     * 移除高亮
     */
    private removeHighlight(): void {
        if (!this.existingHighlight) {
            this.hide();
            return;
        }

        // 获取高亮文本（用于保存到文件）
        const text = this.existingHighlight.textContent || '';

        try {
            // 将高亮元素的内容提取出来，替换高亮元素
            const parent = this.existingHighlight.parentNode;
            if (parent) {
                // 将高亮元素的子节点移动到父节点
                while (this.existingHighlight.firstChild) {
                    parent.insertBefore(this.existingHighlight.firstChild, this.existingHighlight);
                }
                // 移除空的高亮元素
                parent.removeChild(this.existingHighlight);
            }

            // 调用移除回调（从文件中移除高亮标记）
            if (this.options.onRemoveHighlight) {
                this.options.onRemoveHighlight(text);
            }
        } catch (err) {
            uiLog.error('[DeepPDF] Failed to remove highlight:', err);
        }

        this.hide();
        this.existingHighlight = null;
    }

    /**
     * 检查选中内容
     */
    private checkSelection(): void {
        const selection = window.getSelection();
        const hasSelection = selection && !selection.isCollapsed && selection.toString().trim();

        // 检查是否在阅读模式区域内
        const readingMode = document.body.classList.contains('deeppdf-reading-mode');
        if (!readingMode) {
            this.hide();
            this.hideColorPicker();
            return;
        }

        // 如果没有选中文本，隐藏工具栏
        if (!hasSelection) {
            this.hide();
            this.hideColorPicker();
            return;
        }

        const text = selection!.toString().trim();
        const range = selection!.getRangeAt(0);

        // 检查选中文本是否在高亮元素内
        this.existingHighlight = this.findHighlightElement(range.startContainer);

        // 显示工具栏
        this.show(text, range);
    }

    /**
     * 查找高亮元素
     */
    private findHighlightElement(node: Node): HTMLElement | null {
        let current: Node | null = node;
        while (current && current !== document.body) {
            if (current instanceof HTMLElement && current.tagName === 'MARK') {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    /**
     * 显示工具栏
     */
    private show(text: string, range: Range): void {
        if (!this.toolbarEl) return;

        // 存储选中文本和范围
        (this.toolbarEl as any).__selectedText = text;
        this.savedRange = range.cloneRange();  // 克隆范围以保存

        // 根据是否已高亮显示不同的工具栏
        if (this.existingHighlight) {
            // 已高亮：显示移除按钮
            this.toolbarEl.innerHTML = `
                <button class="deeppdf-toolbar-btn primary" data-action="quote" title="引用">
                    ${Icons.quote}
                </button>
                <button class="deeppdf-toolbar-btn" data-action="excerpt" title="摘录">
                    ${Icons.excerpt}
                </button>
                <button class="deeppdf-toolbar-btn remove-highlight-btn" data-action="remove-highlight" title="移除高亮">
                    ${Icons.removeHighlight}
                </button>
            `;
        } else {
            // 未高亮：显示高亮按钮
            this.toolbarEl.innerHTML = `
                <button class="deeppdf-toolbar-btn primary" data-action="quote" title="引用">
                    ${Icons.quote}
                </button>
                <button class="deeppdf-toolbar-btn" data-action="excerpt" title="摘录">
                    ${Icons.excerpt}
                </button>
                <button class="deeppdf-toolbar-btn highlight-trigger" data-action="highlight" title="高亮">
                    ${Icons.highlight}
                </button>
            `;
        }

        // 绑定工具栏按钮事件
        this.toolbarEl.querySelectorAll('.deeppdf-toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = (btn as HTMLElement).dataset.action;
                if (action === 'highlight') {
                    this.handleHighlight(this.getRandomColor());
                } else if (action === 'remove-highlight') {
                    this.removeHighlight();
                } else {
                    this.handleAction(action!);
                }
            });
        });

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
        document.removeEventListener('click', this.handleOutsideClick);
        this.toolbarEl?.remove();
        this.toolbarEl = null;
        this.colorPickerEl?.remove();
        this.colorPickerEl = null;
    }
}
