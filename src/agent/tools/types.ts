/**
 * Tool Executor 类型定义
 */

import type { QuoteItem } from '../../components/chat-input/chat-input.js';
import type { EngineMode } from '../graph/state.js';
import type { VaultContext, BookContext, CrossBookContext, WereadContext, VisualContext } from './context/index.js';

export type { QuoteItem } from '../../components/chat-input/chat-input.js';
export type { DeepReaderPluginInterface } from './context/vault.js';

export interface ToolContext {
  vault: VaultContext;
  book: BookContext;
  crossBook?: CrossBookContext;
  weread?: WereadContext;
  visual?: VisualContext;

  // 图节点专用（向后兼容，后续 PR 可逐步移入图节点专属上下文）
  useLLMTreeSearch?: boolean;
  /** @deprecated 无赋值点，消费者已移除 */
  scopeNodeIds?: string[];
  /** @deprecated 无赋值点，消费者已移除 */
  quotes?: QuoteItem[];
  mode?: EngineMode;
  proactiveTrigger?: string;
  highlightContext?: string[];
}

/**
 * Tool 执行器接口
 */
export interface ToolExecutor {
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
