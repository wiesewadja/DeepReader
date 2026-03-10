/**
 * FrontendAgent - 前端 Agent 主入口
 *
 * 提供完整的 Agent 功能封装，包括：
 * - LLM 客户端
 * - Skill 加载
 * - 用户上下文
 * - 工具注册
 * - 对话管理
 */

// Re-export everything
export { LLMClient } from './llm-client.js';
export { SkillLoader } from './skills/loader.js';
export { runAgentLoop } from './agent-loop.js';
export { buildSystemPrompt } from './prompts.js';
export { ContextLoader } from './context/index.js';
export type { AgentLoopOptions } from './agent-loop.js';
export type { ChatMessage, ToolDefinition, ToolCall, StreamChunk } from './types.js';
export type { ToolExecutor, ToolRegistry, ToolContext } from './tools/types.js';
export type { Skill } from './skills/types.js';
export type { UserContext } from './context/index.js';

// Import for FrontendAgent class
import { LLMClient } from './llm-client.js';
import { SkillLoader } from './skills/loader.js';
import { ContextLoader } from './context/index.js';
import { createToolRegistry, getToolDefinitions } from './tools/index.js';
import { runAgentLoop } from './agent-loop.js';
import { buildSystemPrompt } from './prompts.js';
import type { ChatMessage } from './types.js';
import type { AgentLoopOptions } from './agent-loop.js';
import type { ToolContext } from './tools/types.js';
import { log } from '../utils/logger.js';

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
  private initialized = false;
  private userContext: { profile: string; memorySummary: string; hasProfile: boolean } | null = null;

  constructor(private options: FrontendAgentOptions) {
    this.llmClient = new LLMClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    });
    this.skillLoader = new SkillLoader(options.skillsDir);
    this.contextLoader = new ContextLoader(options.app);
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      // 确保目录结构存在
      await this.contextLoader.ensureDirectories();

      // 加载 Skills
      await this.skillLoader.loadSkills();

      // 加载用户上下文
      this.userContext = await this.contextLoader.loadContext();
      log('[FrontendAgent] User context loaded, hasProfile:', this.userContext.hasProfile);

      this.initialized = true;
    }
  }

  getSystemPrompt(): string {
    return buildSystemPrompt(this.skillLoader, this.userContext || undefined);
  }

  async chat(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();
    const systemPrompt = this.getSystemPrompt();
    const toolRegistry = createToolRegistry(this.skillLoader, context);
    const tools = getToolDefinitions(toolRegistry);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];
    return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
  }

  async continueChat(
    history: ChatMessage[],
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();
    const systemPrompt = this.getSystemPrompt();
    const toolRegistry = createToolRegistry(this.skillLoader, context);
    const tools = getToolDefinitions(toolRegistry);

    // 更新历史中的 system prompt（以支持 skill 热重载）
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.filter(msg => msg.role !== 'system'),
      { role: 'user', content: userMessage },
    ];
    return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
  }

  async reloadSkills(): Promise<void> {
    await this.skillLoader.loadSkills();
  }

  listSkills(): string[] {
    return this.skillLoader.listSkills();
  }

  /**
   * 重载用户上下文
   */
  async reloadContext(): Promise<void> {
    this.userContext = await this.contextLoader.loadContext();
    log('[FrontendAgent] User context reloaded');
  }
}
