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
        });

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

            // 发送查询请求
            const result = await this.handleQuery(message, this.currentIndexId);

            // 更新 AI 消息
            this.messageList?.updateMessage(aiMessageId, {
                content: result.answer,
                citations: result.citations,
                isStreaming: false
            });

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
    private async handleQuery(query: string, indexId: string): Promise<{
        answer: string;
        citations: CitationData[];
    }> {
        if (!this.apiClient) {
            throw new Error("API 客户端未连接");
        }

        const result = await this.apiClient.queryPDF(query, indexId);

        if (result.status !== "success") {
            throw new Error("查询失败");
        }

        // 从 API 响应中获取 PDF 名称（避免依赖可能过时的本地状态）
        const pdfName = result.index_info?.pdf_name || "未知文档";

        // 格式化响应
        let answer = "";
        if (result.query) {
            answer += `**查询**: ${query}\n\n`;
        }

        if (!result.results || result.results.length === 0) {
            answer += "未找到相关结果。请尝试使用不同的关键词重新搜索。";
            return { answer, citations: [] };
        }

        // 构建答案
        answer += `找到 ${result.results.length} 个相关结果：\n\n`;

        result.results.forEach((item, index) => {
            answer += `${index + 1}. ${this.escapeHtml(item.text || "")}\n\n`;
        });

        // 构建引用（使用从 API 返回的 pdf_name）
        const citations: CitationData[] = result.results.map(item => ({
            pdf_name: pdfName,
            page: item.metadata?.page || item.metadata?.start_index || 0,
            snippet: item.text || "",
            file_path: item.metadata?.node_name || undefined
        }));

        return { answer, citations };
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
