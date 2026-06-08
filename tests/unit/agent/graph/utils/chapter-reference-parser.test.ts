import { describe, it, expect } from 'vitest';
import { extractCitedNodeIds } from '@/agent/graph/utils/chapter-reference-parser';

describe('extractCitedNodeIds', () => {
  describe('wiki link form', () => {
    it('extracts chapter from [[24 - 章节标题]] (T2 case)', () => {
      expect(extractCitedNodeIds('不，[[24 - ]] 这里就有这个概念')).toEqual(['0024']);
    });

    it('extracts chapter from [[书名/24 - xxx]] (T0 form)', () => {
      expect(extractCitedNodeIds('这里就有[[AI极简经济学/24 - ]]')).toEqual(['0024']);
    });

    it('extracts multiple chapters in one message', () => {
      expect(extractCitedNodeIds('对比 [[21 - 第7章]] 和 [[24 - ]]')).toEqual(['0021', '0024']);
    });

    it('handles dash variants (en/em dash)', () => {
      expect(extractCitedNodeIds('[[24 – 章节]]')).toEqual(['0024']);
      expect(extractCitedNodeIds('[[24 — 章节]]')).toEqual(['0024']);
    });
  });

  describe('block-quote form', () => {
    it('extracts chapter from "> — 24 -" (T0 user citation)', () => {
      expect(extractCitedNodeIds('> — 24 - 章节标题')).toEqual(['0024']);
    });

    it('extracts chapter from "> — 24"', () => {
      expect(extractCitedNodeIds('> — 24')).toEqual(['0024']);
    });
  });

  describe('multi-message history', () => {
    it('extracts cited chapters across multiple messages', () => {
      const messages = [
        '你好',
        '什么是回报函数工程',
        '不，[[24 - ]] 这里就有这个概念',
      ];
      expect(extractCitedNodeIds(messages)).toContain('0024');
    });
  });

  describe('dedup and ordering', () => {
    it('deduplicates repeated citations', () => {
      expect(extractCitedNodeIds('[[24 - ]] 和 [[24 - ]]')).toEqual(['0024']);
    });
  });

  describe('rejection of false positives', () => {
    it('ignores page numbers that look like chapter ids', () => {
      // 9999 is the upper bound; 10000+ should be rejected as out of range
      expect(extractCitedNodeIds('[[12345 - 异常]]')).toEqual([]);
    });

    it('returns empty array for messages without citations', () => {
      expect(extractCitedNodeIds('什么是回报函数工程')).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(extractCitedNodeIds('')).toEqual([]);
      expect(extractCitedNodeIds([])).toEqual([]);
    });
  });

  describe('nodeId formatting', () => {
    it('pads to 4 digits', () => {
      expect(extractCitedNodeIds('[[7 - 章节]]')).toEqual(['0007']);
    });

    it('preserves already-padded form', () => {
      expect(extractCitedNodeIds('[[0024 - 章节]]')).toEqual(['0024']);
    });
  });
});
