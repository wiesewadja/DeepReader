/**
 * FrontendAgent - 前端 Agent 主入口
 *
 * 提供完整的 Agent 功能封装，包括：
 * - LLM 客户端
 * - Skill 加载
 * - 用户上下文（通过 ContextBuilder）
 * - 工具注册
 * - 对话管理
 * - 认知状态机（替代原 ReAct 循环）
 */

// Re-export everything
export { LLMClient } from './llm-client.js';
export { SkillLoader } from './skills/loader.js';
export { runAgentLoop } from './agent-loop.js';
export { ContextLoader } from './context/index.js';
export { ContextBuilder } from './context/builder.js';
export { initTracer, getTracer } from './tracing/index.js';
export type { ITraceContext, ITracer } from './tracing/types.js';
export type { AgentLoopOptions } from './agent-loop.js';
export type { ChatMessage, ToolDefinition, ToolCall, StreamChunk } from './types.js';
export type { ToolExecutor, ToolRegistry, ToolContext } from './tools/types.js';
export type { Skill } from './skills/types.js';
export type { UserContext } from './context/index.js';
export type { DocumentMetadata, ReadingProgress } from './context/builder.js';

// 认知状态机导出
export {
  runCognitiveEngine,
  createSharedContext,
  CognitiveEngineAdapter,
  createCognitiveEngineAdapter,
} from './cognitive-engine/index.js';
export type {
  SharedContext,
  StateResult,
  SearchResult,
  ReadingDepth,
  ModelType,
  StateNodeOptions,
  EngineCallbacks,
  ToolInterceptor,
} from './cognitive-engine/index.js';

// Import for FrontendAgent class
import { LLMClient, LLMClientManager, type ModelConfig } from './llm-client.js';
import { SkillLoader } from './skills/loader.js';
import { ContextLoader } from './context/index.js';
import { ContextBuilder, type DocumentMetadata, type ReadingProgress } from './context/builder.js';
import { MemoryStore } from './memory/store.js';
import { createToolRegistry, getToolDefinitions } from './tools/index.js';
import { runAgentLoop } from './agent-loop.js';
import { SubagentManager } from './subagent/manager.js';
import { setSubagentManager } from './tools/create-sub-agent.js';
import { IntentRouter } from './router/index.js';
import { runCognitiveEngine, createSharedContext } from './cognitive-engine/index.js';
import { summarizeRecentHistory, extractPrevBlockIds } from './cognitive-engine/utils/history-summarizer.js';
import type { ChatMessage, ToolDefinition } from './types.js';
import type { AgentLoopOptions } from './agent-loop.js';
import type { ToolContext } from './tools/types.js';
import type { EngineCallbacks } from './cognitive-engine/types.js';
import { agentLog as log } from '../utils/logger.js';
import { initTracer, getTracer } from './tracing/index.js';
import { HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { cognitiveEngine, createCognitiveEngine } from './graph/index.js';
import { FileCheckpointer } from './graph/checkpointer.js';
import { createChatModels } from './models/index.js';

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

  // LangGraph 引擎设置（可选）
  useLangGraphEngine?: boolean;
  enableHumanReview?: boolean;
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
  private fileCheckpointer: FileCheckpointer | null = null;
  private compiledEngine: ReturnType<typeof createCognitiveEngine> | null = null;
  private cachedModels: ReturnType<typeof createChatModels> | null = null;

  constructor(private options: FrontendAgentOptions) {
    // 构建 main 配置
    const mainConfig: ModelConfig = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      providerName: options.providerName,
    };

    // 构建 fast 配置（如果启用）
    let fastConfig: ModelConfig | undefined;
    if (options.fastModelEnabled && options.fastApiKey) {
      fastConfig = {
        apiKey: options.fastApiKey,
        baseUrl: options.fastBaseUrl,
        model: options.fastModel,
        providerName: options.fastProviderName,
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
   *
   * 注意：Tools 通过 Function Calling API 传递，不在 System Prompt 中
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

    // Tools 不再放在 System Prompt 中，仅通过 Function Calling API 传递
    return this.contextBuilder.buildSystemPrompt(
      skillsSummary,
      documentMetadata,
      docDescription
    );
  }

  /**
   * 获取编译后的认知引擎（带持久化 checkpointer）。
   */
  private getCompiledEngine() {
    if (this.compiledEngine) return this.compiledEngine;

    if (this.options.app?.vault?.adapter) {
      this.fileCheckpointer = new FileCheckpointer(this.options.app);
      this.compiledEngine = createCognitiveEngine(this.fileCheckpointer);
      log('[FrontendAgent] 使用 FileCheckpointer 持久化');
    } else {
      this.compiledEngine = cognitiveEngine;
      log('[FrontendAgent] 使用 MemorySaver（无持久化）');
    }
    return this.compiledEngine;
  }

  /**
   * 检查并压缩过大的 MEMORY.md
   * 在每次构建 System Prompt 时检查，主动触发压缩
   */
  private async maybeCompressMemory(): Promise<void> {
    const needsCompression = await this.memoryStore.needsCompression();
    if (!needsCompression) return;

    log('[FrontendAgent] 🔄 MEMORY.md 超限，触发主动压缩...');

    // 读取当前记忆内容
    const currentMemory = await this.memoryStore.readLongTermMemory();
    if (!currentMemory) return;

    // 使用 LLM 压缩
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
1. **合并重复**：同一概念只保留一次（如"社会中心主义"出现多次 → 只保留一次）
2. **删除临时状态**：
   - 删除"正在阅读"、"当前关注"等会过时的状态
   - 删除过于详细的描述
3. **极简表达**：
   - 用关键词替代完整句子
   - 用"-"列表替代段落
4. **保持结构**：用户画像/阅读偏好/兴趣主题/阅读习惯

直接返回压缩后的 Markdown 内容，不要任何解释。`;

    try {
      // 使用非流式调用获取完整响应
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
    progress?: ReadingProgress,
    systemNote?: string
  ): ChatMessage[] {
    return ContextBuilder.buildMessagesWithMetadata(
      systemPrompt,
      history,
      userMessage,
      metadata,
      progress,
      systemNote
    );
  }

  /**
   * 使用 LangGraph 认知引擎处理查询。
   *
   * 桥接 LangGraph StateGraph 到现有 UI 回调系统。
   * 支持 Human-in-the-Loop（HITL）中断。
   */
  async runGraphEngine(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions,
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    await this.initialize();

    const threadId = `thread-${Date.now()}`;
    this.activeThreadId = threadId;

    const configurable = await this.buildGraphConfigurable(context, callbacks, threadId, userMessage);

    try {
      const stream = await this.getCompiledEngine().stream(
        {
          messages: [new HumanMessage(userMessage)],
          bookId: context.indexId || '',
          pdfName: context.pdfName || '',
        },
        { configurable, signal: callbacks.abortSignal },
      );

      const result = await this.processGraphStream(stream, callbacks);
      // 正常完成或错误时清理 threadId，interrupted 时保留供 resume 使用
      if (!result.interrupted) {
        this.activeThreadId = null;
      }
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      callbacks.onError?.(errorMsg);
      this.activeThreadId = null;
      return { messages: [{ role: 'assistant', content: `LangGraph 引擎错误: ${errorMsg}` }] };
    }
  }

  /**
   * 恢复被 HITL 中断的图执行。
   *
   * 使用 Command({ resume }) 发送用户审查结果，
   * 图从中断点继续执行。
   */
  async resumeGraphExecution(
    approved: boolean,
    feedback: string,
    context: ToolContext,
    callbacks: AgentLoopOptions,
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    if (!this.activeThreadId) {
      return { messages: [{ role: 'assistant', content: '没有活跃的图会话可恢复' }] };
    }

    const configurable = await this.buildGraphConfigurable(context, callbacks, this.activeThreadId);

    try {
      const stream = await this.getCompiledEngine().stream(
        new Command({ resume: { approved, feedback } }),
        { configurable, signal: callbacks.abortSignal },
      );

      const result = await this.processGraphStream(stream, callbacks);
      if (!result.interrupted) {
        this.activeThreadId = null;
      }
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      callbacks.onError?.(errorMsg);
      this.activeThreadId = null;
      return { messages: [{ role: 'assistant', content: `恢复图执行错误: ${errorMsg}` }] };
    }
  }

  /**
   * 构建 LangGraph configurable 对象（公共逻辑）。
   */
  private async buildGraphConfigurable(
    context: ToolContext,
    callbacks: AgentLoopOptions,
    threadId: string,
    rawUserQuery?: string,
  ) {
    if (!this.cachedModels) {
      this.cachedModels = createChatModels(
        { apiKey: this.options.apiKey, baseUrl: this.options.baseUrl || '', model: this.options.model || '' },
        this.options.fastModelEnabled && this.options.fastApiKey
          ? { apiKey: this.options.fastApiKey, baseUrl: this.options.fastBaseUrl || '', model: this.options.fastModel || '' }
          : undefined,
      );
    }
    const models = this.cachedModels;

    const toolRegistry = createToolRegistry(this.skillLoader, context);
    const memoryContext = await this.memoryStore.getMemoryContext();

    const ctx = createSharedContext({
      indexId: context.indexId || '',
      pdfName: context.pdfName || '',
      rawUserQuery: rawUserQuery || '',
      chatHistory: [],
      markdownFiles: context.markdownFiles,
      abortSignal: callbacks.abortSignal,
      docDescription: context.docDescription,
      memoryContext,
      llmClientManager: this.llmClientManager,
      toolRegistry: toolRegistry,
      toolContext: context,
    });

    const engineCallbacks: EngineCallbacks = {
      onProgress: callbacks.onProgress || (() => {}),
      onContent: callbacks.onContent || (() => {}),
      onReasoning: callbacks.onReasoning,
      onComplete: callbacks.onComplete || (() => {}),
      onError: callbacks.onError || (() => {}),
    };

    return {
      thread_id: threadId,
      fastModel: models.fast,
      mainModel: models.main,
      sharedContext: ctx,
      chatHistory: [],
      toolContext: context,
      callbacks: engineCallbacks,
      enableHumanReview: this.options.enableHumanReview ?? false,
    };
  }

  /**
   * 处理 LangGraph 流式输出（公共逻辑）。
   * 检测 interrupt，映射到 callbacks，返回统一结果。
   */
  private async processGraphStream(
    stream: AsyncIterable<unknown>,
    callbacks: AgentLoopOptions,
  ): Promise<{ messages: ChatMessage[]; interrupted?: { nodeId: string; content: string } }> {
    const onProgress = callbacks.onProgress || (() => {});
    const onContent = callbacks.onContent || (() => {});

    let formattedOutput = '';
    let interruptedNode: { nodeId: string; content: string } | undefined;

    for await (const chunk of stream) {
      if (Array.isArray(chunk) && chunk.length === 2) {
        const [nodeName, stateUpdate] = chunk as [string, any];

        onProgress(`正在执行: ${nodeName}`);

        // 检测 interrupt（HITL）
        if (nodeName === '__interrupt__') {
          const interruptValue = stateUpdate?.value;
          if (interruptValue) {
            interruptedNode = {
              nodeId: interruptValue.nodeId || nodeName,
              content: interruptValue.content || interruptValue.question || '',
            };
          }
          break;
        }

        // 收集格式化输出
        if (stateUpdate?.formattedOutput) {
          formattedOutput = stateUpdate.formattedOutput;
          onContent(formattedOutput);
        }
      }
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

  async chat(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    // LangGraph 引擎切换
    if (this.options.useLangGraphEngine) {
      const result = await this.runGraphEngine(userMessage, context, callbacks);
      return result.messages;
    }

    // 创建工具注册表
    const toolRegistry = createToolRegistry(this.skillLoader, context);

    // 创建认知引擎所需的回调
    const engineCallbacks: EngineCallbacks = {
      onProgress: callbacks.onProgress || (() => {}),
      onContent: callbacks.onContent || (() => {}),
      onReasoning: callbacks.onReasoning,
      onComplete: callbacks.onComplete || (() => {}),
      onError: callbacks.onError || (() => {}),
    };

    // 读取长期记忆上下文（用于 S4 个性化输出）
    const memoryContext = await this.memoryStore.getMemoryContext();

    // 创建 SharedContext
    const ctx = createSharedContext({
      indexId: context.indexId || '',
      pdfName: context.pdfName || '',
      rawUserQuery: userMessage,
      chatHistory: [],
      markdownFiles: context.markdownFiles,
      abortSignal: callbacks.abortSignal,
      docDescription: context.docDescription,  // 全书摘要
      memoryContext,  // 长期记忆
      // 传递引擎依赖
      llmClientManager: this.llmClientManager,
      toolRegistry: toolRegistry,
      toolContext: context,
    });

    // 运行认知引擎
    await runCognitiveEngine(ctx, engineCallbacks);

    // 返回更新后的消息历史
    return ctx.chatHistory;
  }

  async continueChat(
    history: ChatMessage[],
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    // LangGraph 引擎切换
    if (this.options.useLangGraphEngine) {
      const result = await this.runGraphEngine(userMessage, context, callbacks);
      return result.messages;
    }

    const toolRegistry = createToolRegistry(this.skillLoader, context);

    const engineCallbacks: EngineCallbacks = {
      onProgress: callbacks.onProgress || (() => {}),
      onContent: callbacks.onContent || (() => {}),
      onReasoning: callbacks.onReasoning,
      onComplete: callbacks.onComplete || (() => {}),
      onError: callbacks.onError || (() => {}),
    };

    const cleanHistory = history.filter(m => m.role === 'user' || m.role === 'assistant');

    const recentHistorySummaries = summarizeRecentHistory(cleanHistory, 3);

    const prevSearchedBlockIds = extractPrevBlockIds(cleanHistory);

    const memoryContext = await this.memoryStore.getMemoryContext();

    const ctx = createSharedContext({
      indexId: context.indexId || '',
      pdfName: context.pdfName || '',
      rawUserQuery: userMessage,
      chatHistory: cleanHistory,
      markdownFiles: context.markdownFiles,
      abortSignal: callbacks.abortSignal,
      docDescription: context.docDescription,
      memoryContext,
      llmClientManager: this.llmClientManager,
      toolRegistry: toolRegistry,
      toolContext: context,
      recentHistorySummaries,
      prevSearchedBlockIds,
    });

    await runCognitiveEngine(ctx, engineCallbacks);

    return ctx.chatHistory;
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
    // ContextBuilder 每次调用都会重新读取 MEMORY.md
    // 这里只需要刷新 memoryStore 的缓存（如果有的话）
    log('[FrontendAgent] User context will be refreshed on next prompt');
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
   *
   * 必须在 chat/continueChat 之前调用，传入 ToolContext
   * SubagentManager 需要 ToolContext 来访问文档信息
   */
  setupSubagentManager(context: ToolContext): void {
    const toolRegistry = createToolRegistry(this.skillLoader, context);
    const manager = new SubagentManager(
      this.llmClientManager.getMainClient(),
      toolRegistry,
      context,
      {},
      undefined,
      undefined // traceCtx - will be set per-session
    );
    setSubagentManager(manager);
    log('[FrontendAgent] SubagentManager 已初始化');
  }
}
