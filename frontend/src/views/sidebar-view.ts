/**
 * DeepPDF 侧边栏视图
 * ChatGPT 风格的对话界面
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { PDFFileSelectorModal, DocumentFileInfo } from "../ui/pdf-file-selector.js";
import { DeepPDFClient, QueryPDFResult, ListIndexesResult, IndexListItem, TaskProgress as APITaskProgress, CitationInfo, SessionInfo } from "../api/http-client.js";
import { Drawer } from "../components/drawer/drawer.js";
import { TaskPollingManager } from "../utils/task-polling-manager.js";
import { TaskProgressCard } from "../components/task-progress-card.js";
import { TaskProgress } from "../types/index.js";
import { MessageList } from "../components/message-list/message-list.js";
import { ChatInput } from "../components/chat-input/chat-input.js";
import { MessageData, MessageRole, CitationData, parseFollowUpQuestions, FollowUpQuestion, parseAgentContent, AgentThought, AgentToolCall } from "../components/message/message.js";
import { IndexManager } from "../components/index-manager/index-manager.js";
import { ConfirmModal } from "../components/confirm-modal.js";
import { exportIndexToMarkdown } from "../services/markdown-exporter.js";
import { Icons, getIcon } from "../utils/icons.js";
import { handleError, handleNetworkError, handleAPIError } from "../utils/error-handler.js";
import { agentAPI } from "../api/index.js";
import { ChatHistoryModal } from "../components/chat-history-modal/chat-history-modal.js";

// ==================== 类型映射 ====================

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

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

/** 任务完成后显示延迟时间（毫秒） */
const TASK_COMPLETE_DISPLAY_MS = 2000;

export class SidebarView extends ItemView {
    private apiClient: DeepPDFClient | null;
    private plugin: any; // 插件实例，用于访问设置
    private indexManager: IndexManager | null = null;
    private taskPollingManager: TaskPollingManager | null = null;
    private taskCards: Map<string, TaskProgressCard> = new Map();
    private chatHistoryModal: ChatHistoryModal | null = null;

    // 对话界面组件
    private messageList: MessageList | null = null;
    private chatInput: ChatInput | null = null;
    private currentIndexId: string | null = null;
    private currentPdfName: string | null = null;
    private isProcessing: boolean = false;
    private sessionId: string | null = null;  // 会话ID，用于多轮对话
    private streamController: AbortController | null = null;  // 流式请求控制器
    private isAiStreaming: boolean = false;  // AI 是否正在流式输出
    private inputSectionMinimized: boolean = false;  // 输入框是否最小化

    /** 生成新的会话ID */
    private generateSessionId(): string {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /** 开启新会话 */
    private async startNewSession(indexId: string) {
        this.sessionId = this.generateSessionId();

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
        this.messageList.addMessage({
            id: welcomeId,
            role: "assistant",
            content: `已切换到文档 **${this.currentPdfName || '未命名'}**。您可以开始提问了！`,
            timestamp: new Date().toISOString()
        });
    }

    /** 处理新建会话 */
    private handleNewChat() {
        if (!this.currentIndexId) {
            new Notice("请先选择一个索引");
            return;
        }
        this.startNewSession(this.currentIndexId);
    }

    /** 处理显示历史 */
    private async handleShowHistory() {
        if (!this.currentIndexId) {
            new Notice("请先选择一个索引");
            return;
        }

        try {
            // 获取会话列表
            const result = await agentAPI.listSessions(this.currentIndexId);
            if (result.status !== 'success') {
                throw new Error('获取会话列表失败');
            }

            // 直接使用 API 返回的 SessionInfo，不需要映射
            const sessions: SessionInfo[] = result.sessions;

            // 每次都创建新的 Modal 实例，销毁旧的（如果有）
            if (this.chatHistoryModal) {
                this.chatHistoryModal.destroy();
                this.chatHistoryModal = null;
            }

            this.chatHistoryModal = new ChatHistoryModal(this.app, {
                onSessionSelect: (sessionId, indexId) => {
                    this.handleSessionSelect(sessionId, indexId);
                },
                onSessionDelete: async (sessionId, indexId) => {
                    await this.handleSessionDelete(sessionId, indexId);
                }
            });

            this.chatHistoryModal.setSessions(sessions);
            this.chatHistoryModal.open();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            new Notice(`获取历史失败: ${errorMessage}`);
        }
    }

    /** 处理会话选择 */
    private async handleSessionSelect(sessionId: string, indexId: string) {
        try {
            // 切换到选择的会话
            this.sessionId = sessionId;

            // 保存到设置
            if (!this.plugin.settings.savedSessions) {
                this.plugin.settings.savedSessions = {};
            }
            this.plugin.settings.savedSessions[indexId] = sessionId;
            await this.plugin.saveSettings();

            // 清空当前界面
            this.messageList?.clear();

            // 从后端恢复历史
            const history = await agentAPI.getHistory(indexId, sessionId);
            if (history && history.length > 0) {
                this.restoreHistoryToView(history, false);
                new Notice(`已加载会话记录`);
            } else {
                this.showWelcomeMessage();
            }

            // 关闭模态框
            this.chatHistoryModal?.close();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            new Notice(`加载会话失败: ${errorMessage}`);
        }
    }

    /** 处理会话删除 */
    private async handleSessionDelete(sessionId: string, indexId: string) {
        try {
            await agentAPI.deleteSession(indexId, sessionId);
            console.log(`[DeepPDF] 已删除会话: ${sessionId}`);

            // 如果删除的是当前会话，清空界面
            if (this.sessionId === sessionId) {
                this.messageList?.clear();
                this.showWelcomeMessage();
            }
        } catch (error) {
            throw error;
        }
    }

    /** 恢复历史记录到视图 */
    private restoreHistoryToView(history: any[], fromCache: boolean = false) {
        if (!this.messageList) return;

        if (fromCache) {
            // 从缓存恢复，直接使用 MessageData
            history.forEach(msgData => {
                try {
                    this.messageList!.addMessage(msgData);
                } catch (e) {
                    console.warn(`[DeepPDF] Failed to restore cached message ${msgData.id}:`, e);
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
            });
        }
    }

    /** 保存当前对话到本地缓存（带 LRU 清理） */
    private async saveToCache() {
        if (!this.sessionId || !this.currentIndexId || !this.messageList) return;

        // 1. 获取当前所有消息
        // Note: 需要在 MessageList 中实现 getAllMessages
        const allMessages = (this.messageList as any).getAllMessages();

        // 2. 过滤有效消息
        const validMsgs = allMessages.filter((m: any) =>
            (m.role === 'user' || m.role === 'assistant') &&
            !m.content.includes("已切换到文档") &&
            m.content !== "正在思考..." &&
            m.content // 确保有内容
        );

        if (validMsgs.length === 0) return;

        // 3. 更新设置
        if (!this.plugin.settings.chatCache) {
            this.plugin.settings.chatCache = {};
        }

        this.plugin.settings.chatCache[this.sessionId] = {
            sessionId: this.sessionId,
            indexId: this.currentIndexId,
            lastUpdated: Date.now(),
            messages: validMsgs
        };

        // 4. 清理并保存
        await this.cleanupCache();
        await this.plugin.saveSettings();
    }

    /** 清理过期缓存 (LRU, max 5MB) */
    private async cleanupCache() {
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        const cache = this.plugin.settings.chatCache;
        if (!cache) return;

        // 计算当前大小
        let currentSize = JSON.stringify(cache).length;

        if (currentSize <= MAX_SIZE) return;

        console.log(`[DeepPDF] 缓存大小 (${(currentSize / 1024).toFixed(1)}KB) 超过限制，开始清理...`);

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
                console.log(`[DeepPDF] 已删除过期缓存: ${oldestId}`);
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
        return "DeepPDF";
    }

    getIcon() {
        return "lucide-book-open";
    }

    /**
     * 创建索引管理区 (折叠面板)
     */
    private createIndexManager(container: HTMLElement) {
        this.indexManager = new IndexManager({
            app: this.app,
            onIndexChange: async (indexId: string) => {
                console.log(`[DeepPDF] onIndexChange triggered: ${indexId}`);
                this.currentIndexId = indexId;
                // 保存到设置
                this.plugin.settings.lastSelectedIndexId = indexId;
                await this.plugin.saveSettings();

                // 查找 PDF 名称
                const index = (this.indexManager as any).indexes?.find((i: any) => i.id === indexId);
                if (index) {
                    this.currentPdfName = index.pdf_name;
                    new Notice(`已切换到索引: ${index.pdf_name}`);
                }

                // 清空当前界面
                this.messageList?.clear();

                // 尝试恢复会话
                const savedSessions = this.plugin.settings.savedSessions || {};
                const savedSessionId = savedSessions[indexId];
                console.log(`[DeepPDF] Saved session ID for ${indexId}: ${savedSessionId}`);

                if (savedSessionId) {
                    try {
                        console.log(`[DeepPDF] 尝试恢复会话: ${savedSessionId}`);
                        this.sessionId = savedSessionId;

                        // 1. 尝试从本地缓存恢复
                        const cached = this.plugin.settings.chatCache?.[savedSessionId];
                        if (cached && cached.messages && cached.messages.length > 0) {
                            console.log(`[DeepPDF] 从本地缓存恢复: ${cached.messages.length} 条`);
                            this.restoreHistoryToView(cached.messages, true); // true indicates from cache
                            new Notice(`已恢复对话 (本地缓存)`);
                            return;
                        }

                        // 2. 从后端恢复
                        console.log('[DeepPDF] Local cache miss/empty, fetching from backend...');
                        const history = await agentAPI.getHistory(indexId, savedSessionId);

                        if (history && history.length > 0) {
                            console.log(`[DeepPDF] 恢复历史记录: ${history.length} 条`);
                            this.restoreHistoryToView(history, false);
                            new Notice(`已恢复之前的对话记录`);
                        } else {
                            // 有 ID 但没历史（可能是后端文件没了），不显示欢迎语，直接当新会话
                            // 或者显示欢迎语
                            console.log('[DeepPDF] No history found on backend.');
                            this.showWelcomeMessage();
                        }
                    } catch (e) {
                        console.error(`[DeepPDF] 恢复会话失败:`, e);
                        this.startNewSession(indexId);
                    }
                } else {
                    console.log('[DeepPDF] No saved session, starting new session.');
                    this.startNewSession(indexId);
                }
            },
            onCreateIndex: () => {
                // 直接打开 PDF 选择器，不再需要 IndexManagerModal
                new PDFFileSelectorModal(this.app, async (fileInfo: DocumentFileInfo) => {
                    try {
                        // 使用 ConfirmModal 替代原生 confirm
                        new ConfirmModal(
                            this.app,
                            'Confirm Indexing',
                            `Are you sure you want to index "${fileInfo.name}"?\n\nFile size: ${fileInfo.sizeFormatted}\nYou can start AI Q&A after indexing is complete.`,
                            async () => {
                                new Notice(`Starting to index "${fileInfo.name}"...`);

                                // 调用 API 创建索引
                                try {
                                    const result = await this.apiClient!.indexPDF(fileInfo.path, {
                                        llmProvider: this.plugin.settings.llmProvider,
                                        llmModel: this.plugin.settings.llmModel,
                                        deepseekApiKey: this.plugin.settings.deepseekApiKey,
                                        openaiApiKey: this.plugin.settings.openaiApiKey,
                                        apiUrl: this.plugin.settings.apiUrl,
                                        maxPagesPerNode: this.plugin.settings.maxPagesPerNode,
                                        maxTokensPerNode: this.plugin.settings.maxTokensPerNode,
                                        ifAddNodeSummary: this.plugin.settings.ifAddNodeSummary
                                    });

                                    // 检查返回状态
                                    if (result.status === 'pending') {
                                        // 异步任务已创建
                                        new Notice(
                                            `Index task created (ID: ${result.index_id}), processing in background...`,
                                            4000
                                        );

                                        // 等待一小段时间确保后端任务已注册
                                        await new Promise(resolve => setTimeout(resolve, 500));

                                        // 刷新索引列表以显示新任务
                                        await this.loadIndexes();

                                        // 启动任务轮询以更新进度
                                        const pollingManager = this.getTaskPollingManager();
                                        if (pollingManager && result.index_id) {
                                            console.log(`[DeepPDF] 开始轮询任务: ${result.index_id}`);
                                            pollingManager.startPolling(result.index_id, async (progress) => {
                                                console.log(`[DeepPDF] 任务进度更新: ${progress.status}, ${progress.progress_percent}%`);
                                                // 刷新索引列表以显示最新进度
                                                await this.loadIndexes();

                                                // 如果任务完成，显示通知
                                                if (progress.status === 'completed') {
                                                    new Notice(`Indexing completed! Nodes: ${progress.node_count || 0}`, 3000);
                                                } else if (progress.status === 'failed') {
                                                    new Notice(`Indexing failed: ${progress.error || 'Unknown error'}`, 5000);
                                                }
                                            });
                                        }
                                    } else if (result.status === 'success') {
                                        // 同步完成
                                        new Notice(`Indexing successful! Nodes: ${result.node_count}`, 3000);
                                        await this.loadIndexes();
                                    } else {
                                        new Notice(`Index status: ${result.status}`, 3000);
                                        await this.loadIndexes();
                                    }
                                } catch (error: any) {
                                    let errorMessage = 'Indexing failed';
                                    if (error.message) {
                                        if (error.message.includes('Too Many Requests') || error.message.includes('速率限制')) {
                                            errorMessage = 'Rate limit exceeded, please try again later';
                                        } else if (error.message.includes('API key')) {
                                            errorMessage = 'API key invalid or missing';
                                        } else {
                                            errorMessage = `Indexing failed: ${error.message}`;
                                        }
                                    }
                                    new Notice(errorMessage, 5000);
                                    console.error('[DeepPDF] Indexing error:', error);
                                }
                            },
                            {
                                confirmLabel: 'Start Indexing'
                            }
                        ).open();

                        // 移除原来的逻辑，因为现在都在 ConfirmModal 的回调里了
                        return;

                        new Notice(`开始索引 "${fileInfo.name}"...`);

                        // 调用 API 创建索引
                        const result = await this.apiClient!.indexPDF(fileInfo.path, {
                            llmProvider: this.plugin.settings.llmProvider,
                            llmModel: this.plugin.settings.llmModel,
                            deepseekApiKey: this.plugin.settings.deepseekApiKey,
                            openaiApiKey: this.plugin.settings.openaiApiKey,
                            apiUrl: this.plugin.settings.apiUrl,
                            maxPagesPerNode: this.plugin.settings.maxPagesPerNode,
                            maxTokensPerNode: this.plugin.settings.maxTokensPerNode,
                            ifAddNodeSummary: this.plugin.settings.ifAddNodeSummary
                        });

                        // 检查返回状态
                        if (result.status === 'pending') {
                            // 异步任务已创建
                            new Notice(
                                `索引任务已创建 (ID: ${result.index_id})，正在后台处理...`,
                                4000
                            );

                            // 等待一小段时间确保后端任务已注册
                            await new Promise(resolve => setTimeout(resolve, 500));

                            // 刷新索引列表以显示新任务
                            await this.loadIndexes();


                        } else if (result.status === 'success') {
                            // 同步完成（很少见）
                            new Notice(
                                `索引创建成功！节点数: ${result.node_count}`,
                                3000
                            );

                            // 刷新索引列表
                            await this.loadIndexes();
                        } else {
                            // 其他状态
                            new Notice(
                                `索引状态: ${result.status}`,
                                3000
                            );
                            await this.loadIndexes();
                        }
                    } catch (error: any) {
                        let errorMessage = '索引创建失败';

                        if (error.message) {
                            if (error.message.includes('Too Many Requests') ||
                                error.message.includes('速率限制')) {
                                errorMessage = '创建索引过于频繁，请稍后再试';
                            } else if (error.message.includes('API key')) {
                                errorMessage = 'API key 未配置或无效，请在设置中检查';
                            } else {
                                errorMessage = `索引创建失败: ${error.message}`;
                            }
                        }

                        new Notice(errorMessage, 5000);
                        console.error('[DeepPDF] 索引创建错误:', error);
                    }
                }).open();
            },
            onExportMarkdown: async (indexId: string) => {
                await this.handleExportMarkdown(indexId);
            },
            onDeleteIndex: async (indexId: string) => {
                await this.handleDeleteIndex(indexId);
            },
            onNewChat: () => {
                this.handleNewChat();
            },
            onShowHistory: () => {
                this.handleShowHistory();
            }
        });

        const el = this.indexManager.getElement();
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

        // 创建索引管理区 (新)
        this.createIndexManager(container);

        // 创建消息列表区
        this.createMessageListSection(container);

        // 创建输入区
        this.createChatInputSection(container);

        // 加载索引列表
        await this.loadIndexes();

        // 更新服务器状态
        this.updateStatus();

        // 设置滚动监听：滚动时隐藏输入框
        this.setupScrollHandler(container);
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
                console.warn('[DeepPDF] Scroll handler setup failed: elements not found');
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

            // 点击输入区域恢复显示（从最小化状态）
            inputSection.addEventListener('click', () => {
                if (this.inputSectionMinimized) {
                    inputSection.removeClass('minimized');
                    this.inputSectionMinimized = false;
                }
            });
        }, 100);
    }

    /**
     * 最小化输入框（AI 回复时调用）
     */
    private minimizeInputSection() {
        console.log('[DeepPDF] minimizeInputSection called');
        const inputSection = this.containerEl.querySelector('.deeppdf-chat-input-section');
        console.log('[DeepPDF] inputSection found:', !!inputSection);
        if (inputSection) {
            inputSection.addClass('minimized');
            this.inputSectionMinimized = true;
            console.log('[DeepPDF] minimized class added, inputSection classes:', inputSection.className);
        }
    }

    /**
     * 恢复输入框显示（AI 回复结束时调用）
     */
    private restoreInputSection() {
        console.log('[DeepPDF] restoreInputSection called');
        const inputSection = this.containerEl.querySelector('.deeppdf-chat-input-section');
        console.log('[DeepPDF] inputSection found:', !!inputSection);
        if (inputSection) {
            inputSection.removeClass('minimized', 'hidden');
            this.inputSectionMinimized = false;
            console.log('[DeepPDF] minimized/hidden classes removed');
        }
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
            }
        }, this.app);

        const messageListEl = this.messageList.getElement();
        if (messageListEl) {
            section.appendChild(messageListEl);
        }
    }

    /**
     * 创建聊天输入区
     */
    private createChatInputSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "deeppdf-chat-input-section" });

        // 创建聊天输入组件（默认使用自动路由）
        this.chatInput = new ChatInput({
            placeholder: "输入以开始对话...",
            onSend: (message: string) => {
                this.sendMessage(message);
            }
        });

        const chatInputEl = this.chatInput.getElement();
        if (chatInputEl) {
            section.appendChild(chatInputEl);
        }
    }

    // ==================== 消息处理 ====================

    /**
     * 发送消息
     */
    private async sendMessage(message: string): Promise<void> {
        if (!message.trim() || this.isProcessing) {
            return;
        }

        // 检查是否选择了索引
        if (!this.currentIndexId) {
            new Notice("请先选择一个索引");
            return;
        }

        // 禁用输入并最小化输入框
        this.isProcessing = true;
        this.isAiStreaming = true;
        this.chatInput?.setDisabled(true);
        this.minimizeInputSection();

        try {
            // 生成消息 ID（使用单一时间戳避免冲突）
            const timestamp = Date.now();
            const userMessageId = `msg-${timestamp}-user`;
            const aiMessageId = `msg-${timestamp}-ai`;

            // 添加用户消息
            const userMessageData: MessageData = {
                id: userMessageId,
                role: "user" as MessageRole,
                content: message,
                timestamp: new Date().toISOString()
            };
            this.messageList?.addMessage(userMessageData);

            // 添加 AI 消息（初始为加载状态）
            const aiMessageData: MessageData = {
                id: aiMessageId,
                role: "assistant" as MessageRole,
                content: "正在思考...",
                timestamp: new Date().toISOString(),
                isStreaming: true,
                isAgentMessage: true  // 默认使用 Agent 模式（自动路由）
            };
            this.messageList?.addMessage(aiMessageData);

            // 使用 Agent 智能体模式（支持自动路由）
            // 注意：不要使用 await，因为 handleAgentQuery 使用回调模式
            this.handleAgentQuery(message, this.currentIndexId, aiMessageId);


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
            this.chatInput?.setDisabled(false);
            this.restoreInputSection();
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

        const result = await this.apiClient.queryPDF(query, indexId);

        if (result.status !== "success") {
            throw new Error(result.error || "查询失败");
        }

        // 从 API 响应中获取 PDF 名称
        const pdfName = result.index_info?.pdf_name || "未知文档";

        // 如果没有相关结果
        if (!result.results || result.results.length === 0) {
            this.messageList?.updateMessage(aiMessageId, {
                content: "未找到相关结果。请尝试使用不同的关键词重新搜索。",
                isStreaming: false
            });
            return;
        }

        // ========== 优化 3: Re-ranking 机制 ==========
        // 在应用 token 限制之前，先对结果进行 Re-ranking
        const rerankedResults = this.rerankResults(result.results, query);
        console.log(`[DeepPDF] [handleQuery] Re-ranking 完成，结果顺序已优化`);

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

        console.log('\n========== [AI 引用调试] 构建上下文 ==========');
        console.log(`[上下文] 查询返回 ${resultsWithContext.length} 个结果`);

        bookContext += resultsWithContext.map((r, index) => {
            const mdPath = r.metadata?.markdown_path || "未生成Markdown";
            const page = r.metadata?.page || r.metadata?.start_index || "?";
            const title = citations[index].title || `第${index + 1}节`;

            // 【关键日志】记录每个来源片段的详细信息
            console.log(`\n[来源片段 ${index + 1}]`);
            console.log(`  完整路径: ${mdPath}`);

            // 从路径中提取文件名（不含 .md）
            let filename = mdPath;
            let displayName = mdPath;
            if (mdPath !== "未生成Markdown") {
                const parts = mdPath.split('/');
                filename = parts[parts.length - 1]; // 最后一部分是文件名
                // 移除 .md 扩展名
                displayName = filename.replace('.md', '');
            }
            console.log(`  文件名: ${filename}`);
            console.log(`  显示名: ${displayName}`);
            console.log(`  页码锚点: ^page-${page}`);
            console.log(`  章节标题: ${title}`);
            console.log(`  → 正确引用应该是: [[${displayName}#^page-${page}]]`);

            // 注入路径和锚点，供 AI 引用
            return `【来源片段 ${index + 1}】
文件路径: ${mdPath}
页码锚点: ^page-${page}
章节标题: ${title}
内容:
${r.text}`;
        }).join("\n\n");

        const userPrompt = `${bookContext}\n\n读者提问: ${query}`;

        console.log(`\n[上下文] 完整 userPrompt (前 1000 字符):`);
        console.log(userPrompt.substring(0, 1000) + '...');
        console.log(`[上下文] 估计 token 数: ${this.estimateTokens(userPrompt)}`);
        console.log('========== [AI 引用调试] 上下文构建完成 ==========\n');

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
            console.error("LLM Error:", err);

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
     * 处理 Agent 查询请求
     */
    private async handleAgentQuery(query: string, indexId: string, aiMessageId: string): Promise<void> {
        if (!this.apiClient) {
            throw new Error("API 客户端未连接");
        }

        // 取消之前的流式请求（如果有）
        if (this.streamController) {
            this.streamController.abort();
            console.log('[DeepPDF] 取消旧的流式请求');
        }

        let fullContent = '';
        let streamController: AbortController | null = null;
        let agentCitations: CitationInfo[] = []; // 收集 Agent 返回的引用

        // 跟踪上一次的 Agent 元数据，避免不必要的全量重绘
        let lastThoughtsJSON = '';
        let lastToolCallsJSON = '';

        try {
            // 使用流式 Agent API（从插件设置中读取 force_mode）
            const forceMode = this.plugin?.settings?.forceMode || 'auto';
            streamController = agentAPI.chatStream(
                query,
                indexId,
                // onChunk: 接收流式内容
                (chunk: string, metadata?: { status?: string; citations?: CitationInfo[] }) => {
                    // 处理引用数据
                    if (metadata?.citations) {
                        console.log('[DeepPDF] 收到引用数据:', metadata.citations);
                        console.log('[DeepPDF] 引用数据数量:', metadata.citations.length);
                        agentCitations = metadata.citations;
                    }

                    fullContent += chunk;

                    // 解析 Agent 内容（提取思考过程、工具调用、状态等）
                    const { thoughts, toolCalls, cleanedContent, currentStatus } = parseAgentContent(fullContent);

                    // 调试日志
                    if (currentStatus) {
                        console.log('[DeepPDF] handleAgentQuery - 检测到状态:', currentStatus);
                    }

                    // 检查 Agent 元数据是否真正变化
                    const currentThoughtsJSON = JSON.stringify(thoughts);
                    const currentToolCallsJSON = JSON.stringify(toolCalls);

                    const thoughtsChanged = currentThoughtsJSON !== lastThoughtsJSON;
                    const toolCallsChanged = currentToolCallsJSON !== lastToolCallsJSON;

                    // 构建更新对象 - 始终更新所有字段以确保实时显示
                    let displayContent = cleanedContent;

                    // 回滚：在正文中显示默认状态，确保用户能看到反馈
                    if ((!cleanedContent || cleanedContent.trim() === '') && !currentStatus) {
                        displayContent = '🤔 正在思考...';
                    } else if (!cleanedContent || cleanedContent.trim() === '') {
                        // 如果有状态但没内容，这里可以选择显示状态或者留空
                        // 为了确保可见性，我们可以让正文也显示状态
                        // 或者保持之前的逻辑：Header 显示具体状态，正文留空
                        displayContent = '';
                    }

                    const updates: any = {
                        content: displayContent,
                        isStreaming: true,
                        isAgentMessage: true,
                        // 始终传递思考内容
                        agentThoughts: thoughts,
                        // 始终传递工具调用
                        agentToolCalls: toolCalls,
                        // 传递当前状态（用于在 header 中显示）
                        currentStatus: currentStatus
                    };

                    // 更新跟踪变量
                    lastThoughtsJSON = currentThoughtsJSON;
                    lastToolCallsJSON = currentToolCallsJSON;

                    // 如果有引用数据，转换为 CitationData 格式并添加
                    if (agentCitations.length > 0) {
                        console.log('[DeepPDF] 转换引用数据，数量:', agentCitations.length);
                        const convertedCitations = this.convertCitationsToCitationData(agentCitations);
                        console.log('[DeepPDF] 转换后的引用数据:', convertedCitations);
                        updates.citations = convertedCitations;
                    }

                    // 更新消息显示
                    console.log('[DeepPDF] 更新消息，updates keys:', Object.keys(updates));
                    console.log('[DeepPDF] updates.citations 存在?', !!updates.citations);
                    this.messageList?.updateMessage(aiMessageId, updates);
                },
                // onComplete: 流式完成
                () => {
                    this.messageList?.updateMessage(aiMessageId, {
                        isStreaming: false
                    });
                    // 保存到缓存
                    this.saveToCache();

                    // 恢复输入状态（AI 回复完成）
                    this.isProcessing = false;
                    this.isAiStreaming = false;
                    this.chatInput?.setDisabled(false);
                    this.restoreInputSection();
                    this.chatInput?.focus();
                },
                // onError: 错误处理
                (error: string) => {
                    this.messageList?.updateMessage(aiMessageId, {
                        content: `查询失败: ${error}`,
                        isStreaming: false
                    });

                    // 恢复输入状态（出错时）
                    this.isProcessing = false;
                    this.isAiStreaming = false;
                    this.chatInput?.setDisabled(false);
                    this.restoreInputSection();
                    this.chatInput?.focus();
                },
                forceMode,  // 传递强制模式参数
                true,       // 启用引用数据提取
                this.sessionId || undefined,  // 传递会话ID
                true        // 启用历史记录
            );

            // 保存 controller 用于取消
            this.streamController = streamController;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.messageList?.updateMessage(aiMessageId, {
                content: `Agent 查询失败: ${errorMessage}`,
                isStreaming: false
            });
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
                            console.warn("Error parsing stream chunk", e);
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
            console.log('\n========== [AI 原始回复调试] ==========');
            console.log('【AI 完整原始回复】');
            console.log(fullContent);
            console.log('\n【AI 清理后回复】');
            console.log(cleanedContent);
            console.log('\n【引用数据】');
            console.log(JSON.stringify(citations, null, 2));
            console.log('========== [AI 原始回复调试结束] ==========\n');

            this.messageList?.updateMessage(messageId, {
                content: cleanedContent,
                citations: citations,
                isStreaming: false,
                followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : undefined
            });

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
            // 重新发送查询
            this.sendMessage(messages[userMessageIndex].content);
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
     * 处理引用跳转
     * 直接打开 PDF 文件并跳转到指定页面
     */
    private handleCitationJump(citation: CitationData): void {
        if (citation.pdf_name && citation.page) {
            try {
                console.log('[DeepPDF] [引用跳转] 开始查找 PDF');
                console.log(`[引用跳转] pdf_name: ${citation.pdf_name}`);
                console.log(`[引用跳转] page: ${citation.page}`);

                // 获取 vault 中所有 PDF 文件
                const allFiles = this.app.vault.getFiles();
                const pdfFiles = allFiles.filter(f => f.extension === 'pdf');

                console.log(`[引用跳转] Vault 中共有 ${pdfFiles.length} 个 PDF 文件`);

                // 根据 pdf_name 查找匹配的 PDF 文件
                // pdf_name 格式可能是: "纳瓦尔宝典.pdf" 或 "纳瓦尔宝典"
                const targetName = citation.pdf_name.replace('.pdf', '').toLowerCase();

                const matchedFile = pdfFiles.find(f => {
                    const fileNameWithoutExt = f.basename.toLowerCase();
                    return fileNameWithoutExt === targetName || f.path.toLowerCase().endsWith(targetName + '.pdf');
                });

                if (!matchedFile) {
                    console.log(`[引用跳转] 未找到匹配的 PDF 文件`);
                    console.log(`[引用跳转] 所有 PDF 文件:`, pdfFiles.map(f => `${f.basename} (${f.path})`).join(', '));
                    new Notice(`找不到 PDF 文件: ${citation.pdf_name}`);
                    return;
                }

                console.log(`[引用跳转] 找到 PDF: ${matchedFile.path}`);
                this.openPdfWithPage(matchedFile.path, citation.page, citation.pdf_name);

            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                new Notice(`打开 PDF 失败: ${errorMsg}`);
                console.error('[DeepPDF] 打开 PDF 失败:', error);
            }
        } else {
            new Notice('引用数据不完整');
            console.warn('[DeepPDF] 引用数据缺少 pdf_name 或 page:', citation);
        }
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
        console.log(`[DeepPDF] 已打开 PDF: ${pdfLink}`);
    }

    /**
     * 处理追问问题点击
     * 自动发送追问问题
     */
    private handleQuestionClick(question: string): void {
        console.log('[DeepPDF] 追问问题点击:', question);
        // 自动发送问题
        this.sendMessage(question);
    }

    async updateStatus(): Promise<void> {
        if (!this.indexManager) return;

        // 设置为加载状态
        this.indexManager.setConnectionStatus('loading');

        if (!this.apiClient) {
            this.indexManager.setConnectionStatus('disconnected');
            return;
        }

        try {
            const isHealthy = await this.apiClient.healthCheck();
            if (isHealthy) {
                this.indexManager.setConnectionStatus('connected');
            } else {
                this.indexManager.setConnectionStatus('disconnected');
            }
        } catch (error) {
            handleNetworkError(error as Error, { context: 'updateStatus' });
            this.indexManager.setConnectionStatus('error');
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

        new Notice(`开始导出: ${indexInfo.pdf_name}...`);

        try {
            // 1. 获取完整节点数据
            const data = await this.apiClient.exportIndex(indexId);

            // 2. 前端生成并写入文件
            // 转换 API 数据格式到 NodeData (如果字段不完全匹配)
            const result = await exportIndexToMarkdown(this.app, indexInfo.pdf_name, data.nodes);

            if (result.success) {
                new Notice(`导出成功! 创建了 ${result.filesCreated} 个文件`);
                // 3. 保存映射回后端
                await this.apiClient.saveMarkdownMapping(indexId, result.fileMapping);
            } else {
                new Notice(`导出失败: ${result.error}`);
            }
        } catch (error) {
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
        if (!this.indexManager) return; // 使用 indexManager

        if (!this.apiClient) {
            this.indexManager.setIndexes([]);
            return;
        }

        try {
            console.log('[DeepPDF] [loadIndexes] 开始请求索引列表...');
            const result: ListIndexesResult = await this.apiClient.listIndexes();
            console.log('[DeepPDF] [loadIndexes] API 响应:', JSON.stringify(result, null, 2));

            if (!result || !Array.isArray(result.indexes) || result.indexes.length === 0) {
                this.indexManager.setIndexes([]);
                return;
            }

            // 打印每个索引的状态
            result.indexes.forEach((idx, i) => {
                console.log(`[DeepPDF] [loadIndexes] 索引 ${i + 1}: id="${idx.id}", status="${idx.status}", pdf="${idx.pdf_name}"`);
            });

            // 1. 设置索引列表 (不传递选中项)
            this.indexManager.setIndexes(result.indexes);

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

            // 3. 显式选中，触发 onIndexChange -> 加载历史
            if (indexToSelect) {
                this.indexManager.selectIndex(indexToSelect);
                console.log(`[DeepPDF] [loadIndexes] selectIndex('${indexToSelect}') called`);
            }

            // 如果当前选中的是 task_id，检查任务状态并更新为实际的 index_id
            await this.updateCurrentIndexIdIfNeeded();
        } catch (error) {
            console.error('[DeepPDF] [loadIndexes] 请求失败:', error);
            handleNetworkError(error as Error, { context: 'loadIndexes' });
            this.indexManager.setIndexes([]);
        }
    }

    /**
     * 如果当前选中的是 task_id，检查任务状态并更新为实际的 index_id
     */
    private async updateCurrentIndexIdIfNeeded(): Promise<void> {
        if (!this.currentIndexId || !this.apiClient) {
            console.log('[DeepPDF] [updateCurrentIndexIdIfNeeded] 跳过：无 currentIndexId 或 apiClient');
            return;
        }

        console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 当前选中: ${this.currentIndexId}`);

        // 如果当前选中的是 task_id，查询任务状态获取实际的 index_id
        if (this.currentIndexId.startsWith('task_')) {
            console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 检测到 task_id，查询状态...`);
            try {
                const taskStatus = await this.apiClient.getIndexStatus(this.currentIndexId);
                console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 任务状态响应:`, JSON.stringify(taskStatus, null, 2));

                if (taskStatus.status === 'completed' && taskStatus.index_id) {
                    // 任务已完成，更新为实际的 index_id
                    console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 更新索引ID: ${this.currentIndexId} -> ${taskStatus.index_id}`);
                    this.currentIndexId = taskStatus.index_id;
                    // 更新索引管理器的选中状态
                    if (this.indexManager) {
                        (this.indexManager as any).selectedIndexId = taskStatus.index_id;
                        (this.indexManager as any).renderList();
                        console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 已更新索引管理器选中状态`);
                    }
                    // 更新 PDF 名称
                    if (taskStatus.pdf_name) {
                        this.currentPdfName = taskStatus.pdf_name;
                        console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 已更新 PDF 名称: ${taskStatus.pdf_name}`);
                    }
                } else {
                    console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 任务状态: ${taskStatus.status}，未完成或无 index_id`);
                }
            } catch (error) {
                console.warn(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 无法获取任务 ${this.currentIndexId} 的状态:`, error);
            }
        } else {
            console.log(`[DeepPDF] [updateCurrentIndexIdIfNeeded] 不是 task_id，跳过查询`);
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

        console.log(`[DeepPDF] [rerank] 开始 Re-ranking ${results.length} 个结果`);

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
                console.log(`[DeepPDF] [buildContext] 达到 token 限制 (${currentTokens}/${maxTokens})，剩余 ${results.length - limitedResults.length} 个结果被截断`);
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
        console.error("[DeepPDF]", message);
    }

    async onClose() {
        try {
            // 清理流式请求
            if (this.streamController) {
                try {
                    this.streamController.abort();
                    console.log('[DeepPDF] 已取消流式请求');
                } catch (e) {
                    console.warn('[DeepPDF] Error aborting streamController:', e);
                }
                this.streamController = null;
            }

            // 清理历史模态框
            if (this.chatHistoryModal) {
                try {
                    this.chatHistoryModal.destroy();
                } catch (e) {
                    console.warn('[DeepPDF] Error destroying chatHistoryModal:', e);
                }
                this.chatHistoryModal = null;
            }

            // 清理消息列表
            if (this.messageList) {
                try {
                    this.messageList.destroy();
                } catch (e) {
                    console.warn('[DeepPDF] Error destroying messageList:', e);
                }
                this.messageList = null;
            }

            // 清理聊天输入
            if (this.chatInput) {
                try {
                    this.chatInput.destroy();
                } catch (e) {
                    console.warn('[DeepPDF] Error destroying chatInput:', e);
                }
                this.chatInput = null;
            }

            // 清理轮询管理器
            if (this.taskPollingManager) {
                try {
                    this.taskPollingManager.destroy();
                } catch (e) {
                    console.warn('[DeepPDF] Error destroying taskPollingManager:', e);
                }
                this.taskPollingManager = null;
            }

            // 清理任务卡片
            try {
                this.taskCards.clear();
            } catch (e) {
                console.warn('[DeepPDF] Error clearing taskCards:', e);
            }

            // 清理索引管理器
            if (this.indexManager) {
                try {
                    this.indexManager.destroy();
                } catch (e) {
                    console.warn('[DeepPDF] Error destroying indexManager:', e);
                }
                this.indexManager = null;
            }
        } catch (error) {
            console.error('[DeepPDF] Error in onClose:', error);
            // 不要重新抛出错误，避免影响 Obsidian 的 UI
        }
    }
}
