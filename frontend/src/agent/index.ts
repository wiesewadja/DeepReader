/**
 * FrontendAgent - 前端 Agent 主入口
 *
 * 提供完整的 Agent 功能封装，包括：
 * - LLM 客户端
 * - Skill 加载
 * - 工具注册
 * - 对话管理
 */

// Re-export everything
export { LLMClient } from './llm-client.js';
export { SkillLoader } from './skills/loader.js';
export { runAgentLoop } from './agent-loop.js';
export { buildSystemPrompt } from './prompts.js';
export type { AgentLoopOptions } from './agent-loop.js';
export type { ChatMessage, ToolDefinition, ToolCall, StreamChunk } from './types.js';
export type { ToolExecutor, ToolRegistry, ToolContext } from './tools/types.js';
export type { Skill } from './skills/types.js';

// Import for FrontendAgent class
import { LLMClient } from './llm-client.js';
import { SkillLoader } from './skills/loader.js';
import { createToolRegistry, getToolDefinitions } from './tools/index.js';
import { runAgentLoop } from './agent-loop.js';
import { buildSystemPrompt } from './prompts.js';
import type { ChatMessage } from './types.js';
import type { AgentLoopOptions } from './agent-loop.js';
import type { ToolContext } from './tools/types.js';

export interface FrontendAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  skillsDir: string;
}

export class FrontendAgent {
  private llmClient: LLMClient;
  private skillLoader: SkillLoader;
  private initialized = false;

  constructor(private options: FrontendAgentOptions) {
    this.llmClient = new LLMClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    });
    this.skillLoader = new SkillLoader(options.skillsDir);
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.skillLoader.loadSkills();
      this.initialized = true;
    }
  }

  getSystemPrompt(): string {
    return buildSystemPrompt(this.skillLoader);
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
    const toolRegistry = createToolRegistry(this.skillLoader, context);
    const tools = getToolDefinitions(toolRegistry);
    const messages: ChatMessage[] = [
      ...history,
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
}
