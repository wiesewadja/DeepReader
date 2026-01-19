/**
 * DeepPDF 侧边栏视图
 * ChatGPT 风格的对话界面
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { PDFFileSelectorModal, PDFFileInfo } from "../ui/pdf-file-selector.js";
import { DeepPDFClient, QueryPDFResult, ListIndexesResult, IndexListItem, TaskProgress as APITaskProgress } from "../api/http-client.js";
import { Drawer } from "../components/drawer/drawer.js";
import { TaskPollingManager } from "../utils/task-polling-manager.js";
import { TaskProgressCard } from "../components/task-progress-card.js";
import { TaskProgress } from "../types/index.js";
import { MessageList } from "../components/message-list/message-list.js";
import { ChatInput } from "../components/chat-input/chat-input.js";
import { MessageData, MessageRole, CitationData } from "../components/message/message.js";
import { TopNav } from "../components/top-nav/top-nav.js";
import { IndexManager } from "../components/index-manager/index-manager.js";
import { ConfirmModal } from "../components/confirm-modal.js";
import { exportIndexToMarkdown } from "../services/markdown-exporter.js";
import { Icons, getIcon } from "../utils/icons.js";
import { handleError, handleNetworkError, handleAPIError } from "../utils/error-handler.js";

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
    private topNav: TopNav | null = null;
    private indexManager: IndexManager | null = null;
    private taskPollingManager: TaskPollingManager | null = null;
    private taskCards: Map<string, TaskProgressCard> = new Map();

    // 对话界面组件
    private messageList: MessageList | null = null;
    private chatInput: ChatInput | null = null;
    private currentIndexId: string | null = null;
    private currentPdfName: string | null = null;
    private isProcessing: boolean = false;

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
        return Icons.database;
    }

    /**
     * 创建顶部导航区
     */
    /**
     * 创建顶部导航区
     */
    private createTopNavigation(container: HTMLElement) {
        // 创建 TopNav 组件 (极简风格)
        this.topNav = new TopNav({
            onSettings: () => {
                // 打开 Obsidian 设置并定位到 DeepPDF 插件
                const app = this.app as any;
                if (app.setting) {
                    app.setting.open();
                    app.setting.openTabById('deeppdf');
                }
            },
            onTitleClick: () => {
                // 可以在这里显示关于信息或重置
            }
        });

        const navEl = this.topNav.getElement();
        if (navEl) {
            container.appendChild(navEl);
        }
    }

    /**
     * 创建索引管理区 (折叠面板)
     */
    private createIndexManager(container: HTMLElement) {
        this.indexManager = new IndexManager({
            app: this.app,
            onIndexChange: (indexId: string) => {
                this.currentIndexId = indexId;
                // 查找 PDF 名称
                const index = (this.indexManager as any).indexes?.find((i: any) => i.id === indexId);
                if (index) {
                    this.currentPdfName = index.pdf_name;
                    new Notice(`已切换到索引: ${index.pdf_name}`);
                }
            },
            onCreateIndex: () => {
                // 直接打开 PDF 选择器，不再需要 IndexManagerModal
                new PDFFileSelectorModal(this.app, async (fileInfo: PDFFileInfo) => {
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

        // 创建顶部导航区
        this.createTopNavigation(container);

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

        // 创建聊天输入组件
        this.chatInput = new ChatInput({
            placeholder: "输入问题开始查询...",
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

        // 禁用输入
        this.isProcessing = true;
        this.chatInput?.setDisabled(true);

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
                isStreaming: true
            };
            this.messageList?.addMessage(aiMessageData);

            // 发送查询请求 (handleQuery 将负责更新 UI 和流式输出)
            await this.handleQuery(message, this.currentIndexId, aiMessageId);


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
        } finally {
            // 恢复输入
            this.isProcessing = false;
            this.chatInput?.setDisabled(false);
            this.chatInput?.focus();
        }
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
        const MAX_CONTEXT_TOKENS = 12000; // 根据 DeepSeek (16K) 和 GPT-3.5 (4K) 调整
        const resultsWithContext = this.buildContextWithTokenLimit(rerankedResults, MAX_CONTEXT_TOKENS);

        // 构建包含完整信息的引用
        const citations: CitationData[] = resultsWithContext.map((item, index) => {
            const section = item.metadata?.section || '';
            const nodeName = item.metadata?.node_name || '';
            const page = item.metadata?.page || item.metadata?.start_index || 0;

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
                title: title // 添加标题字段用于显示
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

        // ========== 优化 3: 添加检索来源说明 ==========
        let contextWithSources = "";

        // 添加来源说明
        const sourceSections = resultsWithContext.map((item, index) => {
            const title = citations[index].title || `Page ${citations[index].page}`;
            return `  [${index + 1}] ${title}`;
        }).join('\n');

        contextWithSources = `📚 检索来源: ${resultsWithContext.length} 个片段来自《${pdfName}》\n${sourceSections}\n\n文档内容:\n\n`;

        // 构建 context（带 token 限制）
        contextWithSources += resultsWithContext.map((r, index) => {
            const title = citations[index].title || `片段 ${index + 1}`;
            return `【${title}】\n${r.text}`;
        }).join("\n\n---\n\n");

        const userPrompt = `${contextWithSources}\n\n用户问题: ${query}`;

        console.log(`[DeepPDF] [handleQuery] 查询: "${query}"`);
        console.log(`[DeepPDF] [handleQuery] 使用 ${resultsWithContext.length}/${result.results.length} 个结果 (token 限制)`);
        console.log(`[DeepPDF] [handleQuery] 估计 token 数: ${this.estimateTokens(userPrompt)}`);

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
            this.messageList?.updateMessage(messageId, {
                content: fullContent,
                citations: citations,
                isStreaming: false
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
     */
    private handleCitationJump(citation: CitationData): void {
        // 优先使用 Markdown 路径
        if (citation.markdown_path) {
            try {
                // 使用 Obsidian API 打开 Markdown 文件
                // openLinkText 参数: (linktext, sourcePath, newLeaf, openViewState)
                this.app.workspace.openLinkText(
                    citation.markdown_path,
                    '',  // sourcePath - 空字符串表示从 vault 根目录
                    false  // newLeaf - false 表示在当前标签页打开
                );
                new Notice(`已打开: ${citation.markdown_path}`);
                console.log('[DeepPDF] 已打开 Markdown 文件:', citation.markdown_path);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                new Notice(`打开文件失败: ${errorMsg}`);
                console.error('[DeepPDF] 打开 Markdown 文件失败:', error);
            }
        } else {
            // 降级:显示 PDF 信息
            new Notice(`Markdown 文件未生成,请重新索引 PDF: ${citation.pdf_name}`);
            console.warn('[DeepPDF] Markdown path not found for citation:', citation);
        }
    }

    async updateStatus(): Promise<void> {
        if (!this.topNav) return;

        // 设置为加载状态
        this.topNav.setStatus('loading');

        if (!this.apiClient) {
            this.topNav.setStatus('disconnected');
            return;
        }

        try {
            const isHealthy = await this.apiClient.healthCheck();
            if (isHealthy) {
                this.topNav.setStatus('connected');
            } else {
                this.topNav.setStatus('disconnected');
            }
        } catch (error) {
            handleNetworkError(error as Error, { context: 'updateStatus' });
            this.topNav.setStatus('error');
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

            // 更新索引列表，保持当前选中状态 (如果还在列表中)
            this.indexManager.setIndexes(result.indexes, this.currentIndexId || undefined);
            console.log(`[DeepPDF] [loadIndexes] 已加载 ${result.indexes.length} 个索引，当前选中: ${this.currentIndexId || '无'}`);

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

        return `You are a helpful AI assistant specialized in analyzing PDF documents.

📄 Document: 《${pdfName}》
${structureInfo}

📋 Guidelines:
1. Use the provided context from the PDF to answer the user's question accurately
2. Context is organized by sections with page numbers - preserve this structure in your answer
3. When referencing specific content, mention the section name and page number
4. If the answer is not in the context, clearly state that you cannot find the answer in the document
5. Maintain the hierarchical structure of information when possible
6. Respond in the same language as the user's question (Chinese, English, etc.)

💡 Tips for better answers:
- Start with a direct answer, then provide supporting details
- Use bullet points for listing multiple items
- Quote key phrases from the document when relevant
- Cross-reference different sections if they provide related information`;
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
            // 清理 TopNav
            if (this.topNav) {
                try {
                    this.topNav.destroy();
                } catch (e) {
                    console.warn('[DeepPDF] Error destroying topNav:', e);
                }
                this.topNav = null;
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
