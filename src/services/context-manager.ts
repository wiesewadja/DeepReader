/**
 * DeepPDF 上下文管理器
 * 管理已加载到对话上下文的文档
 */

import { type App, TFile, Notice } from 'obsidian';
import { error as logError } from '../utils/logger.js';

/**
 * 已加载的文档信息
 */
export interface LoadedDocument {
    /** 文件路径 */
    path: string;
    /** 显示名称 */
    name: string;
    /** 文件内容 */
    content: string;
    /** 字符数 */
    charCount: number;
    /** 加载方式 */
    source: 'current' | 'mention' | 'wikilink';
    /** 加载时间 */
    loadedAt: Date;
}

/**
 * 上下文管理器选项
 */
export interface ContextManagerOptions {
    app: App;
    /** 内容变更回调 */
    onContextChange?: (docs: Map<string, LoadedDocument>) => void;
}

/**
 * 上下文管理器
 * 管理已加载到对话上下文的文档
 */
export class ContextManager {
    private app: App;
    private loadedDocs: Map<string, LoadedDocument> = new Map();
    private onContextChange?: (docs: Map<string, LoadedDocument>) => void;

    constructor(options: ContextManagerOptions) {
        this.app = options.app;
        this.onContextChange = options.onContextChange;
    }

    /**
     * 加载当前活跃文档
     * @returns 加载的文档信息，如果没有活跃文档则返回 null
     */
    async loadCurrentDocument(): Promise<LoadedDocument | null> {
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile) {
            new Notice('没有打开的文档');
            return null;
        }

        if (activeFile.extension !== 'md') {
            new Notice('只支持 Markdown 文件');
            return null;
        }

        return await this.loadByPath(activeFile.path, 'current');
    }

    /**
     * 通过路径加载文档
     * @param path 文件路径
     * @param source 加载方式
     * @returns 加载的文档信息
     */
    async loadByPath(path: string, source: 'current' | 'mention' | 'wikilink' = 'mention'): Promise<LoadedDocument | null> {
        // 检查是否已加载
        if (this.loadedDocs.has(path)) {
            new Notice('文档已在上下文中');
            return this.loadedDocs.get(path)!;
        }

        const file = this.app.vault.getAbstractFileByPath(path);

        if (!(file instanceof TFile)) {
            new Notice('文件不存在');
            return null;
        }

        // 读取文件内容
        let content: string;
        try {
            content = await this.app.vault.read(file);
        } catch (error) {
            new Notice('读取文件失败');
            logError('[ContextManager] 读取文件失败:', error);
            return null;
        }

        const doc: LoadedDocument = {
            path,
            name: file.basename,
            content,
            charCount: content.length,
            source,
            loadedAt: new Date()
        };

        this.loadedDocs.set(path, doc);
        this.notifyChange();
        // new Notice(`已加载: ${doc.name}`);

        return doc;
    }

    /**
     * 移除已加载的文档
     * @param path 文件路径
     */
    removeDocument(path: string): void {
        if (this.loadedDocs.has(path)) {
            this.loadedDocs.delete(path);
            this.notifyChange();
        }
    }
    /**
     * 清空所有已加载的文档
     */
    clearAll(): void {
        this.loadedDocs.clear();
        this.notifyChange();
    }
    /**
     * 获取所有已加载的文档
     */
    getLoadedDocuments(): Map<string, LoadedDocument> {
        return new Map(this.loadedDocs);
    }
    /**
     * 获取已加载文档列表（数组形式）
     */
    getLoadedDocumentsArray(): LoadedDocument[] {
        return Array.from(this.loadedDocs.values());
    }
    /**
     * 获取总字符数
     */
    getTotalCharCount(): number {
        let total = 0;
        for (const doc of this.loadedDocs.values()) {
            total += doc.charCount;
        }
        return total;
    }
    /**
     * 检查是否有已加载的文档
     */
    hasDocuments(): boolean {
        return this.loadedDocs.size > 0;
    }
    /**
     * 检查指定路径是否已加载
     */
    hasDocument(path: string): boolean {
        return this.loadedDocs.has(path);
    }
    /**
     * 获取合并后的上下文内容
     * 用于发送给后端
     */
    getCombinedContext(): string {
        if (this.loadedDocs.size === 0) {
            return '';
        }

        const parts: string[] = [];

        for (const doc of this.loadedDocs.values()) {
            parts.push(`---\n文档: ${doc.name}\n路径: ${doc.path}\n---\n${doc.content}`);
        }

        return parts.join('\n\n');
    }
    /**
     * 通知上下文变更
     */
    private notifyChange(): void {
        this.onContextChange?.(this.loadedDocs);
    }
}
