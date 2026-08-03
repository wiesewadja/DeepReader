/**
 * Unit tests for safeNode error boundary wrapper.
 *
 * Verifies the external behavior contract:
 * - Successful node execution passes through unchanged
 * - Throwing node sets nodeErrors[name] with message + recoverable flag
 * - fallback callback is invoked on failure and its output is merged
 * - recoverable is true for all nodes except 'formatter'
 */
import { describe, it, expect, vi } from 'vitest';
import { safeNode } from '@/agent/graph/utils/safe-node';
import type { CognitiveEngineState } from '@/agent/graph/state';
import type { RunnableConfig } from '@langchain/core/runnables';

const stubState = {} as CognitiveEngineState;
const stubConfig = {} as RunnableConfig;

describe('safeNode', () => {
  it('passes through successful node output unchanged', async () => {
    const fn = vi.fn().mockResolvedValue({ analysisResult: 'ok' });
    const wrapped = safeNode('analytical', fn);

    const result = await wrapped(stubState, stubConfig);

    expect(result).toEqual({ analysisResult: 'ok' });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('sets nodeErrors[name] with message and recoverable=true on throw', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapped = safeNode('analytical', fn);

    const result = await wrapped(stubState, stubConfig) as Partial<CognitiveEngineState>;

    expect(result.nodeErrors).toBeDefined();
    const err = (result.nodeErrors as Record<string, unknown>).analytical as { message: string; recoverable: boolean };
    expect(err.message).toBe('boom');
    expect(err.recoverable).toBe(true);
  });

  it('sets recoverable=false for the formatter node', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    const wrapped = safeNode('formatter', fn);

    const result = await wrapped(stubState, stubConfig) as Partial<CognitiveEngineState>;
    const err = (result.nodeErrors as Record<string, unknown>).formatter as { recoverable: boolean };

    expect(err.recoverable).toBe(false);
  });

  it('invokes fallback callback and merges its output on failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const fallback = vi.fn().mockReturnValue({ analysisResult: 'fallback-content' });
    const wrapped = safeNode('inspectional', fn, fallback);

    const result = await wrapped(stubState, stubConfig) as Partial<CognitiveEngineState>;

    expect(fallback).toHaveBeenCalledOnce();
    expect(result.analysisResult).toBe('fallback-content');
    expect(result.nodeErrors).toBeDefined();
  });

  it('returns only nodeErrors when no fallback is provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('no-fb'));
    const wrapped = safeNode('pre_search', fn);

    const result = await wrapped(stubState, stubConfig) as Partial<CognitiveEngineState>;

    expect(Object.keys(result)).toEqual(['nodeErrors']);
  });

  it('does not include fallbackAction field in nodeError (removed dead field)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('check'));
    const wrapped = safeNode('analytical', fn);

    const result = await wrapped(stubState, stubConfig) as Partial<CognitiveEngineState>;
    const err = (result.nodeErrors as Record<string, unknown>).analytical as Record<string, unknown>;

    expect(err).not.toHaveProperty('fallbackAction');
    expect(err).toHaveProperty('message');
    expect(err).toHaveProperty('recoverable');
  });
});
