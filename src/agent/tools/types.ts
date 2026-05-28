/**
 * Tool Executor 类型定义
 */

import type { ToolDefinition } from '../types.js';
import type { QuoteItem } from '../../components/chat-input/chat-input.js';
import type { EngineMode } from '../graph/state.js';
import type { VaultContext, BookContext, CrossBookContext, WereadContext, VisualContext } from './context/index.js';

export type { QuoteItem } from '../../components/chat-input/chat-input.js';
export type { DeepReaderPluginInterface } from './context/vault.js';

/**
 * Tool 执行上下文
 */
export interface ToolContext {
  vault: VaultContext;
  book: BookContext;
  crossBook?: CrossBookContext;
  weread?: WereadContext;
  visual?: VisualContext;

  // 图节点专用（向后兼容，后续 PR 可逐步移入图节点专属上下文）
  useLLMTreeSearch?: boolean;
  scopeNodeIds?: string[];
  quotes?: QuoteItem[];
  ttsConfig?: { apiKey: string; baseUrl: string; model?: string; provider?: string };
  llmConfig?: { apiKey: string; baseUrl: string; model?: string };
  mode?: EngineMode;
  proactiveTrigger?: string;
  highlightContext?: string[];
}

/**
 * Tool 执行器接口
 */
export interface ToolExecutor {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
