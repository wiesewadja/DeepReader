import { z } from 'zod';
import { StateParseError } from './errors';

/**
 * Try to fix common JSON issues from LLM output
 */
function fixJsonString(jsonStr: string): string {
  let fixed = jsonStr;

  // 1. Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');

  // 2. Replace Chinese quotes with standard quotes (for display purposes)
  // Note: These are different characters from ASCII quotes and don't break JSON
  // But we normalize them for consistency
  fixed = fixed.replace(/[""]/g, '"');
  fixed = fixed.replace(/['']/g, "'");

  // 3. Fix unescaped quotes inside string values
  // This is a more sophisticated approach: parse the JSON structure
  // and escape any unescaped quotes within string values
  fixed = fixUnescapedQuotes(fixed);

  // 4. Remove any trailing text after the last }
  const lastBrace = fixed.lastIndexOf('}');
  if (lastBrace !== -1) {
    fixed = fixed.slice(0, lastBrace + 1);
  }

  // 5. Remove any leading text before the first {
  const firstBrace = fixed.indexOf('{');
  if (firstBrace > 0) {
    fixed = fixed.slice(firstBrace);
  }

  return fixed;
}

/**
 * Fix unescaped quotes inside JSON string values
 * This handles cases where LLM outputs: "text with "quotes" inside"
 * We need to convert it to: "text with \"quotes\" inside"
 */
function fixUnescapedQuotes(jsonStr: string): string {
  const result: string[] = [];
  let inString = false;
  let i = 0;

  while (i < jsonStr.length) {
    const char = jsonStr[i];

    if (!inString) {
      // Outside of string
      if (char === '"') {
        inString = true;
        result.push(char);
      } else {
        result.push(char);
      }
      i++;
    } else {
      // Inside string
      if (char === '\\' && i + 1 < jsonStr.length) {
        // Already escaped character, keep as-is
        result.push(char, jsonStr[i + 1]);
        i += 2;
      } else if (char === '"') {
        // Check if this is the end of string or an unescaped quote inside
        // Look ahead to see what follows
        const restAfterQuote = jsonStr.slice(i + 1).trimStart();
        if (
          restAfterQuote.startsWith(',') ||
          restAfterQuote.startsWith('}') ||
          restAfterQuote.startsWith(']') ||
          restAfterQuote.startsWith(':')
        ) {
          // This is likely the end of the string
          inString = false;
          result.push(char);
        } else {
          // This is an unescaped quote inside the string, escape it
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

/**
 * Extract JSON from LLM response with multiple strategies
 */
function extractJson(content: string): string | null {
  // Strategy 1: Extract from ```json code block
  const jsonBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch?.[1]) {
    return jsonBlockMatch[1].trim();
  }

  // Strategy 2: Find balanced braces for JSON object
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

  // Strategy 3: Greedy match as last resort
  const greedyMatch = content.match(/\{[\s\S]*\}/);
  return greedyMatch?.[0] || null;
}

/**
 * Safely parse JSON from LLM response
 * 1. Supports extracting from ```json code blocks
 * 2. Supports direct JSON object matching with balanced braces
 * 3. Attempts to fix common JSON issues
 * 4. Uses Zod for schema validation
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

  // Try parsing as-is first
  try {
    const parsed = JSON.parse(jsonStr);
    return schema.parse(parsed);
  } catch {
    // Continue to try fixing
  }

  // Try fixing common issues
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