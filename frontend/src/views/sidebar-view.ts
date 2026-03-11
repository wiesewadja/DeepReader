/**
 * DeepPDF 侧边栏视图
 * ChatGPT 风格的对话界面
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { PDFFileSelectorModal, DocumentFileInfo } from "../ui/pdf-file-selector.js";
import { DeepPDFClient, QueryPDFResult, ListIndexesResult, IndexListItem, TaskProgress as APITaskProgress, CitationInfo, SessionInfo, ContextDoc } from "../api/http-client.js";
import { Drawer } from "../components/drawer/drawer.js";
import { TaskPollingManager } from "../utils/task-polling-manager.js";
import { TaskProgressCard } from "../components/task-progress-card.js";
import { TaskProgress, SearchFilters, CrossBookSearchParams } from "../types/index.js";
import { MessageList } from "../components/message-list/message-list.js";
import { ChatInput } from "../components/chat-input/chat-input.js";
import { MessageData, MessageRole, CitationData, parseFollowUpQuestions, FollowUpQuestion, parseAgentContent, AgentThought, AgentToolCall } from "../components/message/message.js";
import { IndexManager } from "../components/index-manager/index-manager.js";
import { exportIndexToMarkdown } from "../services/markdown-exporter.js";
import { Icons, getIcon } from "../utils/icons.js";
import { handleError, handleNetworkError, handleAPIError } from "../utils/error-handler.js";
import { agentAPI } from "../api/index.js";
import { ReadingPortalService } from "../services/reading-portal.js";
import { ContextManager } from "../services/context-manager.js";
import { ContextTags } from "../components/context-tags/index.js";
import { ExcerptModal } from "../components/excerpt/excerpt-modal.js";
import type { ExcerptContent, ExcerptMetadata } from "../types/excerpt.js";
import { ReadingTopbar } from "../components/reading-topbar/index.js";
import type { QuoteItem } from "../components/chat-input/chat-input.js";
import { LibraryModal } from "../components/library-modal/index.js";
import { uiLog as log, warn, error as logError } from "../utils/logger.js";
import { FrontendAgent } from "../agent/index.js";
import type { ToolContext } from "../agent/tools/types.js";
import type { ReadingProgress } from "../agent/tools/types.js";
import { getBookReadingProgress } from "../agent/utils/book-note.js";
import { calculateProgressMetrics } from "../agent/utils/plugin-data.js";

/**
 * 将 API 的 TaskProgress 转换为组件需要的 TaskProgress 格式
 * @internal
 */
export function toTaskProgress(apiProgress: APITaskProgress): TaskProgress {
    return {
        id: apiProgress.id,
        status: (apiProgress.status === 'pending' || apiProgress.status === 'processing' ||
            apiProgress.status === 'completed' || apiProgress.status === 'failed' ||
            apiProgress.status === 'cancelled')
            ? apiProgress.status
            : 'pending',
        message: apiProgress.message || '任务进行中',
        pdf_name: apiProgress.pdf_name,
        current_step: apiProgress.current_step,
        progress_percent: apiProgress.progress_percent,
        total_steps: apiProgress.total_steps,
        completed_steps: apiProgress.completed_steps,
        error: apiProgress.error
    };
}

/** 连接状态类型 */
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

/** 任务完成后显示延迟时间（毫秒） */
const TASK_COMPLETE_DISPLAY_MS = 2000;

export class SidebarView extends ItemView {
    private apiClient: DeepPDFClient | null;
    private plugin: any; // 插件实例，用于访问设置
    private readingTopbar: ReadingTopbar | null = null;
    private taskPollingManager: TaskPollingManager | null = null;
    private indexes: IndexListItem[] = [];  // 索引列表缓存
    private taskCards: Map<string, TaskProgressCard> = new Map();

    /** @deprecated 使用 readingTopbar 代替 */
    private get indexManager(): ReadingTopbar | null {
        return this.readingTopbar;
    }

    // 对话界面组件
    private messageList: MessageList | null = null;
    private chatInput: ChatInput | null = null;
    private currentIndexId: string | null = null;
    private currentPdfName: string | null = null;
    private isProcessing: boolean = false;
    private sessionId: string | null = null;  // 会话ID，用于多轮对话
    private streamController: AbortController | null = null;  // 流式请求控制器
    private isAiStreaming: boolean = false;  // AI 是否正在流式输出
    private readingPortal: ReadingPortalService | null = null;
    private crossBookMode: boolean = false;  // 跨书籍模式开关
    private connectionStatus: ConnectionStatus = 'connecting';  // 后端连接状态

    /** 向后兼容：返回是否已连接 */
    private get isConnected(): boolean {
        return this.connectionStatus === 'connected';
    }
    private searchFilters: SearchFilters = { booklists: [], tags: [] };  // 搜索过滤条件
    private healthCheckInterval: ReturnType<typeof setInterval> | null = null;  // 健康检查定时器
    private useLLMTreeSearch: boolean = false;  // 深度思考模式开关（LLM 树搜索）

    // 上下文管理（章节辅助阅读）
    private contextManager: ContextManager | null = null;
    private contextTags: ContextTags | null = null;

    // 引用卡片管理
    private quotesContainer: HTMLElement | null = null;
    private quotes: import("../components/chat-input/chat-input.js").QuoteItem[] = [];

    // 前端 Agent
    private frontendAgent: FrontendAgent | null = null;

    /** 当前索引的 Markdown 文件映射 (node_id -> file_path) */
    private currentMarkdownFiles: Record<string, string> = {};

    /** 前端 Agent 对话历史 */
    private agentChatHistory: import("../agent/types.js").ChatMessage[] = [];

    /** 聚焦模式变化事件监听器绑定引用 */
    private boundHandleFocusModeChange: EventListenerOrEventListenerObject | null = null;

    /** 生成新的会话ID */
    private generateSessionId(): string {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 初始化前端 Agent
     * 使用 plugin 统一管理的 Agent 实例
     */
    private async initializeFrontendAgent(): Promise<void> {
        if (this.frontendAgent) {
            return; // 已初始化
        }
        // 使用 plugin 统一管理的 Agent
        const agent = await this.plugin.getFrontendAgent();
        this.frontendAgent = agent;
        log('[DeepPDF] FrontendAgent 初始化完成，可用 skills:', agent.listSkills());
    }

    /** 开启新会话 */
    private async startNewSession(indexId: string) {
        this.sessionId = this.generateSessionId();

        // 清空前端 Agent 对话历史
        this.agentChatHistory = [];

        // 保存到设置
        if (!this.plugin.settings.savedSessions) {
            this.plugin.settings.savedSessions = {};
        }
        this.plugin.settings.savedSessions[indexId] = this.sessionId;
        await this.plugin.saveSettings();

        this.showWelcomeMessage();
    }

    /** 显示欢迎语 */
    private showWelcomeMessage() {
        if (!this.messageList) return;

        const welcomeId = `msg-${Date.now()}`;
        let welcomeContent: string;

        if (this.crossBookMode) {
            welcomeContent = "📚 已切换到**跨书籍阅读**模式。您可以在所有已索引的书籍中搜索和提问！";

            // 显示过滤条件
            if (this.hasSearchFilters()) {
                welcomeContent += `\n\n🔍 当前过滤条件: ${this.buildFilterDescription()}`;
                welcomeContent += `\n\n[清除过滤](obsidian://deepreader-search) | [搜索全部](obsidian://deepreader-search)`;
            }

            this.messageList.addMessage({
                id: welcomeId,
                role: "assistant",
                content: welcomeContent,
                timestamp: new Date().toISOString()
            });
        }
        // 单书籍模式：不添加欢迎消息，让空状态的"生成阅读大纲"按钮显示
    }

    /** 构建过滤条件描述 */
    private buildFilterDescription(): string {
        const parts: string[] = [];
        if (this.searchFilters.booklists.length > 0) {
            parts.push(`书单: ${this.searchFilters.booklists.join(", ")}`);
        }
        if (this.searchFilters.tags.length > 0) {
            parts.push(`标签: ${this.searchFilters.tags.join(", ")}`);
        }
        return parts.join("; ");
    }

    /** 检查是否有搜索过滤条件 */
    private hasSearchFilters(): boolean {
        return this.searchFilters.booklists.length > 0 || this.searchFilters.tags.length > 0;
    }

    /** 切换到跨书籍模式 */
    private async switchToCrossBookMode(options: { clearMessages?: boolean; showWelcome?: boolean } = {}): Promise<void> {
        if (this.crossBookMode) return;

        this.crossBookMode = true;
        this.chatInput?.setSearchMode('cross');
        this.indexManager?.setCrossBookMode(true);
        this.plugin.settings.lastCrossBookMode = true;
        await this.plugin.saveSettings();

        // 清空当前 PDF 名称（跨书籍模式不显示快捷操作按钮）
        this.messageList?.setCurrentPdfName('');

        if (options.clearMessages !== false) {
            this.messageList?.clear();
        }
        if (options.showWelcome) {
            this.showWelcomeMessage();
        }
    }

    /** 处理新建会话 */
    private handleNewChat() {
        // 不再检查连接状态，允许用户在未连接时创建新会话
        if (!this.currentIndexId) {
            new Notice("请先选择一个索引");
            return;
        }
        this.startNewSession(this.currentIndexId);
    }

    /** 切换聚焦模式 */
    private toggleFocusMode(): void {
        if (!this.plugin?.readingModeService) return;

        const focusService = this.plugin.readingModeService.getFocusModeService();
        if (!focusService) return;

        const enabled = focusService.toggle();
        this.readingTopbar?.setFocusMode(enabled);
    }


    /** 恢复历史记录到视图 */
    private restoreHistoryToView(history: any[], fromCache: boolean = false) {
        if (!this.messageList) return;

        // 同时恢复 agentChatHistory
        const chatMessages: import("../agent/types.js").ChatMessage[] = [];

        if (fromCache) {
            // 从缓存恢复，直接使用 MessageData
            history.forEach(msgData => {
                try {
                    this.messageList!.addMessage(msgData);

                    // 同时构建 ChatMessage 格式
                    if (msgData.role === 'user' || msgData.role === 'assistant') {
                        chatMessages.push({
                            role: msgData.role,
                            content: msgData.content,
                        });
                    }
                } catch (e) {
                    warn(`[DeepPDF] Failed to restore cached message ${msgData.id}:`, e);
                }
            });
        } else {
            // 从后端恢复 (OpenAI 格式)
            history.forEach((msg, index) => {
                // 跳过 system 消息
                if (msg.role === 'system') return;

                const msgId = `hist-${Date.now()}-${index}`;
                this.messageList!.addMessage({
                    id: msgId,
                    role: msg.role as MessageRole,
                    content: msg.content,
                    timestamp: new Date().toISOString(),
                    isAgentMessage: msg.role === 'assistant'
                });

                // 同时构建 ChatMessage 格式
                if (msg.role === 'user' || msg.role === 'assistant') {
                    chatMessages.push({
                        role: msg.role,
                        content: msg.content,
                    });
                }
            });
        }

        // 恢复 agentChatHistory（前面加上 system 消息）
        if (chatMessages.length > 0 && this.frontendAgent) {
            const systemPrompt = this.frontendAgent.getSystemPrompt();
            this.agentChatHistory = [
                { role: 'system', content: systemPrompt },
                ...chatMessages
            ];
            log('[DeepPDF] 恢复 agentChatHistory，消息数:', this.agentChatHistory.length);
        }
    }

    /** 保存当前对话到本地缓存（带 LRU 清理） */
    private async saveToCache() {
        log('[DeepPDF] saveToCache called, sessionId:', this.sessionId, 'crossBookMode:', this.crossBookMode);
        if (!this.sessionId || !this.messageList) {
            log('[DeepPDF] saveToCache early return: no sessionId or messageList');
            return;
        }

        // 跨书籍模式使用特殊标识，单书籍模式使用 currentIndexId
        const effectiveIndexId = this.crossBookMode
            ? '__cross_book__'
            : this.currentIndexId;

        if (!effectiveIndexId) {
            log('[DeepPDF] saveToCache early return: no effectiveIndexId');
            return;
        }

        // 1. 获取当前所有消息
        // Note: 需要在 MessageList 中实现 getAllMessages
        const allMessages = (this.messageList as any).getAllMessages();
        log('[DeepPDF] saveToCache allMessages count:', allMessages?.length);

        // 2. 过滤有效消息
        const validMsgs = allMessages.filter((m: any) =>
            (m.role === 'user' || m.role === 'assistant') &&
            !m.content.includes("已切换到书籍") &&
            m.content !== "📖 正在翻阅..." &&
            m.content !== "🔍 正在跨书籍查阅..." &&
            m.content // 确保有内容
        );

        log('[DeepPDF] saveToCache validMsgs count:', validMsgs?.length);
        if (validMsgs.length === 0) {
            log('[DeepPDF] saveToCache early return: no valid messages');
            return;
        }

        // 3. 更新设置
        if (!this.plugin.settings.chatCache) {
            this.plugin.settings.chatCache = {};
        }

        this.plugin.settings.chatCache[this.sessionId] = {
            sessionId: this.sessionId,
            indexId: effectiveIndexId,
            lastUpdated: Date.now(),
            messages: validMsgs,
            isCrossBook: this.crossBookMode ? true : undefined  // 明确使用 true 而不是 this.crossBookMode
        };

        // 如果是跨书籍模式，保存会话ID以便下次恢复
        if (this.crossBookMode) {
            this.plugin.settings.lastCrossBookSessionId = this.sessionId;
            log('[DeepPDF] 保存跨书籍会话ID:', this.sessionId);
        }

        // 4. 清理并保存
        await this.cleanupCache();
        await this.plugin.saveSettings();
        log('[DeepPDF] 缓存已保存, chatCache keys:', Object.keys(this.plugin.settings.chatCache || {}));
    }

    /** 清理过期缓存 (LRU, max 5MB) */
    private async cleanupCache() {
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        const cache = this.plugin.settings.chatCache;
        if (!cache) return;

        // 计算当前大小
        let currentSize = JSON.stringify(cache).length;

        if (currentSize <= MAX_SIZE) return;

        log(`[DeepPDF] 缓存大小 (${(currentSize / 1024).toFixed(1)}KB) 超过限制，开始清理...`);

        // 按时间排序
        const sessionIds = Object.keys(cache).sort((a, b) =>
            cache[a].lastUpdated - cache[b].lastUpdated
        );

        // 删除最旧的，直到满足要求
        while (currentSize > MAX_SIZE && sessionIds.length > 0) {
            const oldestId = sessionIds.shift();
            if (oldestId) {
                delete cache[oldestId];
                currentSize = JSON.stringify(cache).length;
                log(`[DeepPDF] 已删除过期缓存: ${oldestId}`);
            }
        }
    }

    constructor(leaf: WorkspaceLeaf, apiClient: DeepPDFClient | null, plugin: any) {
        super(leaf);
        this.apiClient = apiClient;
        this.plugin = plugin;
        // TaskPollingManager 将在首次需要时延迟初始化
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
     * 打在线书库弹窗
     */
    private openLibraryModal(): void {
        new LibraryModal(this.app, {
            app: this.app,
            indexes: this.indexes,
            selectedIndexId: this.currentIndexId,
            onIndexChange: (indexId: string) => {
                this.selectIndex(indexId);
            },
            onCreateIndex: async () => {
                // 刷新索引列表
                await this.loadIndexes();
            },
            onExportMarkdown: (indexId: string) => {
                this.handleExportMarkdown(indexId);
            },
            onDeleteIndex: async (indexId: string) => {
                await this.handleDeleteIndex(indexId);
                return this.indexes;
            },
            onRefresh: async () => {
                await this.loadIndexes();
                return this.indexes;
            },
            apiClient: this.apiClient,
            plugin: this.plugin
        }).open();
    }

    /**
     * 检查书籍章节是否已下载到本地
     * @param pdfName PDF 文件名
     * @returns 是否存在章节文件
     */
    private async checkBookChaptersExist(pdfName: string): Promise<boolean> {
        // 获取书籍文件夹名称（去掉扩展名）
        let folderName = pdfName;
        if (folderName.toLowerCase().endsWith('.pdf')) {
            folderName = folderName.slice(0, -4);
        }
        if (folderName.toLowerCase().endsWith('.epub')) {
            folderName = folderName.slice(0, -5);
        }

        // 检查 DeepReader/{folderName} 文件夹是否存在
        const folderPath = `DeepReader/${folderName}`;
        const folder = this.app.vault.getAbstractFileByPath(folderPath);

        if (!folder) {
            return false;
        }

        // 检查文件夹中是否有 .md 文件（章节文件）
        const files = this.app.vault.getMarkdownFiles();
        const chapterFiles = files.filter(f =>
            f.path.startsWith(folderPath + '/')
        );

        return chapterFiles.length > 0;
    }

    /**
     * 加载书籍封面
     * @param bookName 书籍名称（不含扩展名）
     */
    private loadBookCover(bookName: string): void {
        const coverPath = `DeepReader/covers/${bookName}.png`;
        const coverFile = this.app.vault.getAbstractFileByPath(coverPath);

        if (coverFile) {
            // 使用 Obsidian 的 getResourcePath 获取可用的 URL
            const { TFile } = require('obsidian');
            if (coverFile instanceof TFile) {
                const coverUrl = this.app.vault.getResourcePath(coverFile as any);
                this.readingTopbar?.setBookCover(coverUrl);
                log(`[DeepPDF] 加载书籍封面: ${coverPath}`);
                return;
            }
        }

        // 封面不存在，使用默认图标
        this.readingTopbar?.setBookCover(null);
        log(`[DeepPDF] 书籍封面不存在: ${coverPath}`);
    }

    /**
     * 选择索引（从弹窗中调用或自动切换）
     * @param indexId 索引 ID
     */
    public async selectIndex(indexId: string): Promise<void> {
        // 如果已经选中了同一个索引，跳过以避免闪烁
        if (this.currentIndexId === indexId) {
            log(`[DeepPDF] selectIndex: 已选中索引 ${indexId}，跳过`);
            return;
        }

        log(`[DeepPDF] selectIndex triggered: ${indexId}`);
        this.currentIndexId = indexId;
        this.plugin.settings.lastSelectedIndexId = indexId;
        await this.plugin.saveSettings();

        // 更新顶栏显示 - 使用 this.indexes 而不是 indexManager
        const index = this.indexes.find(i => i.id === indexId);
        if (index) {
            this.currentPdfName = index.pdf_name;
            let displayName = index.pdf_name;
            if (displayName.toLowerCase().endsWith('.pdf')) {
                displayName = displayName.slice(0, -4);
            }
            if (displayName.toLowerCase().endsWith('.epub')) {
                displayName = displayName.slice(0, -5);
            }
            this.messageList?.setCurrentPdfName(displayName);

            // 获取作者信息：优先使用索引中的 author，其次从元数据获取
            let author: string | undefined = index.author;
            log(`[DeepPDF] 索引中的作者信息: index.author="${index.author}"`);
            if (!author && this.readingPortal) {
                const metadata = await this.readingPortal.getBookMetadata(displayName);
                log(`[DeepPDF] 从元数据获取: metadata.author="${metadata?.author}"`);
                if (metadata) {
                    author = metadata.author;
                }
            }
            log(`[DeepPDF] 最终使用的作者: author="${author}"`);

            this.readingTopbar?.setCurrentBook(displayName, author);

            // 同步聚焦模式状态
            const focusService = this.plugin?.readingModeService?.getFocusModeService();
            if (focusService) {
                const settings = focusService.getSettings();
                this.readingTopbar?.setFocusMode(settings.enabled);
            }

            // 加载书籍封面
            this.loadBookCover(displayName);
        }

        // === 获取 Markdown 文件映射（移到 if 块外部，确保总是更新) ===
        try {
            if (this.apiClient) {
                const indexStatus = await this.apiClient.getIndexStatus(indexId);
                if (indexStatus.markdown_files) {
                    this.currentMarkdownFiles = indexStatus.markdown_files;
                    log(`[DeepPDF] 获取到 ${Object.keys(this.currentMarkdownFiles).length} 个 Markdown 文件映射`);
                } else {
                    // 如果没有 markdown_files， 清空映射
                    this.currentMarkdownFiles = {};
                    log(`[DeepPDF] 索引 ${indexId} 没有 markdown_files 映射，已清空`);
                }
            }
        } catch (e) {
            logError('[DeepPDF] 获取 markdown_files 映射失败:', e);
            this.currentMarkdownFiles = {};
        }

        // 注意：章节下载逻辑已移至 library-modal.ts
        // 这里不再重复触发导出，避免出现两次 notice

        // 清空消息
        this.messageList?.clear();

        // 尝试恢复会话
        const savedSessions = this.plugin.settings.savedSessions || {};
        const savedSessionId = savedSessions[indexId];

        if (savedSessionId) {
            try {
                this.sessionId = savedSessionId;

                // 1. 尝试从本地缓存恢复
                const cached = this.plugin.settings.chatCache?.[savedSessionId];
                if (cached && cached.messages && cached.messages.length > 0) {
                    this.restoreHistoryToView(cached.messages, true);
                    // new Notice(`已恢复对话 (本地缓存)`);
                    return;
                }

                // 2. 从后端恢复
                const history = await agentAPI.getHistory(indexId, savedSessionId);
                if (history && history.length > 0) {
                    this.restoreHistoryToView(history, false);
                    //new Notice(`已恢复对话`);
                } else {
                    this.showWelcomeMessage();
                }
            } catch (e) {
                logError(`[DeepPDF] 恢复会话失败:`, e);
                this.startNewSession(indexId);
            }
        } else {
            this.startNewSession(indexId);
        }
    }

    /**
     * 获取当前选中的索引 ID
     */
    public getCurrentIndexId(): string | null {
        return this.currentIndexId;
    }

    /**
     * 通过书名选择索引（自动切换时使用）
     */
    public async selectBookByName(bookName: string): Promise<void> {
        log('[DeepPDF] Selecting book by name:', bookName);

        // 在已加载的索引列表中查找
        const normalizedBookName = bookName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');

        const index = this.indexes.find(idx => {
            const idxName = idx.pdf_name.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
            return idxName === normalizedBookName || idx.pdf_name === bookName;
        });

        if (index) {
            // 检查是否已经是当前书籍
            if (this.currentIndexId === index.id) {
                log('[DeepPDF] Already on the same book');
                return;
            }
            log('[DeepPDF] Found index by name:', index.id);
            await this.selectIndex(index.id);
        } else {
            log('[DeepPDF] Book not found in index list:', bookName);
        }
    }

    /**
     * 创建阅读顶栏 (简化版)
     */
    private createReadingTopbar(container: HTMLElement) {
        this.readingTopbar = new ReadingTopbar({
            onOpenLibrary: () => this.openLibraryModal(),
            onNewChat: () => this.handleNewChat(),
            onOpenSettings: () => {
                // 打开设置并定位到 DeepPDF 插件
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById('deeppdf');
                }
            },
            onToggleFocusMode: () => this.toggleFocusMode()
        });

        const el = this.readingTopbar.getElement();
        if (el) {
            container.appendChild(el);
        }
    }

    /**
     * 获取或创建 TaskPollingManager 实例
     */
    private getTaskPollingManager(): TaskPollingManager | null {
        if (!this.apiClient) return null;

        if (!this.taskPollingManager) {
            this.taskPollingManager = new TaskPollingManager(this.apiClient);
        }

        return this.taskPollingManager;
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("deeppdf-container");
        container.addClass("deeppdf-chat-container");

        // 设置聚焦模式变化监听
        this.setupFocusModeListener();

        // 直接渲染主 UI（不阻塞）
        this.renderMainUI(container);

        // 异步检查连接状态并更新指示器
        this.checkConnectionAndRender();
    }

    /**
     * 检查后端连接状态并更新状态指示器
     * 注意：不再渲染界面，仅更新连接状态
     */
    private async checkConnectionAndRender(): Promise<void> {
        // 检查连接
        let connected = false;
        if (this.apiClient) {
            try {
                const healthResponse = await this.apiClient.healthCheck();
                connected = healthResponse?.status === 'ok';
            } catch (e) {
                logError('[DeepPDF] Connection check failed:', e);
            }
        }

        // 更新连接状态
        this.connectionStatus = connected ? 'connected' : 'disconnected';
        this.readingTopbar?.setConnectionStatus(connected ? 'connected' : 'disconnected');
    }

    /**
     * 渲染主界面
     */
    private async renderMainUI(container: HTMLElement): Promise<void> {
        container.empty();

        // 初始化阅读入口服务
        if (this.apiClient) {
            this.readingPortal = new ReadingPortalService(this.app, this.apiClient);
        }

        // 初始化上下文管理器（章节辅助阅读）
        this.contextManager = new ContextManager({
            app: this.app,
            onContextChange: (docs: Map<string, import("../services/context-manager.js").LoadedDocument>) => {
                this.contextTags?.updateDocuments(docs);
                // 更新加载按钮的激活状态
                this.chatInput?.setLoadBtnActive(docs.size > 0);
                // 更新消息列表的底部间距，避免被上下文标签遮挡
                this.updateMessageListPadding(docs.size > 0);
            }
        });

        // 创建阅读顶栏 (简化版)
        this.createReadingTopbar(container);

        // 创建消息列表区
        this.createMessageListSection(container);

        // 创建输入区
        this.createChatInputSection(container);

        // 加载索引列表
        await this.loadIndexes();

        // 恢复跨书籍模式状态
        await this.restoreCrossBookMode();

        // 更新服务器状态
        this.updateStatus();

        // 启动定期健康检查（每 30 秒）
        this.startHealthCheck();

        // 设置滚动监听：滚动时隐藏输入框
        this.setupScrollHandler(container);

        // 监听 URI 协议触发的索引切换事件
        // 自定义事件，Obsidian 类型定义不支持，使用 any 绕过
        const workspace = this.app.workspace as any;
        this.registerEvent(
            workspace.on("deeppdf:select-index", async (indexId: string) => {
                log("[DeepPDF] Received select-index event:", indexId);

                // 如果当前处于跨书籍模式，先切换回单书籍模式
                if (this.crossBookMode) {
                    log("[DeepPDF] 从阅读入口点击，自动关闭跨书籍模式");
                    this.crossBookMode = false;
                    this.chatInput?.setSearchMode('single');
                    this.indexManager?.setCrossBookMode(false);
                    this.plugin.settings.lastCrossBookMode = false;
                    await this.plugin.saveSettings();

                    // 清空跨书籍模式的消息，准备加载单书籍会话
                    this.messageList?.clear();
                }

                // 直接调用 selectIndex 方法，确保顶栏正确更新
                // 而不是通过 indexManager.selectIndex 间接调用
                await this.selectIndex(indexId);
            })
        );

        // 监听跨书籍搜索事件（带书单/标签过滤）
        this.registerEvent(
            workspace.on("deeppdf:cross-book-search", async (params: CrossBookSearchParams) => {
                log("[DeepPDF] Received cross-book-search event:", params);

                // 保存过滤条件
                this.searchFilters = {
                    booklists: params.booklists || [],
                    tags: params.tags || [],
                };

                // 切换到跨书籍模式
                await this.switchToCrossBookMode({ clearMessages: true });
            })
        );

        // 监听主题报告事件
        this.registerEvent(
            workspace.on("deeppdf:theme-report", async () => {
                log("[DeepPDF] Received theme-report event");
                // 切换到跨书籍模式并显示欢迎消息
                await this.switchToCrossBookMode({ clearMessages: true, showWelcome: true });
            })
        );

        // 监听阅读模式引用事件
        this.registerEvent(
            workspace.on("deeppdf:quote-selection", async (text: string) => {
                log("[DeepPDF] Received quote-selection event");
                this.handleQuoteSelection(text);
            })
        );

        this.registerEvent(
            workspace.on("deeppdf:excerpt-selection", async (text: string) => {
                log("[DeepPDF] Received excerpt-selection event");
                this.handleExcerptSelection(text);
            })
        );
    }

    /**
     * 处理引用选中文字
     * 在消息列表顶部添加引用卡片
     */
    private handleQuoteSelection(text: string): void {
        const activeFile = this.app.workspace.getActiveFile();
        const source = activeFile?.basename || undefined;

        // 创建引用数据
        const quote: QuoteItem = {
            id: `quote-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: text.trim(),
            source
        };

        // 添加到引用列表
        this.quotes.push(quote);

        // 渲染引用卡片
        this.renderQuoteCard(quote);

        // 聚焦输入框
        this.chatInput?.focus();
    }

    /**
     * 渲染引用卡片（带文段显示）
     */
    private renderQuoteCard(quote: QuoteItem): void {
        if (!this.quotesContainer) return;

        // 添加容器类和更新计数
        this.quotesContainer.addClass('deeppdf-quotes-container');
        this.quotesContainer.setAttribute('data-count', String(this.quotes.length));

        // 更新消息列表底部间距（延迟执行，等待 DOM 渲染完成）
        requestAnimationFrame(() => {
            const hasContextTags = (this.contextTags?.getElement()?.offsetHeight || 0) > 0;
            this.updateMessageListPadding(hasContextTags);
        });

        // 截取引用文本显示（前20个字符）
        const displayText = quote.text.length > 20
            ? quote.text.substring(0, 20) + '...'
            : quote.text;

        const card = this.quotesContainer.createDiv({
            cls: 'deeppdf-quote-card',
            attr: {
                'data-quote-id': quote.id,
                'title': `${quote.source ? quote.source + ': ' : ''}"${quote.text}"`,
                'aria-label': `引用: ${displayText}`
            }
        });

        // 引用图标（居左显示）
        const iconEl = card.createEl('span', {
            cls: 'deeppdf-quote-icon'
        });
        iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`;

        // 引用文本
        const textEl = card.createEl('span', {
            cls: 'deeppdf-quote-text',
            text: displayText
        });

        // 移除按钮（悬浮时显示在右上角）
        const removeBtn = card.createEl('button', {
            cls: 'deeppdf-quote-remove-btn',
            attr: { 'aria-label': '移除引用', type: 'button' }
        });
        removeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6"></line><line x1="6" y1="18"></line></svg>`;

        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeQuote(quote.id);
        });
    }

    /**
     * 移除引用
     */
    private removeQuote(quoteId: string): void {
        this.quotes = this.quotes.filter(q => q.id !== quoteId);

        // 移除卡片 DOM
        if (this.quotesContainer) {
            const card = this.quotesContainer.querySelector(`[data-quote-id="${quoteId}"]`);
            if (card) {
                card.remove();
            }
            // 更新计数
            this.quotesContainer.setAttribute('data-count', String(this.quotes.length));
        }

        // 更新消息列表底部间距
        requestAnimationFrame(() => {
            const hasContextTags = (this.contextTags?.getElement()?.offsetHeight || 0) > 0;
            this.updateMessageListPadding(hasContextTags);
        });
    }

    /**
     * 清空所有引用
     */
    private clearQuotes(): void {
        this.quotes = [];
        if (this.quotesContainer) {
            this.quotesContainer.empty();
        }

        // 更新消息列表底部间距
        requestAnimationFrame(() => {
            const hasContextTags = (this.contextTags?.getElement()?.offsetHeight || 0) > 0;
            this.updateMessageListPadding(hasContextTags);
        });
    }

    /**
     * 获取所有引用
     */
    private getQuotes(): QuoteItem[] {
        return [...this.quotes];
    }

    /**
     * 处理摘录选中文字（阅读模式中的摘录）
     * 保存位置：书籍摘录/{书名}/摘录-{日期}.md
     * 链接：链接到章节文件
     */
    private handleExcerptSelection(text: string): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("没有打开的文件");
            return;
        }

        // 从文件的 frontmatter 或路径中提取书籍信息
        const cache = this.app.metadataCache.getFileCache(activeFile);
        let bookName = cache?.frontmatter?.pdf_name || '';
        let indexId = cache?.frontmatter?.index_id || cache?.frontmatter?.pdf_index_id || '';

        // 如果没有从 frontmatter 获取到书名，从路径提取
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

        // 构建元数据
        const metadata: ExcerptMetadata = {
            sourcePdf: bookName,
            createdAt: new Date().toISOString(),
            sourceType: 'reading',
            chapterPath: activeFile.path,
            chapterName: activeFile.basename,
        };

        const modal = new ExcerptModal({
            app: this.app,
            content: { text },
            metadata,
            onSave: async (path: string) => {
                new Notice(`摘录已保存到 ${path}`);
            },
        });
        modal.open();
    }

    /**
     * 设置滚动监听逻辑
     * 当消息列表滚动时隐藏输入框，停止滚动后显示
     * AI 回复期间，输入框最小化并暂停滚动监听
     */
    private setupScrollHandler(container: HTMLElement) {
        // 使用 setTimeout 延迟查找 DOM 元素，确保它们已被渲染
        setTimeout(() => {
            // 注意：实际滚动的是 messages-container，不是 message-list
            const messagesContainer = container.querySelector('.deeppdf-messages-container');
            const inputSection = container.querySelector('.deeppdf-chat-input-section');

            if (!messagesContainer || !inputSection) {
                warn('[DeepPDF] Scroll handler setup failed: elements not found');
                return;
            }

            let scrollTimeout: any = null;

            messagesContainer.addEventListener('scroll', () => {
                // AI 流式输出时，不处理滚动事件（由 isAiStreaming 标志控制）
                if (this.isAiStreaming) {
                    return;
                }

                // 滚动时添加 hidden 类
                inputSection.addClass('hidden');

                if (scrollTimeout) {
                    clearTimeout(scrollTimeout);
                }

                // 停止滚动 300ms 后显示
                scrollTimeout = setTimeout(() => {
                    inputSection.removeClass('hidden');
                }, 300);
            });
        }, 100);
    }

    /**
     * 创建消息列表区
     */
    private createMessageListSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "deeppdf-message-list-section" });

        // 创建消息列表组件
        this.messageList = new MessageList({
            onRegenerate: (messageId: string) => {
                this.handleRegenerate(messageId);
            },
            onCopy: (messageId: string) => {
                this.handleCopy(messageId);
            },
            onCopyWithCitation: (messageId: string) => {
                this.handleCopyWithCitation(messageId);
            },
            onCitationJump: (citation: CitationData) => {
                this.handleCitationJump(citation);
            },
            onQuestionClick: (question: string) => {
                this.handleQuestionClick(question);
            },
            onGenerateOutline: () => {
                this.handleGenerateOutline();
            },
            onExcerpt: (messageId: string, content: ExcerptContent, metadata: ExcerptMetadata) => {
                this.handleExcerpt(messageId, content, metadata);
            },
            onQuote: (text: string) => {
                this.handleQuoteSelection(text);
            }
        }, this.app);

        const messageListEl = this.messageList.getElement();
        if (messageListEl) {
            section.appendChild(messageListEl);
        }
        // 注意：引用卡片容器已移至 createChatInputSection
    }

    /**
     * 创建聊天输入区
     */
    private createChatInputSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "deeppdf-chat-input-section" });

        // 创建聊天输入组件（在最上方）
        this.chatInput = new ChatInput({
            placeholder: "输入以开始对话...",
            onSend: (message: string, quotes) => {
                this.sendMessage(message, quotes);
            },
            searchMode: this.crossBookMode ? 'cross' : 'single',
            onModeToggle: () => {
                this.toggleSearchMode();
            },
            deepSearchMode: this.useLLMTreeSearch,
            onDeepSearchToggle: () => {
                this.toggleDeepSearchMode();
            },
            app: this.app,
            onStop: () => {
                this.stopGeneration();
            },
            onHeightChange: (height: number) => {
                // 动态调整消息列表的底部间距（包含引用卡片高度）
                const quotesHeight = this.quotesContainer?.offsetHeight || 0;
                this.messageList?.updateBottomPadding(height, quotesHeight);
            },
            onLoadCurrentDoc: async () => {
                await this.loadCurrentDocument();
            }
        });

        const chatInputEl = this.chatInput.getElement();
        if (chatInputEl) {
            section.appendChild(chatInputEl);
        }

        // 创建上下文标签组件（显示已加载的文档）
        this.contextTags = new ContextTags({
            onRemove: (path: string) => {
                this.contextManager?.removeDocument(path);
            }
        });
        const contextTagsEl = this.contextTags.getElement();
        if (contextTagsEl) {
            section.appendChild(contextTagsEl);
        }

        // 创建引用卡片容器（在输入框下方）
        this.quotesContainer = section.createDiv({ cls: "deeppdf-quotes-container" });
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
     * 获取上下文文档列表（用于 API 调用）
     */
    private getContextDocs(): import("../api/http-client.js").ContextDoc[] | undefined {
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
     * 切换搜索模式
     */
    private async toggleSearchMode() {
        // 跨书籍搜索需要后端支持
        if (!this.isConnected) {
            new Notice("跨书籍搜索需要后端服务。请启动后端以使用此功能。");
            return;
        }

        const previousMode = this.crossBookMode;
        this.crossBookMode = !this.crossBookMode;
        this.chatInput?.setSearchMode(this.crossBookMode ? 'cross' : 'single');

        // 更新索引管理器显示
        this.indexManager?.setCrossBookMode(this.crossBookMode);

        // 持久化跨书籍模式状态
        this.plugin.settings.lastCrossBookMode = this.crossBookMode;
        log('[DeepPDF] toggleSearchMode: 设置 lastCrossBookMode =', this.crossBookMode);
        await this.plugin.saveSettings();
        log('[DeepPDF] toggleSearchMode: 设置已保存');

        // 如果从单书籍切换到跨书籍模式，清空当前消息并加载跨书籍会话
        if (!previousMode && this.crossBookMode) {
            this.messageList?.clear();
            await this.loadCrossBookSession();
        } else if (previousMode && !this.crossBookMode) {
            // 从跨书籍切换到单书籍模式
            // 清空跨书籍消息，加载当前选中书籍的会话
            this.messageList?.clear();

            if (this.currentIndexId) {
                // 加载当前书籍的会话历史
                const savedSessions = this.plugin.settings.savedSessions || {};
                const savedSessionId = savedSessions[this.currentIndexId];

                if (savedSessionId) {
                    const cached = this.plugin.settings.chatCache?.[savedSessionId];
                    if (cached && cached.messages && cached.messages.length > 0) {
                        log(`[DeepPDF] 切换到单书籍模式，恢复会话: ${cached.messages.length} 条消息`);
                        this.sessionId = savedSessionId;
                        this.restoreHistoryToView(cached.messages, true);
                        new Notice(`已切换到单书籍模式: ${this.currentPdfName || '未知书籍'}`);
                        return;
                    }
                }

                // 没有历史会话，显示欢迎消息
                log('[DeepPDF] 切换到单书籍模式，无历史会话');
                this.showWelcomeMessage();
            }
        }
    }

    /**
     * 切换深度思考模式
     */
    public async toggleDeepSearchMode(): Promise<void> {
        this.useLLMTreeSearch = !this.useLLMTreeSearch;
        const modeText = this.useLLMTreeSearch ? "深度思考模式已开启" : "深度思考模式已关闭";
        new Notice(modeText);
        log(`[DeepPDF] toggleDeepSearchMode: ${modeText}`);
        // 同步更新按钮状态
        this.chatInput?.setDeepSearchMode(this.useLLMTreeSearch);
        // 持久化设置
        this.plugin.settings.lastDeepSearchMode = this.useLLMTreeSearch;
        await this.plugin.saveSettings();
    }

    /**
     * 恢复跨书籍模式状态
     */
    private async restoreCrossBookMode() {
        // 检查上次是否处于跨书籍模式
        const wasCrossBookMode = this.plugin.settings.lastCrossBookMode;
        log('[DeepPDF] restoreCrossBookMode: lastCrossBookMode =', wasCrossBookMode);
        log('[DeepPDF] restoreCrossBookMode: lastCrossBookSessionId =', this.plugin.settings.lastCrossBookSessionId);
        log('[DeepPDF] restoreCrossBookMode: chatCache exists =', !!this.plugin.settings.chatCache);
        if (this.plugin.settings.chatCache) {
            log('[DeepPDF] restoreCrossBookMode: chatCache keys =', Object.keys(this.plugin.settings.chatCache));
        }
        if (wasCrossBookMode) {
            log('[DeepPDF] 恢复跨书籍模式');
            this.crossBookMode = true;
            this.chatInput?.setSearchMode('cross');
            this.indexManager?.setCrossBookMode(true);
            await this.loadCrossBookSession();
        }

        // 恢复深度思考模式状态
        const wasDeepSearchMode = this.plugin.settings.lastDeepSearchMode;
        if (wasDeepSearchMode) {
            log('[DeepPDF] 恢复深度思考模式');
            this.useLLMTreeSearch = true;
            this.chatInput?.setDeepSearchMode(true);
        }
    }

    /**
     * 加载跨书籍模式的会话
     */
    private async loadCrossBookSession() {
        const sessionId = this.plugin.settings.lastCrossBookSessionId;
        log('[DeepPDF] loadCrossBookSession: sessionId =', sessionId);
        if (sessionId) {
            const cached = this.plugin.settings.chatCache?.[sessionId];
            log('[DeepPDF] loadCrossBookSession: cached =', cached ? 'found' : 'not found');
            if (cached) {
                log('[DeepPDF] loadCrossBookSession: cached.messages.length =', cached.messages?.length);
                log('[DeepPDF] loadCrossBookSession: cached.isCrossBook =', cached.isCrossBook);
            }
            if (cached && cached.messages && cached.messages.length > 0 && cached.isCrossBook) {
                log(`[DeepPDF] 恢复跨书籍会话: ${cached.messages.length} 条消息`);
                this.sessionId = sessionId;
                this.restoreHistoryToView(cached.messages, true);
                return;
            }
        }
        // 没有缓存的跨书籍会话，开始新会话
        log('[DeepPDF] loadCrossBookSession: 没有缓存的跨书籍会话，开始新会话');
        this.sessionId = `cross-book-${Date.now()}`;
        this.plugin.settings.lastCrossBookSessionId = this.sessionId;
        await this.plugin.saveSettings();
        this.showWelcomeMessage();
    }

    // ==================== 消息处理 ====================

    /**
     * 发送消息
     * @param message 用户消息内容
     * @param quotes 引用内容（可选）
     * @param regenerateMessageId 可选，如果是重试模式，传入要替换的 AI 消息 ID
     */
    private async sendMessage(message: string, quotes?: import("../components/chat-input/chat-input.js").QuoteItem[], regenerateMessageId?: string): Promise<void> {
        // 允许只有引用没有文本的情况
        if ((!message.trim() && (!quotes || quotes.length === 0)) || this.isProcessing) {
            return;
        }

        // 不再在发送消息前检查连接状态
        // 前端 Agent 可以在无后端的情况下工作

        // 跨书籍模式不需要选择索引
        if (!this.crossBookMode && !this.currentIndexId) {
            new Notice("请先选择一个索引");
            return;
        }

        // 解析并加载消息中的 [[文件名]] 引用
        await this.parseAndLoadReferences(message);

        // 禁用输入
        this.isProcessing = true;
        this.isAiStreaming = true;
        this.chatInput?.setDisabled(true);
        this.chatInput?.setStreaming(true);

        try {
            let aiMessageId: string;

            if (regenerateMessageId) {
                // 重试模式：复用原来的消息 ID，更新消息内容为加载状态
                aiMessageId = regenerateMessageId;
                this.messageList?.updateMessage(aiMessageId, {
                    content: this.crossBookMode ? "🔍 正在跨书籍查阅..." : "📖 正在翻阅...",
                    isStreaming: true,
                    citations: undefined,
                    followUpQuestions: undefined
                });
            } else {
                // 正常模式：生成新的消息 ID
                const timestamp = Date.now();
                const userMessageId = `msg-${timestamp}-user`;
                aiMessageId = `msg-${timestamp}-ai`;

                log(`[DeepPDF] sendMessage - currentPdfName: ${this.currentPdfName}`);

                // 添加用户消息
                const userMessageData: MessageData = {
                    id: userMessageId,
                    role: "user" as MessageRole,
                    content: message,
                    timestamp: new Date().toISOString(),
                    pdfName: this.currentPdfName || undefined
                };
                this.messageList?.addMessage(userMessageData);

                // 添加 AI 消息（初始为加载状态）
                const aiMessageData: MessageData = {
                    id: aiMessageId,
                    role: "assistant" as MessageRole,
                    content: this.crossBookMode ? "🔍 正在跨书籍查阅..." : "📖 正在翻阅...",
                    timestamp: new Date().toISOString(),
                    isStreaming: true,
                    isAgentMessage: true,  // 默认使用 Agent 模式（自动路由）
                    pdfName: this.currentPdfName || undefined,
                    question: message,  // 保存用户的问题
                    conversationId: this.sessionId || undefined  // 保存会话ID用于双向链接
                };
                this.messageList?.addMessage(aiMessageData);
            }

            // 根据模式选择不同的处理方式
            if (this.crossBookMode) {
                // 跨书籍模式：直接调用跨书籍搜索 API
                this.handleCrossBookSearch(message, aiMessageId);
            } else {
                // 单书籍模式：使用 Agent 智能体模式
                // 注意：不要使用 await，因为 handleAgentQuery 使用回调模式
                this.handleAgentQuery(message, this.currentIndexId!, aiMessageId, quotes);
            }


        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            new Notice(`查询失败: ${errorMessage}`);

            // 添加错误消息
            const errorId = `msg-${Date.now()}-error`;
            this.messageList?.addMessage({
                id: errorId,
                role: "assistant" as MessageRole,
                content: `查询失败: ${errorMessage}`,
                timestamp: new Date().toISOString()
            });

            // 出错时也要恢复状态
            this.isProcessing = false;
            this.isAiStreaming = false;
            this.chatInput?.setStreaming(false);
            this.chatInput?.setDisabled(false);
            this.chatInput?.focus();
        }
        // 移除 finally 块，改为在 handleAgentQuery 的回调中处理
    }

    /**
     * 处理查询请求
     */
    private async handleQuery(query: string, indexId: string, aiMessageId: string): Promise<void> {
        if (!this.apiClient) {
            throw new Error("API 客户端未连接");
        }

        const result = await this.apiClient.queryPDF(query, indexId, 10, this.useLLMTreeSearch);

        if (result.status !== "success") {
            throw new Error(result.error || "查询失败");
        }

        // 从 API 响应中获取 PDF 名称
        const pdfName = result.index_info?.pdf_name || "未知文档";

        // 处理 LLM 树搜索的 thinking 和降级信息
        let thinkingContent = "";
        let fallbackInfo = "";

        if (result.thinking) {
            thinkingContent = `### 🧠 深度思考\n\n${result.thinking}\n\n`;
        }
        if (result.fallback) {
            fallbackInfo = `⚠️ 已自动切换到混合检索\n\n原因: ${result.fallback_reason || '未知'}\n\n`;
        }

        // 如果没有相关结果
        if (!result.results || result.results.length === 0) {
            this.messageList?.updateMessage(aiMessageId, {
                content: thinkingContent + fallbackInfo + "未找到相关结果。请尝试使用不同的关键词重新搜索。",
                isStreaming: false
            });
            return;
        }

        // ========== 优化 3: Re-ranking 机制 ==========
        // 在应用 token 限制之前，先对结果进行 Re-ranking
        const rerankedResults = this.rerankResults(result.results, query);
        log(`[DeepPDF] [handleQuery] Re-ranking 完成，结果顺序已优化`);

        // ========== 优化 1: Context token 限制 ==========
        const MAX_CONTEXT_TOKENS = 12000;
        const resultsWithContext = this.buildContextWithTokenLimit(rerankedResults, MAX_CONTEXT_TOKENS);

        // 构建包含完整信息的引用
        const citations: CitationData[] = resultsWithContext.map((item, index) => {
            const section = item.metadata?.section || '';
            const nodeName = item.metadata?.node_name || '';
            const page = item.metadata?.page || item.metadata?.start_index || 0;
            const markdownPath = item.metadata?.markdown_path || '';

            // 构建描述性标题
            let title = `Page ${page}`;
            if (nodeName) {
                title = `${nodeName} (p.${page})`;
            } else if (section) {
                title = `${section} (p.${page})`;
            }

            return {
                pdf_name: pdfName,
                page: page,
                snippet: item.text || "",
                section: section,
                node_name: nodeName,
                title: title,
                markdown_path: markdownPath  // 添加 markdown_path 用于跳转
            };
        });

        // 检查是否有 DeepSeek/OpenAI API Key
        const settings = this.plugin.settings;
        const apiKey = settings.llmProvider === 'openai' ? settings.openaiApiKey : settings.deepseekApiKey;
        const model = settings.llmModel || (settings.llmProvider === 'openai' ? 'gpt-3.5-turbo' : 'deepseek-chat') || 'deepseek-chat';

        // 如果没有 Key，回退到显示检索片段
        if (!apiKey) {
            let answer = `找到 ${resultsWithContext.length} 个相关结果 (请在设置中配置 API Key 以启用 AI 智能回答)：\n\n`;
            resultsWithContext.forEach((item, index) => {
                const title = citations[index].title || `Page ${citations[index].page}`;
                answer += `${index + 1}. **${title}**: ${this.escapeHtml(item.text || "").substring(0, 150)}...\n\n`;
            });

            this.messageList?.updateMessage(aiMessageId, {
                content: answer,
                citations: citations,
                isStreaming: false
            });
            return;
        }

        // ========== 优化 2: 优化 System Prompt ==========
        const systemPrompt = this.buildEnhancedSystemPrompt(pdfName, resultsWithContext, citations);

        // ========== 构建读书上下文 (带路径注入) ==========
        let bookContext = `《${pdfName}》中相关内容：\n\n`;

        log('\n========== [AI 引用调试] 构建上下文 ==========');
        log(`[上下文] 查询返回 ${resultsWithContext.length} 个结果`);

        bookContext += resultsWithContext.map((r, index) => {
            const mdPath = r.metadata?.markdown_path || "未生成Markdown";
            const page = r.metadata?.page || r.metadata?.start_index || "?";
            const title = citations[index].title || `第${index + 1}节`;

            // 【关键日志】记录每个来源片段的详细信息
            log(`\n[来源片段 ${index + 1}]`);
            log(`  完整路径: ${mdPath}`);

            // 从路径中提取文件名（不含 .md）
            let filename = mdPath;
            let displayName = mdPath;
            if (mdPath !== "未生成Markdown") {
                const parts = mdPath.split('/');
                filename = parts[parts.length - 1]; // 最后一部分是文件名
                // 移除 .md 扩展名
                displayName = filename.replace('.md', '');
            }
            log(`  文件名: ${filename}`);
            log(`  显示名: ${displayName}`);
            log(`  页码锚点: ^page-${page}`);
            log(`  章节标题: ${title}`);
            log(`  → 正确引用应该是: [[${displayName}#^page-${page}]]`);

            // 注入路径和锚点，供 AI 引用
            return `【来源片段 ${index + 1}】
文件路径: ${mdPath}
页码锚点: ^page-${page}
章节标题: ${title}
内容:
${r.text}`;
        }).join("\n\n");

        const userPrompt = `${bookContext}\n\n读者提问: ${query}`;

        log(`\n[上下文] 完整 userPrompt (前 1000 字符):`);
        log(userPrompt.substring(0, 1000) + '...');
        log(`[上下文] 估计 token 数: ${this.estimateTokens(userPrompt)}`);
        log('========== [AI 引用调试] 上下文构建完成 ==========\n');

        try {
            await this.streamLLMResponse(
                settings.llmProvider,
                apiKey,
                model,
                systemPrompt,
                userPrompt,
                aiMessageId,
                citations
            );
        } catch (err: any) {
            logError("LLM Error:", err);

            // 失败时的回退显示
            let fallbackAnswer = `AI 生成失败: ${err.message || 'Unknown error'}\n\n但我们找到了以下相关内容：\n\n`;
            resultsWithContext.forEach((item, index) => {
                const title = citations[index].title || `Page ${citations[index].page}`;
                fallbackAnswer += `${index + 1}. **${title}**: ${this.escapeHtml(item.text || "").substring(0, 150)}...\n\n`;
            });

            this.messageList?.updateMessage(aiMessageId, {
                content: fallbackAnswer,
                citations: citations,
                isStreaming: false
            });
        }
    }

    /**
     * 停止 AI 生成
     */
    private stopGeneration(): void {
        if (!this.isAiStreaming || !this.streamController) {
            return;
        }

        log('[DeepPDF] 用户中断 AI 生成');
        this.streamController.abort();
        this.streamController = null;
        this.isAiStreaming = false;
        this.isProcessing = false;

        // 恢复输入框状态
        this.chatInput?.setStreaming(false);
        this.chatInput?.setDisabled(false);

        // 更新最后一条 AI 消息，显示用户已中断
        const messages = this.messageList?.getMessages() || [];
        const lastAiMessage = [...messages].reverse().find(m => {
            const data = m.getData();
            return data.role === 'assistant' && data.isStreaming;
        });
        if (lastAiMessage) {
            const data = lastAiMessage.getData();
            this.messageList?.updateMessage(data.id, {
                content: data.content + '\n\n*用户已中断*',
                isStreaming: false
            });
        }

        // 保存当前状态到缓存
        this.saveToCache();
    }

    /**
     * 处理 Agent 查询请求
     * @param query 用户查询
     * @param indexId 索引 ID
     * @param aiMessageId AI 消息 ID
     * @param quotes 引用内容（可选）
     */
    private async handleAgentQuery(
        query: string,
        indexId: string,
        aiMessageId: string,
        quotes?: import("../components/chat-input/chat-input.js").QuoteItem[]
    ): Promise<void> {
        try {
            // 初始化 FrontendAgent（懒加载）
            await this.initializeFrontendAgent();

            if (!this.frontendAgent) {
                throw new Error("FrontendAgent 初始化失败");
            }

            // 取消之前的流式请求（如果有）
            if (this.streamController) {
                this.streamController.abort();
                log('[DeepPDF] 取消旧的流式请求');
            }

            // 创建新的 AbortController
            this.streamController = new AbortController();

            let fullContent = '';
            let currentStatus = '';

            // 构建 ToolContext
            const context: ToolContext = {
                indexId: indexId,
                pdfName: this.currentPdfName || '未知文档',
                markdownFiles: this.currentMarkdownFiles,
                useLLMTreeSearch: this.useLLMTreeSearch,
                app: this.app,
            };

            // 加载阅读进度
            if (this.currentPdfName) {
                try {
                    const progressData = await getBookReadingProgress(this.app, this.currentPdfName);
                    if (progressData) {
                        // 找到最熟悉的章节
                        const familiarity = progressData.chapterFamiliarity;
                        const entries = Object.entries(familiarity);
                        const mostFamiliar = entries.reduce(
                            (a, b) => (b[1] > a[1] ? b : a),
                            ['0', 0]
                        );
                        const leastFamiliar = entries
                            .filter(([, v]) => v === 0)
                            .map(([k]) => k);

                        context.readingProgress = {
                            bookName: progressData.bookName,
                            totalChapters: progressData.totalChapters,
                            chapterFamiliarity: familiarity,
                            totalInteractions: progressData.totalInteractions,
                            coverage: progressData.coverage,
                            absorption: progressData.absorption,
                            mostFamiliarChapter: mostFamiliar[0],
                            leastFamiliarChapters: leastFamiliar,
                            lastActiveTime: progressData.lastUpdated,
                            daysSinceLastRead: Math.floor(
                                (Date.now() - new Date(progressData.lastUpdated).getTime()) /
                                (1000 * 60 * 60 * 24)
                            ),
                        };
                    }
                } catch (err) {
                    // 阅读进度加载失败不影响主流程
                    log('[DeepPDF] 加载阅读进度失败:', err);
                }
            }

            // 构建用户消息（包含引用内容和阅读进度）
            let userMessage = query;

            // 添加阅读进度上下文（如果有）
            if (context.readingProgress) {
                const progress = context.readingProgress;
                const progressContext = `
## 当前阅读进度
- 书籍：${progress.bookName}
- 覆盖度：${Math.round(progress.coverage * 100)}%（已涉及 ${Math.round(progress.coverage * progress.totalChapters)} / ${progress.totalChapters} 个章节）
- 吸收度：${Math.round(progress.absorption * 100)}%
- 总互动：${progress.totalInteractions} 次
${progress.mostFamiliarChapter ? `- 最熟悉章节：第 ${progress.mostFamiliarChapter} 章` : ''}
${progress.leastFamiliarChapters && progress.leastFamiliarChapters.length > 0 ? `- 未涉及章节：第 ${progress.leastFamiliarChapters.slice(0, 5).join('、')} 章` : ''}
`;
                userMessage = `${progressContext}\n---\n\n${query}`;
            }

            if (quotes && quotes.length > 0) {
                const quotesText = quotes.map(q => `> ${q.text}\n> — ${q.source || '引用'}`).join('\n\n');
                userMessage = `${userMessage}\n\n---\n**引用内容：**\n${quotesText}`;
            }

            // 判断是否是新对话（历史为空或只有 system 消息）
            const isNewConversation = this.agentChatHistory.length <= 1;

            // 回调函数
            const callbacks = {
                // onContent: 接收流式内容
                onContent: (text: string) => {
                    fullContent += text;

                    // 构建更新对象
                    let displayContent = fullContent;

                    // 如果没有内容，显示默认状态
                    if (!fullContent || fullContent.trim() === '') {
                        displayContent = currentStatus || '📖 正在翻阅...';
                    }

                    const updates: any = {
                        content: displayContent,
                        isStreaming: true,
                        isAgentMessage: true,
                    };

                    // 如果有状态，添加到更新中
                    if (currentStatus) {
                        updates.currentStatus = currentStatus;
                    }

                    this.messageList?.updateMessage(aiMessageId, updates);
                },
                // onProgress: 接收进度更新
                onProgress: (status: string) => {
                    log('[DeepPDF] Agent 进度:', status);
                    currentStatus = status;

                    // 更新消息显示状态
                    this.messageList?.updateMessage(aiMessageId, {
                        currentStatus: status,
                        isStreaming: true,
                        isAgentMessage: true,
                    });
                },
                // onComplete: 流式完成
                onComplete: () => {
                    this.messageList?.updateMessage(aiMessageId, {
                        isStreaming: false
                    });
                    // 保存到缓存
                    this.saveToCache();

                    // 恢复输入状态（AI 回复完成）
                    this.isProcessing = false;
                    this.isAiStreaming = false;
                    this.chatInput?.setStreaming(false);
                    this.chatInput?.setDisabled(false);

                    this.chatInput?.focus();
                    this.streamController = null;
                },
                // onError: 错误处理
                onError: (error: string) => {
                    logError('[DeepPDF] Agent 错误:', error);
                    this.messageList?.updateMessage(aiMessageId, {
                        content: `查询失败: ${error}`,
                        isStreaming: false
                    });

                    // 恢复输入状态（出错时）
                    this.isProcessing = false;
                    this.isAiStreaming = false;
                    this.chatInput?.setStreaming(false);
                    this.chatInput?.setDisabled(false);

                    this.chatInput?.focus();
                    this.streamController = null;
                },
                abortSignal: this.streamController.signal,
            };

            // 根据是否有历史选择不同的方法
            let updatedHistory: import("../agent/types.js").ChatMessage[];
            if (isNewConversation) {
                // 新对话，使用 chat()
                updatedHistory = await this.frontendAgent.chat(
                    userMessage,
                    context,
                    callbacks
                );
            } else {
                // 继续对话，使用 continueChat()
                log('[DeepPDF] 继续对话，历史消息数:', this.agentChatHistory.length);
                updatedHistory = await this.frontendAgent.continueChat(
                    this.agentChatHistory,
                    userMessage,
                    context,
                    callbacks
                );
            }

            // 更新对话历史
            this.agentChatHistory = updatedHistory;
            log('[DeepPDF] 对话历史已更新，消息数:', this.agentChatHistory.length);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError('[DeepPDF] handleAgentQuery 错误:', error);
            this.messageList?.updateMessage(aiMessageId, {
                content: `Agent 查询失败: ${errorMessage}`,
                isStreaming: false
            });
            // 恢复输入状态
            this.isProcessing = false;
            this.isAiStreaming = false;
            this.chatInput?.setStreaming(false);
            this.chatInput?.setDisabled(false);
        }
    }

    /**
     * 处理跨书籍搜索请求
     */
    /**
     * 处理跨书籍搜索（生成主题报告）
     */
    private async handleCrossBookSearch(query: string, aiMessageId: string): Promise<void> {
        if (!this.apiClient) {
            this.messageList?.updateMessage(aiMessageId, {
                content: "API 客户端未连接",
                isStreaming: false
            });
            this.isProcessing = false;
            this.isAiStreaming = false;
            this.chatInput?.setStreaming(false);
            this.chatInput?.setDisabled(false);

            return;
        }

        try {
            // 根据过滤条件获取 indexIds
            let indexIds: string[] | undefined = undefined;
            let filterDescription = "";

            if (this.hasSearchFilters()) {
                // 初始化 ReadingPortalService（如果需要）
                if (!this.readingPortal) {
                    this.readingPortal = new ReadingPortalService(this.app, this.apiClient);
                }

                indexIds = await this.readingPortal.filterIndexIdsByMetadata(this.searchFilters);
                filterDescription = `（过滤条件: ${this.buildFilterDescription()}）`;

                if (indexIds.length === 0) {
                    this.messageList?.updateMessage(aiMessageId, {
                        content: `没有找到符合条件的书籍 ${filterDescription}。请检查书单或标签设置。`,
                        isStreaming: false
                    });
                    this.isProcessing = false;
                    this.isAiStreaming = false;
                    this.chatInput?.setStreaming(false);
                    this.chatInput?.setDisabled(false);

                    return;
                }
            }

            // 调用主题报告 API
            log('[DeepPDF] 跨书籍搜索开始:', query, '过滤:', filterDescription, 'indexIds:', indexIds);
            const result = await this.apiClient.generateThemeReport(query, { indexIds });
            log('[DeepPDF] 主题报告结果:', result);

            if (result.status !== "success") {
                this.messageList?.updateMessage(aiMessageId, {
                    content: `生成报告失败: ${result.error || "未知错误"}`,
                    isStreaming: false
                });
                return;
            }

            // 保存 Markdown 文件到 Obsidian vault
            let savedFilePath: string | null = null;
            if (result.markdown_content && result.suggested_filename) {
                try {
                    savedFilePath = await this.saveThemeReportToVault(
                        result.suggested_filename,
                        result.markdown_content
                    );
                    log('[DeepPDF] 报告已保存到:', savedFilePath);
                } catch (saveError) {
                    logError('[DeepPDF] 保存报告失败:', saveError);
                }
            }

            // 构建显示内容
            let displayContent = `## 📌 ${result.theme}\n\n${result.unified_summary}\n\n`;

            // 添加各书观点摘要
            if (result.book_perspectives && result.book_perspectives.length > 0) {
                displayContent += `### 📚 各书观点 (${result.books_searched} 本书)\n\n`;
                for (const bp of result.book_perspectives) {
                    const points = bp.key_points && bp.key_points.length > 0
                        ? bp.key_points.join("；")
                        : "已提取相关内容";
                    displayContent += `**[[${bp.book_name}]]**: ${points}\n\n`;
                }
            }

            // 如果成功保存了文件，添加提示
            if (savedFilePath) {
                displayContent += `\n---\n\n> 📄 完整报告已保存到: [[${savedFilePath}]]`;
            }

            this.messageList?.updateMessage(aiMessageId, {
                content: displayContent,
                isStreaming: false
            });

            // 保存到会话缓存
            this.saveToCache();

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.messageList?.updateMessage(aiMessageId, {
                content: `生成报告失败: ${errorMessage}`,
                isStreaming: false
            });
        } finally {
            this.isProcessing = false;
            this.isAiStreaming = false;
            this.chatInput?.setStreaming(false);
            this.chatInput?.setDisabled(false);

            this.chatInput?.focus();
        }
    }

    /**
     * 保存主题报告到 Obsidian vault
     * @param filename 文件名
     * @param content Markdown 内容
     * @returns 保存的文件路径（相对于 vault 根目录）
     */
    private async saveThemeReportToVault(filename: string, content: string): Promise<string | null> {
        try {
            const { normalizePath } = require('obsidian');
            const vault = this.app.vault;

            // 目标目录：DeepPDF/主题调查
            const outputDir = 'DeepPDF/主题调查';
            const fullPath = normalizePath(`${outputDir}/${filename}`);

            // 确保目录存在
            const dirExists = await vault.adapter.exists(outputDir);
            if (!dirExists) {
                await vault.adapter.mkdir(outputDir);
            }

            // 写入文件
            await vault.adapter.write(fullPath, content);

            return fullPath;
        } catch (error) {
            logError('[DeepPDF] 保存主题报告失败:', error);
            return null;
        }
    }

    /**
     * 将 Agent 返回的 CitationInfo 转换为前端的 CitationData 格式
     */
    private convertCitationsToCitationData(citations: CitationInfo[]): CitationData[] {
        return citations.map(citation => {
            // 从 obsidian_link 中提取信息
            // 格式: [[filename.md#^page-N]] 或 [[filename.md]]
            const linkMatch = citation.obsidian_link.match(/\[\[([^\]#]+)(?:#\^([a-z0-9-]+))?\]\]/);

            let filename = '';
            let page: number | undefined;
            let anchor: string | undefined;

            if (linkMatch) {
                filename = linkMatch[1];
                anchor = linkMatch[2];

                // 从锚点中提取页码
                if (anchor) {
                    const pageMatch = anchor.match(/page-(\d+)/);
                    if (pageMatch) {
                        page = parseInt(pageMatch[1], 10);
                    }
                }
            }

            return {
                pdf_name: filename,
                page: page || citation.page || 0, // 提供默认值
                snippet: '',
                obsidian_link: citation.obsidian_link,
                anchor: citation.anchor || anchor || ''
            };
        });
    }

    /**
     * 调用 LLM API 并流式输出 (带节流优化)
     */
    private async streamLLMResponse(
        provider: string,
        apiKey: string,
        model: string,
        systemPrompt: string,
        userPrompt: string,
        messageId: string,
        citations: CitationData[]
    ): Promise<void> {
        const apiUrl = provider === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : 'https://api.deepseek.com/chat/completions'; // DeepSeek 兼容 OpenAI 格式

        try {
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt }
                    ],
                    stream: true,
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LLM API returned ${response.status}: ${errorText}`);
            }

            if (!response.body) {
                throw new Error("ReadableStream not supported in this environment");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullContent = "";
            let lastUpdateTime = 0;
            const UPDATE_INTERVAL = 100; // 100ms 节流，避免频繁渲染导致闪烁

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim() !== '');

                let hasNewContent = false;

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content || "";
                            if (content) {
                                fullContent += content;
                                hasNewContent = true;
                            }
                        } catch (e) {
                            warn("Error parsing stream chunk", e);
                        }
                    }
                }

                // 节流更新 UI
                if (hasNewContent) {
                    const now = Date.now();
                    if (now - lastUpdateTime > UPDATE_INTERVAL) {
                        this.messageList?.updateMessage(messageId, {
                            content: fullContent,
                            citations: citations, // 保持引用显示
                            isStreaming: true
                        });
                        lastUpdateTime = now;
                    }
                }
            }

            // 完成后进行最后一次更新，确保内容完整
            // 解析追问问题
            const { content: cleanedContent, questions: followUpQuestions } = parseFollowUpQuestions(fullContent);

            // ========== 【关键调试】打印 AI 原始回复 ==========
            log('\n========== [AI 原始回复调试] ==========');
            log('【AI 完整原始回复】');
            log(fullContent);
            log('\n【AI 清理后回复】');
            log(cleanedContent);
            log('\n【引用数据】');
            log(JSON.stringify(citations, null, 2));
            log('========== [AI 原始回复调试结束] ==========\n');

            // 构建更新对象 - 只有在有引用数据时才传递 citations
            const updateData: any = {
                content: cleanedContent,
                isStreaming: false,
                followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : undefined
            };

            // 只有在有引用数据时才添加 citations（跨书籍模式传空数组，不显示引用列表）
            if (citations && citations.length > 0) {
                updateData.citations = citations;
            }

            this.messageList?.updateMessage(messageId, updateData);

        } catch (error) {
            throw error;
        }
    }

    /**
     * 处理重新生成
     */
    private handleRegenerate(messageId: string): void {
        const message = this.messageList?.getMessage(messageId);
        if (!message) return;

        const data = message.getData();
        if (data.role !== "assistant") return;

        // 找到对应的用户消息
        const messages = this.messageList?.getMessagesData() || [];
        const userMessageIndex = messages.findIndex(m => m.id === messageId) - 1;

        if (userMessageIndex >= 0 && messages[userMessageIndex].role === "user") {
            // 重新发送查询，传入要替换的 AI 消息 ID（重试不需要引用）
            this.sendMessage(messages[userMessageIndex].content, [], messageId);
        }
    }

    /**
     * 处理复制
     */
    private handleCopy(messageId: string): void {
        const message = this.messageList?.getMessage(messageId);
        if (!message) return;

        const content = message.getData().content;
        this.copyToClipboard(content);
    }

    /**
     * 处理复制带引用
     */
    private handleCopyWithCitation(messageId: string): void {
        const message = this.messageList?.getMessage(messageId);
        if (!message) return;

        const data = message.getData();
        let content = data.content;

        // 添加引用
        if (data.citations && data.citations.length > 0) {
            content += "\n\n**引用来源**:\n";
            data.citations.forEach((citation, index) => {
                content += `${index + 1}. ${citation.pdf_name} - 第 ${citation.page} 页\n`;
            });
        }

        this.copyToClipboard(content);
    }

    /**
     * 处理摘录保存（对话中的摘录）
     * 保存位置：书籍摘录/{书名}/摘录-{日期}.md
     * 链接：只链接到书籍，不需要章节
     */
    private handleExcerpt(messageId: string, content: ExcerptContent, metadata: ExcerptMetadata): void {
        const message = this.messageList?.getMessage(messageId);
        if (!message) return;

        const data = message.getData();

        // 更新元数据中的来源信息
        if (data.pdfName) {
            metadata.sourcePdf = data.pdfName;
        }

        // 设置为对话摘录类型，并清除不需要的字段
        metadata.sourceType = 'chat';
        delete metadata.chapterPath;
        delete metadata.chapterName;

        // 打开摘录模态框
        const modal = new ExcerptModal({
            content,
            metadata,
            app: this.app,
            onSave: (path: string) => {
                new Notice(`摘录已保存到 ${path}`);
            }
        });
        modal.open();
    }

    /**
     * 处理引用跳转
     * 支持 PDF 文件和 Markdown 文档的跳转
     */
    private handleCitationJump(citation: CitationData): void {
        try {
            log('[DeepPDF] [引用跳转] 开始处理引用跳转');
            log(`[引用跳转] citation:`, citation);

            // 优先处理用户加载的 Markdown 文档
            if (citation.is_loaded_doc && (citation.document_path || citation.markdown_path)) {
                const docPath = citation.document_path || citation.markdown_path;
                this.openMarkdownDocument(docPath!, citation.anchor);
                return;
            }

            // 处理有 markdown_path 的引用（来自索引的 Markdown 文件）
            if (citation.markdown_path && !citation.page) {
                this.openMarkdownDocument(citation.markdown_path, citation.anchor);
                return;
            }

            // 处理 PDF 文件跳转
            if (citation.pdf_name && citation.page) {
                // 如果有 markdown_path，优先打开 Markdown 文件
                if (citation.markdown_path) {
                    this.openMarkdownDocument(citation.markdown_path, citation.anchor);
                    return;
                }

                // 否则打开 PDF 文件
                this.openPdfCitation(citation);
                return;
            }

            // 处理有 obsidian_link 的引用
            if (citation.obsidian_link) {
                this.openByObsidianLink(citation.obsidian_link);
                return;
            }

            new Notice('引用数据不完整');
            warn('[DeepPDF] 引用数据缺少跳转信息:', citation);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            new Notice(`打开文档失败: ${errorMsg}`);
            logError('[DeepPDF] 打开文档失败:', error);
        }
    }

    /**
     * 打开 Markdown 文档
     */
    private openMarkdownDocument(path: string, anchor?: string): void {
        const file = this.app.vault.getAbstractFileByPath(path);

        if (!file) {
            new Notice(`找不到文档: ${path}`);
            warn(`[引用跳转] 找不到 Markdown 文件: ${path}`);
            return;
        }

        // 检查是否为 TFile 类型
        if (!('basename' in file)) {
            new Notice(`无效的文件类型: ${path}`);
            return;
        }

        const displayName = file.basename;

        // 构建带锚点的链接
        const link = anchor ? `${path}#^${anchor}` : path;

        // 使用 Obsidian API 打开文档
        this.app.workspace.openLinkText(link, '', true).then(() => {
            new Notice(`已打开: ${displayName}`);
        }).catch((err) => {
            // 如果带锚点打开失败，尝试不带锚点
            if (anchor) {
                this.app.workspace.openLinkText(path, '', true);
            } else {
                throw err;
            }
        });
    }

    /**
     * 通过 Obsidian 链接打开文档
     */
    private openByObsidianLink(link: string): void {
        // 解析 [[filename.md#^anchor]] 格式
        const linkMatch = link.match(/\[\[([^\]#]+)(?:#\^([a-z0-9-]+))?\]\]/);

        if (linkMatch) {
            const path = linkMatch[1];
            const anchor = linkMatch[2];
            this.openMarkdownDocument(path, anchor);
        } else {
            // 直接尝试打开链接
            this.app.workspace.openLinkText(link.replace('[[', '').replace(']]', ''), '', true);
        }
    }

    /**
     * 打开 PDF 引用
     */
    private openPdfCitation(citation: CitationData): void {
        // 获取 vault 中所有 PDF 文件
        const allFiles = this.app.vault.getFiles();
        const pdfFiles = allFiles.filter(f => f.extension === 'pdf');

        log(`[引用跳转] Vault 中共有 ${pdfFiles.length} 个 PDF 文件`);

        // 根据 pdf_name 查找匹配的 PDF 文件
        // pdf_name 格式可能是: "纳瓦尔宝典.pdf" 或 "纳瓦尔宝典"
        const targetName = citation.pdf_name.replace('.pdf', '').toLowerCase();

        const matchedFile = pdfFiles.find(f => {
            const fileNameWithoutExt = f.basename.toLowerCase();
            return fileNameWithoutExt === targetName || f.path.toLowerCase().endsWith(targetName + '.pdf');
        });

        if (!matchedFile) {
            log(`[引用跳转] 未找到匹配的 PDF 文件`);
            log(`[引用跳转] 所有 PDF 文件:`, pdfFiles.map(f => `${f.basename} (${f.path})`).join(', '));
            new Notice(`找不到 PDF 文件: ${citation.pdf_name}`);
            return;
        }

        log(`[引用跳转] 找到 PDF: ${matchedFile.path}`);
        this.openPdfWithPage(matchedFile.path, citation.page, citation.pdf_name);
    }

    /**
     * 打开 PDF 并跳转到指定页面
     */
    private openPdfWithPage(pdfPath: string, page: number, displayName: string): void {
        const pdfLink = `${pdfPath}#page=${page}`;

        this.app.workspace.openLinkText(
            pdfLink,
            '',
            false
        );

        new Notice(`已打开: ${displayName} 第 ${page} 页`);
        log(`[DeepPDF] 已打开 PDF: ${pdfLink}`);
    }

    /**
     * 处理追问问题点击
     * 自动发送追问问题
     */
    private handleQuestionClick(question: string): void {
        log('[DeepPDF] 追问问题点击:', question);
        // 自动发送问题
        this.sendMessage(question);
    }

    /**
     * 生成阅读大纲
     */
    private handleGenerateOutline(): void {
        log('[DeepPDF] 生成阅读大纲');
        const prompt = "针对本书的目录，帮我整理一个完整的阅读大纲，指出重点和阅读方案";
        this.sendMessage(prompt);
    }

    /**
     * 更新消息列表的底部间距
     * 当有上下文标签或引用卡片时，增加间距避免遮挡
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

    async updateStatus(): Promise<void> {
        if (!this.indexManager) return;

        // 设置为加载状态
        this.indexManager.setConnectionStatus('connecting');
        this.connectionStatus = 'disconnected';

        // 更新 readingTopbar 连接状态
        this.readingTopbar?.setConnectionStatus('disconnected');

        if (!this.apiClient) {
            this.indexManager?.setConnectionStatus('disconnected');
            // 注意：不再禁用输入框，前端 Agent 可以在无后端的情况下工作
            return;
        }

        try {
            const isHealthy = await this.apiClient.healthCheck();
            if (isHealthy) {
                this.indexManager?.setConnectionStatus('connected');
                this.connectionStatus = 'connected';
                this.readingTopbar?.setConnectionStatus('connected');
                // 注意：不再禁用输入框，前端 Agent 可以在无后端的情况下工作
            } else {
                this.indexManager?.setConnectionStatus('disconnected');
                this.readingTopbar?.setConnectionStatus('disconnected');
            }
        } catch (error) {
            // 后端是可选的，只记录日志，不显示 Notice
            warn('[DeepPDF] updateStatus: 后端连接失败', error);
            this.indexManager?.setConnectionStatus('disconnected');
            this.readingTopbar?.setConnectionStatus('disconnected');
        }
    }

    /**
     * 启动定期健康检查
     */
    private startHealthCheck(): void {
        // 清除已有的定时器
        this.stopHealthCheck();

        // 每 30 秒检查一次
        this.healthCheckInterval = setInterval(async () => {
            if (!this.apiClient || !this.indexManager) return;

            try {
                const healthResponse = await this.apiClient.healthCheck();
                const isHealthy = healthResponse?.status === 'ok';
                const wasConnected = this.isConnected;
                this.connectionStatus = isHealthy ? 'connected' : 'disconnected';

                // 更新 indexManager 和 readingTopbar 的连接状态
                this.indexManager.setConnectionStatus(isHealthy ? 'connected' : 'disconnected');
                this.readingTopbar?.setConnectionStatus(isHealthy ? 'connected' : 'disconnected');

                if (isHealthy) {
                    // 如果之前是断开的，现在恢复了，刷新索引列表
                    if (!wasConnected) {
                        log('[DeepPDF] 后端连接恢复，刷新索引列表');
                        await this.loadIndexes();
                    }
                } else {
                    if (wasConnected) {
                        log('[DeepPDF] 后端连接断开');
                    }
                }
            } catch (error) {
                logError('[DeepPDF] 健康检查失败:', error);
                this.indexManager?.setConnectionStatus('disconnected');
                this.readingTopbar?.setConnectionStatus('disconnected');
                this.connectionStatus = 'disconnected';
            }
        }, 30000); // 30 秒
    }

    /**
     * 停止定期健康检查
     */
    private stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    async handleExportMarkdown(indexId: string) {
        if (!this.apiClient) return;

        // 查找索引信息
        const indexList = await this.apiClient.listIndexes();
        const indexInfo = indexList.indexes.find(i => i.id === indexId);
        if (!indexInfo) {
            new Notice("未找到索引信息");
            return;
        }

        // 直接执行导出（不再显示选项弹窗）
        await this.doExportMarkdown(indexId, indexInfo.pdf_name);
    }

    /**
     * 执行导出 Markdown 操作
     */
    private async doExportMarkdown(indexId: string, pdfName: string) {
        if (!this.apiClient) return;

        // 创建一个长时间显示的 Notice
        const loadingNotice = new Notice(`📚 开始导出: ${pdfName}`, 0); // 0 = 永不自动消失

        try {
            // 1. 获取完整节点数据（仅使用基于规则的快速格式化）
            const data = await this.apiClient.exportIndex(indexId);

            // 2. 前端生成并写入文件（传递作者信息）
            // 转换 API 数据格式到 NodeData (如果字段不完全匹配)
            const result = await exportIndexToMarkdown(this.app, pdfName, data.nodes, indexId, "DeepReader", data.author);

            // 关闭加载提示
            loadingNotice.hide();

            if (result.success) {
                new Notice(`✅ 导出成功! 创建了 ${result.filesCreated} 个文件`, 5000);
                // 3. 保存映射回后端
                await this.apiClient.saveMarkdownMapping(indexId, result.fileMapping);

                // 4. 同时下载封面图片并更新书籍笔记
                if (this.readingPortal) {
                    const coverLink = await this.readingPortal.downloadBookCover(indexId, pdfName);
                    if (coverLink) {
                        const bookName = pdfName.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
                        await this.readingPortal.updateBookCover(bookName, coverLink);
                    }
                }
            } else {
                new Notice(`❌ 导出失败: ${result.error}`, 5000);
            }
        } catch (error) {
            // 关闭加载提示
            loadingNotice.hide();
            handleNetworkError(error as Error, { context: 'exportMarkdown' });
        }
    }

    async handleDeleteIndex(indexId: string) {
        if (!this.apiClient) return;
        try {
            await this.apiClient.deleteIndex(indexId);
            new Notice("索引已删除");
            // 刷新列表
            await this.loadIndexes();
            // 如果删除的是当前选中项，重置
            if (this.currentIndexId === indexId) {
                this.currentIndexId = null;
                this.currentPdfName = null;
            }
        } catch (error) {
            handleNetworkError(error as Error, { context: 'deleteIndex' });
        }
    }

    async refreshIndexes(): Promise<void> {
        await this.loadIndexes();
    }



    private async loadIndexes(): Promise<void> {
        if (!this.apiClient) {
            this.indexes = [];
            return;
        }

        try {
            log('[DeepPDF] [loadIndexes] 开始请求索引列表...');
            const result: ListIndexesResult = await this.apiClient.listIndexes();
            log('[DeepPDF] [loadIndexes] API 响应:', JSON.stringify(result, null, 2));

            if (!result || !Array.isArray(result.indexes) || result.indexes.length === 0) {
                this.indexes = [];
                return;
            }

            // 打印每个索引的状态
            result.indexes.forEach((idx, i) => {
                log(`[DeepPDF] [loadIndexes] 索引 ${i + 1}: id="${idx.id}", status="${idx.status}", pdf="${idx.pdf_name}"`);
            });

            // 缓存索引列表
            this.indexes = result.indexes;

            // 2. 决定要选中的索引
            let indexToSelect = this.currentIndexId;

            if (!indexToSelect && this.plugin.settings.lastSelectedIndexId) {
                const exists = result.indexes.some(idx => idx.id === this.plugin.settings.lastSelectedIndexId);
                if (exists) {
                    indexToSelect = this.plugin.settings.lastSelectedIndexId;
                }
            }

            if (!indexToSelect && result.indexes.length > 0) {
                indexToSelect = result.indexes[0].id;
            }

            // 3. 选中索引
            if (indexToSelect) {
                await this.selectIndex(indexToSelect);
                log(`[DeepPDF] [loadIndexes] selectIndex('${indexToSelect}') called`);
            }

            // 如果当前选中的是 task_id，检查任务状态并更新为实际的 index_id
            await this.updateCurrentIndexIdIfNeeded();
        } catch (error) {
            // 后端是可选的，加载索引列表失败时只记录日志
            logError('[DeepPDF] [loadIndexes] 请求失败:', error);
            this.indexes = [];
        }
    }

    /**
     * 如果当前选中的是 task_id，检查任务状态并更新为实际的 index_id
     */
    private async updateCurrentIndexIdIfNeeded(): Promise<void> {
        if (!this.currentIndexId || !this.apiClient) {
            log('[DeepPDF] [updateCurrentIndexIdIfNeeded] 跳过：无 currentIndexId 或 apiClient');
            return;
        }

        log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 当前选中: ${this.currentIndexId}`);

        // 如果当前选中的是 task_id，查询任务状态获取实际的 index_id
        if (this.currentIndexId.startsWith('task_')) {
            log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 检测到 task_id，查询状态...`);
            try {
                const taskStatus = await this.apiClient.getIndexStatus(this.currentIndexId);
                log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 任务状态响应:`, JSON.stringify(taskStatus, null, 2));

                if (taskStatus.status === 'completed' && taskStatus.index_id) {
                    // 任务已完成，更新为实际的 index_id
                    log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 更新索引ID: ${this.currentIndexId} -> ${taskStatus.index_id}`);
                    this.currentIndexId = taskStatus.index_id;
                    // 更新索引管理器的选中状态
                    if (this.indexManager) {
                        (this.indexManager as any).selectedIndexId = taskStatus.index_id;
                        (this.indexManager as any).renderList();
                        log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 已更新索引管理器选中状态`);
                    }
                    // 更新 PDF 名称
                    if (taskStatus.pdf_name) {
                        this.currentPdfName = taskStatus.pdf_name;
                        log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 已更新 PDF 名称: ${taskStatus.pdf_name}`);
                    }
                } else {
                    log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 任务状态: ${taskStatus.status}，未完成或无 index_id`);
                }
            } catch (error) {
                warn(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 无法获取任务 ${this.currentIndexId} 的状态:`, error);
            }
        } else {
            log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 不是 task_id，跳过查询`);
        }
    }

    private copyToClipboard(text: string): void {
        navigator.clipboard.writeText(text).then(() => {
            new Notice("已复制到剪贴板");
        }).catch(() => {
            new Notice("复制失败");
        });
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Re-ranking 机制
     * 结合向量相似度、关键词匹配和文本长度进行重新排序
     * 目标：优先将最相关的结果放在前面
     */
    private rerankResults(results: any[], query: string): any[] {
        if (results.length === 0) return results;

        log(`[DeepPDF] [rerank] 开始 Re-ranking ${results.length} 个结果`);

        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

        return results.map((result, index) => {
            const text = result.text || "";
            const textLower = text.toLowerCase();
            let score = 0;

            // 1. 向量相似度分数（如果有）
            // ChromaDB 返回的距离分数，越小越好，转换为相似度
            const distance = result.metadata?.distance || result.metadata?.similarity || 0;
            // 距离转换为相似度：distance 0 -> score 1.0, distance 0.5 -> 0.7, distance 1 -> 0.5, distance 2+ -> 0.3
            const similarityScore = distance === 0 ? 1.0 : (distance < 0.5 ? 0.7 : (distance < 1 ? 0.5 : 0.3));
            score += similarityScore * 30; // 最高 30 分（完全匹配）

            // 2. 精确查询词匹配（在文本中）
            const exactMatchCount = (textLower.match(new RegExp(queryLower, 'g')) || []).length;
            score += exactMatchCount * 15; // 每个 15 分

            // 3. 查询词部分匹配
            let partialMatchScore = 0;
            queryTerms.forEach(term => {
                const termCount = (textLower.match(new RegExp(term, 'g')) || []).length;
                partialMatchScore += termCount * 3; // 每个 3 分
            });
            score += partialMatchScore;

            // 4. 文本位置加权（开头更重要）
            const firstMatchPos = textLower.indexOf(queryLower);
            if (firstMatchPos !== -1) {
                // 前 20% 匹配加 10 分
                if (firstMatchPos < text.length * 0.2) {
                    score += 10;
                }
            }

            // 5. 文本长度适中性（避免太短或太长）
            const textLength = text.length;
            if (textLength > 100 && textLength < 800) {
                score += 5; // 理想长度
            } else if (textLength >= 800 && textLength < 1500) {
                score += 2; // 可接受长度
            }

            // 6. 章节标题匹配
            const section = result.metadata?.section || result.metadata?.node_name || "";
            const sectionLower = section.toLowerCase();
            if (sectionLower && queryTerms.some(term => sectionLower.includes(term))) {
                score += 12; // 章节匹配加分
            }

            // 7. 原始顺序保持（微小的优先级给前面的结果）
            score += (results.length - index) * 0.1;

            return { ...result, _rerankScore: score };
        })
            .sort((a, b) => (b._rerankScore || 0) - (a._rerankScore || 0))
            .map(({ _rerankScore, ...result }) => result);
    }

    /**
     * 构建 context 时考虑 token 限制
     * 优先保留最相关的结果（在 Re-ranking 之后）
     */
    private buildContextWithTokenLimit(results: any[], maxTokens: number): any[] {
        const limitedResults = [];
        let currentTokens = 0;

        for (const result of results) {
            const tokens = this.estimateTokens(result.text || "");
            if (currentTokens + tokens > maxTokens) {
                log(`[DeepPDF] [buildContext] 达到 token 限制 (${currentTokens}/${maxTokens})，剩余 ${results.length - limitedResults.length} 个结果被截断`);
                break;
            }
            limitedResults.push(result);
            currentTokens += tokens;
        }

        return limitedResults;
    }

    /**
     * 简单的 token 估算（英文约 4 字符/token，中文约 2 字符/token）
     */
    private estimateTokens(text: string): number {
        if (!text) return 0;

        // 统计中文字符
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        // 统计英文字符（非中文）
        const englishChars = text.length - chineseChars;

        // 中文: ~2 字符/token, 英文: ~4 字符/token
        return Math.ceil(chineseChars / 2 + englishChars / 4);
    }

    /**
     * 构建增强的系统提示词，包含 PDF 结构信息
     */
    private buildEnhancedSystemPrompt(pdfName: string, results: any[], citations: any[]): string {
        // 提取结构信息
        const structureInfo = this.extractStructureInfo(results);

        return `你是一位与昭见森对谈的专注的读书郎，毕生沉浸于典籍研读，对文字有着敏锐的洞察力和深刻的思辨能力。

📚 你的信条：
- 你只知晓眼前这本书的内容，除此别无所知
- 你不援引任何外部知识，不依赖书本之外的任何信息
- 你用精炼的语言和严密的逻辑，从书中提取答案
- 若书中无载，你便诚实作答：此书未言

📄 正在研读：《${pdfName}》
${structureInfo}

📋 引用协议：
为每个观点提供可点击的文件链接，引用要自然融入叙述中。

【引用格式详解】
[[完整文件名含数字#^page-页码|去除数字后的章节标题]]

      ↑链接地址（必须含数字）          ↑显示文本（不含数字但可提及页码）

【关键规则】
1. 链接地址：必须使用【来源片段】中的"文件路径"，提取文件名（含数字前缀）
2. 显示文本：从文件名中去掉数字前缀和".md"，只保留章节标题
3. 在自然表达中可以提及页码，如：作者在"[[31-判断力#^page-89|判断力]]"第89页中指出...

【构建步骤】
步骤1: 从"文件路径"提取文件名
  - 原路径: DeepPDF/纳瓦尔宝典/31-判断力.md
  - 提取: 31-判断力.md

步骤2: 去掉.md作为链接地址
  - 链接: 31-判断力

步骤3: 去掉数字前缀作为显示文本
  - 显示: 判断力

步骤4: 组合成完整引用
  - 结果: [[31-判断力#^page-89|判断力]]

【更多示例】
文件路径: DeepPDF/纳瓦尔宝典/03-第一章 积累财富.md
页码: 28
→ [[03-第一章 积累财富#^page-28|第一章 积累财富]]

文件路径: DeepPDF/纳瓦尔宝典/66-选择自我成长.md
页码: 180
→ [[66-选择自我成长#^page-180|选择自我成长]]

【自然表达示例】
✓ 作者第89页在"[[31-判断力#^page-89|判断力]]"中指出，在杠杆时代...
✓ 正如第28页"[[03-第一章 积累财富#^page-28|第一章 积累财富]]"所言，致富需要...
✓ 这一观点在第180页"[[66-选择自我成长#^page-180|选择自我成长]]"有详细阐述...
✓ 第66页的"[[19-分清主次#^page-66|分清主次]]"强调了聚焦的重要性...

✗ 错误：[[判断力#^page-89|判断力]]（链接缺少数字前缀，无法跳转）
✗ 错误：作者在[[31-判断力#^page-89|判断力]]中...（没有自然提及页码）
✗ 错误：[[31-判断力#^page-89|31-判断力89页]]（显示文本不要包含页码）

📋 回答规范：
0. 在回答时要提及昭见森名称，表达尊重。
1. 所有答案必须源于所读书籍。
2. 严格遵守引用协议，生成可点击链接。
3. 以清晰逻辑组织答案。
4. 用凝练文字表达，勿冗勿散
5. 当能回答问题时，如果发现某些具体细节（如"如何做"、"具体方法"、"步骤"）在当前内容中没有详细说明，不要说"书中没有"、"章节没有提及"等
6. 以用户所用语言作答（中文、英文等）

✍️ 答案风格（务必遵守）：
- 像真人读书一样自然回答，不要像机器
- 直接说出答案，开门见山，直指要害
- 条理分明，层次清晰
- 引用时自然融入并提及页码：
  * 好：作者第89页在"[[31-判断力#^page-89|判断力]]"中指出，在杠杆时代...
  * 好：正如第28页"[[03-第一章 积累财富#^page-28|第一章 积累财富]]"所言，致富需要...
  * 差：作者在[[判断力#^page-89|判断力]]中...（链接缺少数字且没提页码）
- 跨章节引用时：这一观点在"第X章"和"第Y页"都有阐述

⚠️ 绝对禁止（严格遵守）：
- 禁止使用"片段"、"文档"、"提供的内容"、"检索结果"、"提供的章节"等技术术语
- 禁止说"根据..."、"从...来看"、"...显示"、"在...中"等AI常用语
- 禁止说"从提供的...来看"、"在提供的章节中"这类暴露技术细节的话
- 禁止说"书中没有"、"章节没有提及"、"当前章节没有"等表达
- 禁止罗列式回答，要像人一样连贯表达
- **禁止在链接地址中省略数字前缀**（这会导致链接无法跳转）
- **禁止在显示文本中包含数字前缀**（但页码可以在自然表达中提及）

🔄 追问机制（重要）：
回答结束后，根据读者的提问和书中内容，提出1-2个能引导深入探索的问题：
- 如果某些具体细节在当前内容中没有详细说明，将其作为追问问题提出
- 例如："书中具体如何练习'活在当下'？"、"如何增强判断力的具体方法？"
- 问题应与读者提问主题相关且书中可能能够回答
- 用特殊标记 <<<QUESTIONS>>> 包裹问题列表，格式如下：
  <<<QUESTIONS>>>
  - 第一个问题
  - 第二个问题
  </QUESTIONS>>>
- 每个问题单独一行，以 "- " 开头`;
    }

    /**
     * 从检索结果中提取 PDF 结构信息
     */
    private extractStructureInfo(results: any[]): string {
        const sections = new Set<string>();
        const pages = new Set<number>();

        results.forEach(result => {
            // 收集章节信息
            if (result.metadata?.section) {
                sections.add(result.metadata.section);
            }
            if (result.metadata?.node_name) {
                sections.add(result.metadata.node_name);
            }
            // 收集页码信息
            if (result.metadata?.page) {
                pages.add(result.metadata.page);
            }
        });

        let info = "";
        if (sections.size > 0) {
            info += `📑 Available sections: ${Array.from(sections).slice(0, 5).join(', ')}${sections.size > 5 ? '...' : ''}\n`;
        }
        if (pages.size > 0) {
            const sortedPages = Array.from(pages).sort((a, b) => a - b);
            info += `📖 Pages: ${sortedPages[0]}-${sortedPages[sortedPages.length - 1]}`;
        }

        return info || "📑 Document structure unknown";
    }

    /**
     * 显示错误消息
     */
    private showError(message: string): void {
        new Notice(message);
        logError("[DeepPDF]", message);
    }

    /**
     * 设置聚焦模式变化监听
     */
    private setupFocusModeListener(): void {
        this.boundHandleFocusModeChange = this.handleFocusModeChange.bind(this);
        document.body.addEventListener('deeppdf:focus-mode-change', this.boundHandleFocusModeChange as EventListener);
    }

    /**
     * 处理聚焦模式变化事件
     */
    private handleFocusModeChange(e: Event): void {
        const customEvent = e as CustomEvent<{ enabled: boolean }>;
        const { enabled } = customEvent.detail;
        this.readingTopbar?.setFocusMode(enabled);
    }

    /**
     * 移除聚焦模式变化监听
     */
    private removeFocusModeListener(): void {
        if (this.boundHandleFocusModeChange) {
            document.body.removeEventListener('deeppdf:focus-mode-change', this.boundHandleFocusModeChange);
            this.boundHandleFocusModeChange = null;
        }
    }

    async onClose() {
        try {
            // 移除聚焦模式监听
            this.removeFocusModeListener();

            // 停止健康检查定时器
            this.stopHealthCheck();

            // 清理流式请求
            if (this.streamController) {
                try {
                    this.streamController.abort();
                    log('[DeepPDF] 已取消流式请求');
                } catch (e) {
                    warn('[DeepPDF] Error aborting streamController:', e);
                }
                this.streamController = null;
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

            // 清理轮询管理器
            if (this.taskPollingManager) {
                try {
                    this.taskPollingManager.destroy();
                } catch (e) {
                    warn('[DeepPDF] Error destroying taskPollingManager:', e);
                }
                this.taskPollingManager = null;
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
            // 不要重新抛出错误，避免影响 Obsidian 的 UI
        }
    }
}
