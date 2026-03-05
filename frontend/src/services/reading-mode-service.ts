/**
 * 阅读模式服务
 * 管理章节文件的书籍化阅读体验
 */

import { App, TFile, EventRef } from 'obsidian';
import { log } from '../utils/logger.js';

export class ReadingModeService {
    private app: App;
    private isActive: boolean = false;
    private currentFile: TFile | null = null;
    private fileOpenHandler: EventRef | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 判断文件是否为 DeepReader 章节文件
     */
    isChapterFile(file: TFile): boolean {
        // 1. 路径以 DeepReader/ 开头
        if (!file.path.startsWith('DeepReader/')) {
            return false;
        }

        // 2. 文件名格式为 NN-章节名.md
        if (!/^\d{2}-/.test(file.name)) {
            return false;
        }

        // 3. 检查 frontmatter 是否包含 node_id 或 pdf_name
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) {
            return false;
        }

        return !!(cache.frontmatter.node_id || cache.frontmatter.pdf_name);
    }

    /**
     * 激活阅读模式
     */
    activate(file: TFile): void {
        if (this.isActive && this.currentFile?.path === file.path) {
            return; // 已经激活
        }

        this.deactivate();
        this.currentFile = file;
        this.isActive = true;

        // 添加阅读模式 CSS 类
        document.body.classList.add('deeppdf-reading-mode');
        log('[ReadingMode] Activated for:', file.path);
    }

    /**
     * 停用阅读模式
     */
    deactivate(): void {
        if (!this.isActive) return;

        document.body.classList.remove('deeppdf-reading-mode');
        this.isActive = false;
        this.currentFile = null;
        log('[ReadingMode] Deactivated');
    }

    /**
     * 启动服务（监听文件打开事件）
     */
    start(): void {
        this.fileOpenHandler = this.app.workspace.on('file-open', (file) => {
            if (file && this.isChapterFile(file)) {
                this.activate(file);
            } else {
                this.deactivate();
            }
        });

        // 检查当前打开的文件
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && this.isChapterFile(activeFile)) {
            this.activate(activeFile);
        }
    }

    /**
     * 停止服务
     */
    stop(): void {
        this.deactivate();
        if (this.fileOpenHandler) {
            this.app.workspace.offref(this.fileOpenHandler);
            this.fileOpenHandler = null;
        }
    }

    /**
     * 获取当前文件信息
     */
    getCurrentFile(): TFile | null {
        return this.currentFile;
    }

    /**
     * 获取当前文件的 index_id
     */
    getCurrentIndexId(): string | null {
        if (!this.currentFile) return null;
        const cache = this.app.metadataCache.getFileCache(this.currentFile);
        return cache?.frontmatter?.index_id || null;
    }
}
