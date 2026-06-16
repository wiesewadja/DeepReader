/**
 * Shared Excalidraw diagram prompt — re-exported from the centralized PromptRegistry.
 *
 * The canonical prompt lives in src/agent/prompts/auxiliary/diagram.ts as a
 * registered PromptModule. This file exists for backward compat with consumers
 * (tool definitions, diagram-helper) that import the raw string directly.
 */

import { diagramPrompt } from '../prompts/auxiliary/diagram.js';

export const SHARED_DIAGRAM_PROMPT = diagramPrompt.locales.zh.systemPrompt;
