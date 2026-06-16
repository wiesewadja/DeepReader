/**
 * S4 Formatter System Prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/utils.js' instead.
 */

export {
  buildFormatterSystemPrompt,
  buildFormatterUserMessage,
  MAX_HISTORY_ROUNDS,
} from '../../prompts/utils.js';
export { formatterPrompt } from '../../prompts/core/formatter.js';
