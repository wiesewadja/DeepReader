import { z } from 'zod';
import { StateParseError } from './errors';

/**
 * Safely parse JSON from LLM response
 * 1. Supports extracting from ```json code blocks
 * 2. Supports direct JSON object matching
 * 3. Uses Zod for schema validation
 */
export function parseStateOutput<T>(
  content: string,
  schema: z.ZodSchema<T>,
  fallback?: T
): T {
  // 1. Try to extract JSON code block
  const jsonBlockMatch = content.match(/```json\n([\s\S]*?)\n```/);

  // 2. Try to match direct JSON object
  const jsonObjectMatch = content.match(/\{[\s\S]*\}/);

  const jsonStr = jsonBlockMatch?.[1] || jsonObjectMatch?.[0];

  if (!jsonStr) {
    if (fallback !== undefined) return fallback;
    throw new StateParseError('No JSON found in LLM response', content);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return schema.parse(parsed);
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new StateParseError(
      `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
      content
    );
  }
}