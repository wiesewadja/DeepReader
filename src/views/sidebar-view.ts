/**
 * DeepPDF 侧边栏视图
 * ChatGPT 风格的对话界面
 */

import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { PDFFileSelectorModal, DocumentFileInfo } from "../ui/pdf-file-selector.js";
import { Drawer } from "../components/drawer/drawer.js";
import { TaskProgressCard } from "../components/task-progress-card.js";
import { TaskProgress, SearchFilters, IndexListItem, SessionInfo, ContextDoc } from "../types/index.js";
import { LIBRARY_VIEW_TYPE } from "./library-view.js";
import {
    createEmptyProgress,
    markChapterVisited,
    updateLastRead,
    getProgressPercent,
    loadProgress,
    saveProgress,
} from "../pageindex/reading-progress.js";
import type { ReadingProgress } from "../pageindex/reading-progress.js";
import { MessageList, GuidanceType, GUIDANCE_BUTTONS } from "../components/message-list/message-list.js";
import { ChatInput } from "../components/chat-input/chat-input.js";
import { MessageData, MessageRole, parseAgentContent, AgentThought, AgentToolCall, AIMessage } from "../components/message/message.js";
import { IndexManager } from "../components/index-manager/index-manager.js";
import { Icons, getIcon } from "../utils/icons.js";
import { handleError, handleNetworkError, handleAPIError } from "../utils/error-handler.js";
import { ContextManager } from "../services/context-manager.js";
import { ExcerptModal } from "../components/excerpt/excerpt-modal.js";
import { ConfirmModal } from "../components/confirm-modal.js";
import type { ExcerptContent, ExcerptMetadata } from "../types/excerpt.js";
import { ReadingTopbar } from "../components/reading-topbar/index.js";
import type { QuoteItem } from "../components/chat-input/chat-input.js";
import { uiLog as log, serviceLog, warn, error as logError } from "../utils/logger.js";
import { FrontendAgent } from "../agent/index.js";
import type { ToolContext } from "../agent/tools/types.js";
import {
    validateAndCorrectLinks,
} from "../agent/utils/link-validator.js";
import { MemoryStore } from "../agent/memory/store.js";
import { MemoryConsolidator } from "../agent/memory/consolidator.js";
import { DEFAULT_CONSOLIDATOR_CONFIG } from "../agent/memory/types.js";
import { MilestoneRecorder } from "../agent/memory/milestones.js";
import type { HumanizedProgress } from "../agent/ui/humanized-types.js";
import { SessionStore } from "../agent/session/index.js";
import { findBlockIdFromRange } from "../utils/block-utils.js";
import { TTSService, type TTSPlayState } from '../services/tts/tts-service.js';
import { StreamingVoicePlayer, type StreamingVoiceState } from '../services/tts/streaming-voice-player.js';
import { resolveRoleConfig } from '../config/providers.js';

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

/** 任务完成后显示延迟时间（毫秒） */
const TASK_COMPLETE_DISPLAY_MS = 2000;

export class SidebarView extends ItemView {
    private plugin: any; // 插件实例，用于访问设置
    private readingTopbar: ReadingTopbar | null = null;
    indexes: IndexListItem[] = [];  // 索引列表缓存
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
    private currentBookCoverUrl: string | null = null;  // 当前书籍封面 URL
    private currentBookAuthor: string | null = null;  // 当前书籍作者
    private isProcessing: boolean = false;
    private sessionId: string | null = null;  // 会话ID，用于多轮对话
    private streamController: AbortController | null = null;  // 流式请求控制器
    private isAiStreaming: boolean = false;  // AI 是否正在流式输出
    private crossBookMode: boolean = false;  // 跨书籍模式开关
    private searchFilters: SearchFilters = { booklists: [], tags: [] };  // 搜索过滤条件
    private useLLMTreeSearch: boolean = false;  // 深度思考模式开关（LLM 树搜索）

    // 上下文管理（章节辅助阅读）
    private contextManager: ContextManager | null = null;

    // 引用卡片管理
    private quotesContainer: HTMLElement | null = null;
    private quotes: import("../components/chat-input/chat-input.js").QuoteItem[] = [];

    // 前端 Agent
    private frontendAgent: FrontendAgent | null = null;

    // 阅读里程碑记录器
    private milestoneRecorder: MilestoneRecorder | null = null;

    // TTS 语音播报服务
    private ttsService: TTSService | null = null;

    // 流式语音播放器（用于语音消息）
    private streamingVoicePlayers: Map<string, StreamingVoicePlayer> = new Map();

    // 会话存储（JSONL 文件）
    private sessionStore: SessionStore | null = null;

    /** 当前索引的 Markdown 文件映射 (node_id -> file_path) */
    private currentMarkdownFiles: Record<string, string> = {};

    // 阅读进度追踪
    private readingProgress: ReadingProgress | null = null;
    private progressDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly PROGRESS_DEBOUNCE_MS = 3000;

    /** 当前书籍的全书摘要（由后端生成，用于 Agent 系统提示） */
    private currentDocDescription: string | null = null;

    /** 前端 Agent 对话历史 */
    private agentChatHistory: import("../agent/types.js").ChatMessage[] = [];

    /** 生成新的会话ID */
    private generateSessionId(): string {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 初始化前端 Agent
     * 使用 plugin 统一管理的 Agent 实例
     */
    private async initializeFrontendAgent(): Promise<void> {
        // 每次都从 plugin 获取最新的 Agent（支持设置切换后立即生效）
        const agent = await this.plugin.getFrontendAgent();
        this.frontendAgent = agent;
        log('[DeepPDF] FrontendAgent 初始化完成，可用 skills:', agent.listSkills());
    }

    /**
     * 初始化里程碑记录器
     */
    private async initializeMilestoneRecorder(): Promise<void> {
        if (this.milestoneRecorder) {
            return; // 已初始化
        }
        this.milestoneRecorder = new MilestoneRecorder(this.app);
        await this.milestoneRecorder.restoreFromHistory();

        log('[DeepPDF] MilestoneRecorder 初始化完成');
    }

/**
     * 检查后端连接状态
     * @deprecated Page Index 不需要后端连接
     */
    private async checkBackendConnection(): Promise<boolean> {
        return true;
    }

    /**
     * 导出 Markdown（Page Index 不需要）
     * @deprecated Markdown 已由 book-indexer 自动导出
     */
    async handleExportMarkdown(indexId: string) {
        new Notice('Markdown 文件已在索引时自动导出', 3000);
    }

    /**
     * 执行导出 Markdown 操作
     * @deprecated Page Index 不需要
     */
    private async doExportMarkdown(indexId: string, pdfName: string) {
        // No-op: Markdown 已由 book-indexer 自动导出
    }

    /**
     * 删除索引（本地实现）
     */
    async handleDeleteIndex(indexId: string) {
        try {
            const vaultPath = (this.app.vault.adapter as any).basePath;
            const fs = require('fs/promises');
            const path = require('path');

            // 1. 读取 book-meta.json 获取导出目录名
            const indexDir = path.join(vaultPath, '.pageindex', indexId);
            let exportName: string | null = null;
            try {
                const metaRaw = await fs.readFile(path.join(indexDir, 'book-meta.json'), 'utf-8');
                const meta = JSON.parse(metaRaw);
                exportName = meta.exportName || null;
            } catch { /* meta file may not exist */ }

            // 2. 删除索引数据
            await fs.rm(indexDir, { recursive: true, force: true });

            // 3. 删除本地导出文件夹和封面图片
            const index = this.indexes.find(idx => idx.id === indexId);
            if (index && exportName) {
                const exportDir = path.join(vaultPath, 'DeepReader', exportName);
                await fs.rm(exportDir, { recursive: true, force: true });

                const coversDir = path.join(vaultPath, 'DeepReader', 'covers');
                for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
                    const coverPath = path.join(coversDir, `${exportName}.${ext}`);
                    try { await fs.unlink(coverPath); } catch { /* not found */ }
                }
            } else if (index) {
                // Fallback: no exportName in meta, try displayName
                const displayName = this.getDisplayName(index.pdf_name);
                const exportDir = path.join(vaultPath, 'DeepReader', displayName);
                await fs.rm(exportDir, { recursive: true, force: true });

                const coversDir = path.join(vaultPath, 'DeepReader', 'covers');
                for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
                    const coverPath = path.join(coversDir, `${displayName}.${ext}`);
                    try { await fs.unlink(coverPath); } catch { /* not found */ }
                }
            }

            new Notice("索引已删除");
            
            await this.loadIndexes();
            
            if (this.currentIndexId === indexId) {
                this.currentIndexId = null;
                this.currentPdfName = null;

                // 重置右栏 UI 到欢迎页状态
                this.messageList?.clearMessages();
                this.messageList?.setCurrentPdfName('');
                this.readingTopbar?.setCurrentBook(null);
                this.readingTopbar?.setBookCover(null);
                this.currentDocDescription = null;
            }
        } catch (error) {
            console.error('[DeepPDF] 删除索引失败:', error);
            new Notice('删除索引失败');
        }
    }

    /**
     * 获取书籍显示名称（去除扩展名和副标题）
     */
    private getDisplayName(pdfName: string): string {
        let name = pdfName;
        if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
        if (name.toLowerCase().endsWith('.epub')) name = name.slice(0, -5);

        const separators = ['：', ':', '—', '-', '｜', '|'];
        for (const sep of separators) {
            if (name.includes(sep)) {
                name = name.split(sep)[0].trim();
                break;
            }
        }
        return name;
    }

    async refreshIndexes(): Promise<void> {
        await this.loadIndexes();
    }

    /**
     * 初始化会话存储
     */
    private async initializeSessionStore(): Promise<void> {
        if (this.sessionStore) {
            return; // 已初始化
        }
        this.sessionStore = new SessionStore(this.app);
        log('[DeepPDF] SessionStore 初始化完成');
    }

    /**
     * 获取标准化的书籍名称（用于 session key）
     * 统一后端 indexId 和本地书名的差异
     */
    private getNormalizedBookName(): string {
        if (!this.currentPdfName) {
            return this.currentIndexId || '';
        }
        // 移除扩展名
        return this.currentPdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
    }

    /** 开启新会话 */
    private async startNewSession(indexId: string) {
        // 取消任何正在进行的流式请求，避免旧回调更新新消息列表
        this.cancelActiveStream();

        this.sessionId = this.generateSessionId();

        // 清空前端 Agent 对话历史
        this.agentChatHistory = [];

        // 清空上下文管理器（清除旧书籍的文档）
        if (this.contextManager) {
            this.contextManager.clearAll();
            log('[DeepPDF] ContextManager cleared for new session');
        }

        // 在 SessionStore 中创建会话
        await this.initializeSessionStore();
        const effectiveIndexId = this.crossBookMode ? '__cross_book__' : indexId;
        await this.sessionStore!.create(this.sessionId, effectiveIndexId, this.crossBookMode);

        // 保存到设置：使用标准化书名作为 key（合并后端 indexId 和本地书名）
        if (!this.plugin.settings.savedSessions) {
            this.plugin.settings.savedSessions = {};
        }
        const sessionKey = this.crossBookMode ? indexId : this.getNormalizedBookName();
        this.plugin.settings.savedSessions[sessionKey] = this.sessionId;
        // 同时保留 indexId 映射（兼容旧逻辑）
        if (indexId !== sessionKey) {
            this.plugin.settings.savedSessions[indexId] = this.sessionId;
        }
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
        this.indexManager?.setCrossBookMode(true);
        this.plugin.settings.lastCrossBookMode = true;
        await this.plugin.saveSettings();

        // 清空当前 PDF 名称（跨书籍模式不显示快捷操作按钮）
        this.messageList?.setCurrentPdfName('');

        if (options.clearMessages !== false) {
            // 取消任何正在进行的流式请求，避免旧回调更新新消息列表
            this.cancelActiveStream();
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

    /**
     * 处理系统文件上传（已弃用 - Page Index 不需要上传）
     */
    private async handleSystemUpload(): Promise<void> {
        new Notice('请使用我的书库添加书籍', 3000);
    }


    /** 从 SessionStore 恢复历史记录到视图 */
    private async restoreFromSessionStore(sessionId: string): Promise<boolean> {
        if (!this.messageList) return false;

        await this.initializeSessionStore();
        const session = await this.sessionStore!.get(sessionId);

        if (!session || session.messages.length === 0) {
            log('[DeepPDF] SessionStore 中没有找到会话或会话为空:', sessionId);
            return false;
        }

        log('[DeepPDF] 从 SessionStore 恢复会话:', sessionId, '消息数:', session.messages.length, 'lastConsolidated:', session.lastConsolidated);

        // 1. 恢复消息到 UI
        // 过滤规则：
        // - user 消息：全部显示
        // - assistant 消息：只显示最终回复（没有 tool_calls 的），过滤掉中间过程消息
        // - 对于重试产生的多个 AI 回复，只保留最新的一个
        const allDisplayMessages = session.messages.filter(msg => {
            if (msg.role === 'user') return true;
            if (msg.role === 'assistant') {
                // 过滤掉带有 tool_calls 的中间消息（这些是工具调用前的思考/动作消息）
                // 只显示最终的 assistant 回复（没有 tool_calls 的）
                return !msg.tool_calls || msg.tool_calls.length === 0;
            }
            return false; // 过滤掉 tool 和其他角色消息
        });

        // 去重：对于连续的多个 assistant 消息，只保留最新的一个
        // 这是为了处理重试（regenerate）产生的重复 AI 回复
        const displayMessages: typeof allDisplayMessages = [];
        for (let i = 0; i < allDisplayMessages.length; i++) {
            const msg = allDisplayMessages[i];
            const nextMsg = allDisplayMessages[i + 1];

            // 如果当前是 assistant 消息，且下一个也是 assistant 消息，跳过当前的（保留最新的）
            if (msg.role === 'assistant' && nextMsg?.role === 'assistant') {
                log(`[DeepPDF] 跳过旧的 AI 回复（有更新的版本）`);
                continue;
            }
            displayMessages.push(msg);
        }

        // 将过滤后的消息添加到 UI
        let lastUserContent = '';
        
        displayMessages.forEach((msg, index) => {
            try {
                const msgData: any = {
                    id: `restored-${Date.now()}-${index}`,
                    role: msg.role as MessageRole,
                    content: msg.content || '',
                    timestamp: msg.timestamp || new Date().toISOString(),
                    isAgentMessage: msg.role === 'assistant'
                };
                if (msg.role === 'user') {
                    lastUserContent = msg.content || '';
                } else if (msg.role === 'assistant' && lastUserContent) {
                    msgData.question = lastUserContent;
                }
                // 只在有语音数据时才设置语音相关字段
                if ((msg as any).voiceAudio) {
                    msgData.voiceAudio = (msg as any).voiceAudio;
                    msgData.voiceDuration = (msg as any).voiceDuration;
                    msgData.letterState = (msg as any).letterState || 'sealed';
                    msgData.voiceState = 'ready';
                    msgData.enableVoiceReply = true;
                    log(`[DeepPDF] 恢复语音数据: duration=${(msg as any).voiceDuration}s`);
                }
                this.messageList!.addMessage(msgData);
            } catch (e) {
                warn(`[DeepPDF] Failed to restore message:`, e);
            }
        });

        // 如果最后一条消息是 user 消息（没有对应的 assistant 回复），添加空的 AI 占位气泡
        if (displayMessages.length > 0 && displayMessages[displayMessages.length - 1].role === 'user') {
            this.messageList!.addMessage({
                id: `restored-placeholder-${Date.now()}`,
                role: 'assistant' as MessageRole,
                content: '',
                timestamp: new Date().toISOString(),
                isAgentMessage: true
            });
            log('[DeepPDF] 添加空的 AI 占位气泡，方便用户重试');
        }

        // 2. 使用 getLLMHistory() 加载 LLM 上下文（只加载未整合消息）
        if (this.frontendAgent) {
            const llmHistory = await this.sessionStore!.getLLMHistory(sessionId);
            const systemPrompt = await this.frontendAgent.getSystemPromptAsync();
            this.agentChatHistory = [
                { role: 'system', content: systemPrompt },
                ...llmHistory
            ];
            log('[DeepPDF] 恢复 agentChatHistory (LLM), 未整合消息数:', llmHistory.length, '总历史数:', session.messages.length);
        }

        return true;
    }

    /** 保存当前对话到 SessionStore（JSONL 文件） */
    private async saveToCache() {
        log('[DeepPDF] saveToCache called, sessionId:', this.sessionId);
        if (!this.sessionId) {
            log('[DeepPDF] saveToCache early return: no sessionId');
            return;
        }

        // 确保 SessionStore 已初始化
        await this.initializeSessionStore();

        const effectiveIndexId = this.crossBookMode
            ? '__cross_book__'
            : this.currentIndexId;

        if (!effectiveIndexId) {
            log('[DeepPDF] saveToCache early return: no effectiveIndexId');
            return;
        }

        // 1. 从 MessageList 获取完整消息数据（包括语音数据）
        // 这样可以确保语音数据被持久化
        const RUNTIME_CONTEXT_PATTERN = /^\[运行时上下文[^\]]*\]\n[^\n]*(?:\n[^\n]*)*\n\n/;
        const SYSTEM_NOTE_PATTERN = /<system_note>[\s\S]*?<\/system_note>\n\n/g;
        
        // 优先从 MessageList 获取消息（包含语音数据）
        // MessageList 中的消息只有 user 和 assistant 角色，不会有 system
        let messagesToSave: any[] = [];
        if (this.messageList) {
            const uiMessages = this.messageList.getMessagesData();
            messagesToSave = uiMessages
                .filter(m =>
                    m.content &&
                    !m.content.includes("已切换到书籍") &&
                    m.content !== "📖 开始翻阅..." &&
                    m.content !== "🔍 正在跨书籍查阅..."
                )
                .map(m => {
                    // 剥离用户消息中的运行时上下文和 system_note
                    if (m.role === 'user' && m.content) {
                        let content = m.content;
                        content = content.replace(SYSTEM_NOTE_PATTERN, '');
                        content = content.replace(RUNTIME_CONTEXT_PATTERN, '');
                        return { ...m, content };
                    }
                    return m;
                });
        }

        // 如果 MessageList 没有消息，回退到 agentChatHistory
        if (messagesToSave.length === 0) {
            messagesToSave = this.agentChatHistory
                .filter(m =>
                    m.role !== 'system' &&
                    m.content &&
                    !m.content.includes("已切换到书籍") &&
                    m.content !== "📖 开始翻阅..." &&
                    m.content !== "🔍 正在跨书籍查阅..."
                )
                .map(m => {
                    if (m.role === 'user' && m.content) {
                        let content = m.content;
                        content = content.replace(SYSTEM_NOTE_PATTERN, '');
                        content = content.replace(RUNTIME_CONTEXT_PATTERN, '');
                        return { ...m, content };
                    }
                    return m;
                });
        }

        log('[DeepPDF] saveToCache messagesToSave count:', messagesToSave.length);
        if (messagesToSave.length === 0) {
            log('[DeepPDF] saveToCache early return: no messages to save');
            return;
        }

        // 2. 获取会话
        let session = await this.sessionStore!.get(this.sessionId);
        if (!session) {
            // 会话不存在，创建新的
            session = await this.sessionStore!.create(
                this.sessionId,
                effectiveIndexId,
                this.crossBookMode
            );
        }

        // 3. 只追加新消息（增量保存，使用内容哈希去重）
        const existingHashes = new Set(
            session.messages.map(m => `${m.role}:${m.content?.slice(0, 100)}`)
        );

        let savedCount = 0;
        for (const msg of messagesToSave) {
            const msgHash = `${msg.role}:${msg.content?.slice(0, 100)}`;
            if (!existingHashes.has(msgHash)) {
                await this.sessionStore!.appendMessage(this.sessionId, msg);
                existingHashes.add(msgHash); // 防止同一批次重复
                savedCount++;
            }
        }

        if (savedCount > 0) {
            log(`[DeepPDF] 保存 ${savedCount} 条新消息到 SessionStore`);
        }

        // 4. 如果是跨书籍模式，保存会话ID
        if (this.crossBookMode) {
            this.plugin.settings.lastCrossBookSessionId = this.sessionId;
            await this.plugin.saveSettings();
            log('[DeepPDF] 保存跨书籍会话ID:', this.sessionId);
        }
    }

    /**
     * 检查并执行记忆整合（如果需要）
     *
     * 当对话 token 数超过阈值时，自动将旧消息整合到 MEMORY.md 和 HISTORY.md
     */
    private async maybeConsolidateMemory(): Promise<void> {
        try {
            // 确保 sessionId 和 SessionStore 存在
            if (!this.sessionId || !this.sessionStore) {
                return;
            }

            const session = await this.sessionStore.get(this.sessionId);
            if (!session || session.messages.length === 0) {
                return;
            }

            const unconsolidated = session.messages.slice(session.lastConsolidated);

            // 简单的 token 估算
            const estimateTokens = (msgs: any[]): number => {
                let totalChars = 0;
                for (const msg of msgs) {
                    if (typeof msg.content === 'string') {
                        totalChars += msg.content.length;
                    }
                }
                return Math.round(totalChars / 2);
            };

            const currentTokens = estimateTokens(unconsolidated);

            // 🔍 调试日志：每次都输出 token 状态
            log(`[DeepPDF] Memory 状态检查: ${currentTokens} tokens (阈值: ${DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold}), 未整合消息数: ${unconsolidated.length}, lastConsolidated: ${session.lastConsolidated}`);

            // 检查是否需要整合
            if (currentTokens < DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold) {
                log(`[DeepPDF] Memory 未触发整合: ${currentTokens} < ${DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold}`);
                return;
            }

            log(`[DeepPDF] ✅ Memory 整合触发: ${currentTokens} tokens >= ${DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold}`);

            // 获取会话锁（防止并发整合）
            await this.sessionStore.acquireLock(this.sessionId);

            try {
                // 创建整合器
                const store = new MemoryStore(this.app);
                const consolidator = new MemoryConsolidator(
                    store,
                    this.frontendAgent?.getLLMClient() as any,
                    DEFAULT_CONSOLIDATOR_CONFIG
                );

                // 执行整合
                const newLastConsolidated = await consolidator.maybeConsolidate(
                    session.messages,
                    session.lastConsolidated,
                    async (newIndex) => {
                        // 更新 SessionStore 中的 lastConsolidated
                        await this.sessionStore!.updateLastConsolidated(this.sessionId!, newIndex);
                        log(`[DeepPDF] lastConsolidated 更新为 ${newIndex}`);
                    }
                );

                if (newLastConsolidated > session.lastConsolidated) {
                    log(`[DeepPDF] 记忆整合完成: ${session.lastConsolidated} -> ${newLastConsolidated}`);

                    // 关键：整合后刷新 agentChatHistory（只保留未整合消息）
                    const newLLMHistory = await this.sessionStore!.getLLMHistory(this.sessionId!);
                    if (this.frontendAgent && newLLMHistory.length >= 0) {
                        const systemPrompt = await this.frontendAgent.getSystemPromptAsync();
                        this.agentChatHistory = [
                            { role: 'system', content: systemPrompt },
                            ...newLLMHistory
                        ];
                        log(`[DeepPDF] agentChatHistory 已刷新，当前消息数: ${this.agentChatHistory.length}`);
                    }
                }
            } finally {
                this.sessionStore.releaseLock(this.sessionId);
            }
        } catch (err) {
            logError('[DeepPDF] 记忆整合失败:', err);
        }
    }

    constructor(leaf: WorkspaceLeaf, plugin: any) {
        super(leaf);
        this.plugin = plugin;
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
     * 打开书库（改为 Tab 视图）
     */
    private async openLibrary(): Promise<void> {
        await this.loadIndexes();

        // 检查是否已有书库视图
        const existingLeaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
        if (existingLeaves.length > 0) {
            // 聚焦现有视图
            this.app.workspace.revealLeaf(existingLeaves[0]);
            return;
        }

        // 在主面板打开书库视图
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({
            type: LIBRARY_VIEW_TYPE,
            state: { indexes: this.indexes, selectedIndexId: this.currentIndexId }
        });
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
     *
     * 从本地 Obsidian vault 加载 (DeepReader/covers/{bookName}.png)
     */
    private async loadBookCover(bookName: string, indexId?: string): Promise<void> {
        // 从本地 Obsidian vault 加载，尝试多种图片格式
        const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
        let coverFile: any = null;
        let foundPath: string = '';

        for (const ext of extensions) {
            const coverPath = `DeepReader/covers/${bookName}.${ext}`;
            const file = this.app.vault.getAbstractFileByPath(coverPath);
            if (file && file instanceof TFile) {
                coverFile = file;
                foundPath = coverPath;
                break;
            }
        }

        if (coverFile) {
            const coverUrl = this.app.vault.getResourcePath(coverFile as any);
            this.currentBookCoverUrl = coverUrl;  // 存储封面 URL
            this.readingTopbar?.setBookCover(coverUrl);
            log(`[DeepPDF] 从本地加载书籍封面: ${foundPath}`);
            return;
        }

        // 封面不存在，使用默认图标
        this.currentBookCoverUrl = null;  // 清空封面 URL
        this.readingTopbar?.setBookCover(null);
        log(`[DeepPDF] 书籍封面不存在: DeepReader/covers/${bookName}.{png,jpg,...}`);
    }

    /**
     * 通过 indexId 扫描 Vault 找到对应书籍的实际目录名和元数据
     * 用户可能重命名了目录，因此不能仅依赖静态的 book-meta.json
     */
    /**
     * 同步顶栏书名到最新状态（用户可能在书库中修改了书名/目录名）
     */
    private async syncTopbarBookName(): Promise<void> {
        if (!this.currentIndexId) return;
        const vaultDir = await this.findBookDirectoryByIndexId(this.currentIndexId);
        if (!vaultDir) return;

        const index = this.indexes.find(i => i.id === this.currentIndexId);
        const displayName = vaultDir.bookName || vaultDir.dirName || index?.pdf_name || this.currentPdfName || '';

        // 更新内部标识（使用目录名作为标识）
        if (this.currentPdfName !== vaultDir.dirName) {
            this.currentPdfName = vaultDir.dirName;
            this.messageList?.setCurrentPdfName(displayName);
        }

        // 更新顶栏显示
        const author = vaultDir.author || index?.author;
        this.readingTopbar?.setCurrentBook(displayName, author);
        log('[DeepPDF] syncTopbarBookName:', displayName);
    }

    private async findBookDirectoryByIndexId(indexId: string): Promise<{ dirName: string; author?: string; bookName?: string } | null> {
        const allFiles = this.app.vault.getMarkdownFiles();

        for (const f of allFiles) {
            if (!f.path.startsWith('DeepReader/')) continue;
            if (!f.path.includes('MOC')) continue;

            const cache = this.app.metadataCache.getFileCache(f);
            if (cache?.frontmatter?.index_id === indexId || cache?.frontmatter?.pdf_index_id === indexId) {
                // 找到 MOC 文件，提取目录名：DeepReader/{dirName}/MOC.md
                const parts = f.path.split('/');
                if (parts.length >= 3) {
                    const dirName = parts[1];
                    log(`[DeepPDF] findBookDirectoryByIndexId: 找到目录 "${dirName}" (indexId=${indexId})`);
                    return {
                        dirName,
                        author: cache.frontmatter?.author,
                        bookName: cache.frontmatter?.book_name || cache.frontmatter?.title,
                    };
                }
            }
        }
        return null;
    }

    /**
     * 选择索引（从弹窗中调用或自动切换）
     * @param indexId 索引 ID
     */
    public async selectIndex(indexId: string): Promise<void> {
        // 如果已经选中了同一个索引，跳过以避免闪烁
        // 但需要刷新顶栏显示名（用户可能在书库中修改了书名/目录名）
        if (this.currentIndexId === indexId) {
            log(`[DeepPDF] selectIndex: 已选中索引 ${indexId}，跳过`);
            // 即使跳过切换，也要确保阅读进度已初始化
            if (!this.readingProgress) {
                await this.initReadingProgress(indexId);
            }
            // 同步最新的书名到 topbar（用户可能重命名了书籍）
            await this.syncTopbarBookName();
            return;
        }

        log(`[DeepPDF] selectIndex triggered: ${indexId}`);

        // 切换书籍前，flush 旧书籍的阅读进度
        await this.flushProgressSave();
        this.currentIndexId = indexId;
        this.plugin.settings.lastSelectedIndexId = indexId;
        await this.plugin.saveSettings();

        // 更新顶栏显示 - 使用 this.indexes 而不是 indexManager
        const index = this.indexes.find(i => i.id === indexId);

        // 确定显示名称：优先从索引获取，否则从 indexId 推断
        let displayName: string;
        let author: string | undefined;
        let coverName: string | undefined;

        // 扫描 Vault 获取实际目录名（用户可能重命名了目录）
        const vaultDir = await this.findBookDirectoryByIndexId(indexId);

        if (index) {
            // 从后端索引获取信息
            const previousBook = this.currentPdfName;
            displayName = index.pdf_name;
            if (displayName.toLowerCase().endsWith('.pdf')) {
                displayName = displayName.slice(0, -4);
            }
            if (displayName.toLowerCase().endsWith('.epub')) {
                displayName = displayName.slice(0, -5);
            }

            // 读取 exportName（精简后的标题，用于封面和 wiki link）和 author
            let exportName: string | undefined;
            let metaAuthor: string | undefined;
            try {
                const vaultPath = (this.app.vault.adapter as any).basePath;
                const fs = require('fs/promises');
                const metaRaw = await fs.readFile(`${vaultPath}/.pageindex/${indexId}/book-meta.json`, 'utf-8');
                const meta = JSON.parse(metaRaw);
                exportName = meta.exportName || undefined;
                metaAuthor = meta.author || undefined;
                coverName = exportName;
            } catch { /* ignore */ }

            // 优先使用 Vault 中的实际目录名，回退到 book-meta.json 的 exportName
            const simplifiedName = vaultDir?.dirName || exportName || this.getDisplayName(displayName);
            this.currentPdfName = simplifiedName;

            // 顶栏显示也使用实际目录名（精简的书名）
            displayName = vaultDir?.bookName || simplifiedName;

            // 记录书籍切换里程碑
            await this.initializeMilestoneRecorder();
            if (this.milestoneRecorder && previousBook !== displayName) {
                await this.milestoneRecorder.handleBookSwitch(displayName);
            }

            // 获取作者信息：优先使用 Vault MOC 的 author，回退到 book-meta.json 和 index
            author = vaultDir?.author || metaAuthor || index.author;
            log(`[DeepPDF] 作者信息: vaultDir.author="${vaultDir?.author}", book-meta.author="${metaAuthor}", index.author="${index.author}"`);

            // 加载书籍封面（优先使用 exportName 匹配封面文件）
            this.loadBookCover(coverName || displayName, indexId);
        } else {
            // index 不在 indexes 列表中（可能 loadIndexes 还没完成）
            // 优先使用 Vault 扫描结果，回退到 book-meta.json
            let exportName: string | undefined;
            let metaAuthor: string | undefined;
            try {
                const vaultPath = (this.app.vault.adapter as any).basePath;
                const fs = require('fs/promises');
                const metaRaw = await fs.readFile(`${vaultPath}/.pageindex/${indexId}/book-meta.json`, 'utf-8');
                const meta = JSON.parse(metaRaw);
                exportName = meta.exportName || undefined;
                metaAuthor = meta.author || undefined;
            } catch { /* ignore */ }

            const resolvedName = vaultDir?.dirName || exportName;
            if (resolvedName) {
                displayName = vaultDir?.bookName || resolvedName;
                this.currentPdfName = resolvedName;
                author = vaultDir?.author || metaAuthor;
                log(`[DeepPDF] 从 book-meta.json/vault 恢复书名: "${resolvedName}"`);
                this.loadBookCover(resolvedName, indexId);
            } else {
                // book-meta.json 也不存在且 Vault 中也找不到，无法恢复，放弃设置
                log(`[DeepPDF] index ${indexId} 不在列表中且无 book-meta.json/vault 目录，跳过`);
                return;
            }
        }

        // 尝试从本地元数据获取作者信息（如果还没有）
        if (!author) {
            // 从当前打开的章节文件 frontmatter 读取 author 字段
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const cache = this.app.metadataCache.getFileCache(activeFile);
                const fmAuthor = cache?.frontmatter?.author;
                if (fmAuthor && typeof fmAuthor === 'string') {
                    author = fmAuthor;
                    log(`[DeepPDF] 从章节文件 frontmatter 获取作者: "${author}"`);
                }
            }
            if (!author) {
                log(`[DeepPDF] 作者信息未找到`);
            }
        }
        log(`[DeepPDF] 最终使用的作者: author="${author}"`);

        // 存储当前书籍作者（用于消息传递）
        this.currentBookAuthor = author || null;

        // 更新 UI
        this.messageList?.setCurrentPdfName(displayName);
        this.readingTopbar?.setCurrentBook(displayName, author);

        // 初始化阅读进度
        await this.initReadingProgress(indexId);

        // 自动跳转到上次阅读的章节
        this.navigateToLastReadChapter();

        // === 从本地书籍笔记读取全书摘要 ===
        try {
            // 书籍笔记路径：DeepReader/{exportName}/{exportName}.md
            const bookName = coverName || this.getDisplayName(this.currentPdfName || '');
            const bookNotePath = `DeepReader/${bookName}/${bookName}.md`;
            const bookNoteFile = this.app.vault.getAbstractFileByPath(bookNotePath);

            if (bookNoteFile instanceof TFile) {
                const content = await this.app.vault.read(bookNoteFile);
                // 提取全书摘要部分（## 📝 全书摘要）
                const descMatch = content.match(/## 📝 全书摘要\s*\n\n([\s\S]*?)(?=\n## |$)/);
                if (descMatch && descMatch[1]) {
                    this.currentDocDescription = descMatch[1].trim();
                    log(`[DeepPDF] 从本地笔记读取到全书摘要，长度: ${this.currentDocDescription.length}`);
                } else {
                    this.currentDocDescription = null;
                    log.debug('[DeepPDF] 本地笔记没有全书摘要部分');
                }
            } else {
                this.currentDocDescription = null;
                log.debug('[DeepPDF] 本地笔记不存在，可能尚未导出');
            }
        } catch (e) {
            logError('[DeepPDF] 读取本地笔记失败:', e);
            this.currentDocDescription = null;
        }

        // 注意：章节下载逻辑已移至 library-modal.ts
        // 这里不再重复触发导出，避免出现两次 notice

        // 取消任何正在进行的流式请求，避免旧回调更新新消息列表
        this.cancelActiveStream();

        // 清空消息
        this.messageList?.clear();

        // 尝试恢复会话：优先使用标准化书名查找，兼容旧的 indexId
        const savedSessions = this.plugin.settings.savedSessions || {};
        const normalizedBookName = this.getNormalizedBookName();
        let savedSessionId = savedSessions[normalizedBookName] || savedSessions[indexId];

        if (savedSessionId) {
            try {
                // 先校验会话是否属于当前书籍（在恢复到 UI 之前）
                await this.initializeSessionStore();
                const session = await this.sessionStore!.get(savedSessionId);

                if (session) {
                    // 标准化 session.indexId 以便比较（移除扩展名）
                    const sessionBookName = session.indexId
                        .replace(/\.pdf$/i, '')
                        .replace(/\.epub$/i, '');

                    // 判断会话是否属于当前书籍
                    // 匹配条件：indexId 完全匹配，或标准化后的书名匹配
                    const isMatch = session.indexId === indexId ||
                        session.indexId === normalizedBookName ||
                        sessionBookName === normalizedBookName ||
                        sessionBookName === indexId;

                    if (!isMatch) {
                        log(`[DeepPDF] 会话不匹配: session.indexId="${session.indexId}", 当前 indexId="${indexId}", normalizedBookName="${normalizedBookName}"`);
                        // 会话不匹配，创建新会话
                        this.startNewSession(indexId);
                        return;
                    }

                    // 会话匹配，恢复到 UI
                    this.sessionId = savedSessionId;
                    const restored = await this.restoreFromSessionStore(savedSessionId);
                    if (restored) {
                        log('[DeepPDF] 从 SessionStore 恢复会话成功，会话匹配');
                        return;
                    }
                }

                // 没有找到会话或会话为空，创建新会话
                this.startNewSession(indexId);
            } catch (e) {
                logError(`[DeepPDF] 恢复会话失败:`, e);
                this.startNewSession(indexId);
            }
        } else {
            this.startNewSession(indexId);
        }
    }

    /**
     * 自动同步当前章节到上下文
     * 
     * 默认行为：
     * - 首次打开章节时，自动加载到上下文
     * - 切换章节时，自动更新为新章节
     * - 只有用户手动点击按钮才能卸载文档
     */
    private async autoSyncCurrentChapter(): Promise<void> {
        if (!this.contextManager || !this.currentPdfName) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return;

        // 检查当前文件是否属于正在阅读的书籍
        const bookPath = `DeepReader/${this.currentPdfName}/`;
        if (!activeFile.path.startsWith(bookPath)) return;

        // 排除书籍主文件（只加载章节文件）
        if (activeFile.path === `${bookPath}${this.currentPdfName}.md`) return;

        // 检查当前章节是否已在上下文中
        if (this.contextManager.hasDocument(activeFile.path)) return;

        // 找到当前书籍的章节文档（source === 'current' 的文档）
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

    // ============ 阅读进度追踪 ============

    /**
     * 初始化阅读进度（加载或创建）
     * 可安全多次调用（幂等）
     */
    private async initReadingProgress(indexId: string): Promise<void> {
        if (this.readingProgress?.bookId === indexId) return;

        try {
            const vaultPath = (this.app.vault.adapter as any).basePath;
            const loaded = await loadProgress(vaultPath, indexId);
            this.readingProgress = loaded || createEmptyProgress(indexId);
            log(`[DeepPDF] 阅读进度已初始化: ${indexId}, 已访问 ${Object.keys(this.readingProgress.chapters).filter(k => this.readingProgress!.chapters[k].visited).length} 章`);

            // 更新 topbar 进度显示
            this.updateProgressUI();
        } catch (e) {
            logError('[DeepPDF] 初始化阅读进度失败:', e);
            this.readingProgress = createEmptyProgress(indexId);
        }
    }

    /**
     * 追踪当前阅读的章节
     * 在 file-open 和 active-leaf-change 时调用
     */
    private async trackReadingProgress(): Promise<void> {
        if (!this.readingProgress || !this.currentPdfName) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return;

        // 只有关联 tab（第一个被激活阅读模式的分页 tab）才更新进度
        const rms = this.plugin.readingModeService;
        if (rms) {
            const activeLeaf = this.app.workspace.activeLeaf;
            const activatedContainer = rms.getActiveContainerEl();
            if (activatedContainer && activeLeaf?.view?.containerEl !== activatedContainer) {
                return; // 非关联 tab，不更新进度
            }
        }

        // 检查当前文件是否属于正在阅读的书籍
        const bookPath = `DeepReader/${this.currentPdfName}/`;
        if (!activeFile.path.startsWith(bookPath)) return;

        // 排除书籍主文件
        if (activeFile.path === `${bookPath}${this.currentPdfName}.md`) return;

        // 获取章节标识：优先 node_id，回退到文件 basename
        const cache = this.app.metadataCache.getFileCache(activeFile);
        const rawNodeId = cache?.frontmatter?.node_id;
        const chapterId = rawNodeId ? String(rawNodeId) : activeFile.basename;
        if (!chapterId) return;

        // 标记章节已访问
        const wasVisited = this.readingProgress.chapters[chapterId]?.visited;
        this.readingProgress = markChapterVisited(this.readingProgress, chapterId);
        this.readingProgress = updateLastRead(this.readingProgress, chapterId);

        if (!wasVisited) {
            log(`[DeepPDF] 章节已标记为已读: ${chapterId} (${activeFile.basename})`);
        }

        // 更新 topbar 进度显示
        this.updateProgressUI();

        // 防抖保存
        this.debouncedSaveProgress();
    }

    /**
     * 更新顶栏进度 UI
     */
    private updateProgressUI(): void {
        if (!this.readingProgress || !this.currentPdfName) return;

        const totalChapters = this.getTotalChapters();
        const percent = getProgressPercent(this.readingProgress, totalChapters);
        this.readingTopbar?.setProgress(percent);
        log(`[DeepPDF] 进度更新: ${percent}% (${Object.values(this.readingProgress.chapters).filter(c => c.visited).length}/${totalChapters})`);
    }

    /**
     * 获取当前书籍的总章节数
     */
    private getTotalChapters(): number {
        if (!this.currentPdfName) return 0;

        // 从索引列表中获取
        const index = this.indexes.find(i => i.id === this.currentIndexId);
        if (index && index.node_count > 0) {
            return index.node_count;
        }

        // 回退：统计 DeepReader/{bookName}/ 下的 md 文件数量
        try {
            const bookFolder = this.app.vault.getAbstractFileByPath(`DeepReader/${this.currentPdfName}`);
            if (bookFolder && 'children' in bookFolder) {
                const children = (bookFolder as any).children as any[];
                return children.filter((f: any) =>
                    f instanceof TFile && f.extension === 'md' &&
                    f.path !== `DeepReader/${this.currentPdfName}/${this.currentPdfName}.md`
                ).length;
            }
        } catch {
            // ignore
        }
        return 0;
    }

    /**
     * 自动跳转到上次阅读的章节
     */
    private navigateToLastReadChapter(): void {
        if (!this.currentPdfName) return;

        const bookPath = `DeepReader/${this.currentPdfName}/`;

        // 检查当前是否已经打开了该书籍的某个章节文件（非 MOC）
        // 如果用户已手动从 MOC 页选择了章节，不应再自动导航
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path.startsWith(bookPath)) {
            const cache = this.app.metadataCache.getFileCache(activeFile);
            const isMoc = cache?.frontmatter?.type === 'pdf-moc' || cache?.frontmatter?.type === 'epub-moc';
            if (!isMoc) {
                // 当前已打开章节文件，直接激活阅读模式即可
                if (this.plugin.readingModeService?.getAutoEnable()) {
                    this.plugin.readingModeService.activate(activeFile);
                }
                return;
            }
        }

        // 有阅读记录：跳转到上次阅读的章节
        if (this.readingProgress?.lastReadChapterId) {
            const chapterId = this.readingProgress.lastReadChapterId;

            // 检查当前文件是否已经是目标章节
            if (activeFile && activeFile.path.startsWith(bookPath)) {
                const cache = this.app.metadataCache.getFileCache(activeFile);
                const currentNodeId = cache?.frontmatter?.node_id;
                if (String(currentNodeId) === chapterId || activeFile.basename === chapterId) {
                    if (this.plugin.readingModeService?.getAutoEnable()) {
                        this.plugin.readingModeService.activate(activeFile);
                    }
                    return;
                }
            }

            // 通过 node_id 或 basename 查找章节文件
            const files = this.app.vault.getMarkdownFiles();
            let targetFile: TFile | null = null;

            for (const f of files) {
                if (!f.path.startsWith(bookPath)) continue;
                if (f.path === `${bookPath}${this.currentPdfName}.md`) continue;
                const cache = this.app.metadataCache.getFileCache(f);
                if (cache?.frontmatter?.node_id !== undefined && String(cache.frontmatter.node_id) === chapterId) {
                    targetFile = f;
                    break;
                }
            }

            if (!targetFile) {
                const matchPath = `${bookPath}${chapterId}.md`;
                const file = this.app.vault.getAbstractFileByPath(matchPath);
                if (file instanceof TFile) {
                    targetFile = file;
                }
            }

            if (targetFile) {
                log(`[DeepPDF] 自动跳转到上次阅读章节: ${targetFile.path}`);
                this.app.workspace.getLeaf(false).openFile(targetFile);

                setTimeout(() => {
                    const rms = this.plugin.readingModeService;
                    if (rms?.getAutoEnable() && !rms.getCurrentFile()) {
                        const file = this.app.workspace.getActiveFile();
                        if (file && rms.isChapterFile(file)) {
                            rms.activate(file);
                        }
                    }
                }, 300);
                return;
            }
        }

        // 无阅读记录或找不到章节：打开这本书的 MOC 文档
        const files = this.app.vault.getMarkdownFiles();
        const mocFile = files.find(f => {
            if (!f.path.startsWith(bookPath)) return false;
            if (!f.path.includes('MOC')) return false;
            const cache = this.app.metadataCache.getFileCache(f);
            return cache?.frontmatter?.index_id === this.readingProgress?.bookId
                || cache?.frontmatter?.pdf_index_id === this.currentIndexId;
        });

        if (mocFile) {
            log(`[DeepPDF] 无阅读记录，打开 MOC: ${mocFile.path}`);
            this.app.workspace.getLeaf(false).openFile(mocFile);
        }
    }

    /**
     * 防抖保存阅读进度
     */
    private debouncedSaveProgress(): void {
        if (this.progressDebounceTimer) {
            clearTimeout(this.progressDebounceTimer);
        }
        this.progressDebounceTimer = setTimeout(() => {
            this.flushProgressSave();
        }, this.PROGRESS_DEBOUNCE_MS);
    }

    /**
     * 立即保存阅读进度到磁盘
     */
    private async flushProgressSave(): Promise<void> {
        if (this.progressDebounceTimer) {
            clearTimeout(this.progressDebounceTimer);
            this.progressDebounceTimer = null;
        }

        if (!this.readingProgress) return;

        try {
            const vaultPath = (this.app.vault.adapter as any).basePath;
            await saveProgress(vaultPath, this.readingProgress);

            // 同步进度到 MOC frontmatter（供 Obsidian Base 读取）
            await this.syncProgressToMoc();
        } catch (e) {
            logError('[DeepPDF] 保存阅读进度失败:', e);
        }
    }

    /**
     * 同步阅读进度到 MOC 文件的 frontmatter（status + progress 字段）
     * 供 Obsidian Base/Database 视图读取
     */
    private async syncProgressToMoc(): Promise<void> {
        if (!this.readingProgress || !this.currentIndexId) return;

        try {
            const bookId = this.readingProgress.bookId;
            // 使用和顶栏一样的算法：visited / index.node_count
            const totalChapters = this.getTotalChapters();
            const percent = getProgressPercent(this.readingProgress, totalChapters);

            // 找到对应 MOC 文件
            const files = this.app.vault.getMarkdownFiles();
            const mocFile = files.find(f => {
                if (!f.path.includes('DeepReader/')) return false;
                if (!f.path.includes('MOC')) return false;
                const cache = this.app.metadataCache.getFileCache(f);
                return cache?.frontmatter?.index_id === bookId;
            });

            if (!mocFile) return;

            // 更新 frontmatter（仅 progress 字段）
            await this.app.fileManager.processFrontMatter(mocFile, (fm) => {
                fm.progress = percent;
            });

            log(`[DeepPDF] MOC 进度已同步: ${percent}%`);
        } catch (e) {
            logError('[DeepPDF] MOC 进度同步失败:', e);
        }
    }

    /**
     * 获取当前选中的索引 ID
     */
    public getCurrentIndexId(): string | null {
        return this.currentIndexId;
    }

    /**
     * 清除顶栏书名显示（阅读模式停用时调用）
     * 不重置 currentPdfName/currentIndexId，保持用户通过书库选中的书籍
     */
    public clearTopbarDisplay(): void {
        this.readingTopbar?.setCurrentBook(null);
        this.readingTopbar?.setBookCover(null);
    }

    /**
     * 清除所有书籍信息（删除索引时调用）
     */
    public clearBookInfo(): void {
        this.currentIndexId = null;
        this.currentPdfName = null;
        this.currentBookCoverUrl = null;
        this.currentBookAuthor = null;
        this.readingTopbar?.setCurrentBook(null);
        this.readingTopbar?.setBookCover(null);
    }

    /**
     * 通过书名选择索引（自动切换时使用）
     */
    public async selectBookByName(bookName: string): Promise<void> {
        log('[DeepPDF] Selecting book by name:', bookName);

        // 标准化书名（移除扩展名）
        const normalizedBookName = bookName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');

        // 检查当前书籍是否已经是目标书籍（基于书名比较）
        const currentBookName = this.getNormalizedBookName();
        if (currentBookName === normalizedBookName) {
            log('[DeepPDF] Already on the same book (by name):', normalizedBookName);
            // 即使同一本书，也要确保进度已初始化
            if (!this.readingProgress && this.currentIndexId) {
                await this.initReadingProgress(this.currentIndexId);
            }
            return;
        }

        // 在已加载的索引列表中查找
        const index = this.indexes.find(idx => {
            const idxName = idx.pdf_name.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
            // 精确匹配或双向前缀匹配（处理 sanitize 截断的情况）
            return idxName === normalizedBookName ||
                   idx.pdf_name === bookName ||
                   idxName.startsWith(normalizedBookName) ||
                   normalizedBookName.startsWith(idxName);
        });

        if (index) {
            log('[DeepPDF] Found index by name:', index.id);
            await this.selectIndex(index.id);
        } else {
            // 索引列表可能未加载，先尝试重新加载
            log('[DeepPDF] Book not found in index list, reloading indexes...');
            await this.loadIndexes();

            const retryIndex = this.indexes.find(idx => {
                const idxName = idx.pdf_name.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
                return idxName === normalizedBookName ||
                       idx.pdf_name === bookName ||
                       idxName.startsWith(normalizedBookName) ||
                       normalizedBookName.startsWith(idxName);
            });

            if (retryIndex) {
                log('[DeepPDF] Found index after reload:', retryIndex.id);
                await this.selectIndex(retryIndex.id);
            } else {
                // 绝不能用书名作为 indexId（bookId 是 SHA-256 哈希，不是书名）
                log('[DeepPDF] Book not found in index list after reload, skipping:', normalizedBookName);
            }
        }
    }

    /**
     * 创建阅读顶栏 (简化版)
     */
    private createReadingTopbar(container: HTMLElement) {
        this.readingTopbar = new ReadingTopbar({
            onOpenLibrary: () => this.openLibrary(),
            onOpenSettings: () => {
                // 打开设置并定位到 DeepPDF 插件
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById('deepreader');
                }
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

        // 设置聚焦模式变化监听（已移除）
        // this.setupFocusModeListener();

        // 直接渲染主 UI（不阻塞）
        this.renderMainUI(container);

        // 异步检查连接状态并更新指示器
        this.checkConnectionAndRender();
    }

    /**
     * 检查后端连接状态并更新状态指示器
     * 注意：不再渲染界面，Page Index 不需要后端连接
     */
    private async checkConnectionAndRender(): Promise<void> {
        // Page Index 不需要后端连接
    }

    /**
     * 渲染主界面
     */
    private async renderMainUI(container: HTMLElement): Promise<void> {
        container.empty();

        // 初始化上下文管理器（章节辅助阅读）
        this.contextManager = new ContextManager({
            app: this.app,
            onContextChange: (docs: Map<string, import("../services/context-manager.js").LoadedDocument>) => {
                // 同步文档内容到 currentMarkdownFiles 供 Agent 搜索使用
                const files: Record<string, string> = {};
                for (const [path, doc] of docs) {
                    files[path] = doc.content;
                }
                this.currentMarkdownFiles = files;

                // 更新加载按钮的激活状态（检查当前活跃文件是否已加载）
                const activeFile = this.app.workspace.getActiveFile();
                const isCurrentDocLoaded = activeFile ? docs.has(activeFile.path) : false;
                this.chatInput?.setLoadBtnActive(isCurrentDocLoaded);
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
                    this.indexManager?.setCrossBookMode(false);
                    this.plugin.settings.lastCrossBookMode = false;
                    await this.plugin.saveSettings();

                    // 取消任何正在进行的流式请求，避免旧回调更新新消息列表
                    this.cancelActiveStream();

                    // 清空跨书籍模式的消息，准备加载单书籍会话
                    this.messageList?.clear();
                }

                // 直接调用 selectIndex 方法，确保顶栏正确更新
                // 而不是通过 indexManager.selectIndex 间接调用
                await this.selectIndex(indexId);
            })
        );

        // 监听阅读模式引用事件
        this.registerEvent(
            workspace.on("deeppdf:quote-selection", async (metadata: import("../components/chat-input/chat-input.js").QuoteMetadata) => {
                log("[DeepPDF] Received quote-selection event");
                this.handleQuoteSelection(metadata);
            })
        );

        this.registerEvent(
            workspace.on("deeppdf:excerpt-selection", async (text: string, range: Range) => {
                log("[DeepPDF] Received excerpt-selection event");
                this.handleExcerptSelection(text, range);
            })
        );

        // 监听文件切换事件，更新文档加载按钮状态 + 阅读进度追踪 + 自动同步章节上下文
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                if (this.contextManager) {
                    const activeFile = this.app.workspace.getActiveFile();
                    const isLoaded = activeFile ? this.contextManager.hasDocument(activeFile.path) : false;
                    this.chatInput?.setLoadBtnActive(isLoaded);
                }
                // 追踪阅读进度
                this.trackReadingProgress();
                // 自动同步当前章节到上下文
                this.autoSyncCurrentChapter();
            })
        );
    }

    /**
     * 处理引用选中文字
     * 在输入框上方显示引用卡片，更新 placeholder 提示
     */
    private handleQuoteSelection(metadata: import("../components/chat-input/chat-input.js").QuoteMetadata): void {
        // 1. 创建引用数据（保留结构化元数据）
        const quote: QuoteItem = {
            id: `quote-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: metadata.text.trim(),
            source: metadata.source,
            sourcePath: metadata.sourcePath,
            blockId: metadata.blockId,
            nodeId: metadata.nodeId,
            heading: metadata.heading,
            headingPath: metadata.headingPath
        };

        // 2. 添加到引用列表
        this.quotes.push(quote);

        // 3. 渲染引用卡片
        this.renderQuoteCard(quote);

        // 4. 更新 placeholder 提示引用数量
        this.updateQuotePlaceholder();

        // 5. 聚焦输入框
        this.chatInput?.focus();
    }

    /**
     * 渲染引用卡片（带文段显示）
     */
    private renderQuoteCard(quote: QuoteItem): void {
        if (!this.quotesContainer) return;

        // 添加容器类和更新计数
        // this.quotesContainer.addClass('deeppdf-quotes-container');
        this.quotesContainer.setAttribute('data-count', String(this.quotes.length));

        // 更新消息列表底部间距（延迟执行，等待 DOM 渲染完成）
        requestAnimationFrame(() => {
            this.updateMessageListPadding(false);
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

        this.updateQuotePlaceholder();

        // 更新消息列表底部间距
        requestAnimationFrame(() => {
            this.updateMessageListPadding(false);
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

        this.updateQuotePlaceholder();

        // 更新消息列表底部间距
        requestAnimationFrame(() => {
            this.updateMessageListPadding(false);
        });
    }

    /**
     * 更新输入框 placeholder 反映引用数量
     */
    private updateQuotePlaceholder(): void {
        const textarea = (this.chatInput as any)?.textarea as HTMLTextAreaElement | undefined;
        if (!textarea) return;

        if (this.quotes.length > 0) {
            textarea.placeholder = `已引用 ${this.quotes.length} 段文字，请输入你的问题...`;
        } else {
            textarea.placeholder = '输入消息，或使用 @ 引用文件...';
        }
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
     * 链接：链接到章节文件，精确到 block id
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
                // 摘录成功后，在阅读界面标记文本（添加虚线下划线）
                this.markExcerptText(range);
            },
        });
        modal.open();
    }

    /**
     * 在阅读界面标记摘录文本（添加虚线下划线）
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
            onQuestionClick: (question: string) => {
                this.handleQuestionClick(question);
            },
            onGenerateOutline: () => {
                this.handleGenerateOutline();
            },
            onGuidanceClick: (type: GuidanceType) => {
                this.handleGuidanceClick(type);
            },
            onExcerpt: (messageId: string, content: ExcerptContent, metadata: ExcerptMetadata) => {
                this.handleExcerpt(messageId, content, metadata);
            },
            onQuote: (metadata: import("../components/chat-input/chat-input.js").QuoteMetadata) => {
                this.handleQuoteSelection(metadata);
            },
            onDelete: (messageId: string) => {
                this.handleDeleteMessagePair(messageId);
            },
            onTTS: async (messageId: string, content: string) => {
                // 喇叭按钮始终直接朗读原文，不走摘要模式
                this.handleTTS(messageId, content, { rawText: true });
            },
            onVoicePlay: (messageId: string) => {
                // 控制流式语音播放
                const player = this.streamingVoicePlayers.get(messageId);
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
                coverUrl: this.currentBookCoverUrl,
                author: this.currentBookAuthor,
                bookName: this.currentPdfName
            })
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
            onSend: (message: string, _chatInputQuotes) => {
                // 使用 sidebar 自己管理的引用列表（而非 ChatInput 内部的空数组）
                this.sendMessage(message, this.getQuotes());
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
            },
            onUnloadCurrentDoc: async () => {
                await this.unloadCurrentDocument();
            }
        });

        // 创建引用卡片容器（在输入框上方）
        this.quotesContainer = section.createDiv({ cls: "deeppdf-quotes-container" });

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
     * 获取上下文文档列表（用于 API 调用）
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
     * 切换搜索模式
     */
    private async toggleSearchMode() {
        // 跨书籍搜索功能已移除
        new Notice("跨书籍搜索功能已移除");
    }

    /**
     * 切换深度思考模式
     */
    public async toggleDeepSearchMode(): Promise<void> {
        this.useLLMTreeSearch = !this.useLLMTreeSearch;
        const modeText = this.useLLMTreeSearch ? "深度思考模式已开启" : "深度思考模式已关闭";
        new Notice(modeText);
        log(`[DeepPDF] toggleDeepSearchMode: ${modeText}`);
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
        if (wasCrossBookMode) {
            log('[DeepPDF] 恢复跨书籍模式');
            this.crossBookMode = true;
            this.indexManager?.setCrossBookMode(true);
            await this.loadCrossBookSession();
        }

        // 恢复深度思考模式状态
        const wasDeepSearchMode = this.plugin.settings.lastDeepSearchMode;
        if (wasDeepSearchMode) {
            log('[DeepPDF] 恢复深度思考模式');
            this.useLLMTreeSearch = true;
        }
    }

    /**
     * 加载跨书籍模式的会话
     */
    private async loadCrossBookSession() {
        const sessionId = this.plugin.settings.lastCrossBookSessionId;
        log('[DeepPDF] loadCrossBookSession: sessionId =', sessionId);

        if (sessionId) {
            this.sessionId = sessionId;

            // 从 SessionStore 恢复
            const restored = await this.restoreFromSessionStore(sessionId);
            if (restored) {
                log('[DeepPDF] loadCrossBookSession: 从 SessionStore 恢复成功');
                return;
            }
        }

        // 没有缓存的跨书籍会话，开始新会话
        log('[DeepPDF] loadCrossBookSession: 没有缓存的跨书籍会话，开始新会话');
        this.sessionId = `cross-book-${Date.now()}`;
        this.plugin.settings.lastCrossBookSessionId = this.sessionId;
        await this.plugin.saveSettings();

        // 在 SessionStore 中创建跨书籍会话
        await this.initializeSessionStore();
        await this.sessionStore!.create(this.sessionId, '__cross_book__', true);

        this.showWelcomeMessage();
    }

    // ==================== 消息处理 ====================

    /**
     * 公开方法：从外部发送消息（用于调试）
     * @param message 用户消息内容
     */
    public async sendMessageWithInput(message: string): Promise<void> {
        log('[DeepPDF] sendMessageWithInput called:', message);
        await this.sendMessage(message);
    }

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
                // 重试模式：复用原来的消息 ID，清空旧内容重新开始
                aiMessageId = regenerateMessageId;
                this.messageList?.updateMessage(aiMessageId, {
                    content: this.crossBookMode ? "🔍 正在跨书籍查阅..." : "📖 正在翻阅...",
                    isStreaming: true,
                    currentStatus: '开始阅读...',
                    agentToolCalls: [],
                });

                // 关键：从 agentChatHistory 中删除旧的 AI 回复（从最后一条 user 消息之后的所有 assistant 消息）
                // 这样重新生成时，新的回复不会导致重复
                const lastUserIndex = this.agentChatHistory.findLastIndex(m => m.role === 'user');
                if (lastUserIndex >= 0) {
                    const beforeRegenerate = this.agentChatHistory.length;
                    // 只保留到最后一条 user 消息（包含）
                    this.agentChatHistory = this.agentChatHistory.slice(0, lastUserIndex + 1);
                    log(`[DeepPDF] 重试模式：清理了 ${beforeRegenerate - this.agentChatHistory.length} 条旧消息`);
                }
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
                    pdfName: this.currentPdfName || undefined,
                    quotes: quotes && quotes.length > 0 ? quotes : undefined
                };
                this.messageList?.addMessage(userMessageData);

                // 添加 AI 消息（初始为加载状态）
                const aiMessageData: MessageData = {
                    id: aiMessageId,
                    role: "assistant" as MessageRole,
                    content: "",
                    timestamp: new Date().toISOString(),
                    isStreaming: true,
                    isAgentMessage: true,  // 默认使用 Agent 模式（自动路由）
                    currentStatus: '开始阅读...',
                    pdfName: this.currentPdfName || undefined,
                    question: message,  // 保存用户的问题
                    conversationId: this.sessionId || undefined,  // 保存会话ID用于双向链接
                    bookCoverUrl: this.currentBookCoverUrl || undefined,  // 书籍封面 URL
                    bookAuthor: this.currentBookAuthor || undefined,  // 书籍作者
                    enableVoiceReply: !!(this.plugin.settings.enableVoiceReply && resolveRoleConfig('tts', this.plugin.settings)),
                    // 如果启用了语音回复，初始设置 voiceState 为 loading，显示占位符
                    voiceState: !!(this.plugin.settings.enableVoiceReply && resolveRoleConfig('tts', this.plugin.settings)) ? 'loading' as const : undefined,
                };
                this.messageList?.addMessage(aiMessageData);
            }

            // 使用 Agent 智能体模式
            // 注意：不要使用 await，因为 handleAgentQuery 使用回调模式
            this.handleAgentQuery(message, this.currentIndexId!, aiMessageId, quotes);


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
     * 静默取消正在进行的流式请求（不更新 UI）
     * 用于切换会话或清空消息列表前清理状态
     */
    private cancelActiveStream(): void {
        if (this.streamController) {
            try {
                this.streamController.abort();
                log('[DeepPDF] 已静默取消流式请求');
            } catch (e) {
                warn('[DeepPDF] 取消流式请求时出错:', e);
            }
            this.streamController = null;
        }
        this.isAiStreaming = false;
        this.isProcessing = false;
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
                isStreaming: false,
                timestamp: new Date().toISOString()
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

            // 获取当前阅读章节的 node_id（用于搜索提权）
            const activeFile = this.app.workspace.getActiveFile();
            let currentNodeId: string | undefined;
            if (activeFile) {
                const cache = this.app.metadataCache.getFileCache(activeFile);
                const rawNodeId = cache?.frontmatter?.node_id;
                if (rawNodeId) currentNodeId = String(rawNodeId);
            }

            // 构建 ToolContext
            const context: ToolContext = {
                indexId: indexId,
                pdfName: this.currentPdfName || '未知文档',
                markdownFiles: this.currentMarkdownFiles,
                useLLMTreeSearch: this.useLLMTreeSearch,
                app: this.app,
                plugin: this.plugin,
                currentNodeId,
                // 添加文档元数据（用于 Agent 上下文）
                documentMetadata: {
                    title: this.currentPdfName || '未知文档',
                },
                // 添加全书摘要（用于系统提示）
                docDescription: this.currentDocDescription || undefined,
                // 添加结构化引用数据（用于工具优先搜索）
                quotes: quotes,
                // TTS 配置（用于 VoicePipeline 语音合成）
                ttsConfig: this.plugin.settings.enableVoiceReply ? (() => {
                    const cfg = resolveRoleConfig('tts', this.plugin.settings);
                    return cfg ? { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model } : undefined;
                })() : undefined,
                // LLM 配置（用于 VoicePipeline 语音摘要生成）
                llmConfig: this.plugin.settings.enableVoiceReply ? (() => {
                    const cfg = resolveRoleConfig('router', this.plugin.settings);
                    return cfg ? { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model } : undefined;
                })() : undefined,
            };

            // 构建用户消息
            // 注意：运行时上下文（阅读进度等）由 FrontendAgent.buildMessages() 注入
            // 这里只处理用户主动附加的引用内容
            let userMessage = query;

            // 添加引用内容（用户主动附加的上下文）
            // 使用结构化元数据格式化引用，包含章节路径信息
            if (quotes && quotes.length > 0) {
                const quotesText = quotes.map(q => {
                    // 优先使用完整的标题路径，其次使用单个标题，最后使用来源
                    const location = q.headingPath?.join(' > ') || q.heading || q.source || '引用';
                    return `> ${q.text}\n> — ${location}`;
                }).join('\n\n');
                userMessage = `${userMessage}\n\n---\n**用户引用了以下内容，请重点关注并基于引用内容回答：**\n${quotesText}`;
            }

            // 判断是否是新对话（历史为空或只有 system 消息）
            const isNewConversation = this.agentChatHistory.length <= 1;

            // 简化状态追踪：thinking（思考中）vs answering（回答中）
            let agentState: 'thinking' | 'answering' = 'thinking';
            // 追踪是否收到过工具调用（用于判断是否是最终回复阶段）
            let hadToolCalls = false;
            // 累积推理内容（Kimi K2.5 / DeepSeek R1 等思考模型）
            let reasoningContent = '';

            // 🕐 性能统计：记录从用户提交问题到首字节响应的时间
            const queryStartTime = Date.now();
            let firstContentLogged = false;

            // 回调函数
            const callbacks = {
                // onContent: 接收流式内容（text 是完整累积内容，不是 delta）
                onContent: (text: string) => {
                    fullContent = text;

                    // 🕐 记录首字节响应时间（仅首次）
                    if (!firstContentLogged && fullContent.trim().length > 0) {
                        firstContentLogged = true;
                        const ttfc = Date.now() - queryStartTime;
                        log(`[DeepPDF] ⚡ 首字节响应时间 (TTCF): ${ttfc}ms (${(ttfc / 1000).toFixed(1)}s)`);
                    }

                    // 优化：立即切换到回答阶段
                    // 条件：收到实际内容（非空白字符）
                    if (agentState === 'thinking' && fullContent.trim().length > 0) {
                        agentState = 'answering';
                    }

                    // 思考阶段：只更新状态，不更新内容
                    // 例外：如果之前没有工具调用（直接回复），立即显示内容
                    if (agentState === 'thinking' && !hadToolCalls) {
                        // 直接回复场景：立即显示流式内容
                        const updates: any = {
                            content: fullContent,
                            isStreaming: true,
                            isAgentMessage: true,
                        };
                        if (currentStatus) {
                            updates.currentStatus = currentStatus;
                        }
                        this.messageList?.updateMessage(aiMessageId, updates);
                        return;
                    }

                    if (agentState === 'thinking') {
                        const updates: any = {
                            isStreaming: true,
                            isAgentMessage: true,
                        };
                        if (currentStatus) {
                            updates.currentStatus = currentStatus;
                        }
                        this.messageList?.updateMessage(aiMessageId, updates);
                        return;
                    }

                    // 回答阶段：显示流式内容
                    const updates: any = {
                        content: fullContent,
                        isStreaming: true,
                        isAgentMessage: true,
                    };

                    if (currentStatus) {
                        updates.currentStatus = currentStatus;
                    }

                    this.messageList?.updateMessage(aiMessageId, updates);
                },
                // onContentComplete: AI 回复完成时校验链接并更新熟悉度
                onContentComplete: async (content: string): Promise<string> => {
                    if (!this.currentPdfName || !context.app) {
                        return content;
                    }

                    try {
                        // 1. 校验并纠正 wiki 链接
                        const { correctedContent, validatedLinks } = await validateAndCorrectLinks(
                            this.app,
                            content
                        );

                        // 2. 如果内容被纠正，更新消息显示
                        if (correctedContent !== content) {
                            log('[DeepPDF] 链接已纠正，更新消息');
                            this.messageList?.updateMessage(aiMessageId, {
                                content: correctedContent,
                            });
                            // 更新 fullContent 以便后续保存
                            fullContent = correctedContent;
                        }

                        return correctedContent;
                    } catch (err) {
                        logError('[DeepPDF] 链接校验失败:', err);
                        return content;
                    }
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
                // onReasoning: 接收推理过程（Kimi K2.5 / DeepSeek R1 等思考模型）
                onReasoning: (text: string) => {
                    log('[DeepPDF] onReasoning 回调被调用, text:', text.slice(0, 50));
                    reasoningContent += text;
                    // 在状态栏显示思考过程（截取第一行，最多 50 字符）
                    const firstLine = reasoningContent.split('\n')[0].slice(0, 50);
                    const displayReasoning = firstLine.length < reasoningContent.split('\n')[0].length
                        ? firstLine + '...'
                        : firstLine;

                    log('[DeepPDF] onReasoning 更新状态:', displayReasoning);
                    this.messageList?.updateMessage(aiMessageId, {
                        currentStatus: displayReasoning ? `💭 ${displayReasoning}` : undefined,
                        isStreaming: true,
                        isAgentMessage: true,
                    });
                },
                // onComplete: 流式完成
                onComplete: async () => {
                    this.messageList?.updateMessage(aiMessageId, {
                        isStreaming: false,
                        timestamp: new Date().toISOString()
                    });

                    // 信封书写完成 → 封口
                    if (this.plugin.settings.enableVoiceReply) {
                        const msg = this.messageList?.getMessage(aiMessageId);
                        if (msg && msg instanceof AIMessage) {
                            msg.updateLetterState('sealed');
                        }
                    }
                    // 注意：不在这里调用 saveToCache()，因为 agentChatHistory 还未更新
                    // saveToCache() 将在 agentChatHistory 更新后调用

                    // 检查是否需要记忆整合（异步执行，不阻塞）
                    this.maybeConsolidateMemory();

                    // 恢复输入状态（AI 回复完成）
                    this.isProcessing = false;
                    this.isAiStreaming = false;
                    this.chatInput?.setStreaming(false);
                    this.chatInput?.setDisabled(false);

                    // 清空引用卡片和 placeholder
                    this.clearQuotes();

                    this.chatInput?.focus();
                    this.streamController = null;

                    // 自动播报（语音回复模式由 VoicePipeline 处理，不重复播报）
                    if (this.plugin.settings.autoTTS && !this.plugin.settings.enableVoiceReply) {
                        if (!this.ttsService) {
                            this.ttsService = this.initTTSService();
                        }
                        if (this.ttsService && this.ttsService.getCurrentMessageId() !== aiMessageId) {
                            const question = this.findUserQuestion(aiMessageId);
                            const memoryContent = await new MemoryStore(this.app).readLongTermMemory() || undefined;
                            this.ttsService.play(aiMessageId, fullContent, question, {
                                bookTitle: this.getDisplayName(this.currentPdfName || '') || undefined,
                                bookAuthor: this.currentBookAuthor || undefined,
                                memoryContent,
                            });
                        }
                    }
                },
                // onError: 错误处理
                onError: (error: string) => {
                    logError('[DeepPDF] Agent 错误:', error);
                    this.messageList?.updateMessage(aiMessageId, {
                        content: `查询失败: ${error}`,
                        isStreaming: false,
                        timestamp: new Date().toISOString()
                    });

                    // 恢复输入状态（出错时）
                    this.isProcessing = false;
                    this.isAiStreaming = false;
                    this.chatInput?.setStreaming(false);
                    this.chatInput?.setDisabled(false);

                    // 清空引用卡片和 placeholder
                    this.clearQuotes();

                    this.chatInput?.focus();
                    this.streamController = null;
                },
                // onHumanizedProgress: 思考阶段的状态更新
                // 更新状态文字、阅读层次徽章、已完成步骤
                onHumanizedProgress: ((() => {
                    let lastUpdateTime = 0;
                    const THROTTLE_MS = 200;

                    return (progress: HumanizedProgress) => {
                        const now = Date.now();
                        if (now - lastUpdateTime < THROTTLE_MS) {
                            return;
                        }
                        lastUpdateTime = now;

                        // 检测是否有工具调用（readingSteps 中有已完成的步骤）
                        if (progress.readingSteps.some(step => step.status === 'done' || step.status === 'current')) {
                            hadToolCalls = true;
                        }

                        // 只要有正在进行的工具调用，就更新状态（不管 agentState）
                        // 这样可以在多轮工具调用时持续显示状态
                        const hasRunningTools = progress.readingSteps.some(step => step.status === 'current');
                        if (agentState !== 'thinking' && !hasRunningTools) {
                            return;
                        }

                        // 提取已完成的步骤
                        const completedSteps = progress.readingSteps
                            .filter(step => step.status === 'done')
                            .map(step => step.action);

                        // 更新状态、阅读层次、已完成步骤
                        this.messageList?.updateMessage(aiMessageId, {
                            currentStatus: progress.mainAction.detail,
                            readingLevel: progress.currentReadingLevel,
                            completedSteps: completedSteps.length > 0 ? completedSteps : undefined,
                            isStreaming: true,
                            isAgentMessage: true,
                        });
                    };
                })()),
                abortSignal: this.streamController.signal,
                onVoiceReady: (data: { audioBuffer: ArrayBuffer; duration: number }) => {
                    const msg = this.messageList?.getMessage(aiMessageId);
                    if (msg && msg instanceof AIMessage) {
                        msg.updateVoiceData(data);
                    }
                    // 同步语音数据到 agentChatHistory，确保持久化
                    const lastAiMsg = this.agentChatHistory[this.agentChatHistory.length - 1];
                    if (lastAiMsg && lastAiMsg.role === 'assistant') {
                        (lastAiMsg as any).voiceAudio = data.audioBuffer;
                        (lastAiMsg as any).voiceDuration = data.duration;
                        (lastAiMsg as any).voiceState = 'ready';
                    }
                    // 按预定路径落盘语音文件（JSONL 中已有占位路径）
                    if (this.sessionStore && this.sessionId) {
                        this.sessionStore.saveVoiceToPlaceholder(
                            this.sessionId,
                            aiMessageId,
                            data.audioBuffer,
                        );
                    }
                },
                // 流式语音生成：边生成边返回音频块
                onVoiceChunk: (data: { audioChunk: ArrayBuffer; isComplete: boolean }) => {
                    const msg = this.messageList?.getMessage(aiMessageId);
                    if (msg && msg instanceof AIMessage) {
                        if (data.isComplete) {
                            // 完成信号：标记播放器 seal
                            const player = this.streamingVoicePlayers.get(aiMessageId);
                            if (player) {
                                player.seal();
                            }
                        } else {
                            // 音频块：发送给流式播放器
                            let player = this.streamingVoicePlayers.get(aiMessageId);
                            if (!player) {
                                // 创建新的流式播放器
                                player = new StreamingVoicePlayer({
                                    sampleRate: 24000,
                                    onStateChange: (state: StreamingVoiceState) => {
                                        // 更新 UI 状态
                                        if (state === 'playing') {
                                            msg.updateVoiceState('playing');
                                        } else if (state === 'paused') {
                                            msg.updateVoiceState('paused');
                                        } else if (state === 'ended') {
                                            msg.updateVoiceState('ended');
                                        }
                                    },
                                });
                                this.streamingVoicePlayers.set(aiMessageId, player);
                                
                                // 首次创建播放器时，设置状态为 ready（显示播放按钮）
                                msg.updateVoiceState('ready');
                            }
                            player.enqueueChunk(data.audioChunk);
                        }
                    }
                },
            };

            // 初始化 SubagentManager（用于 create_sub_agent 工具）
            this.frontendAgent.setupSubagentManager(context);

            // LangGraph 引擎（唯一路径）
            const result = await this.frontendAgent.runGraphEngine(
                userMessage,
                context,
                callbacks,
                this.agentChatHistory,
            );

            if (result.interrupted) {
                // HITL: 显示审查 UI，等待用户确认
                this.showHumanReviewPrompt(result.interrupted.nodeId, result.interrupted.content, context, callbacks);
                return;
            }

            // 正常完成：更新消息
            if (result.messages.length > 0) {
                this.agentChatHistory = [...this.agentChatHistory, { role: 'user', content: userMessage }, ...result.messages];
            }
            await this.saveToCache();

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError('[DeepPDF] handleAgentQuery 错误:', error);
            this.messageList?.updateMessage(aiMessageId, {
                content: `Agent 查询失败: ${errorMessage}`,
                isStreaming: false,
                timestamp: new Date().toISOString()
            });
            // 恢复输入状态
            this.isProcessing = false;
            this.isAiStreaming = false;
            this.chatInput?.setStreaming(false);
            this.chatInput?.setDisabled(false);
        }
    }

    /**
     * 显示 Human-in-the-Loop 审查提示。
     *
     * 使用 Obsidian Notice 提示用户，自动确认继续。
     * 未来可扩展为带确认/拒绝按钮的卡片 UI。
     */
    private showHumanReviewPrompt(
        nodeId: string,
        content: string,
        context: import("../agent/tools/types.js").ToolContext,
        callbacks: import("../agent/agent-loop.js").AgentLoopOptions
    ): void {
        const nodeLabel = nodeId === 'analytical' ? 'S2 分析' : nodeId === 'formatter' ? 'S4 格式化' : nodeId;

        // 显示审查内容
        const messages = this.messageList?.getMessagesData() || [];
        const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';
        if (lastMsgId) {
            const reviewContent = `${content}\n\n---\n**[${nodeLabel} 审查中]** 请确认结果是否满意。`;
            this.messageList?.updateMessage(lastMsgId, {
                content: reviewContent,
                isStreaming: false,
                isAgentMessage: true,
            });
        }

        new Notice(`[${nodeLabel}] 审查中 — 自动确认继续`);
        log(`[DeepPDF] HITL 审查: ${nodeLabel}, 自动确认`);

        // 自动确认（未来可改为交互式确认）
        this.handleHumanReviewResponse(true, '', context, callbacks);
    }

    /**
     * 处理用户对 HITL 审查的响应。
     */
    private async handleHumanReviewResponse(
        approved: boolean,
        feedback: string,
        context: import("../agent/tools/types.js").ToolContext,
        callbacks: import("../agent/agent-loop.js").AgentLoopOptions
    ): Promise<void> {
        try {
            const result = await this.frontendAgent!.resumeGraphExecution(
                approved,
                feedback,
                context,
                callbacks
            );

            if (result.interrupted) {
                // 再次中断（例如 formatter 节点的 interrupt）
                this.showHumanReviewPrompt(result.interrupted.nodeId, result.interrupted.content, context, callbacks);
                return;
            }
            if (result.messages.length > 0) {
                const lastAiMsg = result.messages[result.messages.length - 1];
                this.agentChatHistory.push(lastAiMsg);
            }
            await this.saveToCache();

            // 恢复输入状态
            this.isProcessing = false;
            this.isAiStreaming = false;
            this.chatInput?.setStreaming(false);
            this.chatInput?.setDisabled(false);
        } catch (error) {
            logError('[DeepPDF] HITL 恢复错误:', error);
            this.isProcessing = false;
            this.isAiStreaming = false;
            this.chatInput?.setStreaming(false);
            this.chatInput?.setDisabled(false);
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
     * 处理删除消息对
     * 删除 AI 回复时，同时删除对应的用户问题和所有相关 tool 消息
     */
    private handleDeleteMessagePair(aiMessageId: string): void {
        // 弹窗确认
        const modal = new ConfirmModal(
            this.app,
            "删除对话",
            "此操作不可撤销",
            async () => {
                await this.doDeleteMessagePair(aiMessageId);
            },
            {
                confirmLabel: "删除",
                cancelLabel: "取消",
                isDestructive: true
            }
        );
        modal.open();
    }

    /**
     * 执行删除消息对
     */
    private async doDeleteMessagePair(aiMessageId: string): Promise<void> {
        if (!this.sessionId || !this.sessionStore) {
            new Notice("无法删除：会话不存在");
            return;
        }

        try {
            // 1. 从 SessionStore 获取完整消息列表
            const session = await this.sessionStore.get(this.sessionId);
            if (!session) {
                new Notice("无法删除：会话数据不存在");
                return;
            }

            // 2. 在 UI 消息列表中找到 AI 消息的索引
            const uiMessages = this.messageList?.getMessagesData() || [];
            const uiAiIndex = uiMessages.findIndex(m => m.id === aiMessageId);
            if (uiAiIndex === -1) {
                new Notice("无法删除：消息未找到");
                return;
            }

            // 3. 找到对应的 user 消息（向前查找）
            let uiUserIndex = uiAiIndex - 1;
            while (uiUserIndex >= 0 && uiMessages[uiUserIndex].role !== 'user') {
                uiUserIndex--;
            }
            if (uiUserIndex < 0) {
                new Notice("无法删除：未找到对应的用户问题");
                return;
            }

            // 4. 收集要删除的 UI 消息 ID（从 user 消息到下一个 user 消息之前）
            const uiIdsToDelete: string[] = [];
            for (let i = uiUserIndex; i < uiMessages.length; i++) {
                if (i > uiUserIndex && uiMessages[i].role === 'user') {
                    break;
                }
                uiIdsToDelete.push(uiMessages[i].id);
            }

            // 5. 在 SessionStore 的消息数组中找到对应的索引
            const userContent = uiMessages[uiUserIndex].content;
            const storeIndicesToDelete: number[] = [];

            // 找到 user 消息在 store 中的索引（通过内容匹配）
            let storeUserIndex = -1;
            for (let i = 0; i < session.messages.length; i++) {
                if (session.messages[i].role === 'user' &&
                    session.messages[i].content === userContent) {
                    storeUserIndex = i;
                    break;
                }
            }

            if (storeUserIndex === -1) {
                new Notice("无法删除：存储中未找到对应消息");
                return;
            }

            // 6. 收集要删除的 store 消息索引（从 user 到下一个 user 之前）
            for (let i = storeUserIndex; i < session.messages.length; i++) {
                if (i > storeUserIndex && session.messages[i].role === 'user') {
                    break;
                }
                storeIndicesToDelete.push(i);
            }

            // 7. 从 SessionStore 删除
            await this.sessionStore.deleteMessages(this.sessionId, storeIndicesToDelete);

            // 8. 更新 agentChatHistory（重新加载 LLM 历史）
            if (this.frontendAgent && this.sessionStore) {
                const llmHistory = await this.sessionStore.getLLMHistory(this.sessionId);
                const systemPrompt = await this.frontendAgent.getSystemPromptAsync();
                this.agentChatHistory = [
                    { role: 'system', content: systemPrompt },
                    ...llmHistory
                ];
            }

            // 9. 从 UI 删除
            this.messageList?.removeMessages(uiIdsToDelete);

            new Notice("对话已删除");
            log('[DeepPDF] 删除了消息对:', uiIdsToDelete);

        } catch (error) {
            logError('[DeepPDF] 删除消息对失败:', error);
            new Notice("删除失败，请重试");
        }
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
     * 处理引导按钮点击
     */
    private handleGuidanceClick(type: GuidanceType): void {
        log('[DeepPDF] 引导按钮点击:', type);

        // 查找对应的提示词
        const button = GUIDANCE_BUTTONS.find(b => b.type === type);
        if (!button) {
            warn('[DeepPDF] 未找到引导按钮配置:', type);
            return;
        }

        // 发送问题
        this.sendMessage(button.prompt);
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

    async loadIndexes(): Promise<void> {
        // Scan local .pageindex/ directory for book-meta.json and .indexing.json files
        const vaultPath = (this.app.vault.adapter as any).basePath;
        const pageindexDir = `${vaultPath}/.pageindex`;

        try {
            const fs = require('fs/promises');
            const entries = await fs.readdir(pageindexDir, { withFileTypes: true });
            const indexes: any[] = [];

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const dirPath = `${pageindexDir}/${entry.name}`;

                // Check for in-progress indexing first
                try {
                    const statusContent = await fs.readFile(`${dirPath}/.indexing.json`, 'utf-8');
                    const status = JSON.parse(statusContent);
                    const isComplete = status.step === 'complete' || (status.percent || 0) >= 100;
                    const isFailed = status.step === 'failed';

                    if (isComplete) {
                        // 已完成的索引：清理状态文件，继续读 book-meta.json
                        fs.unlink(`${dirPath}/.indexing.json`).catch(() => {});
                        // Fall through to book-meta.json check below
                    } else {
                        indexes.push({
                            id: status.bookId || entry.name,
                            pdf_name: status.title || entry.name,
                            node_count: 0,
                            created_at: new Date().toISOString(),
                            fileType: status.fileType,
                            status: isFailed ? 'failed' : 'processing',
                            progress_percent: status.percent || 0,
                            message: isFailed ? `索引失败: ${status.error || ''}` : status.stepLabel,
                        });
                        continue; // Skip book-meta.json check while indexing
                    }
                } catch {
                    // No .indexing.json, fall through to check book-meta.json
                }

                // Check for completed index
                try {
                    const content = await fs.readFile(`${dirPath}/book-meta.json`, 'utf-8');
                    const meta = JSON.parse(content);
                    indexes.push({
                        id: meta.bookId || entry.name,
                        pdf_name: meta.title || entry.name,
                        author: meta.author,
                        description: meta.description,
                        fileType: meta.fileType,
                        node_count: meta.chapters?.length || 0,
                        created_at: meta.indexedAt || new Date().toISOString(),
                        status: 'ready',
                    });
                } catch {
                    // Skip directories without book-meta.json
                }
            }

            this.indexes = indexes;
            log('[DeepPDF] [loadIndexes] Loaded', indexes.length, 'indexes from .pageindex/');
        } catch {
            // .pageindex/ doesn't exist yet
            this.indexes = [];
        }

        if (this.plugin.settings.lastSelectedIndexId) {
            // Verify the book still exists before restoring
            const exists = this.indexes.some(idx => idx.id === this.plugin.settings.lastSelectedIndexId);
            if (exists) {
                log('[DeepPDF] [loadIndexes] 恢复上次选中的书籍:', this.plugin.settings.lastSelectedIndexId);
                await this.selectIndex(this.plugin.settings.lastSelectedIndexId);
            } else {
                log('[DeepPDF] [loadIndexes] 上次选中的书籍已不存在，清空状态');
                this.plugin.settings.lastSelectedIndexId = undefined;
                await this.plugin.saveSettings();
            }
        }
    }

    /**
     * 如果当前选中的是 task_id，检查任务状态并更新为实际的 index_id
     * @deprecated Page Index 不使用 task_id
     */
    private async updateCurrentIndexIdIfNeeded(): Promise<void> {
        // Page Index 直接使用 bookId，没有 task_id 概念
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
     * 初始化 TTS 服务
     */
    private initTTSService(): TTSService | null {
        const settings = this.plugin.settings;
        const ttsConfig = resolveRoleConfig('tts', settings);
        if (!ttsConfig) return null;

        const fastConfig = resolveRoleConfig('router', settings);
        if (!fastConfig) return null;

        return new TTSService({
            ttsApiKey: ttsConfig.apiKey,
            ttsBaseUrl: ttsConfig.baseUrl,
            ttsModel: ttsConfig.model,
            llmApiKey: fastConfig.apiKey,
            llmBaseUrl: fastConfig.baseUrl,
            llmModel: fastConfig.model,
            onStateChange: (messageId: string | null, state: TTSPlayState) => {
                if (messageId) {
                    this.messageList?.updateTTSState(messageId, state);
                }
                // TTS 停止时清除高亮
                if (state === 'idle' && messageId) {
                    const msg = this.messageList?.getMessage(messageId);
                    if (msg?.highlightTTSProgress) {
                        msg.highlightTTSProgress(-1);
                    }
                }
            },
            onProgressChange: (messageId: string, progress: number) => {
                const msg = this.messageList?.getMessage(messageId);
                if (msg?.highlightTTSProgress) {
                    msg.highlightTTSProgress(progress);
                }
            },
        });
    }

    /**
     * 处理 TTS 播放/暂停请求
     */
    private async handleTTS(messageId: string, content: string, options?: { rawText?: boolean }): Promise<void> {
        if (!this.ttsService) {
            this.ttsService = this.initTTSService();
        }
        if (!this.ttsService) {
            new Notice('请先在设置中配置语音播报（TTS）服务：添加小米 API Key 并启用 tts 角色');
            return;
        }

        if (this.ttsService.getCurrentMessageId() === messageId && this.ttsService.getState() !== 'idle') {
            this.ttsService.togglePauseResume();
            return;
        }

        // 查找对应的用户提问
        const userQuestion = this.findUserQuestion(messageId);

        await this.ttsService.play(messageId, content, userQuestion, {
            bookTitle: this.getDisplayName(this.currentPdfName || '') || undefined,
            bookAuthor: this.currentBookAuthor || undefined,
            memoryContent: await new MemoryStore(this.app).readLongTermMemory() || undefined,
        }, options);
    }

    /**
     * 根据 AI 消息 ID 找到对应的用户提问
     */
    private findUserQuestion(aiMessageId: string): string | undefined {
        const messages = this.messageList?.getMessagesData();
        if (!messages) return undefined;
        const idx = messages.findIndex(m => m.id === aiMessageId);
        if (idx <= 0) return undefined;
        // AI 消息前面应该是用户消息
        const prev = messages[idx - 1];
        return prev?.role === 'user' ? prev.content : undefined;
    }

    /**
     * 显示错误消息
     */
    private showError(message: string): void {
        new Notice(message);
        logError("[DeepPDF]", message);
    }

    async onClose() {
        try {
            // 保存阅读进度
            await this.flushProgressSave();
            if (this.streamController) {
                try {
                    this.streamController.abort();
                    log('[DeepPDF] 已取消流式请求');
                } catch (e) {
                    warn('[DeepPDF] Error aborting streamController:', e);
                }
                this.streamController = null;
            }

            // 清理 TTS 服务
            if (this.ttsService) {
                try {
                    this.ttsService.destroy();
                } catch (e) {
                    warn('[DeepPDF] Error stopping TTS service:', e);
                }
                this.ttsService = null;
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

    /**
     * 获取当前书籍信息（供调试命令使用）
     */
    getCurrentBookInfo(): { title: string | null; page_count: number; docDescription: string | null } {
        return {
            title: this.currentPdfName,
            page_count: 100, // 暂时硬编码，后续可从索引元数据获取
            docDescription: this.currentDocDescription,
        };
    }
}
