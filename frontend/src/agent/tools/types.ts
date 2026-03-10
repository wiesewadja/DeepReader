/**
 * Tool Executor 类型定义
 */

import type { App } from 'obsidian';
import type { ToolDefinition } from '../types.js';

/**
 * Tool 执行上下文
 */
export interface ToolContext {
  indexId: string;
  pdfName: string;
  /** node_id 到 Markdown 文件路径的映射 */
  markdownFiles?: Record<string, string>;
  /** 是否使用 LLM 树搜索（深度思考模式） */
  useLLMTreeSearch?: boolean;
  /** Obsidian App 实例（用于 vault 操作） */
  app?: App;
}

/**
 * Tool 执行器接口
 */
export interface ToolExecutor {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

/**
 * Tool 注册表类型
 */
export type ToolRegistry = Map<string, ToolExecutor>;
