/**
 * Tool Executor 类型定义
 */

import type { App } from 'obsidian';
import type { ToolDefinition } from '../types.js';

/**
 * 阅读进度信息
 */
export interface ReadingProgress {
  bookName: string;
  totalChapters: number;

  // 熟悉度数据
  chapterFamiliarity: Record<number, number>;
  totalInteractions: number;

  // 计算指标
  coverage: number;      // 覆盖度 %
  absorption: number;    // 吸收度 %

  // 热点章节
  mostFamiliarChapter: string;
  leastFamiliarChapters: string[];

  // 时间信息
  lastActiveTime: string;
  daysSinceLastRead: number;
}

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
  /** 阅读进度信息 */
  readingProgress?: ReadingProgress;
  /** 会话 ID（用于子任务关联） */
  sessionId?: string;
  /** 文档元数据（用于 ContextBuilder） */
  documentMetadata?: {
    title?: string;
    page_count?: number;
    author?: string;
  };
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
