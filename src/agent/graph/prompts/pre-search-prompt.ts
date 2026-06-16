/**
 * S2-Pre: Pre-search early-stop prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/utils.js' instead.
 */

export { buildEarlyStopPrompt } from '../../prompts/utils.js';
export { preSearchPrompt } from '../../prompts/core/pre-search.js';
