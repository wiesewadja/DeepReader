import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCognitiveEngine } from '../../cognitive-engine/engine';
import { createSharedContext } from '../../cognitive-engine/context';
import type { SharedContext, EngineCallbacks } from '../../cognitive-engine/types';

describe('runCognitiveEngine', () => {
  let ctx: SharedContext;
  let callbacks: EngineCallbacks;
  let progressMessages: string[];
  let contentParts: string[];

  beforeEach(() => {
    ctx = createSharedContext({
      indexId: 'test',
      pdfName: 'Test Book',
      rawUserQuery: '什么是MECE？',
    });

    progressMessages = [];
    contentParts = [];

    callbacks = {
      onProgress: (status) => progressMessages.push(status),
      onContent: (text) => contentParts.push(text),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
  });

  it('should execute depth 0 flow (chat only)', async () => {
    // Note: "你好" doesn't match any intent rule, so it falls back to depth 2
    // For depth 0, we need a query that matches no rules and is recognized as casual chat
    // Currently the router doesn't have a depth 0 rule, so this test verifies fallback behavior
    ctx.rawUserQuery = '你好';

    await runCognitiveEngine(ctx, callbacks);

    // Currently falls back to depth 2 (no depth 0 rule exists)
    expect(ctx.depth).toBe(2);
    expect(ctx.executedStates.has('Router')).toBe(true);
    expect(ctx.executedStates.has('Formatter')).toBe(true);
  });

  it('should execute depth 1 flow (S1 -> S4)', async () => {
    ctx.rawUserQuery = '这本书讲了什么？';

    await runCognitiveEngine(ctx, callbacks);

    expect(ctx.depth).toBe(1);
    expect(ctx.executedStates.has('Router')).toBe(true);
    expect(ctx.executedStates.has('Inspectional')).toBe(true);
    expect(ctx.executedStates.has('Formatter')).toBe(true);
    expect(ctx.executedStates.has('Analytical')).toBe(false);
  });

  it('should execute depth 2 flow (S1 -> S2 -> S4)', async () => {
    ctx.rawUserQuery = '什么是MECE？';

    await runCognitiveEngine(ctx, callbacks);

    expect(ctx.depth).toBe(2);
    expect(ctx.executedStates.has('Router')).toBe(true);
    expect(ctx.executedStates.has('Inspectional')).toBe(true);
    expect(ctx.executedStates.has('Analytical')).toBe(true);
    expect(ctx.executedStates.has('Formatter')).toBe(true);
  });

  it('should downgrade depth 3 to depth 2 (S3 not implemented)', async () => {
    ctx.rawUserQuery = '这本书和《金字塔原理》有什么异同？';

    await runCognitiveEngine(ctx, callbacks);

    // Should be downgraded to depth 2
    expect(ctx.depth).toBe(2);
    expect(progressMessages.some(m => m.includes('降级'))).toBe(true);
  });

  it('should call onProgress during execution', async () => {
    await runCognitiveEngine(ctx, callbacks);

    expect(progressMessages.length).toBeGreaterThan(0);
  });

  it('should call onComplete when finished', async () => {
    await runCognitiveEngine(ctx, callbacks);

    expect(callbacks.onComplete).toHaveBeenCalled();
  });

  it('should save session after completion', async () => {
    ctx.chatHistory = [];

    await runCognitiveEngine(ctx, callbacks);

    // Should have added user query and assistant response to history
    expect(ctx.chatHistory.length).toBe(2);
    expect(ctx.chatHistory[0].role).toBe('user');
    expect(ctx.chatHistory[1].role).toBe('assistant');
  });
});