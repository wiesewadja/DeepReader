/**
 * FrontendAgent - 前端 Agent 主入口
 *
 * 提供完整的 Agent 功能封装，包括：
 * - LLM 客户端
 * - Skill 加载
 * - 用户上下文（通过 ContextBuilder）
 * - 工具注册
 * - 对话管理
 */

// Re-export everything
export { LLMClient } from './llm-client.js';
export { SkillLoader } from './skills/loader.js';
export { runAgentLoop } from './agent-loop.js';
export { ContextLoader } from './context/index.js';
export { ContextBuilder } from './context/builder.js';
export type { AgentLoopOptions } from './agent-loop.js';
export type { ChatMessage, ToolDefinition, ToolCall, StreamChunk } from './types.js';
export type { ToolExecutor, ToolRegistry, ToolContext } from './tools/types.js';
export type { Skill } from './skills/types.js';
export type { UserContext } from './context/index.js';
export type { DocumentMetadata, ReadingProgress } from './context/builder.js';

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
import type { ChatMessage } from './types.js';
import type { AgentLoopOptions } from './agent-loop.js';
import type { ToolContext } from './tools/types.js';
import { agentLog as log } from '../utils/logger.js';

export interface FrontendAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  skillsDir: string;
  app: any; // Obsidian App instance
}

export class FrontendAgent {
  private llmClient: LLMClient;
  private skillLoader: SkillLoader;
  private contextLoader: ContextLoader;
  private contextBuilder: ContextBuilder;
  private memoryStore: MemoryStore;
  private initialized = false;

  constructor(private options: FrontendAgentOptions) {
    this.llmClient = new LLMClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    });
    this.skillLoader = new SkillLoader(options.skillsDir);
    this.contextLoader = new ContextLoader(options.app);
    this.memoryStore = new MemoryStore(options.app);
    this.contextBuilder = new ContextBuilder(options.app, this.memoryStore, {
      deepReaderDir: 'DeepReader',
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
   */
  async getSystemPromptAsync(
    documentMetadata?: DocumentMetadata
  ): Promise<string> {
    await this.initialize();

    // 获取工具描述
    const tempContext = { app: this.options.app } as ToolContext;
    const toolRegistry = createToolRegistry(this.skillLoader, tempContext);
    const tools = getToolDefinitions(toolRegistry);

    // 构建工具描述文本
    const toolDescriptions = tools.map(t => {
      const func = t.function;
      return `### ${func.name}\n${func.description}`;
    }).join('\n\n');

    // 获取技能描述
    const skillDescriptions = this.skillLoader.getDescriptions();

    // 使用 ContextBuilder 构建完整的系统提示
    return this.contextBuilder.buildSystemPrompt(
      toolDescriptions,
      skillDescriptions,
      documentMetadata
    );
  }

  /**
   * 构建完整的消息列表（带运行时上下文）
   */
  buildMessages(
    systemPrompt: string,
    history: ChatMessage[],
    userMessage: string,
    metadata?: DocumentMetadata,
    progress?: ReadingProgress
  ): ChatMessage[] {
    return ContextBuilder.buildMessagesWithMetadata(
      systemPrompt,
      history,
      userMessage,
      metadata,
      progress
    );
  }

  async chat(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    // 使用 ContextBuilder 构建系统提示
    const systemPrompt = await this.getSystemPromptAsync(context.documentMetadata);

    const toolRegistry = createToolRegistry(this.skillLoader, context);
    const tools = getToolDefinitions(toolRegistry);

    // 构建消息（带运行时上下文）
    const messages = this.buildMessages(
      systemPrompt,
      [],
      userMessage,
      context.documentMetadata,
      context.readingProgress
    );

    return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
  }

  async continueChat(
    history: ChatMessage[],
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    // 使用 ContextBuilder 构建系统提示
    const systemPrompt = await this.getSystemPromptAsync(context.documentMetadata);

    const toolRegistry = createToolRegistry(this.skillLoader, context);
    const tools = getToolDefinitions(toolRegistry);

    // 构建消息（带运行时上下文）
    const messages = this.buildMessages(
      systemPrompt,
      history,
      userMessage,
      context.documentMetadata,
      context.readingProgress
    );

    return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
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
