import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasSyntopicalKeywords } from '@/agent/utils/syntopical-search';

describe('Router — Syntopical Trigger Logic', () => {
  describe('Hybrid trigger: keyword pre-check', () => {
    it('should trigger syntopical for comparison queries', () => {
      const queries = [
        '对比《金钱心理学》和《纳瓦尔宝典》对财富的看法',
        '比较这两本书关于储蓄的观点',
        '《A》和《B》有什么不同',
        '这两本书观点不同在哪里',
        '跨书对比一下',
        '《A》和《B》的异同',
      ];

      for (const q of queries) {
        expect(hasSyntopicalKeywords(q)).toBe(true);
      }
    });

    it('should NOT trigger syntopical for single book queries', () => {
      const queries = [
        '这本书讲了什么',
        '什么是财富',
        '第3章的内容',
        '这本书不同章节有什么内容',
        '帮我总结一下',
        '核心观点是什么',
      ];

      for (const q of queries) {
        expect(hasSyntopicalKeywords(q)).toBe(false);
      }
    });

    it('should trigger for "主题阅读" keyword', () => {
      expect(hasSyntopicalKeywords('主题阅读财富概念')).toBe(true);
    });

    it('should trigger for "共识" and "分歧" keywords', () => {
      expect(hasSyntopicalKeywords('这两本书的共识是什么')).toBe(true);
      expect(hasSyntopicalKeywords('他们的分歧在哪里')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty query', () => {
      expect(hasSyntopicalKeywords('')).toBe(false);
    });

    it('should handle query with only spaces', () => {
      expect(hasSyntopicalKeywords('   ')).toBe(false);
    });

    it('should handle very long query', () => {
      const longQuery = '对比' + '这本书'.repeat(100);
      expect(hasSyntopicalKeywords(longQuery)).toBe(true);
    });
  });
});