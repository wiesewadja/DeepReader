/**
 * Tool Executor 类型定义
 */

import type { App, FileSystemAdapter } from 'obsidian';
import type { ToolDefinition } from '../types.js';
import type { QuoteItem } from '../../components/chat-input/chat-input.js';
import type { DeepPDFSettings } from '../../config/settings.js';
import type { EngineMode } from '../graph/state.js';

/**
 * 插件实例的最小类型接口（消除 plugin: any）
 */
export interface DeepReaderPlugin {
  settings: DeepPDFSettings;
  profileBuilder?: {
    readSummary(): Promise<string | null>;
    readMeta(): Promise<import('../../services/profile-builder.js').ProfileMeta | null>;
    accumulateConversationRound(userMessage: string, assistantMessage: string): void;
  };
}

// 重新导出 QuoteItem 供其他模块使用
export type { QuoteItem } from '../../components/chat-input/chat-input.js';

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
  /** 用户引用的结构化数据（选中文本时附加的上下文） */
  quotes?: QuoteItem[];
  /** 当前阅读章节的 node_id（用于搜索提权） */
  currentNodeId?: string;
  /** 插件实例（用于访问设置和画像构建器） */
  plugin?: DeepReaderPlugin;
  /** TTS 配置（用于 VoicePipeline 语音合成） */
  ttsConfig?: { apiKey: string; baseUrl: string; model?: string; provider?: string };
  /** LLM 配置（用于 VoicePipeline 语音摘要生成） */
  llmConfig?: { apiKey: string; baseUrl: string; model?: string };
  /** 用户笔记目录（配置后启用 search_journal 工具） */
  journalDir?: string;
  /** 信息图生成配置（配置后启用 generate_infographic 工具） */
  infographicConfig?: { apiKey: string; baseUrl?: string; model?: string; relativeDir: string; vaultAdapter: FileSystemAdapter };
  /** 引擎模式：normal / proactive / socratic */
  mode?: EngineMode;
  /** 主动引导触发类型（inspectional / highlight / chapter） */
  proactiveTrigger?: string;
  /** 用户划线内容（用于 highlight / chapter 触发） */
  highlightContext?: string[];
  /** 子 Agent 管理器（通过 ToolContext 注入，替代全局单例） */
  subagentManager?: import('../subagent/types.js').ISubagentManager;
  /** 书架摘要（阅读顾问模式下注入用户全量书架上下文） */
  bookshelfSummary?: string;
  /** 缓存的 WereadApiClient 实例（避免每次工具调用新建） */
  _wereadClient?: import('../../weread/api/client.js').WereadApiClient;
}

/**
 * Tool 执行器接口
 */
export interface ToolExecutor {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
