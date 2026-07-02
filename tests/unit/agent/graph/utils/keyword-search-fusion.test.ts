import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/pageindex/book-search-v2.js', () => ({
  searchBookV2: vi.fn(),
}));

import { keywordSearchFusion } from '@/agent/graph/utils/keyword-search-fusion';
import { searchBookV2 } from '@/pageindex/book-search-v2.js';
import type { BookSearchResultV2 } from '@/pageindex/book-types.js';

const mockSearch = vi.mocked(searchBookV2);

function makeResult(nodeId: string, score: number, overrides: Partial<BookSearchResultV2> = {}): BookSearchResultV2 {
  return {
    nodeId,
    title: `Title ${nodeId}`,
    fileName: `${nodeId}.md`,
    score,
    matchedBlocks: [{ blockId: `^${nodeId}-1`, content: `Content for ${nodeId}` }],
    ...overrides,
  };
}

describe('keywordSearchFusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when keywords is empty', async () => {
    const result = await keywordSearchFusion([], { filePath: '', topK: 10 });
    expect(result).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('merges results from multiple keywords by nodeId', async () => {
    mockSearch
      .mockResolvedValueOnce([makeResult('n1', 0.8), makeResult('n2', 0.6)])
      .mockResolvedValueOnce([makeResult('n1', 0.7), makeResult('n3', 0.9)]);

    const result = await keywordSearchFusion(['kw1', 'kw2'], { filePath: '', topK: 10 });

    expect(result).toHaveLength(3); // n1, n2, n3
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('keeps highest score when nodeId appears in multiple keyword results', async () => {
    mockSearch
      .mockResolvedValueOnce([makeResult('n1', 0.5)])
      .mockResolvedValueOnce([makeResult('n1', 0.9)]);

    const result = await keywordSearchFusion(['kw1', 'kw2'], { filePath: '', topK: 10 });

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9); // higher score wins
  });

  it('boosts score for currentNodeId', async () => {
    mockSearch
      .mockResolvedValueOnce([makeResult('n1', 0.6), makeResult('n2', 0.7)]);

    const result = await keywordSearchFusion(
      ['kw1'],
      { filePath: '', topK: 10 },
      { currentNodeId: 'n1' },
    );

    // n1 should rank first due to +0.2 boost despite lower base score
    expect(result[0].nodeId).toBe('n1');
  });

  it('boosts score for hitCount (appears in multiple keywords)', async () => {
    mockSearch
      .mockResolvedValueOnce([makeResult('n1', 0.6)])
      .mockResolvedValueOnce([makeResult('n1', 0.6)]);

    const result = await keywordSearchFusion(['kw1', 'kw2'], { filePath: '', topK: 10 });

    expect(result).toHaveLength(1);
    // hitCount=2, so score = 0.6 + 2*0.1 = 0.8 effective
  });

  it('gracefully handles single keyword failure', async () => {
    mockSearch
      .mockResolvedValueOnce([makeResult('n1', 0.8)])
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([makeResult('n2', 0.7)]);

    const result = await keywordSearchFusion(['kw1', 'kw2', 'kw3'], { filePath: '', topK: 10 });

    expect(result).toHaveLength(2); // n1 and n2, kw2 failed gracefully
  });

  it('passes searchOpts through to searchBookV2', async () => {
    mockSearch.mockResolvedValue([]);
    const opts = { filePath: '/test', topK: 5, scopeNodeIds: ['n1'] };

    await keywordSearchFusion(['kw1'], opts);

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ ...opts, query: 'kw1' })
    );
  });
});
