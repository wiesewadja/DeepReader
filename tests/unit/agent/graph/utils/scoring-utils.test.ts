import { describe, it, expect } from 'vitest';
import {
  computeMaxTheoryBM25,
  computeKeywordCoverage,
  computeSubstantiveScore,
} from '@/agent/graph/utils/scoring-utils';

describe('computeMaxTheoryBM25', () => {
  it('returns 10.0 when bm25Index is null', () => {
    expect(computeMaxTheoryBM25(['关键词'], null)).toBe(10.0);
  });

  it('returns 10.0 when bm25Index has no stats', () => {
    expect(computeMaxTheoryBM25(['关键词'], {})).toBe(10.0);
  });

  it('computes IDF × (k1+1) for each non-stopword token', () => {
    const bm25Index = {
      stats: { totalDocs: 100, df: { '搜索': 10 } },
      params: { k1: 1.5 },
      invertedIndex: {},
    };
    const result = computeMaxTheoryBM25(['搜索'], bm25Index);
    // IDF = log(1 + (100 - 10 + 0.5) / (10 + 0.5)) = log(1 + 90.5/10.5) ≈ log(9.619) ≈ 2.264
    // maxTokenScore = 2.264 × 2.5 = 5.66
    expect(result).toBeGreaterThan(5);
    expect(result).toBeLessThan(7);
  });

  it('filters out stop words before scoring', () => {
    const bm25Index = {
      stats: { totalDocs: 100, df: { '的': 50, '搜索': 10 } },
      params: { k1: 1.5 },
      invertedIndex: {},
    };
    // '的' is a stop word and should be filtered
    const result = computeMaxTheoryBM25(['的', '搜索'], bm25Index);
    // Only '搜索' contributes
    const searchOnly = computeMaxTheoryBM25(['搜索'], bm25Index);
    expect(result).toBeCloseTo(searchOnly, 5);
  });

  it('returns 10.0 when no keywords have document frequency', () => {
    const bm25Index = {
      stats: { totalDocs: 100, df: {} },
      params: { k1: 1.5 },
      invertedIndex: {},
    };
    expect(computeMaxTheoryBM25(['不存在的词'], bm25Index)).toBe(10.0);
  });

  it('deduplicates keywords', () => {
    const bm25Index = {
      stats: { totalDocs: 100, df: { '搜索': 10 } },
      params: { k1: 1.5 },
      invertedIndex: {},
    };
    const single = computeMaxTheoryBM25(['搜索'], bm25Index);
    const duplicated = computeMaxTheoryBM25(['搜索', '搜索'], bm25Index);
    expect(duplicated).toBeCloseTo(single, 5);
  });
});

describe('computeKeywordCoverage', () => {
  it('returns 0 for empty text', () => {
    expect(computeKeywordCoverage(['搜索'], '')).toBe(0);
  });

  it('returns 1 when all keywords found in text', () => {
    expect(computeKeywordCoverage(['搜索', '分析'], '搜索和分析功能')).toBe(1);
  });

  it('returns partial coverage', () => {
    expect(computeKeywordCoverage(['搜索', '分析'], '只有搜索功能')).toBe(0.5);
  });

  it('returns 0 when no keywords found', () => {
    expect(computeKeywordCoverage(['搜索', '分析'], '完全无关的内容')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(computeKeywordCoverage(['Hello'], 'hello world')).toBe(1);
  });

  it('filters out stop words before matching', () => {
    // '的' is a stop word, '搜索' is not
    const result = computeKeywordCoverage(['的', '搜索'], '搜索功能');
    expect(result).toBe(1); // only '搜索' counts, and it's found
  });

  it('returns 0 when all keywords are stop words', () => {
    expect(computeKeywordCoverage(['的', '了'], '任何内容')).toBe(0);
  });
});

describe('computeSubstantiveScore', () => {
  it('returns 0 when no hits have block_id', () => {
    const hits = [
      { block_id: '', content: 'some content' },
      { block_id: '', content: 'more content' },
    ];
    expect(computeSubstantiveScore(hits)).toBe(0);
  });

  it('returns high score for hits with block_id and long content', () => {
    const hits = [
      { block_id: 'b1', content: 'a'.repeat(200) },
    ];
    // block_id: +20, 200/10=20 (cap 30), >20: +15 = 55
    expect(computeSubstantiveScore(hits)).toBeCloseTo(55);
  });

  it('returns max score when content exceeds 300 chars', () => {
    const hits = [
      { block_id: 'b1', content: 'a'.repeat(300) },
    ];
    // block_id: +20, 300/10=30 (cap 30), >20: +15 = 65
    expect(computeSubstantiveScore(hits)).toBeCloseTo(65);
  });

  it('returns lower score for short content', () => {
    const hits = [
      { block_id: 'b1', content: 'short' }, // 5 chars
    ];
    // block_id: +20, 5/10=0.5, not >20: 0 = 20.5
    expect(computeSubstantiveScore(hits)).toBeCloseTo(20.5);
  });

  it('returns max score across all hits', () => {
    const hits = [
      { block_id: '', content: 'short' },
      { block_id: 'b2', content: 'a'.repeat(300) },
    ];
    expect(computeSubstantiveScore(hits)).toBeCloseTo(65);
  });

  it('handles empty array', () => {
    expect(computeSubstantiveScore([])).toBe(0);
  });

  it('gives correct score for 25-char content with block_id', () => {
    const hits = [{ block_id: 'b1', content: 'a'.repeat(25) }];
    // block_id: +20, 25/10=2.5, >20: +15 = 37.5
    expect(computeSubstantiveScore(hits)).toBeCloseTo(37.5);
  });
});
