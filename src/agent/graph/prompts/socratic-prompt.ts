/**
 * Socratic Filter prompts - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/utils.js' instead.
 */

export { socraticPrompt } from '../../prompts/core/socratic.js';

import { socraticPrompt } from '../../prompts/core/socratic.js';

export const SOCRATIC_SPLIT_PROMPT = socraticPrompt.locales.zh.systemPrompt;
