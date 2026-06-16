/**
 * Proactive Formatter prompts - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/utils.js' instead.
 */

export {
  buildProactiveSystemPrompt,
  buildProactiveUserMessage,
  buildSocraticDialoguePrompt,
  buildSocraticDialogueUserMessage,
} from '../../prompts/utils.js';
export { proactivePrompt } from '../../prompts/core/proactive.js';
