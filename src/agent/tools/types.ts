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
  mode?: EngineMode;
  proactiveTrigger?: string;
  highlightContext?: string[];
  queryVector?: number[] | null;
}

/**
 * Tool 执行器接口
 */
export interface ToolExecutor {
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

/**
 * 统一工具错误文案：所有 definitions/*.ts 的 catch 返回此字符串。
 *
 * LangChain 工具契约是向模型返回 string，故统一为带错误码前缀的字符串
 * （而非结构化对象——节点层无 JSON 解析点，结构化返回会成为无人消费的死类型）。
 * 替代此前混用的两种形态：`搜索失败: ${msg}`（weread-tools）、
 * `JSON.stringify({status:'ERROR'})`（search-journal）。
 */
export function formatToolError(code: string, message: string): string {
  return `[TOOL_ERROR:${code}] ${message}`;
}
