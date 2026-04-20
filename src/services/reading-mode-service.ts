/**
 * 阅读模式服务
 * 管理章节文件的书籍化阅读体验
 */

import { App, TFile, EventRef, MarkdownView } from 'obsidian';
import { serviceLog } from '../utils/logger.js';
import { SelectionToolbar, SelectionToolbarOptions, HighlightColorId } from '../components/reading-mode/selection-toolbar.js';
import { ChapterNav, ChapterNavOptions } from '../components/reading-mode/chapter-nav.js';
import { PagePaginator } from '../components/reading-mode/page-paginator.js';
import { InkLayer } from '../components/reading-mode/ink-layer.js';
import type { QuoteMetadata } from '../components/chat-input/chat-input.js';

export interface ReadingModeCallbacks {
    onQuote: (metadata: QuoteMetadata) => void;
    onExcerpt: (text: string, range: Range) => void;  // 添加 range 参数
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
    private activeContainerEl: HTMLElement | null = null;  // 记录当前阅读模式所在 leaf 的 containerEl
    private fileOpenHandler: EventRef | null = null;
    private selectionToolbar: SelectionToolbar | null = null;
    private chapterNav: ChapterNav | null = null;
    private paginator: PagePaginator | null = null;
    private inkLayer: InkLayer | null = null;
    private callbacks: ReadingModeCallbacks | null = null;
    private autoEnable: boolean = true;
    private style: 'paginated' | 'scrolling' = 'paginated';
    private originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView | null = null;
    private hashChangeHandler: ((e: HashChangeEvent) => void) | null = null;

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
     * 设置是否自动启用阅读模式
     */
    setAutoEnable(value: boolean): void {
        this.autoEnable = value;
    }

    /**
     * 获取是否自动启用阅读模式
     */
    getAutoEnable(): boolean {
        return this.autoEnable;
    }

    /**
     * 设置阅读模式样式（分页/滚动）
     * 如果当前已激活，立即切换
     */
    setStyle(style: 'paginated' | 'scrolling'): void {
        this.style = style;
        // 如果当前已激活，重新激活以应用新样式
        if (this.isActive && this.currentFile) {
            const file = this.currentFile;
            this.deactivate();
            this.activate(file);
        }
    }

    /**
     * 获取当前阅读模式样式
     */
    getStyle(): 'paginated' | 'scrolling' {
        return this.style;
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
     * 条件：
     * 1. 必须是 Markdown 文件
     * 2. 路径以 DeepReader/ 开头
     * 3. frontmatter 中必须包含 source 字段（书籍标识）
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

        // 检查 frontmatter 标识字段
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        if (!frontmatter) {
            serviceLog('[ReadingMode] No frontmatter:', file.path);
            return false;
        }

        // 必须有 source 字段（书籍来源）
        const hasSource = !!(frontmatter.source || frontmatter.pdf_name || frontmatter.book);
        if (!hasSource) {
            serviceLog('[ReadingMode] File missing source:', file.path, frontmatter);
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

        // 添加阅读模式 CSS 类到当前 leaf 的 containerEl，避免全局污染
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            this.activeContainerEl = view.containerEl;
            view.containerEl.classList.add('deeppdf-reading-mode');
            if (this.style === 'paginated') {
                view.containerEl.classList.add('deeppdf-paginated');
            }
        }

        // 延迟初始化分页器，等待视图渲染完成（仅分页模式）
        if (this.style === 'paginated') {
            setTimeout(() => {
                serviceLog('[DeepPDF] ReadingMode: initializing paginator');

                this.waitForRenderAndInitPaginator();
            }, 200);

// 拦截 scrollIntoView，修复 multi-column 布局下的 blockId 跳转
        this.patchScrollIntoView();

        // 监听 hashchange，处理 blockId 跳转（双重保险）
        this.setupHashChangeHandler();
        }

        // 通知书籍检测回调
        this.notifyBookDetected(file);

        // 初始化墨迹层
        this.initInkLayer(file);

        serviceLog('[ReadingMode] Activated for:', file.path);
    }

    /**
     * 通知检测到书籍章节
     */
    private notifyBookDetected(file: TFile): void {
        if (!this.callbacks?.onBookDetected) return;

        // 从文件的 frontmatter 获取 index_id 或 pdf_index_id
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        let indexId = frontmatter?.index_id || frontmatter?.pdf_index_id || '';

        // 兼容多种 frontmatter 字段获取书名：pdf_name (旧), book (EPUB), source (PDF)
        let bookName = frontmatter?.pdf_name || frontmatter?.book || frontmatter?.source || '';

        // 如果没有书名，从文件路径提取书籍名称
        if (!bookName) {
            const pathParts = file.path.split('/');
            if (pathParts.length >= 2 && pathParts[0] === 'DeepReader') {
                bookName = pathParts[1];
            }
        }

        // 只要有书名就可以尝试切换（即使没有 index_id，也可以通过书名查找）
        if (bookName) {
            serviceLog('[ReadingMode] Book detected:', bookName, 'indexId:', indexId || 'will search by name');
            this.callbacks.onBookDetected(indexId, bookName);
        }
    }

    /**
     * 初始化墨迹层
     */
    private initInkLayer(_file: TFile): void {
        this.inkLayer?.cleanup();
        this.inkLayer = null;

        const container = this.getViewContent();
        if (!container) return;

        this.inkLayer = new InkLayer({ container });

        // 滚动模式直接激活；分页模式等分页器就绪后激活
        if (this.style !== 'paginated') {
            setTimeout(() => {
                if (this.inkLayer) {
                    this.inkLayer.activate();
                    serviceLog('[InkLayer] Activated in scrolling mode');
                }
            }, 300);
        }
    }

    /**
     * 获取当前视图的 .markdown-preview-view 元素（实际阅读区域）
     */
    private getViewContent(): HTMLElement | null {
        if (this.activeContainerEl) {
            return this.activeContainerEl.querySelector('.markdown-preview-view') as HTMLElement | null;
        }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        return view?.containerEl.querySelector('.markdown-preview-view') as HTMLElement | null;
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

        // 清理墨迹层
        this.inkLayer?.cleanup();
        this.inkLayer = null;

        this.paginator?.destroy();
        this.paginator = null;

        // 清理旧的章节导航 UI 元素（如果有）
        const oldNavElements = document.querySelectorAll('.deeppdf-chapter-nav');
        oldNavElements.forEach(el => el.remove());

        // 恢复原始 scrollIntoView
        this.unpatchScrollIntoView();

        // 清理 hashchange 监听
        this.teardownHashChangeHandler();

        // 从记录的 containerEl 上移除 CSS 类（而非从当前 active view 移除，避免错误清理其他 tab）
        if (this.activeContainerEl) {
            this.activeContainerEl.classList.remove('deeppdf-reading-mode');
            this.activeContainerEl.classList.remove('deeppdf-paginated');
            this.activeContainerEl = null;
        }

        // 兼容处理：移除之前可能遗留在 body 上的类
        document.body.classList.remove('deeppdf-reading-mode');
        document.body.classList.remove('deeppdf-paginated');
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

        this.fileOpenHandler = this.app.workspace.on('file-open', (file) => {
            serviceLog('[DeepPDF] file-open event:', file?.path);
            // 只有在自动启用开启时才自动激活阅读模式
            if (file && this.isChapterFile(file)) {
                if (this.autoEnable) {
                    this.activate(file);
                }
            } else {
                this.deactivate();
            }
        });

        // 检查当前打开的文件
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && this.isChapterFile(activeFile) && this.autoEnable) {
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
            getPaginator: () => this.paginator,
        });
        this.chapterNav.init();
        serviceLog('[ReadingMode] Chapter navigation initialized');
    }

    /**
     * 等待渲染完成后初始化分页器
     * 轮询检测 .markdown-preview-sizer 是否已有内容
     */
    private waitForRenderAndInitPaginator(): void {
        this.paginator?.destroy();
        this.paginator = null;

        const maxAttempts = 15;
        let attempts = 0;

        // 提取章节名称（去除编号前缀）
        const chapterName = this.extractChapterName();

        const tryInit = () => {
            attempts++;
            const container = document.querySelector('.markdown-preview-sizer') as HTMLElement;

            if (container && container.children.length > 1) {
                this.paginator = new PagePaginator({
                    container,
                    onNavigatePrev: () => this.navigateToPrev(),
                    onNavigateNext: () => this.navigateToNext(),
                    chapterName,
                });
                this.paginator.paginateAndShow();

                // 分页器就绪后激活墨迹层
                if (this.inkLayer) {
                    this.inkLayer.activate();
                }

                serviceLog('[ReadingMode] Paginator initialized');
                return;
            }

            if (attempts < maxAttempts) {
                setTimeout(tryInit, 150);
            } else {
                serviceLog.warn('[ReadingMode] Paginator: render not ready after timeout');
            }
        };

        tryInit();
    }

    /**
     * 提取章节名称（去除编号前缀）
     * 例如: "23 - 第十九章 如何阅读社会科学" -> "第十九章 如何阅读社会科学"
     */
    private extractChapterName(): string {
        if (!this.currentFile) return '';

        const basename = this.currentFile.basename;
        // 匹配 "数字 - " 或 "数字- " 格式并去除
        const match = basename.match(/^\d+\s*[-–]\s*(.+)$/);
        return match ? match[1] : basename;
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
        if (this.paginator) {
            this.paginator.destroy();
            this.paginator = null;
        }
    }

    /**
     * 获取当前文件信息
     */
    getCurrentFile(): TFile | null {
        return this.currentFile;
    }

    /**
     * 获取分页器实例（供 ChapterNav 路由键盘事件）
     */
    getPaginator(): PagePaginator | null {
        return this.paginator;
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
                // 匹配 "01 - 标题" 或 "01-标题" 格式
                return /^\d+/.test(child.basename);
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

    /**
     * 标记摘录文本（添加虚线下划线）
     * @param range 选中的文本范围
     */
markExcerpt(range: Range): void {
        try {
            const excerptMark = document.createElement('mark');
            excerptMark.setAttribute('data-excerpt', 'true');

            // 使用 extractContents 和 insertNode 来包装选中内容
            const fragment = range.extractContents();
            excerptMark.appendChild(fragment);
            range.insertNode(excerptMark);

            serviceLog('[DeepPDF] Marked excerpt text with dotted underline');
        } catch (err) {
            serviceLog('[DeepPDF] Failed to mark excerpt text:', err);
        }
    }

    /**
     * 拦截 scrollIntoView，修复 CSS multi-column 布局下的 blockId 跳转
     * 
     * 问题：Obsidian 内部用 scrollIntoView() 跳转到 blockId 目标，
     * 但 CSS multi-column 布局下 scrollIntoView() 无法正确横向滚动。
     * 
     * 方案：全局拦截 scrollIntoView，当目标元素在 reading mode 的
     * multi-column 容器内时，手动计算横向滚动位置。
     */
    private patchScrollIntoView(): void {
        if (this.originalScrollIntoView) return;

        this.originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
        const self = this;

        HTMLElement.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions | boolean) {
            // 检查目标元素是否在 reading mode 的 multi-column 容器内
            const scrollView = this.closest?.('.deeppdf-reading-mode .markdown-preview-view') as HTMLElement | null;
            
            if (scrollView && self.isActive) {
                self.scrollToElementInColumn(this as HTMLElement, scrollView);
                return;
            }

            // 非 reading mode 元素，使用原始行为
            return self.originalScrollIntoView!.call(this, options);
        };

        serviceLog('[ReadingMode] scrollIntoView patched for multi-column fix');
    }

    /**
     * 恢复原始 scrollIntoView
     */
    private unpatchScrollIntoView(): void {
        if (this.originalScrollIntoView) {
            HTMLElement.prototype.scrollIntoView = this.originalScrollIntoView;
            this.originalScrollIntoView = null;
            serviceLog('[ReadingMode] scrollIntoView unpatched');
        }
    }

    /**
     * 在 CSS multi-column 布局中滚动到目标元素
     *
     * 使用 getBoundingClientRect 计算元素在滚动内容中的绝对位置，
     * 然后计算目标所在的"页"（列），设置 scrollLeft 跳转。
     *
     * 注意：需要使用双层 rAF 等待 CSS column 布局稳定后再计算位置。
     */
    private scrollToElementInColumn(element: HTMLElement, scrollView: HTMLElement): void {
        // 双层 rAF：第一层等待当前帧渲染完成，第二层等待布局重新计算
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const elemRect = element.getBoundingClientRect();
                const containerRect = scrollView.getBoundingClientRect();
                const computedStyle = window.getComputedStyle(scrollView);
                const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;

                // 元素在可滚动内容中的绝对水平位置
                // elemRect.left 是相对视口的，containerRect.left 也是相对视口的
                // scrollLeft 是当前已滚动的距离
                // paddingLeft 补偿 CSS padding 带来的偏移
                const absoluteLeft = elemRect.left - containerRect.left + scrollView.scrollLeft;
                const viewWidth = scrollView.clientWidth;

                if (viewWidth === 0) return;

                // 计算目标页（列）：0-based
                const targetPage = Math.floor(absoluteLeft / viewWidth);
                const targetScrollLeft = targetPage * viewWidth;

                serviceLog(`[ReadingMode] BlockId jump: absoluteLeft=${absoluteLeft.toFixed(0)}, viewWidth=${viewWidth}, targetPage=${targetPage + 1}, scrollLeft=${targetScrollLeft}`);

                // 平滑滚动到目标列
                scrollView.scrollTo({
                    left: targetScrollLeft,
                    behavior: 'smooth'
                });

                // 更新分页器的当前页码
                if (this.paginator) {
                    this.paginator.setCurrentPage(targetPage + 1);
                }

                // 高亮目标元素
                element.classList.add('deeppdf-block-highlight');
                setTimeout(() => {
                    element.classList.remove('deeppdf-block-highlight');
                }, 2000);
            });
        });
    }
}
