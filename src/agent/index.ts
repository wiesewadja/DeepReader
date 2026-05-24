/**
 * FrontendAgent - 前端 Agent 主入口
 *
 * 提供完整的 Agent 功能封装，包括：
 * - LLM 客户端
 * - Skill 加载
 * - 用户上下文（通过 ContextBuilder）
 * - 工具注册
 * - 对话管理
 * - LangGraph 认知引擎（唯一执行路径）
 */

import type { App } from 'obsidian';

// Re-export everything
export { LLMClient } from './llm-client.js';
export { SkillLoader } from './skills/loader.js';
export { ContextLoader } from './context/index.js';
export { ContextBuilder } from './context/builder.js';
export { NoopTracer, NoopTraceContext } from './tracing/index.js';
export type { ITraceContext, ITracer } from './tracing/types.js';
export type { ChatMessage, ToolDefinition, ToolCall, StreamChunk } from './types.js';
export type { ToolContext } from './tools/types.js';
export type { Skill } from './skills/types.js';
export type { UserContext } from './context/index.js';
export type { DocumentMetadata } from './context/builder.js';
export type { AgentLoopOptions } from './agent-loop.js';

// LangGraph 认知引擎导出
export {
  createSharedContext,
} from './graph/shared-context.js';
export type {
  SharedContext,
  EngineCallbacks,
} from './graph/shared-context.js';
export { ReadingDepth } from './graph/state.js';

// Import for FrontendAgent class
import { ReadingDepth } from './graph/state.js';
import type { EngineMode } from './graph/state.js';
import { LLMClient, LLMClientManager, type ModelConfig } from './llm-client.js';
import { SkillLoader } from './skills/loader.js';
import { ContextLoader } from './context/index.js';
import { ContextBuilder, type DocumentMetadata } from './context/builder.js';
import { MemoryStore } from './memory/store.js';
import { SubagentManager } from './subagent/manager.js';
import { runAgentLoop } from './agent-loop.js';
import { IntentRouter } from './router/index.js';
import type { ChatMessage, ToolDefinition } from './types.js';
import type { AgentLoopOptions } from './agent-loop.js';
import type { ToolContext } from './tools/types.js';
import type { EngineCallbacks } from './graph/shared-context.js';
import { summarizeRecentHistory, extractPrevBlockIds } from './graph/utils/history-summarizer.js';
import { agentLog as log } from '../utils/logger.js';
import { NoopTracer } from './tracing/index.js';
import { HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { cognitiveEngine } from './graph/index.js';
import { createChatModels } from './models/index.js';
import { getLangSmithTracer, resetLangSmithTracer } from './tracing/langsmith.js';
import { createSharedContext } from './graph/shared-context.js';
import { processGraphStream as processStream } from './graph/stream-processor.js';
import { generateVoice, type VoiceConfig } from './graph/voice-pipeline.js';

export interface FrontendAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string; // 服务商显示名称（用于日志）
  skillsDir: string;
  app: App;

  // 新增：Fast 模型配置（可选）
  fastModelEnabled?: boolean;
  fastApiKey?: string;
  fastBaseUrl?: string;
  fastModel?: string;
  fastProviderName?: string;

  // Human-in-the-Loop 设置（可选）
  enableHumanReview?: boolean;

  // LangSmith 追踪配置（可选）
  langsmithApiKey?: string;
  langsmithProject?: string;
  langsmithEnabled?: boolean;

  // 思考模型控制（可选）
  disableThinking?: boolean;       // chat/main 模型
  fastDisableThinking?: boolean;   // router/fast 模型

  // 用户画像（可选）
  journalDir?: string;
}

export class FrontendAgent {
  private llmClientManager: LLMClientManager;
  private skillLoader: SkillLoader;
  private contextLoader: ContextLoader;
  private contextBuilder: ContextBuilder;
  private memoryStore: MemoryStore;
  private intentRouter: IntentRouter;
  private subagentManager?: SubagentManager;
  private initialized = false;
  private activeThreadId: string | null = null;
  private cachedModels: ReturnType<typeof createChatModels> | null = null;

  constructor(private options: FrontendAgentOptions) {
    // 构建 main 配置
    const mainConfig: ModelConfig = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      providerName: options.providerName,
      disableThinking: options.disableThinking,
    };

    // 构建 fast 配置（如果启用）
    let fastConfig: ModelConfig | undefined;
    if (options.fastModelEnabled && options.fastApiKey) {
      fastConfig = {
        apiKey: options.fastApiKey,
        baseUrl: options.fastBaseUrl,
        model: options.fastModel,
        providerName: options.fastProviderName,
        disableThinking: options.fastDisableThinking,
      };
    }

    this.llmClientManager = new LLMClientManager(mainConfig, fastConfig);
    this.skillLoader = new SkillLoader(options.skillsDir);
    this.contextLoader = new ContextLoader(options.app);
    this.memoryStore = new MemoryStore(options.app);
    this.contextBuilder = new ContextBuilder(options.app, this.memoryStore, {
      deepReaderDir: 'DeepReader',
    });
    this.intentRouter = new IntentRouter();
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      // 确保目录结构存在
      await this.contextLoader.ensureDirectories();

      // 初始化 MEMORY.md（如果不存在）
      await this.contextLoader.initializeMemoryFile();

      // 加载 Skills
      await this.skillLoader.loadSkills();

      log('[FrontendAgent] 初始化完成，可用 skills:', this.skillLoader.listSkills());

      this.initialized = true;
    }
  }

  /**
   * 获取系统提示（异步，使用 ContextBuilder）
   */
  async getSystemPromptAsync(
    documentMetadata?: DocumentMetadata,
    docDescription?: string
  ): Promise<string> {
    await this.initialize();

    // 🔄 检查并压缩过大的 MEMORY.md
    await this.maybeCompressMemory();

    // 获取 Skills XML Summary（用于 System Prompt）
    const skillsSummary = this.skillLoader.buildSkillsSummary();

    return this.contextBuilder.buildSystemPrompt(
      skillsSummary,
      documentMetadata,
      docDescription
    );
  }

  /**
   * 获取编译后的认知引擎。
   */
  private getCompiledEngine() {
    return cognitiveEngine;
  }

  /**
   * 检查并压缩过大的 MEMORY.md
   */
  private async maybeCompressMemory(): Promise<void> {
    const needsCompression = await this.memoryStore.needsCompression();
    if (!needsCompression) return;

    log('[FrontendAgent] 🔄 MEMORY.md 超限，触发主动压缩...');

    const currentMemory = await this.memoryStore.readLongTermMemory();
    if (!currentMemory) return;

    const compressed = await this.compressMemoryWithLLM(currentMemory);
    if (compressed && compressed.length < currentMemory.length) {
      await this.memoryStore.writeLongTermMemory(compressed);
      log(`[FrontendAgent] ✅ MEMORY.md 压缩完成: ${currentMemory.length} -> ${compressed.length} 字符`);
    }
  }

  /**
   * 使用 LLM 压缩记忆（简化版）
   */
  private async compressMemoryWithLLM(currentMemory: string): Promise<string | null> {
    const lineCount = currentMemory.split('\n').length;
    const charCount = currentMemory.length;

    const prompt = `激进压缩以下长期记忆，目标：100 行以内，8000 字符以内。

## 当前记忆 (${lineCount} 行, ${charCount} 字符)
${currentMemory}

## 压缩规则（必须严格执行）
1. **合并重复**：同一概念只保留一次
2. **删除临时状态**：删除"正在阅读"、"当前关注"等
3. **极简表达**：用关键词替代完整句子
4. **保持结构**：用户画像/阅读偏好/兴趣主题/阅读习惯

直接返回压缩后的 Markdown 内容，不要任何解释。`;

    try {
      const response = await this.llmClientManager.getMainClient().chat([
        { role: 'system', content: '你是记忆压缩助手。直接返回压缩后的内容，不要解释。' },
        { role: 'user', content: prompt },
      ], []);

      return response.content || null;
    } catch (err) {
      log('[FrontendAgent] 压缩失败:', err);
      return null;
    }
  }

  /**
   * 构建完整的消息列表（带运行时上下文）
   */
  buildMessages(
    systemPrompt: string,
    history: ChatMessage[],
    userMessage: string,
    metadata?: DocumentMetadata,
    systemNote?: string
  ): ChatMessage[] {
    return ContextBuilder.buildMessagesWithMetadata(
      systemPrompt,
      history,
      userMessage,
      metadata,
      systemNote
    );
  }

  /**
   * 使用 LangGraph 认知引擎处理查询。
   */
  async runGraphEngine(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions,
    chatHistory?: ChatMessage[],
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    await this.initialize();

    // 前置检查：API Key 必须配置
    if (!this.options.apiKey) {
      const errorMsg = 'API Key 未配置，请在插件设置中填写对应服务商的 API Key。';
      callbacks.onError?.(errorMsg);
      return { messages: [{ role: 'assistant', content: errorMsg }] };
    }

    const threadId = context.indexId
      ? `thread-${context.indexId}`
      : `thread-${Date.now()}`;
    this.activeThreadId = threadId;

    let configurable: Record<string, unknown>;
    let tracer: unknown;
    try {
      const result = await this.buildGraphConfigurable(context, callbacks, threadId, userMessage, chatHistory);
      tracer = result._langsmithTracer;
      const { _langsmithTracer: _, ...rest } = result;
      configurable = rest;
    } catch (cfgErr) {
      const cfgMsg = cfgErr instanceof Error ? cfgErr.message : String(cfgErr);
      log('[FrontendAgent] buildGraphConfigurable failed:', cfgMsg);
      callbacks.onError?.(cfgMsg);
      this.activeThreadId = null;
      return { messages: [{ role: 'assistant', content: `构建引擎配置失败: ${cfgMsg}` }] };
    }

    const result = await this.executeWithStream(
      {
        messages: [new HumanMessage(userMessage)],
        bookId: context.indexId || '',
        pdfName: context.pdfName || '',
        depth: context.mode === 'proactive' ? ReadingDepth.INSPECTIONAL : undefined,
        mode: (context.mode || 'normal') as EngineMode,
        proactiveTrigger: context.proactiveTrigger ?? undefined,
        highlightContext: context.highlightContext ?? [],
        wereadAvailable: !!context.plugin?.settings?.wereadApiKey,
      },
      callbacks,
      configurable,
      tracer,
    );

    // 后台累计对话轮数（满 10 轮自动更新画像摘要）
    const _pb = context.plugin?.profileBuilder;
    if (_pb) {
      const _userMsg = userMessage || '';
      const _assistantMsg = result.messages?.[0]?.content || '';
      if (_userMsg && _assistantMsg) {
        _pb.accumulateConversationRound(_userMsg, _assistantMsg);
      }
    }

    return result;
  }

  /**
   * 恢复被 HITL 中断的图执行。
   */
  async resumeGraphExecution(
    approved: boolean,
    feedback: string,
    context: ToolContext,
    callbacks: AgentLoopOptions,
    chatHistory?: ChatMessage[],
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    if (!this.activeThreadId) {
      return { messages: [{ role: 'assistant', content: '没有活跃的图会话可恢复' }] };
    }

    let tracer: unknown;
    let configurable: Record<string, unknown>;
    try {
      const cfg = await this.buildGraphConfigurable(context, callbacks, this.activeThreadId, undefined, chatHistory);
      ({ _langsmithTracer: tracer, ...configurable } = cfg);
    } catch (cfgErr) {
      const msg = cfgErr instanceof Error ? cfgErr.message : String(cfgErr);
      log('[FrontendAgent] 恢复执行配置构建失败:', msg);
      callbacks.onError?.(msg);
      return { messages: [{ role: 'assistant', content: `构建引擎配置失败: ${msg}` }] };
    }

    return this.executeWithStream(
      new Command({ resume: { approved, feedback } }),
      callbacks,
      configurable,
      tracer,
      '恢复图执行错误',
    );
  }

  /**
   * 执行图流并统一处理取消/错误。
   * runGraphEngine 和 resumeGraphExecution 的共享逻辑。
   */
  private async executeWithStream(
    streamInput: Parameters<ReturnType<typeof this.getCompiledEngine>['stream']>[0],
    callbacks: AgentLoopOptions,
    configurable: Record<string, unknown>,
    tracer: unknown,
    errorPrefix: string = 'LangGraph 引擎错误',
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    try {
      const stream = await this.getCompiledEngine().stream(
        streamInput,
        {
          streamMode: 'updates',
          configurable,
          signal: callbacks.abortSignal,
          ...(tracer ? { callbacks: [tracer] } : {}),
        },
      );

      const result = await this.processGraphStream(stream, callbacks, { configurable });
      if (!result.interrupted) {
        this.activeThreadId = null;
      }
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        log('[FrontendAgent] 请求被用户取消');
        this.activeThreadId = null;
        return { messages: [] };
      }
      const isAbort = err instanceof Error && (
        err.message.startsWith('Cancel') ||
        err.message.startsWith('AbortError') ||
        err.message === 'Abort' ||
        err.name === 'AbortError'
      );
      if (isAbort || callbacks.abortSignal?.aborted) {
        log('[FrontendAgent] 请求被取消');
        this.activeThreadId = null;
        return { messages: [] };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`[FrontendAgent] ${errorPrefix}:`, errorMsg);
      callbacks.onError?.(errorMsg);
      this.activeThreadId = null;
      return { messages: [{ role: 'assistant', content: `${errorPrefix}: ${errorMsg}` }] };
    }
  }

  /**
   * 构建 LangGraph configurable 对象。
   */
  private async buildGraphConfigurable(
    context: ToolContext,
    callbacks: AgentLoopOptions,
    threadId: string,
    rawUserQuery?: string,
    chatHistory?: ChatMessage[],
  ) {
    if (!this.cachedModels) {
      this.cachedModels = createChatModels(
        { apiKey: this.options.apiKey, baseUrl: this.options.baseUrl || '', model: this.options.model || '', disableThinking: this.options.disableThinking },
        this.options.fastModelEnabled && this.options.fastApiKey
          ? { apiKey: this.options.fastApiKey, baseUrl: this.options.fastBaseUrl || '', model: this.options.fastModel || '', disableThinking: this.options.fastDisableThinking }
          : undefined,
      );
    }
    const models = this.cachedModels;

    const memoryContext = await this.memoryStore.getMemoryContext();

    // 注入 journalDir 到 ToolContext（启用 search_journal 工具）
    if (this.options.journalDir && !context.journalDir) {
      context.journalDir = this.options.journalDir;
    }

    // 读取画像摘要 + 检索相关片段（RAG）
    // 读取用户画像摘要（常驻注入）
    let userProfileSummary: string | undefined;
    const profileBuilder = context.plugin?.profileBuilder;
    if (profileBuilder) {
      try {
        userProfileSummary = await profileBuilder.readSummary() || undefined;
      } catch {
        // 摘要不存在，静默跳过
      }
    }

    // 过滤有效对话历史
    const cleanHistory = (chatHistory ?? []).filter(m => m.role === 'user' || m.role === 'assistant');
    const recentHistorySummaries = summarizeRecentHistory(cleanHistory, 3);
    const prevSearchedBlockIds = extractPrevBlockIds(cleanHistory);

    // SharedContext for S2 compatibility
    const ctx = createSharedContext({
      indexId: context.indexId || '',
      pdfName: context.pdfName || '',
      rawUserQuery: rawUserQuery || '',
      chatHistory: cleanHistory,
      markdownFiles: context.markdownFiles,
      abortSignal: callbacks.abortSignal,
      docDescription: context.docDescription,
      memoryContext,
      llmClientManager: this.llmClientManager,
      toolContext: context,
      recentHistorySummaries,
      prevSearchedBlockIds,
      userProfileSummary,
      booklistBookIds: context.booklistBookIds,
      crossBookMode: !!context.booklistBookIds?.length || !!context.crossBookMode,
      bookshelfSummary: context.bookshelfSummary,
    });

    const engineCallbacks: EngineCallbacks = {
      onProgress: callbacks.onProgress || (() => {}),
      onContent: callbacks.onContent || (() => {}),
      onReasoning: callbacks.onReasoning,
      onComplete: callbacks.onComplete || (() => {}),
      onError: callbacks.onError || (() => {}),
    };

    // LangSmith tracer
    const langsmithTracer = this.options.langsmithEnabled && this.options.langsmithApiKey
      ? getLangSmithTracer({
          apiKey: this.options.langsmithApiKey,
          projectName: this.options.langsmithProject,
        })
      : null;

    if (langsmithTracer) {
      log('[FrontendAgent] LangSmith tracing 已启用');
    }

    return {
      thread_id: threadId,
      fastModel: models.fast,
      mainModel: models.main,
      sharedContext: ctx,
      chatHistory: cleanHistory,
      toolContext: context,
      callbacks: engineCallbacks,
      enableHumanReview: this.options.enableHumanReview ?? false,
      ttsConfig: context.ttsConfig,
      llmConfig: context.llmConfig,
      _langsmithTracer: langsmithTracer,
    };
  }

  private async processGraphStream(
    stream: AsyncIterable<unknown>,
    callbacks: AgentLoopOptions,
    config?: { configurable?: Record<string, unknown> },
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    return processStream(stream, callbacks, config, this.createVoicePipelineCallback());
  }

  private createVoicePipelineCallback() {
    return (formattedOutput: string, cfg: { configurable?: Record<string, unknown> }, cb: AgentLoopOptions) => {
      const ttsCfg = cfg.configurable?.ttsConfig as VoiceConfig | undefined;
      const llmCfg = cfg.configurable?.llmConfig as VoiceConfig | undefined;
      if (!ttsCfg || !llmCfg || !cb.onVoiceReady) return;

      const sharedCtx = cfg.configurable?.sharedContext as Record<string, unknown> | undefined;
      const onChunk = cb.onVoiceChunk;
      generateVoice(formattedOutput, ttsCfg, llmCfg, {
        userQuestion: sharedCtx?.rawUserQuery as string | undefined,
        bookTitle: sharedCtx?.pdfName as string | undefined,
        memoryContext: sharedCtx?.memoryContext as string | undefined,
        abortSignal: cb.abortSignal,
      }, onChunk ? (chunk) => onChunk({ audioChunk: chunk, isComplete: false }) : undefined)
        .then(audioBuffer => {
          if (audioBuffer) {
            const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
            if (onChunk) {
              onChunk({ audioChunk: new ArrayBuffer(0), isComplete: true });
            }
            cb.onVoiceReady!({ audioBuffer, duration });
          }
        }).catch(err => {
          log('[VoicePipeline] voice generation failed:', err instanceof Error ? err.message : String(err));
        });
    };
  }

  async chat(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    const result = await this.runGraphEngine(userMessage, context, callbacks);
    return result.messages;
  }

  async continueChat(
    history: ChatMessage[],
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    const result = await this.runGraphEngine(userMessage, context, callbacks, history);
    return result.messages;
  }

  /**
   * 过滤工具定义，只保留允许的工具
   */
  private filterToolDefinitions(
    allTools: ToolDefinition[],
    allowed: string[]
  ): ToolDefinition[] {
    return allTools.filter(tool => allowed.includes(tool.function.name));
  }

  async reloadSkills(): Promise<void> {
    await this.skillLoader.loadSkills();
  }

  listSkills(): string[] {
    return this.skillLoader.listSkills();
  }

  /**
   * 重载用户上下文（重新加载 MEMORY.md）
   */
  async reloadContext(): Promise<void> {
    log('[FrontendAgent] User context will be refreshed on next prompt');
  }

  /**
   * 清除缓存的用户画像（画像重建后调用）
   */
  invalidateProfileCache(): void {
  }

  /**
   * 获取 LLM 客户端（用于记忆整合等内部功能）
   */
  getLLMClient(): LLMClient {
    return this.llmClientManager.getMainClient();
  }

  /**
   * 获取 MemoryStore（用于里程碑记录等）
   */
  getMemoryStore(): MemoryStore {
    return this.memoryStore;
  }

  /**
   * 初始化并设置 SubagentManager
   */
  setupSubagentManager(context: ToolContext): void {
    const manager = new SubagentManager(
      runAgentLoop,
      this.llmClientManager.getMainClient(),
      context,
      {},
      undefined,
      undefined
    );
    this.subagentManager = manager;
    context.subagentManager = manager;
    log('[FrontendAgent] SubagentManager 已初始化');
  }
}
