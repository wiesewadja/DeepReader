/**
 * 阅读模式服务
 * 管理章节文件的书籍化阅读体验
 */

import { App, TFile, EventRef, MarkdownView } from 'obsidian';
import { serviceLog } from '../utils/logger.js';
import { SelectionToolbar, SelectionToolbarOptions, HighlightColorId } from '../components/reading-mode/selection-toolbar.js';
import { ChapterNav, ChapterNavOptions } from '../components/reading-mode/chapter-nav.js';
import { FocusModeService, FocusModeSettings, DEFAULT_FOCUS_SETTINGS, FocusFontFamily } from './focus-mode-service.js';

export interface ReadingModeCallbacks {
    onQuote: (text: string) => void;
    onExcerpt: (text: string) => void;
    onSaveHighlight?: (text: string, color: HighlightColorId) => Promise<void>;
    onRemoveHighlight?: (text: string) => Promise<void>;
    onBookDetected?: (indexId: string, bookName: string) => void;  // 检测到书籍章节时回调
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
    private focusModeService: FocusModeService | null = null;
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(app: App, callbacks?: ReadingModeCallbacks) {
        this.app = app;
        this.callbacks = callbacks || null;
        this.focusModeService = new FocusModeService();
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
     * 获取聚焦模式服务
     */
    getFocusModeService(): FocusModeService | null {
        return this.focusModeService;
    }

    /**
     * 切换聚焦模式
     * @returns 切换后的状态
     */
    toggleFocusMode(): boolean {
        if (!this.focusModeService) return false;
        const enabled = this.focusModeService.toggle();
        return enabled;
    }

    /**
     * 更新聚焦模式设置
     */
    updateFocusModeSettings(settings: Partial<FocusModeSettings>): void {
        if (!this.focusModeService) return;
        this.focusModeService.updateSettings(settings);
    }

    /**
     * 获取聚焦模式设置
     */
    getFocusModeSettings(): FocusModeSettings {
        return this.focusModeService?.getSettings() || DEFAULT_FOCUS_SETTINGS;
    }

    /**
     * 初始化悬浮工具栏
     */
    private initSelectionToolbar(): void {
        if (!this.callbacks) {
            serviceLog('[ReadingMode] No callbacks set, skipping toolbar init');
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
        serviceLog('[ReadingMode] Selection toolbar initialized');
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

        serviceLog('[ReadingMode] Chapter file detected:', file.path);
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

        serviceLog('[DeepPDF] ReadingMode activating for:', file.path);

        this.currentFile = file;
        this.isActive = true;

        // 切换到阅读视图
        this.switchToReadingView();

        // 添加阅读模式 CSS 类
        document.body.classList.add('deeppdf-reading-mode');

        // 延迟更新章节导航，等待视图渲染完成
        setTimeout(() => {
            serviceLog('[DeepPDF] ReadingMode: calling chapterNav.update()');
            this.chapterNav?.update();
        }, 100);

        // 通知书籍检测回调
        this.notifyBookDetected(file);

        // 自动启用聚焦模式（如果设置了 autoEnable）
        if (this.focusModeService?.shouldAutoEnable()) {
            this.focusModeService.enable();
        }

        // 刷新聚焦模式观察（延迟执行，等待内容渲染）
        setTimeout(() => {
            this.focusModeService?.refresh();
        }, 200);

        serviceLog('[ReadingMode] Activated for:', file.path);
    }

    /**
     * 通知检测到书籍章节
     */
    private notifyBookDetected(file: TFile): void {
        if (!this.callbacks?.onBookDetected) return;

        // 从文件的 frontmatter 获取 index_id 或 pdf_name
        const cache = this.app.metadataCache.getFileCache(file);
        let indexId = cache?.frontmatter?.index_id || cache?.frontmatter?.pdf_index_id;
        let bookName = cache?.frontmatter?.pdf_name || '';

        // 如果没有 index_id，从文件路径提取书籍名称
        if (!bookName) {
            const pathParts = file.path.split('/');
            if (pathParts.length >= 2 && pathParts[0] === 'DeepReader') {
                bookName = pathParts[1];
            }
        }

        // 只要有书名就可以尝试切换（即使没有 index_id，也可以通过书名查找）
        if (bookName) {
            serviceLog('[ReadingMode] Book detected:', bookName, 'indexId:', indexId || 'will search by name');
            this.callbacks.onBookDetected(indexId || '', bookName);
        }
    }

    /**
     * 切换当前 leaf 到阅读视图
     */
    private switchToReadingView(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.getMode() !== 'preview') {
            view.setState({ ...view.getState(), mode: 'preview' }, { history: false });
            serviceLog('[ReadingMode] Switched to reading view');
        }
    }

    /**
     * 停用阅读模式
     */
    deactivate(): void {
        if (!this.isActive) return;

        // 停用聚焦模式（保留 enabled 设置，仅移除 DOM 效果）
        if (this.focusModeService?.getSettings().enabled) {
            this.focusModeService.updateSettings({ enabled: false });
        }

        document.body.classList.remove('deeppdf-reading-mode');
        this.chapterNav?.hide();
        this.isActive = false;
        this.currentFile = null;
        serviceLog('[ReadingMode] Deactivated');
    }

    /**
     * 启动服务（监听文件打开事件）
     */
    start(): void {
        serviceLog('[DeepPDF] ReadingMode service starting...');

        // 初始化悬浮工具栏
        if (this.callbacks) {
            this.initSelectionToolbar();
        }

        // 初始化章节导航
        this.initChapterNav();

        // 初始化键盘快捷键
        this.setupKeydownHandler();

        this.fileOpenHandler = this.app.workspace.on('file-open', (file) => {
            serviceLog('[DeepPDF] file-open event:', file?.path);
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
        serviceLog('[ReadingMode] Chapter navigation initialized');
    }

    /**
     * 停止服务
     */
    stop(): void {
        this.deactivate();
        this.removeKeydownHandler();
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
        if (this.focusModeService) {
            this.focusModeService.destroy();
            this.focusModeService = null;
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
     * 移除键盘快捷键监听（在 Task 7 中实现）
     */
    private removeKeydownHandler(): void {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
    }

    /**
     * 设置键盘快捷键监听
     */
    private setupKeydownHandler(): void {
        if (this.keydownHandler) return;

        this.keydownHandler = (e: KeyboardEvent) => {
            // 只在阅读模式激活时响应
            if (!this.isActive) return;

            // 按 f 键切换聚焦模式
            if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // 检查是否在输入框中
                const activeEl = document.activeElement;
                if (activeEl && (
                    activeEl.tagName === 'INPUT' ||
                    activeEl.tagName === 'TEXTAREA' ||
                    activeEl.getAttribute('contenteditable') === 'true'
                )) {
                    return;
                }

                e.preventDefault();
                const enabled = this.toggleFocusMode();

                // 通过事件通知 UI 更新
                document.body.dispatchEvent(new CustomEvent('deeppdf:focus-mode-change', {
                    detail: { enabled }
                }));
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
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
