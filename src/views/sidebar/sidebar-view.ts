/**
 * DeepPDF 侧边栏视图
 * ChatGPT 风格的对话界面
 */

import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { PDFFileSelectorModal } from "../../ui/pdf-file-selector.js";
import { Drawer } from "../../components/drawer/drawer.js";
import { TaskProgressCard } from "../../components/task-progress-card.js";
import { IndexListItem, ContextDoc, Booklist, stripFileExtension } from "../../types/index.js";
import { LIBRARY_VIEW_TYPE } from "../library-view.js";
import { MessageList, GuidanceType, GUIDANCE_BUTTONS } from "../../components/message-list/message-list.js";
import { ChatInput } from "../../components/chat-input/chat-input.js";
import { MessageData, MessageRole, parseAgentContent, AgentThought, AgentToolCall, AIMessage } from "../../components/message/message.js";
import { IndexManager } from "../../components/index-manager/index-manager.js";
import { Icons, getIcon } from "../../utils/icons.js";

import { ContextManager } from "../../services/context-manager.js";
import { ExcerptModal } from "../../components/excerpt/excerpt-modal.js";
import { ConfirmModal } from "../../components/confirm-modal.js";
import type { ExcerptContent, ExcerptMetadata } from "../../types/excerpt.js";
import { ReadingTopbar } from "../../components/reading-topbar/index.js";

import { uiLog as log, warn, error as logError } from "../../utils/logger.js";
import { FrontendAgent } from "../../agent/index.js";
import type { ToolContext } from "../../agent/tools/types.js";
import type { HumanizedProgress } from "../../agent/ui/humanized-types.js";
import { SessionStore } from "../../agent/session/index.js";
import { findBlockIdFromRange } from "../../utils/block-utils.js";
import { TTSService, type TTSPlayState } from '../../services/tts/tts-service.js';
import { StreamingVoicePlayer, type StreamingVoiceState } from '../../services/tts/streaming-voice-player.js';
import { resolveRoleConfig } from '../../config/providers.js';
import { ProactiveEngine } from '../../agent/proactive/engine.js';
import { copyToClipboard as _copyToClipboard } from './search-utils.js';
import { QuoteManager } from './quote-manager.js';
import type { QuoteItem, QuoteMetadata } from '../../components/chat-input/chat-input.js';
import { TTSController } from './tts-controller.js';
import { SessionManager } from './session-manager.js';
import { AgentChatController } from './agent-chat-controller.js';
import { BookManager } from './book-manager.js';
import type { DeepReaderPluginInterface } from '../../agent/tools/context/vault.js';

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
    private plugin: DeepReaderPluginInterface;
    private readingTopbar: ReadingTopbar | null = null;
    private taskCards: Map<string, TaskProgressCard> = new Map();


    // 对话界面组件
    private messageList: MessageList | null = null;
    private chatInput: ChatInput | null = null;

    // 上下文管理(章节辅助阅读)
    private contextManager: ContextManager | null = null;

    // 引用卡片管理
    private quotesContainer: HTMLElement | null = null;
    private quotes: import("../../components/chat-input/chat-input.js").QuoteItem[] = [];

    // 前端 Agent
    private frontendAgent: FrontendAgent | null = null;


    // TTS 语音播报服务
    private ttsService: TTSService | null = null;

    // 流式语音播放器(用于语音消息)

    // 会话存储(JSONL 文件)


    // 主动阅读引导
    private proactiveEngine: import("../../agent/proactive/engine.js").ProactiveEngine | null = null;

    // ContextManager 同步的文档内容(供 Agent 搜索)

    /** 当前书籍的全书摘要(由后端生成,用于 Agent 系统提示) */

    /** 前端 Agent 对话历史 */

    // ── 子系统 controller ──
    private quoteManager: QuoteManager;
    private ttsCtrl: TTSController;
    private sessionMgr: SessionManager;
    private agentChatCtrl: AgentChatController;
    private bookMgr: BookManager;




    /**
     * 初始化前端 Agent
     * 使用 plugin 统一管理的 Agent 实例
     */
    private async initializeFrontendAgent(): Promise<void> {
        // 每次都从 plugin 获取最新的 Agent(支持设置切换后立即生效)
        const agent = await this.plugin.getFrontendAgent();
        this.frontendAgent = agent;
        log('[DeepPDF] FrontendAgent 初始化完成');

        // 初始化主动阅读引导引擎
        this.proactiveEngine = new ProactiveEngine(
            this.app,
            this.plugin,
            async (params) => {
                await this.agentChatCtrl.executeProactiveGuidance(params);
            },
        );
    }

    /**
     * 初始化里程碑记录器
     */
    /**
     * 删除索引(本地实现)
     */
    async handleDeleteIndex(indexId: string) {
        await this.bookMgr.handleDeleteIndex(indexId);
    }

    /**
     * 获取书籍显示名称(去除扩展名和副标题)
     */
    private getDisplayName(pdfName: string): string {
        let name = pdfName;
        name = stripFileExtension(name);

        const separators = [':', ':', '-', '-', '|', '|'];
        for (const sep of separators) {
            if (name.includes(sep)) {
                name = name.split(sep)[0].trim();
                break;
            }
        }
        return name;
    }

    async refreshIndexes(): Promise<void> {
        await this.bookMgr.refreshIndexes();
    }













    /**
     * 处理系统文件上传(已弃用 - Page Index 不需要上传)
     */
    private async handleSystemUpload(): Promise<void> {
        new Notice('请使用我的书库添加书籍', 3000);
    }


    /** 从 SessionStore 恢复历史记录到视图 */
    private async restoreFromSessionStore(sessionId: string): Promise<boolean> {
        return this.sessionMgr.restoreFromSessionStore(sessionId);
    }



    constructor(leaf: WorkspaceLeaf, plugin: DeepReaderPluginInterface) {
        super(leaf);
        this.plugin = plugin;
        const self = this;
        this.quoteManager = new QuoteManager({
            get chatInput() { return self.chatInput; },
            updateMessageListPadding(hasContextTags: boolean) { self.updateMessageListPadding(hasContextTags); },
            jumpToQuote(quote) { return self.jumpToQuoteInReadingMode(quote); },
            addCitedHighlight(quote) {
                const rms = self.plugin.readingModeService;
                if (rms) rms.addCitedHighlight(quote.blockId, quote.text, quote.sourcePath);
            },
            removeCitedHighlight(quote) {
                const rms = self.plugin.readingModeService;
                if (rms) rms.removeCitedHighlight(quote.blockId, quote.text, quote.sourcePath);
            },
            clearCitedHighlights() {
                const rms = self.plugin.readingModeService;
                if (rms) rms.clearAllCitedHighlights();
            },
        });
        this.ttsCtrl = new TTSController({
            get app() { return self.app; },
            get plugin() { return self.plugin; },
            get messageList() { return self.messageList; },
            getDisplayName(name: string) { return self.getDisplayName(name); },
            getCurrentPdfName() { return self.bookMgr.currentPdfName; },
            getCurrentBookAuthor() { return self.bookMgr.currentBookAuthor; },
            getCurrentIndexId() { return self.bookMgr.currentIndexId; },
            setTtsService(service) { self.ttsService = service; },
        });
        this.sessionMgr = new SessionManager({
            get app() { return self.app; },
            get plugin() { return self.plugin; },
            get messageList() { return self.messageList; },
            get readingTopbar() { return self.readingTopbar; },
            get contextManager() { return self.contextManager; },
            get frontendAgent() { return self.frontendAgent; },
            get readingModeService() { return self.plugin.readingModeService ?? null; },
            get currentIndexId() { return self.bookMgr.currentIndexId; },
            get currentPdfName() { return self.bookMgr.currentPdfName; },
            get currentBookCoverUrl() { return self.bookMgr.currentBookCoverUrl; },
            get currentBookAuthor() { return self.bookMgr.currentBookAuthor; },
            get agentChatHistory() { return self.agentChatCtrl.agentChatHistory; },
            setAgentChatHistory(history: import("../../agent/types.js").ChatMessage[]) { self.agentChatCtrl.agentChatHistory = history; },
            get isProcessing() { return self.agentChatCtrl?.processing ?? false; },
            get isAiStreaming() { return self.agentChatCtrl?.aiStreaming ?? false; },
            cancelActiveStream() { self.agentChatCtrl?.cancelActiveStream(); },
            initializeFrontendAgent() { return self.initializeFrontendAgent(); },
            get currentBooklistItems() { return self.bookMgr.currentBooklist?.items ?? null; },
            restoreBooklist(booklist: import("../../types/index.js").Booklist) { self.restoreBooklist(booklist); },
            get quoteManager() { return self.quoteManager; },
        });
        this.agentChatCtrl = new AgentChatController({
            get app() { return self.app; },
            get plugin() { return self.plugin; },
            get messageList() { return self.messageList; },
            get chatInput() { return self.chatInput; },
            get frontendAgent() { return self.frontendAgent; },
            get proactiveEngine() { return self.proactiveEngine; },
            get currentIndexId() { return self.bookMgr.currentIndexId; },
            get currentPdfName() { return self.bookMgr.currentPdfName; },
            get currentDocDescription() { return self.bookMgr.currentDocDescription; },
            get currentBookCoverUrl() { return self.bookMgr.currentBookCoverUrl; },
            get currentBookAuthor() { return self.bookMgr.currentBookAuthor; },
            get currentMarkdownFiles() { return self.agentChatCtrl.currentMarkdownFiles; },
            get useLLMTreeSearch() { return self.sessionMgr.useLLMTreeSearch; },
            get sessionId() { return self.sessionMgr.sessionId; },
            get sessionStore() { return self.sessionMgr.sessionStore; },
            get crossBookMode() { return self.sessionMgr.crossBookMode; },
            get currentBooklistBookIds() { return self.bookMgr.currentBooklistBookIds; },
            get indexes() { return self.bookMgr.indexes; },
            get ttsService() { return self.ttsService; },
            get contextManager() { return self.contextManager; },
            get isProcessing() { return self.agentChatCtrl.processing; },
            get isAiStreaming() { return self.agentChatCtrl.aiStreaming; },
            get readingTopbar() { return self.readingTopbar; },
            saveToCache() { return self.sessionMgr.saveToCache(); },
            maybeConsolidateMemory() { return self.sessionMgr.maybeConsolidateMemory(); },
            clearQuotes() { self.quoteManager.clearQuotes(); },
            getDisplayName(name: string) { return self.getDisplayName(name); },
            initializeFrontendAgent() { return self.initializeFrontendAgent(); },
            parseAndLoadReferences(message: string) { return self.parseAndLoadReferences(message); },
            copyToClipboard(text: string) { _copyToClipboard(text); },
            getBookshelfSummary() { return self.bookMgr.buildBookshelfSummary() || undefined; },
        });
        this.bookMgr = new BookManager({
            get app() { return self.app; },
            get plugin() { return self.plugin; },
            get messageList() { return self.messageList; },
            get readingTopbar() { return self.readingTopbar; },
            get proactiveEngine() { return self.proactiveEngine; },
            get frontendAgent() { return self.frontendAgent; },
            startNewSession(indexId: string) { return self.sessionMgr.startNewSession(indexId); },
            restoreFromSessionStore(sessionId: string) { return self.sessionMgr.restoreFromSessionStore(sessionId); },
            get sessionId() { return self.sessionMgr.sessionId; },
            set sessionId(id: string | null) { self.sessionMgr.sessionId = id; },
            get sessionStore() { return self.sessionMgr.sessionStore; },
            ensureSessionStore() { return self.sessionMgr.ensureSessionStore(); },
            cancelActiveStream() { self.agentChatCtrl.cancelActiveStream(); },
            initializeFrontendAgent() { return self.initializeFrontendAgent(); },
        });
    }

    getViewType() {
        return SIDEBAR_VIEW_TYPE;
    }

    getDisplayText() {
        return "DeepReader";
    }

    getIcon() {
        return "lucide-book-open";
    }

    /**
     * 打开书库(改为 Tab 视图)
     */

    /**
     * 检查书籍章节是否已下载到本地
     * @param pdfName PDF 文件名
     * @returns 是否存在章节文件
     */
    private async checkBookChaptersExist(pdfName: string): Promise<boolean> {
        return this.bookMgr.checkBookChaptersExist(pdfName);
    }

    /**
     * 加载书籍封面
     * @param bookName 书籍名称(不含扩展名)
     *
     * 从本地 Obsidian vault 加载 (DeepReader/covers/{bookName}.png)
     */

    /**
     * 通过 indexId 扫描 Vault 找到对应书籍的实际目录名和元数据
     * 用户可能重命名了目录,因此不能仅依赖静态的 book-meta.json
     */
    /**
     * 同步顶栏书名到最新状态(用户可能在书库中修改了书名/目录名)
     */

    private async findBookDirectoryByIndexId(indexId: string): Promise<{ dirName: string; author?: string; bookName?: string } | null> {
        return this.bookMgr.findBookDirectoryByIndexId(indexId);
    }

    /**
     * 选择索引(从弹窗中调用或自动切换)
     * @param indexId 索引 ID
     */
    public async selectIndex(indexId: string): Promise<void> {
        // 选书时退出书单/阅读顾问模式
        if (this.sessionMgr.crossBookMode) {
            this.sessionMgr.crossBookMode = false;
        }
        if (this.sessionMgr.generalChatMode) {
            this.sessionMgr.generalChatMode = false;
        }
        await this.bookMgr.selectIndex(indexId);
    }

    public async selectBooklist(booklist: Booklist): Promise<void> {
        this.sessionMgr.crossBookMode = true;
        // 补全 items(历史书单不含 items)
        if (!booklist.items || booklist.items.length === 0) {
            const items = booklist.bookIds.map(id => {
                const idx = this.bookMgr.indexes.find(i => i.id === id);
                let name = idx?.pdf_name || id;
                name = stripFileExtension(name);
                return { id, name, author: idx?.author };
            });
            booklist = { ...booklist, items };
        }
        await this.bookMgr.selectBooklist(booklist);
    }

    /** 重新进入历史书单:恢复已有会话,无会话则新建 */
    public async reenterBooklist(booklist: Booklist): Promise<void> {
        // 补全 items
        if (!booklist.items || booklist.items.length === 0) {
            const items = booklist.bookIds.map(id => {
                const idx = this.bookMgr.indexes.find(i => i.id === id);
                let name = idx?.pdf_name || id;
                name = stripFileExtension(name);
                return { id, name, author: idx?.author };
            });
            booklist = { ...booklist, items };
        }

        this.sessionMgr.crossBookMode = true;

        // 尝试恢复已有会话
        const savedSessionId = this.plugin.settings.savedSessions?.[booklist.id];
        warn(`[reenterBooklist DIAG] booklist.id=${booklist.id}, bookIds=${JSON.stringify(booklist.bookIds)}, savedSessionId=${savedSessionId}, crossBookMode=${this.sessionMgr.crossBookMode}`);
        if (savedSessionId) {
            // 设置 booklist 状态(不创建新会话)
            this.bookMgr.restoreBooklist(booklist);
            warn(`[reenterBooklist DIAG] after restoreBooklist: _currentBooklist.bookIds=${JSON.stringify(this.bookMgr.currentBooklistBookIds)}`);
            this.plugin.settings.lastCrossBookMode = true;
            this.plugin.settings.lastActiveBooklistId = booklist.id;
            await this.plugin.saveSettings();

            if (!this.frontendAgent) {
                await this.initializeFrontendAgent();
            }

            const restored = await this.sessionMgr.restoreFromSessionStore(savedSessionId);
            if (restored) {
                this.sessionMgr.sessionId = savedSessionId;
                return;
            }
        }

        // 无已有会话,走正常 selectBooklist
        await this.bookMgr.selectBooklist(booklist);
    }

    public exitBooklist(): void {
        this.bookMgr.clearBooklist();
        this.sessionMgr.crossBookMode = false;
    }

    public restoreBooklist(booklist: Booklist): void {
        // 补全 items:优先用已存的 bookNames,fallback 到 indexes 查找
        const items = booklist.bookIds.map((id, i) => {
            const idx = this.bookMgr.indexes.find(ix => ix.id === id);
            const name = stripFileExtension(idx?.pdf_name || booklist.bookNames?.[i] || id);
            return { id, name, author: idx?.author };
        });
        const restored = { ...booklist, items };
        this.bookMgr.restoreBooklist(restored);
    }

    /**
     * 自动同步当前章节到上下文
     *
     * 默认行为:
     * - 首次打开章节时,自动加载到上下文
     * - 切换章节时,自动更新为新章节
     * - 只有用户手动点击按钮才能卸载文档
     */
    private async autoSyncCurrentChapter(): Promise<void> {
        if (!this.contextManager || !this.bookMgr.currentPdfName) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return;

        // 检查当前文件是否属于正在阅读的书籍
        const bookPath = `DeepReader/${this.bookMgr.currentPdfName}/`;
        if (!activeFile.path.startsWith(bookPath)) return;

        // 排除书籍主文件(只加载章节文件)
        if (activeFile.path === `${bookPath}${this.bookMgr.currentPdfName}.md`) return;

        // 检查当前章节是否已在上下文中
        if (this.contextManager.hasDocument(activeFile.path)) return;

        // 找到当前书籍的章节文档(source === 'current' 的文档)
        const docs = this.contextManager.getLoadedDocuments();
        const currentChapterDoc = Array.from(docs.values()).find(
            doc => doc.source === 'current' && doc.path.startsWith(bookPath)
        );

        if (currentChapterDoc) {
            // 卸载旧的章节
            this.contextManager.removeDocument(currentChapterDoc.path);
            log(`[DeepPDF] 自动卸载旧章节: ${currentChapterDoc.name}`);
        }

        // 加载新的章节到上下文
        await this.contextManager.loadByPath(activeFile.path, 'current');
        log(`[DeepPDF] 自动加载章节: ${activeFile.basename}`);
    }

    /**
     * 获取当前选中的索引 ID
     */
    public getCurrentIndexId(): string | null {
        return this.bookMgr.currentIndexId;
    }

    public getCurrentBooklistId(): string | null {
        return this.bookMgr.currentBooklist?.id ?? null;
    }

    /** 索引列表(供 main.ts 等外部调用者使用) */
    get indexes(): import("../../types/index.js").IndexListItem[] {
        return this.bookMgr.indexes;
    }

    public async notifyHighlight(text: string): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !this.bookMgr.currentIndexId) return;
        const cache = this.app.metadataCache.getFileCache(activeFile);
        const chapterId = cache?.frontmatter?.node_id ? String(cache.frontmatter.node_id) : activeFile.basename;
        if (!chapterId) return;
        await this.proactiveEngine?.onHighlight(this.bookMgr.currentIndexId, chapterId, text);
    }

    /**
     * 清除顶栏书名显示(阅读模式停用时调用)
     * 不重置 currentPdfName/currentIndexId,保持用户通过书库选中的书籍
     */

    /**
     * 清除所有书籍信息(删除索引时调用)
     */

    /**
     * 通过书名选择索引(自动切换时使用)
     */
    public async selectBookByName(bookName: string): Promise<void> {
        if (this.sessionMgr.crossBookMode) {
            this.sessionMgr.crossBookMode = false;
        }
        await this.bookMgr.selectBookByName(bookName);
    }

    /**
     * 创建阅读顶栏 (简化版)
     */
    private createReadingTopbar(container: HTMLElement) {
        this.readingTopbar = new ReadingTopbar({
            onOpenLibrary: () => this.bookMgr.openLibrary(),
            onOpenSettings: () => {
                // 打开设置并定位到 DeepPDF 插件
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById(this.plugin.manifest.id);
                }
            },
            onCoverClick: async () => {
                const service = this.plugin.readingModeService;
                if (!service) return;
                const opened = await service.openMostRecent();
                if (!opened) {
                    // 无最近阅读历史:fallback 到书库
                    this.bookMgr.openLibrary();
                }
            },
            onExitBooklist: () => this.exitBooklist(),
            onBooklistRename: (newName: string) => {
                this.bookMgr.renameBooklist(newName);
            },
        });

        const el = this.readingTopbar.getElement();
        if (el) {
            container.appendChild(el);
        }
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("deeppdf-container");
        container.addClass("deeppdf-chat-container");

        // 设置聚焦模式变化监听(已移除)
        // this.setupFocusModeListener();

        // 直接渲染主 UI(不阻塞)
        this.renderMainUI(container);

    }

    /**
     * 渲染主界面
     */
    private async renderMainUI(container: HTMLElement): Promise<void> {
        container.empty();

        // 初始化上下文管理器(章节辅助阅读)
        this.contextManager = new ContextManager({
            app: this.app,
            onContextChange: (docs: Map<string, import("../../services/context-manager.js").LoadedDocument>) => {
                // 同步文档内容到 currentMarkdownFiles 供 Agent 搜索使用
                const files: Record<string, string> = {};
                for (const [path, doc] of docs) {
                    files[path] = doc.content;
                }
                this.agentChatCtrl.currentMarkdownFiles = files;

                // 更新加载按钮的激活状态(检查当前活跃文件是否已加载)
                const activeFile = this.app.workspace.getActiveFile();
                const isCurrentDocLoaded = activeFile ? docs.has(activeFile.path) : false;
                this.chatInput?.setLoadBtnActive(isCurrentDocLoaded);
                // 更新消息列表的底部间距,避免被上下文标签遮挡
                this.updateMessageListPadding(docs.size > 0);
            }
        });

        // 创建阅读顶栏 (简化版)
        this.createReadingTopbar(container);

        // 奚童表情:用户活动重置 idle 计时器
        this.registerDomEvent(container, 'mouseenter', () => {
            this.readingTopbar?.onMascotUserActivity();
        });
        this.registerDomEvent(container, 'keydown', () => {
            this.readingTopbar?.onMascotUserActivity();
        });
        this.registerDomEvent(container, 'click', () => {
            this.readingTopbar?.onMascotUserActivity();
        });

        // 创建消息列表区
        this.createMessageListSection(container);

        // 创建输入区
        this.createChatInputSection(container);

        // 加载索引列表
        await this.loadIndexes();

        // 恢复跨书籍模式状态
        await this.sessionMgr.restoreCrossBookMode();

        // 无书时自动进入阅读顾问模式
        if (!this.bookMgr.currentIndexId && !this.sessionMgr.crossBookMode) {
            await this.sessionMgr.restoreGeneralChatSession();
        }

        // 设置滚动监听:滚动时隐藏输入框
        this.setupScrollHandler(container);

        // 监听 URI 协议触发的索引切换事件
        // 自定义事件,Obsidian 类型定义不支持,使用 any 绕过
        const workspace = this.app.workspace as any;
        this.registerEvent(
            workspace.on("deeppdf:select-index", async (indexId: string) => {
                log("[DeepPDF] Received select-index event:", indexId);

                // 如果当前处于跨书籍模式,先切换回单书籍模式
                if (this.sessionMgr.crossBookMode) {
                    log("[DeepPDF] 从阅读入口点击,自动关闭跨书籍模式");
                    this.sessionMgr.crossBookMode = false;
                    this.readingTopbar?.setCrossBookMode(false);
                    this.plugin.settings.lastCrossBookMode = false;
                    await this.plugin.saveSettings();

                    // 取消任何正在进行的流式请求,避免旧回调更新新消息列表
                    this.agentChatCtrl.cancelActiveStream();

                    // 清空跨书籍模式的消息,准备加载单书籍会话
                    this.messageList?.clear();
                }

                // 直接调用 selectIndex 方法,确保顶栏正确更新
                await this.selectIndex(indexId);
            })
        );

        // 监听阅读模式引用事件
        this.registerEvent(
            workspace.on("deeppdf:quote-selection", async (metadata: import("../../components/chat-input/chat-input.js").QuoteMetadata) => {
                log("[DeepPDF] Received quote-selection event");
                this.quoteManager.handleQuoteSelection(metadata);
            })
        );

        this.registerEvent(
            workspace.on("deeppdf:excerpt-selection", async (text: string, range: Range) => {
                log("[DeepPDF] Received excerpt-selection event");
                this.handleExcerptSelection(text, range);
            })
        );

        // 监听文件切换事件,更新文档加载按钮状态 + 阅读进度追踪 + 自动同步章节上下文
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                if (this.contextManager) {
                    const activeFile = this.app.workspace.getActiveFile();
                    const isLoaded = activeFile ? this.contextManager.hasDocument(activeFile.path) : false;
                    this.chatInput?.setLoadBtnActive(isLoaded);
                }
                // 自动同步当前章节到上下文
                this.autoSyncCurrentChapter();
            })
        );
    }

    /**
     * 处理引用选中文字
     * 在输入框上方显示引用卡片,更新 placeholder 提示
     */

    /**
     * 移除引用
     */

    /**
     * 清空所有引用
     */

    /**
     * 更新输入框 placeholder 反映引用数量
     */
    private getQuotes(): QuoteItem[] {
        return this.quoteManager.getQuotes();
    }

    /**
     * 处理摘录选中文字(阅读模式中的摘录)
     * 保存位置:书籍摘录/{书名}/摘录-{日期}.md
     * 链接:链接到章节文件,精确到 block id
     */
    private handleExcerptSelection(text: string, range: Range): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("没有打开的文件");
            return;
        }

        // 从文件的 frontmatter 或路径中提取书籍信息
        const cache = this.app.metadataCache.getFileCache(activeFile);
        let bookName = cache?.frontmatter?.pdf_name || '';
        let indexId = String(cache?.frontmatter?.index_id || cache?.frontmatter?.pdf_index_id || '');

        // 如果没有从 frontmatter 获取到书名,从路径提取
        if (!bookName) {
            const pathParts = activeFile.path.split('/');
            // 假设路径格式是 DeepReader/{书名}/章节.md 或 {书名}/章节.md
            if (pathParts.length >= 2) {
                if (pathParts[0] === 'DeepReader') {
                    bookName = pathParts[1];
                } else {
                    bookName = pathParts[0];
                }
            } else {
                bookName = activeFile.basename;
            }
        }

        // 获取选中文字所在的 block id
        const blockId = findBlockIdFromRange(range, activeFile.path, this.app);
        log('[DeepPDF] Found block id for excerpt:', blockId);

        // 构建元数据
        const metadata: ExcerptMetadata = {
            sourcePdf: bookName,
            createdAt: new Date().toISOString(),
            sourceType: 'reading',
            chapterPath: activeFile.path,
            chapterName: activeFile.basename,
            blockId: blockId || undefined,
            excerptType: 'excerpt',
        };

        const modal = new ExcerptModal({
            app: this.app,
            content: { text },
            metadata,
            onSave: async (path: string) => {
                new Notice(`摘录已保存到 ${path}`);
                // 摘录成功后,在阅读界面标记文本(添加虚线下划线)
                this.markExcerptText(range);
            },
        });
        modal.open();
    }

    /**
     * 在阅读界面标记摘录文本(添加虚线下划线)
     */
    private markExcerptText(range: Range): void {
        try {
            const excerptMark = document.createElement('mark');
            excerptMark.setAttribute('data-excerpt', 'true');

            // 使用 extractContents 和 insertNode 来包装选中内容
            const fragment = range.extractContents();
            excerptMark.appendChild(fragment);
            range.insertNode(excerptMark);

            log('[DeepPDF] Marked excerpt text with dotted underline');
        } catch (err) {
            log('[DeepPDF] Failed to mark excerpt text:', err);
        }
    }

    /**
     * 设置滚动监听逻辑
     * 当消息列表滚动时隐藏输入框,停止滚动后显示
     * AI 回复期间,输入框最小化并暂停滚动监听
     */
    private setupScrollHandler(_container: HTMLElement) {
        // 保留接口位置,但当前不隐藏任何元素。
        // 历史原因:曾将 chat-input 添加 .hidden,滚动时隐藏输入框。
        // 用户反馈:不要隐藏输入框(即使滚动对话时也应保持可见)。
    }

    /**
     * 创建消息列表区
     */
    private createMessageListSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "deeppdf-message-list-section" });

        // 创建消息列表组件
        this.messageList = new MessageList({
            onRegenerate: (messageId: string) => {
                this.agentChatCtrl.handleRegenerate(messageId);
            },
            onCopy: (messageId: string) => {
                this.agentChatCtrl.handleCopy(messageId);
            },
            onQuestionClick: (question: string) => {
                this.agentChatCtrl.handleQuestionClick(question);
            },
            onGenerateOutline: () => {
                this.agentChatCtrl.handleGenerateOutline();
            },
            onGuidanceClick: (type: GuidanceType) => {
                this.agentChatCtrl.handleGuidanceClick(type);
            },
            onExcerpt: (messageId: string, content: ExcerptContent, metadata: ExcerptMetadata) => {
                this.agentChatCtrl.handleExcerpt(messageId, content, metadata);
            },
            onQuote: (metadata: import("../../components/chat-input/chat-input.js").QuoteMetadata) => {
                this.quoteManager.handleQuoteSelection(metadata);
            },
            onDelete: (messageId: string) => {
                this.agentChatCtrl.handleDeleteMessagePair(messageId);
            },
            onTTS: async (messageId: string, content: string) => {
                // 喇叭按钮始终直接朗读原文,不走摘要模式
                this.ttsCtrl.handleTTS(messageId, content, { rawText: true });
            },
            onVoicePlay: (messageId: string) => {
                // 控制流式语音播放
                const player = this.agentChatCtrl.getStreamingVoicePlayers().get(messageId);
                if (player) {
                    const state = player.getState();
                    if (state === 'playing') {
                        player.pause();
                    } else if (state === 'paused' || state === 'buffering') {
                        player.play();
                    } else if (state === 'idle') {
                        player.play();
                    }
                }
            },
            getCurrentBookInfo: () => ({
                coverUrl: this.bookMgr.currentBookCoverUrl,
                author: this.bookMgr.currentBookAuthor,
                bookName: this.bookMgr.currentPdfName
            }),
            getBubbleTheme: () => this.plugin?.settings?.messageBubbleTheme || 'notebook'
        }, this.app);

        const messageListEl = this.messageList.getElement();
        if (messageListEl) {
            section.appendChild(messageListEl);
        }
        // 注意:引用卡片容器已移至 createChatInputSection
    }

    /**
     * 创建聊天输入区
     */
    private createChatInputSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "deeppdf-chat-input-section" });

        // 创建聊天输入组件(在最上方)
        this.chatInput = new ChatInput({
            placeholder: "输入以开始对话...",
            onSend: (message: string, _chatInputQuotes) => {
                // 使用 sidebar 自己管理的引用列表(而非 ChatInput 内部的空数组)
                this.agentChatCtrl.sendMessage(message, this.quoteManager.getQuotes());
            },
            app: this.app,
            onStop: () => {
                this.agentChatCtrl.stopGeneration();
            },
            onHeightChange: (height: number) => {
                // 引用卡片已移到独立子 section,不与 input 联动
                this.messageList?.updateBottomPadding(height, 0);
            },
            onLoadCurrentDoc: async () => {
                await this.loadCurrentDocument();
            },
            onUnloadCurrentDoc: async () => {
                await this.unloadCurrentDocument();
            }
        });

        // 引用卡片容器：位于输入框上方，位置贴附输入框
        // 使用独立的 quote-bar-section 子容器，作用是让 cards 与 chat-input 在
        // flex column 中分离，避免两者互相干扰
        const quoteBar = section.createDiv({ cls: "deeppdf-quote-bar-section" });
        this.quotesContainer = quoteBar.createDiv({ cls: "deeppdf-quotes-container" });
        this.quoteManager.setContainer(this.quotesContainer);

        const chatInputEl = this.chatInput.getElement();
        if (chatInputEl) {
            section.appendChild(chatInputEl);
        }
    }

    /**
     * 加载当前文档到上下文
     */
    private async loadCurrentDocument(): Promise<void> {
        if (!this.contextManager) return;

        const doc = await this.contextManager.loadCurrentDocument();
        if (doc) {
            // new Notice(`已加载: ${doc.name}`);
        }
    }

    /**
     * 从上下文卸载当前文档
     */
    private async unloadCurrentDocument(): Promise<void> {
        if (!this.contextManager) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        this.contextManager.removeDocument(activeFile.path);
    }

    /**
     * 解析消息中的文档引用并自动加载
     * 支持 [[文件名]] 格式的引用
     */
    private async parseAndLoadReferences(message: string): Promise<void> {
        if (!this.contextManager) return;

        // 匹配 [[文件名]] 格式
        const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
        const matches = [...message.matchAll(wikilinkRegex)];

        if (matches.length === 0) return;

        // 获取所有 Markdown 文件
        const files = this.app.vault.getMarkdownFiles();
        const loadedNames: string[] = [];

        for (const match of matches) {
            const fileName = match[1];

            // 查找匹配的文件
            const file = files.find(f =>
                f.basename === fileName ||
                f.basename.toLowerCase() === fileName.toLowerCase() ||
                f.path.endsWith(fileName) ||
                f.path.toLowerCase().endsWith(fileName.toLowerCase())
            );

            if (file) {
                const doc = await this.contextManager.loadByPath(file.path, 'wikilink');
                if (doc) {
                    loadedNames.push(doc.name);
                }
            }
        }

        // 显示加载提示
        // if (loadedNames.length > 0) {
        //     new Notice(`已加载引用文档: ${loadedNames.join(', ')}`);
        // }
    }

    /**
     * 获取上下文文档列表(用于 API 调用)
     */
    private getContextDocs(): ContextDoc[] | undefined {
        if (!this.contextManager) return undefined;

        const docs = this.contextManager.getLoadedDocuments();
        if (docs.size === 0) return undefined;

        return Array.from(docs.values()).map(doc => ({
            path: doc.path,
            name: doc.name,
            content: doc.content
        }));
    }


    /**
     * 切换深度思考模式
     */
    public async toggleDeepSearchMode(): Promise<void> {
        this.sessionMgr.useLLMTreeSearch = !this.sessionMgr.useLLMTreeSearch;
        const modeText = this.sessionMgr.useLLMTreeSearch ? "深度思考模式已开启" : "深度思考模式已关闭";
        new Notice(modeText);
        log(`[DeepPDF] toggleDeepSearchMode: ${modeText}`);
        // 持久化设置
        this.plugin.settings.lastDeepSearchMode = this.sessionMgr.useLLMTreeSearch;
        await this.plugin.saveSettings();
    }



    // ==================== 消息处理 ====================


    /** 从外部发送消息 */
    public async sendMessageWithInput(message: string): Promise<void> {
        await this.agentChatCtrl.sendMessageWithInput(message);
    }
















    /**
     * 更新消息列表的底部间距
     * 当有上下文标签或引用卡片时,增加间距避免遮挡
     */
    private updateMessageListPadding(hasContextTags: boolean): void {
        const messagesContainer = this.containerEl?.querySelector('.deeppdf-messages-container') as HTMLElement;
        if (!messagesContainer) return;

        // 基础间距 110px + 上下文标签高度约 40px + 引用卡片高度
        const basePadding = 110;
        const contextTagsHeight = hasContextTags ? 44 : 0;
        const quotesHeight = this.quotesContainer?.offsetHeight || 0;

        messagesContainer.style.paddingBottom = `${basePadding + contextTagsHeight + quotesHeight}px`;
    }

    async loadIndexes(): Promise<void> {
        await this.bookMgr.loadIndexes();
    }
    /**
     * 处理 TTS 播放/暂停请求
     */

    /**
     * 根据 AI 消息 ID 找到对应的用户提问
     */


    /**
     * 显示错误消息
     */
    private showError(message: string): void {
        new Notice(message);
        logError("[DeepPDF]", message);
    }

    async onClose() {
        try {
            if (this.agentChatCtrl.currentStreamController) {
                this.agentChatCtrl.cancelActiveStream();
            }

            // 清理 TTS 服务
            if (this.ttsCtrl) {
                try {
                    this.ttsCtrl.destroy();
                } catch (e) {
                    warn('[DeepPDF] Error stopping TTS service:', e);
                }
                // ttsService managed by ttsCtrl;
            }

            // 清理消息列表
            if (this.messageList) {
                try {
                    this.messageList.destroy();
                } catch (e) {
                    warn('[DeepPDF] Error destroying messageList:', e);
                }
                this.messageList = null;
            }

            // 清理聊天输入
            if (this.chatInput) {
                try {
                    this.chatInput.destroy();
                } catch (e) {
                    warn('[DeepPDF] Error destroying chatInput:', e);
                }
                this.chatInput = null;
            }

            // 清理主动引导引擎
            if (this.proactiveEngine) {
                try {
                    this.proactiveEngine.destroy();
                } catch (e) {
                    warn('[DeepPDF] Error destroying proactiveEngine:', e);
                }
                this.proactiveEngine = null;
            }

            // 清理任务卡片
            try {
                this.taskCards.clear();
            } catch (e) {
                warn('[DeepPDF] Error clearing taskCards:', e);
            }

            // 清理索引管理器
            if (this.readingTopbar) {
                try {
                    this.readingTopbar.destroy();
                } catch (e) {
                    warn('[DeepPDF] Error destroying readingTopbar:', e);
                }
                this.readingTopbar = null;
            }
        } catch (error) {
            logError('[DeepPDF] Error in onClose:', error);
            // 不要重新抛出错误,避免影响 Obsidian 的 UI
        }
    }

    /**
     * 获取当前书籍信息(供调试命令使用)
     */
    getCurrentBookInfo(): { title: string | null; page_count: number; docDescription: string | null } {
        return this.bookMgr.getCurrentBookInfo();
    }

    /**
     * 跳转引用卡片到原文位置
     * - 若 sourcePath 有效且与当前活动文件不同:先打开文件
     * - 调 reading-mode-service.jumpToBlock(blockId) 跳 + 黄色闪烁
     * - 返回是否成功
     */
    jumpToQuoteInReadingMode(quote: import('../../components/chat-input/chat-input.js').QuoteItem): boolean {
        const service = this.plugin.readingModeService;
        if (!service) {
            log.warn('[Sidebar] jumpToQuote: readingModeService unavailable');
            return false;
        }
        if (!quote.blockId) {
            log.warn('[Sidebar] jumpToQuote: quote has no blockId');
            return false;
        }

        // 1. 如果 sourcePath 存在且与当前活动文件不同,先打开
        const activeFile = this.app.workspace.getActiveFile();
        if (quote.sourcePath && (!activeFile || activeFile.path !== quote.sourcePath)) {
            const abstract = this.app.vault.getAbstractFileByPath(quote.sourcePath);
            if (abstract) {
                void this.app.workspace.openLinkText(quote.sourcePath, '', false);
            } else {
                log.warn('[Sidebar] jumpToQuote: source file not found', quote.sourcePath);
                return false;
            }
        }

        // 2. 跳转 + 闪烁
        return service.jumpToBlock(quote.blockId);
    }
}

