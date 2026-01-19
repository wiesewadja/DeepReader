/**
 * DeepPDF 侧边栏视图
 * ChatGPT 风格的对话界面
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { IndexManagerModal } from "../ui/index-manager-modal.js";
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

    constructor(leaf: WorkspaceLeaf, apiClient: DeepPDFClient | null) {
        super(leaf);
        this.apiClient = apiClient;
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
                // 打开索引管理对话框
                new IndexManagerModal(this.app, this.apiClient!, () => {
                    // 索引创建成功后刷新列表
                    this.loadIndexes();
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
            const result: ListIndexesResult = await this.apiClient.listIndexes();

            if (!result || !Array.isArray(result.indexes) || result.indexes.length === 0) {
                this.indexManager.setIndexes([]);
                return;
            }

            // 更新索引列表，保持当前选中状态 (如果还在列表中)
            this.indexManager.setIndexes(result.indexes, this.currentIndexId || undefined);
            console.log(`[DeepPDF] 已加载 ${result.indexes.length} 个索引`);
        } catch (error) {
            handleNetworkError(error as Error, { context: 'loadIndexes' });
            this.indexManager.setIndexes([]);
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
                this.topNav.destroy();
                this.topNav = null;
            }

            // 清理消息列表
            if (this.messageList) {
                this.messageList.destroy();
                this.messageList = null;
            }

            // 清理聊天输入
            if (this.chatInput) {
                this.chatInput.destroy();
                this.chatInput = null;
            }

            // 清理轮询管理器
            if (this.taskPollingManager) {
                this.taskPollingManager.destroy();
                this.taskPollingManager = null;
            }

            // 清理任务卡片
            this.taskCards.clear();

            if (this.indexManager) {
                this.indexManager.destroy();
                this.indexManager = null;
            }
        } catch (error) {
            console.error('[DeepPDF] Error closing sidebar view:', error);
        }
    }
}
