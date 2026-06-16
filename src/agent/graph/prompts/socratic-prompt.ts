/**
 * Socratic Filter prompts - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/core/socratic.js' instead.
 */

import { socraticPrompt } from '../../prompts/core/socratic.js';

export const SOCRATIC_SPLIT_PROMPT = socraticPrompt.locales.zh.systemPrompt;

// Also export the new prompt module for new code
export { socraticPrompt };
