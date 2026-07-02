import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/agent/graph/utils/self-verification', () => ({
  verifyAndCleanContent: vi.fn(async (content: string) => ({
    content,
    totalRefs: 0,
    ghostRefs: 0,
    truncatedRefs: 0,
    invalidFileRefs: 0,
    llmCorrectionTriggered: false,
  })),
}));

vi.mock('@/agent/prompts/utils/index.js', () => ({
  buildEarlyStopPrompt: vi.fn((systemPrompt: string) => `PROMPT: ${systemPrompt}`),
}));

vi.mock('@/utils/logger.js', () => ({
  agentLog: vi.fn(),
}));

import { earlyStopDecider } from '@/agent/graph/nodes/early-stop-decider';
import { verifyAndCleanContent } from '@/agent/graph/utils/self-verification';
import type { BookSearchResultV2 } from '@/pageindex/book-types.js';

function makeHit(nodeId: string, score: number, content = 'test content', blockId = 'b1') {
  return {
    nodeId,
    title: `Title ${nodeId}`,
    fileName: `${nodeId}.md`,
    score,
    matchedBlocks: [{ blockId: `^${blockId}`, content }],
  };
}

function makeMockModel(response = 'AI response') {
  return {
    invoke: vi.fn(async () => ({ content: response })),
  };
}

describe('earlyStopDecider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns continue when fewer than 2 hits', async () => {
    const result = await earlyStopDecider({
      hits: [makeHit('n1', 0.8)],
      threshold: 0.6,
      mainModel: makeMockModel() as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
    });

    expect(result.decision).toBe('continue');
  });

  it('returns continue when wScore is below threshold', async () => {
    const result = await earlyStopDecider({
      hits: [
        makeHit('n1', 0.3, 'short'),
        makeHit('n2', 0.2, 'x'),
      ],
      threshold: 0.6,
      mainModel: makeMockModel() as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
    });

    expect(result.decision).toBe('continue');
    expect(result.wScore).toBeLessThan(0.6);
  });

  it('returns continue when substantive score is below threshold', async () => {
    // High scores but no block_id → substantive score = 0
    const hits = [
      { nodeId: 'n1', title: 'T1', fileName: 'n1.md', score: 0.9, matchedBlocks: [{ blockId: '', content: '' }] },
      { nodeId: 'n2', title: 'T2', fileName: 'n2.md', score: 0.8, matchedBlocks: [{ blockId: '', content: '' }] },
    ];

    const result = await earlyStopDecider({
      hits,
      threshold: 0.6,
      mainModel: makeMockModel() as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
    });

    expect(result.decision).toBe('continue');
  });

  it('returns early_stop when all conditions met', async () => {
    const hits = [
      makeHit('n1', 0.9, 'a'.repeat(100), 'b1'),
      makeHit('n2', 0.8, 'b'.repeat(100), 'b2'),
    ];

    const result = await earlyStopDecider({
      hits,
      threshold: 0.6,
      mainModel: makeMockModel('analysis result') as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
    });

    expect(result.decision).toBe('early_stop');
    expect(result.content).toBe('analysis result');
  });

  it('skips early stop when l5ForcesAnalytical is true', async () => {
    const hits = [
      makeHit('n1', 0.9, 'a'.repeat(100), 'b1'),
      makeHit('n2', 0.8, 'b'.repeat(100), 'b2'),
    ];

    const result = await earlyStopDecider({
      hits,
      threshold: 0.6,
      mainModel: makeMockModel() as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
      l5ForcesAnalytical: true,
    });

    expect(result.decision).toBe('continue');
  });

  it('calls verifyAndCleanContent on early stop', async () => {
    const hits = [
      makeHit('n1', 0.9, 'a'.repeat(100), 'b1'),
      makeHit('n2', 0.8, 'b'.repeat(100), 'b2'),
    ];

    await earlyStopDecider({
      hits,
      threshold: 0.6,
      mainModel: makeMockModel('response') as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
    });

    expect(verifyAndCleanContent).toHaveBeenCalled();
  });

  it('computes wScore correctly', async () => {
    const hits = [
      makeHit('n1', 1.0, 'a'.repeat(100), 'b1'),
      makeHit('n2', 0.5, 'b'.repeat(100), 'b2'),
      makeHit('n3', 0.0, 'c'.repeat(100), 'b3'),
    ];

    const result = await earlyStopDecider({
      hits,
      threshold: 0.6,
      mainModel: makeMockModel() as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
    });

    // wScore = 1.0*0.6 + 0.5*0.3 + 0.0*0.1 = 0.6 + 0.15 + 0 = 0.75
    expect(result.wScore).toBeCloseTo(0.75);
  });

  it('builds preSearchRecords with correct structure on early stop', async () => {
    // Uses same hits as "returns early_stop when all conditions met" test
    // to verify records structure without mock path conflicts
    const hits = [
      makeHit('n1', 0.9, 'a'.repeat(100), 'b1'),
      makeHit('n2', 0.8, 'b'.repeat(100), 'b2'),
    ];

    const result = await earlyStopDecider({
      hits,
      threshold: 0.6,
      mainModel: makeMockModel('response') as any,
      config: { configurable: {} } as any,
      fullSystemPrompt: 'system',
      userQuery: 'test',
    });

    expect(result.decision).toBe('early_stop');
    expect(result.records).toBeDefined();
    expect(result.records!.length).toBeGreaterThan(0);
    expect(result.records![0]).toHaveProperty('toolName', 'pre_search');
    expect(result.records![0]).toHaveProperty('args');
    expect(result.records![0]).toHaveProperty('result');
  });
});
