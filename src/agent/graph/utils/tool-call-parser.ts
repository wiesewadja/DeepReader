/**
 * Parse tool call arguments from various LLM provider formats.
 *
 * Different providers return tool call args in different shapes:
 * - OpenAI: { args: string } (JSON string)
 * - Some providers: { args: Record<string, unknown> } (already parsed)
 * - Function-calling style: { function: { arguments: string } }
 *
 * Source: @langchain/openai — tool call response format varies by provider.
 */

interface ToolCallLike {
  args: string | Record<string, unknown>;
  function?: { arguments?: string | Record<string, unknown> };
}

interface ParseError {
  [key: string]: unknown;
  _parseError: true;
  _raw: string;
}

export type ParseResult = Record<string, unknown> | ParseError;

export function parseToolCallArgs(tc: ToolCallLike): ParseResult {
  try {
    if (typeof tc.args === 'string') {
      return JSON.parse(tc.args);
    }
    if (tc.args && typeof tc.args === 'object') {
      return tc.args;
    }
    // Function-calling style fallback
    if (tc.function?.arguments) {
      return typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments;
    }
    return {};
  } catch {
    return { _parseError: true, _raw: String(tc.args || tc.function?.arguments || '') };
  }
}
