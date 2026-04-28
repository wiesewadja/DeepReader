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

// Re-export everything
export { LLMClient } from './llm-client.js';
export { SkillLoader } from './skills/loader.js';
export { ContextLoader } from './context/index.js';
export { ContextBuilder } from './context/builder.js';
export { initTracer, getTracer } from './tracing/index.js';
export type { ITraceContext, ITracer } from './tracing/types.js';
export type { ChatMessage, ToolDefinition, ToolCall, StreamChunk } from './types.js';
export type { ToolExecutor, ToolRegistry, ToolContext } from './tools/types.js';
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
  ReadingDepth,
  EngineCallbacks,
} from './graph/shared-context.js';

// Import for FrontendAgent class
import { LLMClient, LLMClientManager, type ModelConfig } from './llm-client.js';
import { SkillLoader } from './skills/loader.js';
import { ContextLoader } from './context/index.js';
import { ContextBuilder, type DocumentMetadata } from './context/builder.js';
import { MemoryStore } from './memory/store.js';
import { getToolDefinitions } from './tools/index.js';
import { SubagentManager } from './subagent/manager.js';
import { setSubagentManager } from './tools/create-sub-agent.js';
import { IntentRouter } from './router/index.js';
import type { ChatMessage, ToolDefinition } from './types.js';
import type { AgentLoopOptions } from './agent-loop.js';
import type { ToolContext } from './tools/types.js';
import type { EngineCallbacks } from './graph/shared-context.js';
import { summarizeRecentHistory, extractPrevBlockIds } from './graph/utils/history-summarizer.js';
import { agentLog as log } from '../utils/logger.js';
import { initTracer, getTracer } from './tracing/index.js';
import { HumanMessage } from '@langchain/core/messages';
import { Command, MemorySaver } from '@langchain/langgraph';
import type { ProactiveParams } from './proactive/types';
import { cognitiveEngine } from './graph/index.js';
import { createChatModels } from './models/index.js';
import { getLangSmithTracer, resetLangSmithTracer } from './tracing/langsmith.js';
import { createSharedContext } from './graph/shared-context.js';

export interface FrontendAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string; // 服务商显示名称（用于日志）
  skillsDir: string;
  app: any; // Obsidian App instance

  // 新增：Fast 模型配置（可选）
  fastModelEnabled?: boolean;
  fastApiKey?: string;
  fastBaseUrl?: string;
  fastModel?: string;
  fastProviderName?: string;

  // Langfuse 追踪配置（可选）
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;
  langfuseEnabled?: boolean;

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

    // 初始化追踪器（Langfuse）
    if (options.langfuseEnabled) {
      initTracer({
        publicKey: options.langfusePublicKey,
        secretKey: options.langfuseSecretKey,
        baseUrl: options.langfuseBaseUrl,
      });
    } else {
      initTracer();
    }
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

    let configurable: any;
    let tracer: any;
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

    try {
      const stream = await this.getCompiledEngine().stream(
        {
          messages: [new HumanMessage(userMessage)],
          bookId: context.indexId || '',
          pdfName: context.pdfName || '',
        },
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

      // 后台累计对话轮数（满 10 轮自动更新画像摘要）
      const _pb = (context as any).plugin?.profileBuilder;
      if (_pb) {
        const _userMsg = userMessage || '';
        const _assistantMsg = result.messages?.[0]?.content || '';
        if (_userMsg && _assistantMsg) {
          _pb.accumulateConversationRound(_userMsg, _assistantMsg);
        }
      }

      return result;
    } catch (err) {
      // 用户主动取消（新查询 abort 旧请求）不应显示为错误
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
      log('[FrontendAgent] LangGraph 引擎错误:', errorMsg);
      callbacks.onError?.(errorMsg);
      this.activeThreadId = null;
      return { messages: [{ role: 'assistant', content: `LangGraph 引擎错误: ${errorMsg}` }] };
    }
  }

  /**
   * 主动引导：跳过 Router，直接走 S1→S4 生成引导提问。
   */
  async runProactiveGuidance(
    context: ToolContext,
    callbacks: AgentLoopOptions,
    chatHistory: ChatMessage[],
    params: ProactiveParams,
  ): Promise<{ messages: ChatMessage[] }> {
    await this.initialize();

    const rawQuery = params.trigger === 'inspectional_followup'
      ? `用户回答了引导问题：${params.userReply || ''}`
      : params.trigger === 'inspectional'
        ? '请对这本书做检视阅读引导'
        : `用户在阅读中划了以下内容，请追问：\n${(params.highlightContext || []).join('\n')}`;

    const threadId = `proactive-${context.indexId || Date.now()}`;
    const { _langsmithTracer: tracer, ...configurable } = await this.buildGraphConfigurable(
      context, callbacks, threadId, rawQuery, chatHistory,
    );

    const initialMessages = [new HumanMessage(rawQuery)];

    const stream = await this.getCompiledEngine().stream({
      messages: initialMessages,
      bookId: context.indexId || '',
      pdfName: context.pdfName || '',
      isProactive: true,
      proactiveTrigger: params.trigger,
      proactiveStep: params.step ?? 1,
      highlightContext: params.highlightContext || [],
      rewrittenQuery: params.userReply || undefined,
      depth: 1,
    }, {
      streamMode: 'updates',
      configurable,
      signal: callbacks.abortSignal,
      ...(tracer ? { callbacks: [tracer] } : {}),
    });

    return this.processGraphStream(stream, callbacks, { configurable });
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

    const { _langsmithTracer: tracer, ...configurable } = await this.buildGraphConfigurable(context, callbacks, this.activeThreadId, undefined, chatHistory);

    try {
      const stream = await this.getCompiledEngine().stream(
        new Command({ resume: { approved, feedback } }),
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
      // 用户主动取消不应显示为错误
      if (err instanceof DOMException && err.name === 'AbortError') {
        log('[FrontendAgent] 恢复执行被用户取消');
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
        log('[FrontendAgent] 恢复执行被取消');
        this.activeThreadId = null;
        return { messages: [] };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      callbacks.onError?.(errorMsg);
      this.activeThreadId = null;
      return { messages: [{ role: 'assistant', content: `恢复图执行错误: ${errorMsg}` }] };
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
      (context as any).journalDir = this.options.journalDir;
    }

    // 读取画像摘要 + 检索相关片段（RAG）
    // 读取用户画像摘要（常驻注入）
    let userProfileSummary: string | undefined;
    const profileBuilder = (context as any).plugin?.profileBuilder;
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
      toolRegistry: null as any, // S2 uses createLangChainTools directly
      toolContext: context,
      recentHistorySummaries,
      prevSearchedBlockIds,
      userProfileSummary,
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

  /**
   * 处理 LangGraph 流式输出（updates 模式）。
   *
   * streamMode: "updates" 产生的 chunk 格式：
   * - 正常节点: { nodeName: { field1: value1, ... } }
   * - interrupt: { __interrupt__: [{ value: { nodeId, content, question } }] }
   */

  /**
   * 节点名到用户友好文案的映射
   */
  private static readonly NODE_STATUS_MAP: Record<string, string> = {
    router: '正在理解你的问题...',
    inspectional: '正在翻阅目录，锁定相关章节...',
    analytical: '正在深度分析原文...',
    formatter: '正在整理笔记...',
  };

  private static getNodeStatus(nodeName: string): string {
    return FrontendAgent.NODE_STATUS_MAP[nodeName] || `正在处理...`;
  }

  private async processGraphStream(
    stream: AsyncIterable<unknown>,
    callbacks: AgentLoopOptions,
    config?: { configurable?: Record<string, any> },
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    const onProgress = callbacks.onProgress || (() => {});
    const onContent = callbacks.onContent || (() => {});

    let formattedOutput = '';
    let interruptedNode: { nodeId: string; content: string } | undefined;

    // 语音生成配置
    const ttsCfg = config?.configurable?.ttsConfig;
    const llmCfg = config?.configurable?.llmConfig;
    const enableVoiceReply = !!(ttsCfg && llmCfg && callbacks.onVoiceReady);

    for await (const chunk of stream) {
      if (chunk == null || typeof chunk !== 'object') continue;

      const record = chunk as Record<string, any>;

      // 检测 interrupt（HITL）
      if ('__interrupt__' in record) {
        const interrupts = record.__interrupt__;
        if (Array.isArray(interrupts) && interrupts.length > 0) {
          const interruptValue = interrupts[0]?.value;
          if (interruptValue) {
            interruptedNode = {
              nodeId: interruptValue.nodeId || 'unknown',
              content: interruptValue.content || interruptValue.question || '',
            };
          }
        }
        break;
      }

      // 正常节点更新: { nodeName: stateUpdate }
      const nodeNames = Object.keys(record);
      for (const nodeName of nodeNames) {
        const stateUpdate = record[nodeName];
        if (stateUpdate == null) continue;

        onProgress(FrontendAgent.getNodeStatus(nodeName));

        // 收集格式化输出（流式）
        if (stateUpdate.formattedOutput) {
          formattedOutput = stateUpdate.formattedOutput;
          onContent(formattedOutput);
        }

      }
    }

    // S4 阶段完成后，使用 formattedOutput 生成语音
    if (enableVoiceReply && formattedOutput && callbacks.onVoiceReady) {
      // 优先使用流式回调，否则使用完整音频回调
      const onChunk = callbacks.onVoiceChunk;
      this.generateVoiceFromFormattedOutput(
        formattedOutput,
        ttsCfg,
        llmCfg,
        {
          userQuestion: (config?.configurable?.sharedContext as any)?.userQuestion as string | undefined,
          bookTitle: (config?.configurable?.sharedContext as any)?.bookTitle as string | undefined,
          memoryContext: (config?.configurable?.sharedContext as any)?.memoryContext as string | undefined,
          abortSignal: callbacks.abortSignal,
        },
        onChunk ? (chunk) => onChunk({ audioChunk: chunk, isComplete: false }) : undefined,
      ).then(audioBuffer => {
        if (audioBuffer) {
          const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
          // 发送完成信号
          if (onChunk) {
            onChunk({ audioChunk: new ArrayBuffer(0), isComplete: true });
          }
          callbacks.onVoiceReady!({ audioBuffer, duration });
        }
      }).catch(err => {
        console.warn('[VoicePipeline] voice generation failed:', err);
      });
    }

    if (interruptedNode) {
      return { messages: [], interrupted: interruptedNode };
    }

    callbacks.onComplete?.();

    const resultMessages: ChatMessage[] = [];
    if (formattedOutput) {
      resultMessages.push({ role: 'assistant', content: formattedOutput });
    }

    return { messages: resultMessages };
  }

  /**
   * 从格式化输出生成语音
   * 等流式输出结束后，将内容摘要后分段生成语音并合并成完整段落
   * 支持流式回调：边生成边返回音频块
   */
  private async generateVoiceFromFormattedOutput(
    formattedOutput: string,
    ttsConfig: { apiKey: string; baseUrl: string; model?: string },
    llmConfig: { apiKey: string; baseUrl: string; model?: string },
    options: {
      userQuestion?: string;
      bookTitle?: string;
      memoryContext?: string;
      abortSignal?: AbortSignal;
    },
    onChunk?: (audioChunk: ArrayBuffer) => void,
  ): Promise<ArrayBuffer | null> {
    const signal = options.abortSignal;
    if (signal?.aborted) return null;

    const { TTSSummarizer } = await import('../services/tts/tts-summarizer.js');
    const { TTSClient } = await import('../services/tts/tts-client.js');
    const { TTSService } = await import('../services/tts/tts-service.js');

    const summarizer = new TTSSummarizer({
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model || 'deepseek-chat',
    });

    const client = new TTSClient({
      apiKey: ttsConfig.apiKey,
      baseUrl: ttsConfig.baseUrl,
      model: ttsConfig.model,
    });

    // 先对整个内容进行摘要
    const summary = await summarizer.summarize(formattedOutput, options.userQuestion, {
      bookTitle: options.bookTitle,
      memoryContent: options.memoryContext,
    });

    if (!summary.trim() || signal?.aborted) return null;

    // 按句子切分摘要内容
    const sentences: string[] = [];
    let buffer = summary;
    while (true) {
      const match = buffer.search(/[。！？!?]/);
      if (match === -1) break;
      const end = match + 1;
      const sentence = buffer.slice(0, end);
      buffer = buffer.slice(end);
      if (sentence.trim()) {
        sentences.push(sentence);
      }
    }
    // 处理剩余的文本
    if (buffer.trim()) {
      sentences.push(buffer.trim());
    }

    if (sentences.length === 0) return null;

    // 顺序生成所有句子的音频（保持顺序）
    const audioChunks: ArrayBuffer[] = [];
    for (const sentence of sentences) {
      if (signal?.aborted) break;
      try {
        const audioBuffer = await client.synthesize(sentence);
        audioChunks.push(audioBuffer);
        // 流式回调：每生成一个句子就返回音频块
        if (onChunk) {
          onChunk(audioBuffer);
        }
      } catch (err) {
        console.warn('[VoicePipeline] sentence synthesis failed:', err);
      }
    }

    if (signal?.aborted || audioChunks.length === 0) return null;

    // 合并所有音频片段
    return TTSService.mergeAudioChunks(audioChunks);
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
      this.llmClientManager.getMainClient(),
      null as any, // toolRegistry - SubagentManager uses its own system
      context,
      {},
      undefined,
      undefined
    );
    setSubagentManager(manager);
    log('[FrontendAgent] SubagentManager 已初始化');
  }
}
