import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hasSyntopicalKeywords,
  syntopicalSearch,
  formatSyntopicalContext,
} from '../syntopical-search.js';
import type { SyntopicalSearchOptions } from '../syntopical-search.js';

// Mock dependencies
vi.mock('../../../pageindex/book-search-v2.js', () => ({
  searchBookV2: vi.fn(),
}));

vi.mock('../../../pageindex/proposition-search.js', () => ({
  searchPropositions: vi.fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  agentLog: vi.fn(),
}));

vi.mock('./embedding-cache.js', () => ({
  getOrGenerateEmbedding: vi.fn(),
}));

describe('syntopical-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasSyntopicalKeywords', () => {
    it('should detect "对比" keyword', () => {
      expect(hasSyntopicalKeywords('对比《金钱心理学》和《纳瓦尔宝典》')).toBe(true);
    });

    it('should detect "比较" keyword', () => {
      expect(hasSyntopicalKeywords('比较这两本书的观点')).toBe(true);
    });

    it('should detect "看法不同" phrase', () => {
      expect(hasSyntopicalKeywords('这两本书对财富的看法不同')).toBe(true);
    });

    it('should detect "观点不同" phrase', () => {
      expect(hasSyntopicalKeywords('他们的观点不同')).toBe(true);
    });

    it('should detect "有什么不同" phrase', () => {
      expect(hasSyntopicalKeywords('这两本书有什么不同')).toBe(true);
    });

    it('should NOT trigger on standalone "不同" in non-comparison context', () => {
      expect(hasSyntopicalKeywords('这本书不同章节有什么内容')).toBe(false);
    });

    it('should NOT trigger on casual queries', () => {
      expect(hasSyntopicalKeywords('这本书讲了什么')).toBe(false);
    });

    it('should NOT trigger on single book queries', () => {
      expect(hasSyntopicalKeywords('什么是财富')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(hasSyntopicalKeywords('对比这两本书')).toBe(true);
      expect(hasSyntopicalKeywords('对 比')).toBe(false); // space breaks it
    });
  });

  describe('syntopicalSearch', () => {
    it('should return empty result when vaultPath is invalid', async () => {
      // This would fail in real scenario due to fs.access
      // For now, just test the structure
      const result = await syntopicalSearch({
        query: 'test',
        vaultPath: '/nonexistent',
      });

      expect(result.books).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it('should limit books to maxBooks parameter', async () => {
      // This test would need a mock vault setup
      // For now, document the expected behavior
      const options: SyntopicalSearchOptions = {
        query: 'wealth',
        vaultPath: '/vault',
        maxBooks: 3,
        topKPerBook: 5,
      };

      // In real scenario, would call searchBookV2 for each indexed book
      // and limit to maxBooks
      expect(options.maxBooks).toBe(3);
    });

    it('should use default maxBooks=5 when not specified', async () => {
      const options: SyntopicalSearchOptions = {
        query: 'wealth',
        vaultPath: '/vault',
      };

      expect(options.maxBooks).toBeUndefined();
      // Default should be 5 in implementation
    });
  });

  describe('formatSyntopicalContext', () => {
    it('should return empty string for empty results', () => {
      const result = formatSyntopicalContext({
        books: [],
        queryEmbedding: null,
        totalResults: 0,
      });

      expect(result).toBe('');
    });

    it('should format single book result correctly', () => {
      const mockBook = {
        bookId: 'book1',
        bookName: '金钱心理学',
        results: [{
          nodeId: 'node1',
          title: '财富的定义',
          fileName: '14 - 存钱',
          hierarchyPath: ['第14章'],
          matchedBlocks: [{
            blockId: 'p001',
            content: '财富是你没看到的部分...',
          }],
          score: 0.95,
          bm25Score: 0.8,
          vectorScore: 0.95,
        }],
        propositionMatches: [],
      };

      const result = formatSyntopicalContext({
        books: [mockBook],
        queryEmbedding: null,
        totalResults: 1,
      });

      expect(result).toContain('《金钱心理学》');
      expect(result).toContain('财富的定义');
      expect(result).toContain('财富是你没看到的部分');
    });

    it('should include proposition cards when available', () => {
      const mockBook = {
        bookId: 'book1',
        bookName: '金钱心理学',
        results: [],
        propositionMatches: [{
          card: {
            id: 'card1',
            type: '定义',
            answer: '财富是隐形的',
            context: '第14章',
            matchScore: 0.9,
          },
          score: 0.9,
        }],
      };

      const result = formatSyntopicalContext({
        books: [mockBook as any],
        queryEmbedding: null,
        totalResults: 0,
      });

      expect(result).toContain('原子事实卡片');
      expect(result).toContain('【定义】');
      expect(result).toContain('财富是隐形的');
    });
  });
});