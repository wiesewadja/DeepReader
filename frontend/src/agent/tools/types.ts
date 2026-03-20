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
  /** 范围锁定的节点 ID 列表（只在这些节点范围内搜索） */
  scopeNodeIds?: string[];
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
  /** 全书摘要（由路由器生成，用于注入系统提示） */
  docDescription?: string;
  /** 本地工具缓存（跨工具复用，避免重复构建索引） */
  localCache?: import('./local/types.js').LocalToolCache;
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
