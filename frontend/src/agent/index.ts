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
export { dumpSystemPrompt, quickDump } from './debug/system-prompt-dump.js';
export { initDebugLogger, getDebugLogger, DEBUG_LOG_ENABLED } from './debug/index.js';
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
import { LLMClient } from './llm-client.js';
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
import type { ChatMessage, ToolDefinition } from './types.js';
import type { AgentLoopOptions } from './agent-loop.js';
import type { ToolContext } from './tools/types.js';
import type { EngineCallbacks } from './cognitive-engine/types.js';
import { agentLog as log } from '../utils/logger.js';
import { initDebugLogger, getDebugLogger } from './debug/index.js';

export interface FrontendAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string; // 服务商显示名称（用于日志）
  skillsDir: string;
  app: any; // Obsidian App instance
}

export class FrontendAgent {
  private llmClient: LLMClient;
  private skillLoader: SkillLoader;
  private contextLoader: ContextLoader;
  private contextBuilder: ContextBuilder;
  private memoryStore: MemoryStore;
  private intentRouter: IntentRouter;
  private initialized = false;

  constructor(private options: FrontendAgentOptions) {
    this.llmClient = new LLMClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      providerName: options.providerName,
    });
    this.skillLoader = new SkillLoader(options.skillsDir);
    this.contextLoader = new ContextLoader(options.app);
    this.memoryStore = new MemoryStore(options.app);
    this.contextBuilder = new ContextBuilder(options.app, this.memoryStore, {
      deepReaderDir: 'DeepReader',
    });
    this.intentRouter = new IntentRouter();

    // 🐛 初始化调试日志器
    initDebugLogger(options.app, {
      logDir: 'debug-logs',
    });
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
      const response = await this.llmClient.chat([
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

  async chat(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

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

    // 创建 SharedContext
    const ctx = createSharedContext({
      indexId: context.indexId || '',
      pdfName: context.pdfName || '',
      rawUserQuery: userMessage,
      chatHistory: [],
      markdownFiles: context.markdownFiles,
      abortSignal: callbacks.abortSignal,
      docDescription: context.docDescription,  // 全书摘要
      // 传递引擎依赖
      llmClient: this.llmClient,
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

    // 提取纯净历史（只有 user 和 assistant 消息）
    const cleanHistory = history.filter(m => m.role === 'user' || m.role === 'assistant');

    // 创建 SharedContext
    const ctx = createSharedContext({
      indexId: context.indexId || '',
      pdfName: context.pdfName || '',
      rawUserQuery: userMessage,
      chatHistory: cleanHistory,
      markdownFiles: context.markdownFiles,
      abortSignal: callbacks.abortSignal,
      docDescription: context.docDescription,  // 全书摘要
      // 传递引擎依赖
      llmClient: this.llmClient,
      toolRegistry: toolRegistry,
      toolContext: context,
    });

    // 运行认知引擎
    await runCognitiveEngine(ctx, engineCallbacks);

    // 返回更新后的消息历史
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
    return this.llmClient;
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
      this.llmClient,
      toolRegistry,
      context
    );
    setSubagentManager(manager);
    log('[FrontendAgent] SubagentManager 已初始化');
  }
}
