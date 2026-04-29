/**
 * Quick JSON extraction from LLM text output.
 * Handles ```json ... ``` blocks and bare { ... } objects.
 */
export function extractJSON(text: string): Record<string, any> | null {
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch { /* fall through */ }
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
  }
  // Fallback: truncated JSON — try closing with } and parse
  if (text.includes('{')) {
    const repaired = text.replace(/[\s,]*$/, '') + '\n}';
    try { return JSON.parse(repaired); } catch { /* fall through */ }
  }
  return null;
}

/**
 * JSON Parsing Utilities for LLM output
 *
 * Migrated from cognitive-engine/parse.ts
 */

import { z } from 'zod';

/**
 * Error thrown when JSON parsing fails in state output
 */
export class StateParseError extends Error {
  constructor(
    message: string,
    public readonly rawContent: string
  ) {
    super(message);
    this.name = 'StateParseError';
  }
}

/**
 * Try to fix common JSON issues from LLM output
 */
function fixJsonString(jsonStr: string): string {
  let fixed = jsonStr;

  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  fixed = fixed.replace(/[""]/g, '"');
  fixed = fixed.replace(/['']/g, "'");
  fixed = fixUnescapedQuotes(fixed);

  const lastBrace = fixed.lastIndexOf('}');
  if (lastBrace !== -1) {
    fixed = fixed.slice(0, lastBrace + 1);
  }

  const firstBrace = fixed.indexOf('{');
  if (firstBrace > 0) {
    fixed = fixed.slice(firstBrace);
  }

  return fixed;
}

function fixUnescapedQuotes(jsonStr: string): string {
  const result: string[] = [];
  let inString = false;
  let i = 0;

  while (i < jsonStr.length) {
    const char = jsonStr[i];

    if (!inString) {
      if (char === '"') {
        inString = true;
        result.push(char);
      } else {
        result.push(char);
      }
      i++;
    } else {
      if (char === '\\' && i + 1 < jsonStr.length) {
        result.push(char, jsonStr[i + 1]);
        i += 2;
      } else if (char === '"') {
        const restAfterQuote = jsonStr.slice(i + 1).trimStart();
        if (
          restAfterQuote.startsWith(',') ||
          restAfterQuote.startsWith('}') ||
          restAfterQuote.startsWith(']') ||
          restAfterQuote.startsWith(':')
        ) {
          inString = false;
          result.push(char);
        } else {
          result.push('\\', char);
        }
        i++;
      } else {
        result.push(char);
        i++;
      }
    }
  }

  return result.join('');
}

function extractJson(content: string): string | null {
  const jsonBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch?.[1]) {
    return jsonBlockMatch[1].trim();
  }

  let depth = 0;
  let start = -1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (content[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return content.slice(start, i + 1);
      }
    }
  }

  const greedyMatch = content.match(/\{[\s\S]*\}/);
  return greedyMatch?.[0] || null;
}

/**
 * Safely parse JSON from LLM response
 */
export function parseStateOutput<T>(
  content: string,
  schema: z.ZodSchema<T>,
  fallback?: T
): T {
  const jsonStr = extractJson(content);

  if (!jsonStr) {
    if (fallback !== undefined) return fallback;
    throw new StateParseError('No JSON found in LLM response', content);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return schema.parse(parsed);
  } catch {
    // Continue to try fixing
  }

  const fixedJsonStr = fixJsonString(jsonStr);

  try {
    const parsed = JSON.parse(fixedJsonStr);
    return schema.parse(parsed);
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new StateParseError(
      `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
      content
    );
  }
}
