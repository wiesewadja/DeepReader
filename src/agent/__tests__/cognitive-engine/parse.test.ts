import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseStateOutput, StateParseError } from '../../cognitive-engine/parse';

describe('parseStateOutput', () => {
  const testSchema = z.object({
    name: z.string(),
    value: z.number(),
  });

  it('should parse plain JSON object', () => {
    const input = '{"name": "test", "value": 42}';
    const result = parseStateOutput(input, testSchema);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('should parse JSON from markdown code block', () => {
    const input = '```json\n{"name": "test", "value": 42}\n```';
    const result = parseStateOutput(input, testSchema);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('should extract JSON from mixed content', () => {
    const input = 'Here is the result:\n{"name": "test", "value": 42}\nEnd.';
    const result = parseStateOutput(input, testSchema);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('should throw StateParseError for invalid JSON', () => {
    const input = 'not json at all';
    expect(() => parseStateOutput(input, testSchema)).toThrow(StateParseError);
  });

  it('should throw StateParseError for schema mismatch', () => {
    const input = '{"name": "test", "value": "not a number"}';
    expect(() => parseStateOutput(input, testSchema)).toThrow(StateParseError);
  });

  it('should return fallback when provided and parsing fails', () => {
    const input = 'invalid';
    const fallback = { name: 'fallback', value: 0 };
    const result = parseStateOutput(input, testSchema, fallback);
    expect(result).toEqual(fallback);
  });

  it('should not return fallback when parsing succeeds', () => {
    const input = '{"name": "test", "value": 42}';
    const fallback = { name: 'fallback', value: 0 };
    const result = parseStateOutput(input, testSchema, fallback);
    expect(result).toEqual({ name: 'test', value: 42 });
  });
});