/**
 * Cognitive Engine Adapter
 *
 * 将认知状态机集成到现有 FrontendAgent 架构中
 * 提供与现有 runAgentLoop 兼容的接口
 */

import type { ChatMessage, ToolDefinition } from '../../types';
import type { ToolContext, ToolRegistry } from '../../tools/types';
import { LLMClient } from '../../llm-client';
import { runCognitiveEngine, createSharedContext } from '../index';
import type { SharedContext, EngineCallbacks, ReadingDepth } from '../types';

/**
 * 认知引擎适配器选项
 */
export interface CognitiveEngineAdapterOptions {
  /** LLM 客户端实例 */
  llmClient: LLMClient;
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 工具上下文 */
  toolContext: ToolContext;
  /** 最大历史消息数（Token 限制） */
  maxHistoryMessages?: number;
}

/**
 * 认知引擎适配器
 *
 * 将认知状态机包装为与现有 Agent 兼容的接口
 */
export class CognitiveEngineAdapter {
  private llmClient: LLMClient;
  private toolRegistry: ToolRegistry;
  private toolContext: ToolContext;
  private maxHistoryMessages: number;

  constructor(options: CognitiveEngineAdapterOptions) {
    this.llmClient = options.llmClient;
    this.toolRegistry = options.toolRegistry;
    this.toolContext = options.toolContext;
    this.maxHistoryMessages = options.maxHistoryMessages || 10;
  }

  /**
   * 运行认知引擎（主入口）
   *
   * 与现有 runAgentLoop 接口兼容
   */
  async run(
    messages: ChatMessage[],
    _tools: ToolDefinition[], // 工具由状态机内部控制
    callbacks: EngineCallbacks
  ): Promise<ChatMessage[]> {
    // 1. 从消息历史提取用户查询
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }
    const rawUserQuery = typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : '';

    // 2. 提取聊天历史（纯净的前台记录）
    const chatHistory = this.extractCleanHistory(messages);

    // 3. 创建 SharedContext
    const ctx = createSharedContext({
      indexId: this.toolContext.indexId || '',
      pdfName: this.toolContext.pdfName || '',
      rawUserQuery,
      chatHistory,
      markdownFiles: this.toolContext.markdownFiles,
      // 传递引擎依赖
      llmClient: this.llmClient,
      toolRegistry: this.toolRegistry,
      toolContext: this.toolContext,
    });

    // 4. 运行认知引擎
    const output = await runCognitiveEngine(ctx, {
      onProgress: callbacks.onProgress,
      onContent: callbacks.onContent,
      onReasoning: callbacks.onReasoning,
      onComplete: callbacks.onComplete,
      onError: callbacks.onError,
    });

    // 5. 返回更新后的消息历史
    return ctx.chatHistory;
  }

  /**
   * 从消息列表中提取纯净的前台历史
   * （只保留 user 和 assistant 消息，不包含 tool 消息）
   */
  private extractCleanHistory(messages: ChatMessage[]): ChatMessage[] {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: m.content,
        name: m.name,
      }));
  }

  /**
   * 更新工具上下文（用于切换文档等场景）
   */
  updateToolContext(context: Partial<ToolContext>): void {
    this.toolContext = { ...this.toolContext, ...context };
  }
}

/**
 * 创建认知引擎适配器
 */
export function createCognitiveEngineAdapter(
  options: CognitiveEngineAdapterOptions
): CognitiveEngineAdapter {
  return new CognitiveEngineAdapter(options);
}
