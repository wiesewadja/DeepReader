import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module
vi.mock('../../../pageindex/book-search-v2.js', () => ({
  searchBookV2: vi.fn(),
}));

vi.mock('../../../config/providers.js', () => ({
  resolveRoleConfig: vi.fn(() => null),
}));

vi.mock('../../../config/role-adapters.js', () => ({
  toEmbeddingOptions: vi.fn(),
}));

vi.mock('../utils/self-verification.js', () => ({
  verifyAndCleanContent: vi.fn(async (content: string) => ({ content, totalRefs: 0, ghostRefs: 0 })),
}));

vi.mock('../../../utils/logger.js', () => ({
  agentLog: vi.fn(),
}));

import { preSearchNode } from '../nodes/analytical-pre-search';
import { searchBookV2 } from '../../../pageindex/book-search-v2.js';
import { verifyAndCleanContent } from '../utils/self-verification.js';
import type { BookSearchResultV2 } from '../../../pageindex/book-types.js';

function makeConfig(overrides: Record<string, unknown> = {}) {
  const mockApp = {
    vault: {
      adapter: {
        read: vi.fn(async () => JSON.stringify({
          structure: [
            { nodeId: 'node1', nodes: [{ nodeId: 'node2' }] },
            { nodeId: 'node3' },
          ],
        })),
        basePath: '/fake/vault',
      },
    },
  };

  return {
    configurable: {
      mainModel: {
        invoke: vi.fn(async () => ({ content: 'AI response with [[book/ch1#^b1|keyword]]' })),
        stream: vi.fn(),
      },
      toolContext: {
        vault: {
          app: mockApp,
          plugin: { settings: {} },
        },
        book: {
          indexId: 'test-book-id',
          currentNodeId: 'node1',
          markdownFiles: { 'book/01 - Intro.md': 'content' },
        },
      },
      sharedContext: {},
      callbacks: {},
      ...overrides,
    },
    callbacks: undefined,
  };
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    scopeNodeIds: ['node1', 'node2'],
    pdfName: 'TestBook',
    tocSummary: 'Chapter 1\nChapter 2',
    rewrittenQuery: 'test query',
    betterQuestion: 'better question',
    suggestedKeywords: ['关键词A', '关键词B'],
    ...overrides,
  } as any;
}

function makeSearchResult(overrides: Partial<BookSearchResultV2> = {}): BookSearchResultV2 {
  return {
    nodeId: 'node1',
    title: 'Chapter 1',
    fileName: '01 - Chapter 1',
    score: 0.8,
    matchedBlocks: [
      { blockId: 'b1', content: 'Some relevant content about the topic.' },
    ],
    ...overrides,
  };
}

describe('preSearchNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when mainModel is missing', async () => {
    const state = makeState();
    const config = makeConfig({ mainModel: undefined });

    const result = await preSearchNode(state, config as any);

    expect(result.validatedScopeNodeIds).toEqual(['node1', 'node2']);
    expect(result.preSearchBlock).toBe('');
    expect(result.earlyStopContent).toBe('');
  });

  it('returns empty result when toolContext is missing', async () => {
    const state = makeState();
    const config = makeConfig({ toolContext: undefined });

    const result = await preSearchNode(state, config as any);

    expect(result.validatedScopeNodeIds).toEqual(['node1', 'node2']);
    expect(result.preSearchBlock).toBe('');
  });

  it('returns empty result when suggestedKeywords is empty', async () => {
    const state = makeState({ suggestedKeywords: [] });
    const config = makeConfig();

    const result = await preSearchNode(state, config as any);

    expect(result.preSearchBlock).toBe('');
  });

  it('returns empty result when search returns fewer than 2 results', async () => {
    vi.mocked(searchBookV2).mockResolvedValue([makeSearchResult()]);
    const state = makeState();
    const config = makeConfig();

    const result = await preSearchNode(state, config as any);

    expect(result.preSearchBlock).toBe('');
    expect(searchBookV2).toHaveBeenCalled();
  });

  it('early-stops when avgScore >= threshold', async () => {
    const highScoreResults = [
      makeSearchResult({ nodeId: 'n1', score: 0.85 }),
      makeSearchResult({ nodeId: 'n2', score: 0.9 }),
      makeSearchResult({ nodeId: 'n3', score: 0.88 }),
    ];
    vi.mocked(searchBookV2).mockResolvedValue(highScoreResults);

    const state = makeState();
    const config = makeConfig();

    const result = await preSearchNode(state, config as any);

    expect(result.earlyStopContent).toBe('done');
    expect(result.analysisResult).toBeDefined();
    expect(verifyAndCleanContent).toHaveBeenCalled();
  });

  it('injects preSearchBlock on normal path (low scores)', async () => {
    const lowScoreResults = [
      makeSearchResult({ nodeId: 'n1', score: 0.3 }),
      makeSearchResult({ nodeId: 'n2', score: 0.35 }),
    ];
    vi.mocked(searchBookV2).mockResolvedValue(lowScoreResults);

    const state = makeState();
    const config = makeConfig();

    const result = await preSearchNode(state, config as any);

    expect(result.earlyStopContent).toBe('');
    expect(result.preSearchBlock).toContain('pre_search_results');
    expect(result.preSearchBlock).toContain('相关段落');
  });

  it('returns empty result on search exception', async () => {
    vi.mocked(searchBookV2).mockRejectedValue(new Error('Search failed'));

    const state = makeState();
    const config = makeConfig();

    const result = await preSearchNode(state, config as any);

    expect(result.preSearchBlock).toBe('');
    expect(result.earlyStopContent).toBe('');
  });
});
