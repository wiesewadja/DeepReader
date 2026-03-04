/**
 * DeepPDF 上下文标签组件
 * 显示已加载到对话上下文的文档标签
 */

import { LoadedDocument } from '../../services/context-manager.js';

export interface ContextTagsOptions {
    /** 文档移除回调 */
    onRemove?: (path: string) => void;
    /** 加载当前文档回调 */
    onLoadCurrentDoc?: () => void;
}

export class ContextTags {
    private el: HTMLElement | null = null;
    private options: ContextTagsOptions;
    private loadBtn: HTMLButtonElement | null = null;
    private tagsContainer: HTMLElement | null = null;
    private loadBtnClickHandler: (() => void) | null = null;

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

        // 加载当前文档按钮
        this.loadBtn = container.createEl('button', {
            cls: 'deeppdf-load-doc-btn'
        });
        this.loadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
        this.loadBtn.setAttribute('aria-label', '加载当前文档到上下文');
        this.loadBtn.type = 'button';

        // 绑定点击事件
        if (this.options.onLoadCurrentDoc) {
            this.loadBtnClickHandler = () => {
                this.options.onLoadCurrentDoc?.();
            };
            this.loadBtn.addEventListener('click', this.loadBtnClickHandler);
        }

        // 标签容器
        this.tagsContainer = container.createEl('div', {
            cls: 'deeppdf-context-tags-list'
        });
        this.tagsContainer.style.display = 'none';

        return container;
    }

    /**
     * 设置加载按钮的激活状态
     */
    setLoadBtnActive(active: boolean): void {
        if (!this.loadBtn) return;
        if (active) {
            this.loadBtn.classList.add('active');
        } else {
            this.loadBtn.classList.remove('active');
        }
    }

    /**
     * 更新显示的文档标签
     */
    updateDocuments(docs: Map<string, LoadedDocument>): void {
        if (!this.tagsContainer) return;

        // 清空现有内容
        this.tagsContainer.innerHTML = '';

        if (docs.size === 0) {
            this.tagsContainer.style.display = 'none';
            // 更新加载按钮状态
            this.setLoadBtnActive(false);
            return;
        }

        this.tagsContainer.style.display = 'flex';
        // 更新加载按钮状态
        this.setLoadBtnActive(true);

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

            this.tagsContainer.appendChild(tag);
        }

        // 添加总字符数
        const total = this.getTotalCharCount(docs);
        const summary = document.createElement('span');
        summary.className = 'deeppdf-context-summary';
        summary.textContent = `共 ${this.formatCharCount(total)}`;
        this.tagsContainer.appendChild(summary);
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
        // 移除加载按钮事件
        if (this.loadBtn && this.loadBtnClickHandler) {
            this.loadBtn.removeEventListener('click', this.loadBtnClickHandler);
            this.loadBtnClickHandler = null;
        }
        this.loadBtn = null;

        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
        this.tagsContainer = null;
    }
}
