/**
 * Tests for the L5 negative-claim auto-verification gate.
 *
 * The L5 layer detects "未出现" / "未提及" claims and re-verifies them
 * against the FULL book index (not just the current scope). The verified
 * hits are returned to the caller — typically S2-Pre, which stores them
 * in state and lets the routing layer force a state-machine restart
 * at S2 Analytical.
 *
 * Two functions to test:
 *   - shouldVerifyNegativeClaim(analysisResult, rewrittenQuery) → boolean
 *   - verifyNegativeClaimWithFullBook(query, options) → BookSearchResultV2[]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldVerifyNegativeClaim,
  verifyNegativeClaimWithFullBook,
} from '@/agent/graph/utils/claim-verifier';

// Mock the search module before importing the SUT
vi.mock('@/pageindex/book-search-v2', () => ({
  searchBookV2: vi.fn(),
}));

import { searchBookV2 } from '@/pageindex/book-search-v2';

const mockSearch = vi.mocked(searchBookV2);

function hit(nodeId: string, title: string, score: number, content: string) {
  return {
    nodeId,
    title,
    fileName: `${nodeId} - ${title}.md`,
    score,
    matchedBlocks: [{ blockId: `^${nodeId}-1`, content }],
  };
}

describe('shouldVerifyNegativeClaim', () => {
  it('detects common negative-claim patterns', () => {
    expect(shouldVerifyNegativeClaim('书中未出现相关概念', '回报函数工程')).toBe(true);
    expect(shouldVerifyNegativeClaim('本书未提及此术语', '回报函数工程')).toBe(true);
    expect(shouldVerifyNegativeClaim('没有提到这个', 'X')).toBe(true);
    expect(shouldVerifyNegativeClaim('书里没有', 'X')).toBe(true);
    expect(shouldVerifyNegativeClaim('并未提及', 'X')).toBe(true);
  });

  it('returns false when no negative pattern', () => {
    expect(shouldVerifyNegativeClaim('概念出现在 24 章', '回报函数工程')).toBe(false);
    expect(shouldVerifyNegativeClaim('详细解释如下...', 'X')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(shouldVerifyNegativeClaim('', 'X')).toBe(false);
    expect(shouldVerifyNegativeClaim('未出现', '')).toBe(false);
    expect(shouldVerifyNegativeClaim(null, 'X')).toBe(false);
    expect(shouldVerifyNegativeClaim('未出现', null)).toBe(false);
  });
});

describe('verifyNegativeClaimWithFullBook', () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  it('returns [] when no hits above threshold', async () => {
    mockSearch.mockResolvedValue([hit('0021', 'ch21', 0.1, 'low score')] as any);
    const out = await verifyNegativeClaimWithFullBook('回报函数工程', {
      bookId: 'book-1',
      app: {} as any,
    });
    expect(out).toEqual([]);
  });

  it('returns [] when search returns empty', async () => {
    mockSearch.mockResolvedValue([]);
    const out = await verifyNegativeClaimWithFullBook('X', {
      bookId: 'book-1',
      app: {} as any,
    });
    expect(out).toEqual([]);
  });

  it('returns hits found above threshold', async () => {
    const h = hit('0024', '24-决策的基础设施', 0.75, '回报函数工程是 RLHF 的核心。');
    mockSearch.mockResolvedValue([h] as any);
    const out = await verifyNegativeClaimWithFullBook('回报函数工程', {
      bookId: 'book-1',
      app: {} as any,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(h);
    expect(out[0].nodeId).toBe('0024');
    expect(out[0].score).toBeGreaterThan(0.3);
  });

  it('catches search errors and returns []', async () => {
    mockSearch.mockRejectedValue(new Error('BM25 unavailable'));
    const out = await verifyNegativeClaimWithFullBook('X', {
      bookId: 'b',
      app: {} as any,
    });
    expect(out).toEqual([]);
  });

  it('returns [] when bookId missing', async () => {
    const out = await verifyNegativeClaimWithFullBook('X', {
      bookId: '',
      app: {} as any,
    });
    expect(out).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns [] when app missing', async () => {
    const out = await verifyNegativeClaimWithFullBook('X', {
      bookId: 'b',
      app: null as any,
    });
    expect(out).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('honors custom topK option', async () => {
    mockSearch.mockResolvedValue([hit('0001', 'ch1', 0.5, 'c')] as any);
    await verifyNegativeClaimWithFullBook('X', {
      bookId: 'b',
      app: {} as any,
      topK: 10,
    });
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ topK: 10 }));
  });

  it('passes query, bookId, filePath to search', async () => {
    mockSearch.mockResolvedValue([hit('0001', 'ch1', 0.5, 'c')] as any);
    await verifyNegativeClaimWithFullBook('回报函数工程', {
      bookId: 'book-42',
      app: {} as any,
    });
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
      query: '回报函数工程',
      bookId: 'book-42',
      filePath: '',
    }));
  });

  it('threshold boundary: 0.30 rejected, 0.31 accepted', async () => {
    mockSearch.mockResolvedValueOnce([hit('0001', 'ch1', 0.30, 'c')] as any);
    const out1 = await verifyNegativeClaimWithFullBook('X', {
      bookId: 'b', app: {} as any,
    });
    expect(out1).toEqual([]);

    mockSearch.mockResolvedValueOnce([hit('0001', 'ch1', 0.31, 'c')] as any);
    const out2 = await verifyNegativeClaimWithFullBook('X', {
      bookId: 'b', app: {} as any,
    });
    expect(out2).toHaveLength(1);
  });

  it('filters out hits at or below threshold (e.g. 0.3 == threshold → not > threshold)', async () => {
    mockSearch.mockResolvedValue([
      hit('0001', 'ch1', 0.5, 'above'),
      hit('0002', 'ch2', 0.3, 'exactly threshold'),
      hit('0003', 'ch3', 0.1, 'below'),
    ] as any);
    const out = await verifyNegativeClaimWithFullBook('X', {
      bookId: 'b', app: {} as any,
    });
    expect(out.map(h => h.nodeId)).toEqual(['0001']);
  });

  it('preserves full BookSearchResultV2 structure on returned hits', async () => {
    const full = {
      nodeId: '0024',
      title: '24-决策的基础设施',
      fileName: '0024 - 24-决策的基础设施.md',
      hierarchyPath: ['AI极简经济学', '第24章'],
      matchedBlocks: [
        { blockId: '^24-1', content: '回报函数工程定义...' },
        { blockId: '^24-2', content: 'RLHF 依赖回报函数工程...' },
      ],
      score: 0.75,
      bm25Score: 0.6,
      vectorScore: 0.9,
    };
    mockSearch.mockResolvedValue([full] as any);
    const out = await verifyNegativeClaimWithFullBook('X', {
      bookId: 'b', app: {} as any,
    });
    expect(out[0]).toEqual(full);
  });
});
