/**
 * 阅读模式服务
 * 管理章节文件的书籍化阅读体验
 */

import { App, TFile, EventRef, MarkdownView } from 'obsidian';
import { log } from '../utils/logger.js';
import { SelectionToolbar, SelectionToolbarOptions, HighlightColorId } from '../components/reading-mode/selection-toolbar.js';
import { ChapterNav, ChapterNavOptions } from '../components/reading-mode/chapter-nav.js';

export interface ReadingModeCallbacks {
    onQuote: (text: string) => void;
    onExcerpt: (text: string) => void;
    onSaveHighlight?: (text: string, color: HighlightColorId) => Promise<void>;
    onRemoveHighlight?: (text: string) => Promise<void>;
}

export interface ChapterNavigation {
    prev: TFile | null;
    next: TFile | null;
    current: TFile;
    total: number;
    currentIndex: number;
}

export class ReadingModeService {
    private app: App;
    private isActive: boolean = false;
    private currentFile: TFile | null = null;
    private fileOpenHandler: EventRef | null = null;
    private selectionToolbar: SelectionToolbar | null = null;
    private chapterNav: ChapterNav | null = null;
    private callbacks: ReadingModeCallbacks | null = null;

    constructor(app: App, callbacks?: ReadingModeCallbacks) {
        this.app = app;
        this.callbacks = callbacks || null;
    }

    /**
     * 设置回调函数
     */
    setCallbacks(callbacks: ReadingModeCallbacks): void {
        this.callbacks = callbacks;
        // 如果工具栏已初始化，需要重新创建以使用新回调
        if (this.selectionToolbar) {
            this.selectionToolbar.destroy();
            this.initSelectionToolbar();
        }
    }

    /**
     * 初始化悬浮工具栏
     */
    private initSelectionToolbar(): void {
        if (!this.callbacks) {
            log('[ReadingMode] No callbacks set, skipping toolbar init');
            return;
        }

        this.selectionToolbar = new SelectionToolbar({
            app: this.app,
            onQuote: this.callbacks.onQuote,
            onExcerpt: this.callbacks.onExcerpt,
            onSaveHighlight: this.callbacks.onSaveHighlight,
            onRemoveHighlight: this.callbacks.onRemoveHighlight,
        });
        this.selectionToolbar.init();
        log('[ReadingMode] Selection toolbar initialized');
    }

    /**
     * 判断文件是否为 DeepReader 章节文件
     * 只要文件在 DeepReader 文件夹下且是 Markdown 文件即可
     */
    isChapterFile(file: TFile): boolean {
        // 必须是 Markdown 文件
        if (file.extension !== 'md') {
            return false;
        }

        // 路径以 DeepReader/ 开头
        if (!file.path.startsWith('DeepReader/')) {
            return false;
        }

        log('[ReadingMode] Chapter file detected:', file.path);
        return true;
    }

    /**
     * 激活阅读模式
     */
    activate(file: TFile): void {
        const wasSameFile = this.isActive && this.currentFile?.path === file.path;
        if (wasSameFile) {
            return; // 同一个文件，无需重新激活
        }

        console.log('[DeepPDF] ReadingMode activating for:', file.path);

        this.currentFile = file;
        this.isActive = true;

        // 切换到阅读视图
        this.switchToReadingView();

        // 添加阅读模式 CSS 类
        document.body.classList.add('deeppdf-reading-mode');

        // 延迟更新章节导航，等待视图渲染完成
        setTimeout(() => {
            console.log('[DeepPDF] ReadingMode: calling chapterNav.update()');
            this.chapterNav?.update();
        }, 100);

        log('[ReadingMode] Activated for:', file.path);
    }

    /**
     * 切换当前 leaf 到阅读视图
     */
    private switchToReadingView(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.getMode() !== 'preview') {
            view.setState({ ...view.getState(), mode: 'preview' }, { history: false });
            log('[ReadingMode] Switched to reading view');
        }
    }

    /**
     * 停用阅读模式
     */
    deactivate(): void {
        if (!this.isActive) return;

        document.body.classList.remove('deeppdf-reading-mode');
        this.chapterNav?.hide();
        this.isActive = false;
        this.currentFile = null;
        log('[ReadingMode] Deactivated');
    }

    /**
     * 启动服务（监听文件打开事件）
     */
    start(): void {
        console.log('[DeepPDF] ReadingMode service starting...');

        // 初始化悬浮工具栏
        if (this.callbacks) {
            this.initSelectionToolbar();
        }

        // 初始化章节导航
        this.initChapterNav();

        this.fileOpenHandler = this.app.workspace.on('file-open', (file) => {
            console.log('[DeepPDF] file-open event:', file?.path);
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
     * 初始化章节导航
     */
    private initChapterNav(): void {
        this.chapterNav = new ChapterNav({
            app: this.app,
            onNavigatePrev: () => this.navigateToPrev(),
            onNavigateNext: () => this.navigateToNext(),
            getNavigation: () => this.getChapterNavigation(),
        });
        this.chapterNav.init();
        log('[ReadingMode] Chapter navigation initialized');
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
        if (this.selectionToolbar) {
            this.selectionToolbar.destroy();
            this.selectionToolbar = null;
        }
        if (this.chapterNav) {
            this.chapterNav.destroy();
            this.chapterNav = null;
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

    /**
     * 获取章节导航信息
     */
    getChapterNavigation(): ChapterNavigation | null {
        if (!this.currentFile) return null;

        const parent = this.currentFile.parent;
        if (!parent) return null;

        // 获取同文件夹下的所有章节文件
        const chapterFiles = parent.children
            .filter((child): child is TFile => {
                if (!(child instanceof TFile)) return false;
                if (child.extension !== 'md') return false;
                // 只包含有序号前缀的章节文件
                return /^\d+-/.test(child.basename);
            })
            .sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));

        const currentIndex = chapterFiles.findIndex(f => f.path === this.currentFile?.path);

        if (currentIndex === -1) return null;

        return {
            prev: currentIndex > 0 ? chapterFiles[currentIndex - 1] : null,
            next: currentIndex < chapterFiles.length - 1 ? chapterFiles[currentIndex + 1] : null,
            current: this.currentFile,
            total: chapterFiles.length,
            currentIndex: currentIndex + 1,  // 1-based index
        };
    }

    /**
     * 跳转到上一章
     */
    async navigateToPrev(): Promise<boolean> {
        const nav = this.getChapterNavigation();
        if (nav?.prev) {
            await this.openFile(nav.prev);
            return true;
        }
        return false;
    }

    /**
     * 跳转到下一章
     */
    async navigateToNext(): Promise<boolean> {
        const nav = this.getChapterNavigation();
        if (nav?.next) {
            await this.openFile(nav.next);
            return true;
        }
        return false;
    }

    /**
     * 打开文件
     */
    private async openFile(file: TFile): Promise<void> {
        const leaf = this.app.workspace.getLeaf(false);
        if (leaf) {
            await leaf.openFile(file, { active: true });
        }
    }
}
