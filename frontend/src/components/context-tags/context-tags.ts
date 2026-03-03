/**
 * DeepPDF 上下文标签组件
 * 显示已加载到对话上下文的文档标签
 */

import { LoadedDocument } from '../../services/context-manager.js';

export interface ContextTagsOptions {
    /** 文档移除回调 */
    onRemove?: (path: string) => void;
}

export class ContextTags {
    private el: HTMLElement | null = null;
    private options: ContextTagsOptions;

    constructor(options: ContextTagsOptions = {}) {
        this.options = options;
        this.el = this.render();
    }

    /**
     * 渲染组件
     */
    private render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'deeppdf-context-tags';
        container.style.display = 'none'; // 默认隐藏

        return container;
    }

    /**
     * 更新显示的文档标签
     */
    updateDocuments(docs: Map<string, LoadedDocument>): void {
        if (!this.el) return;

        // 清空现有内容
        this.el.innerHTML = '';

        if (docs.size === 0) {
            this.el.style.display = 'none';
            return;
        }

        this.el.style.display = 'flex';

        // 添加标签
        for (const doc of docs.values()) {
            const tag = document.createElement('span');
            tag.className = 'deeppdf-context-tag';

            // 图标 + 名称 + 字符数
            tag.innerHTML = `<span class="deeppdf-context-tag-icon">📄</span>
                <span class="deeppdf-context-tag-name">${this.escapeHtml(doc.name)}</span>
                <span class="deeppdf-context-tag-count">${this.formatCharCount(doc.charCount)}</span>
                <button class="deeppdf-context-tag-remove" data-path="${doc.path}">×</button>`;

            // 移除按钮点击事件
            const removeBtn = tag.querySelector('.deeppdf-context-tag-remove');
            removeBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onRemove?.(doc.path);
            });

            this.el.appendChild(tag);
        }

        // 添加总字符数
        const total = this.getTotalCharCount(docs);
        const summary = document.createElement('span');
        summary.className = 'deeppdf-context-summary';
        summary.textContent = `共 ${this.formatCharCount(total)}`;
        this.el.appendChild(summary);
    }

    /**
     * 获取总字符数
     */
    private getTotalCharCount(docs: Map<string, LoadedDocument>): number {
        let total = 0;
        for (const doc of docs.values()) {
            total += doc.charCount;
        }
        return total;
    }

    /**
     * 格式化字符数
     */
    private formatCharCount(count: number): string {
        if (count >= 1000) {
            return `${Math.round(count / 1000)}k字`;
        }
        return `${count}字`;
    }

    /**
     * HTML 转义
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 获取组件元素
     */
    getElement(): HTMLElement | null {
        return this.el;
    }

    /**
     * 销毁组件
     */
    destroy(): void {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}
