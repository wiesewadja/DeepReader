/**
 * 本地工具函数测试
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildLocalCache,
  extractChapterMetadata,
  estimateTokens,
  parseSectionPath,
  extractHeadingFromPath,
  normalizeHeading
} from '../../../tools/local/utils.js';
import type { TFile } from 'obsidian';

describe('local/utils', () => {
  describe('buildLocalCache', () => {
    it('应正确构建文件缓存和索引', async () => {
      const mockFiles = [
        { path: 'DeepReader/如何阅读一本书/04-第一章.md', extension: 'md' },
        { path: 'DeepReader/如何阅读一本书/05-第二章.md', extension: 'md' },
        { path: 'Other/file.md', extension: 'md' },
      ] as unknown as TFile[];

      const mockApp = {
        vault: {
          getMarkdownFiles: () => mockFiles,
          cachedRead: vi.fn().mockResolvedValue('内容 ^block123')
        },
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue({
            frontmatter: { node_id: '0004', section: '第一章', level: 1 }
          })
        }
      } as any;

      const cache = await buildLocalCache(mockApp, '如何阅读一本书');

      expect(cache.chapterFiles).toHaveLength(2);
      expect(cache.nodeIdIndex?.has('0004')).toBe(true);
    });

    it('应正确构建 blockId 索引', async () => {
      const mockFiles = [
        { path: 'DeepReader/测试书/01-章节.md', extension: 'md' },
      ] as unknown as TFile[];

      const mockApp = {
        vault: {
          getMarkdownFiles: () => mockFiles,
          cachedRead: vi.fn().mockResolvedValue('内容 ^ch1-p1 和 ^ch1-p2')
        },
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue({
            frontmatter: { node_id: '0001', section: '章节' }
          })
        }
      } as any;

      const cache = await buildLocalCache(mockApp, '测试书');

      expect(cache.blockIdIndex?.has('^ch1-p1')).toBe(true);
      expect(cache.blockIdIndex?.has('^ch1-p2')).toBe(true);
    });
  });

  describe('extractChapterMetadata', () => {
    it('应正确提取 frontmatter 元数据', () => {
      const frontmatter = {
        node_id: '0006',
        section: '第一篇 > 第一章 > MECE',
        level: 2,
        summary: '本章探讨...',
        page_range: '5-6'
      };

      const metadata = extractChapterMetadata(frontmatter);

      expect(metadata.node_id).toBe('0006');
      expect(metadata.section).toBe('第一篇 > 第一章 > MECE');
      expect(metadata.level).toBe(2);
      expect(metadata.summary).toBe('本章探讨...');
      expect(metadata.page_range).toBe('5-6');
    });

    it('应处理缺失的可选字段', () => {
      const frontmatter = {
        node_id: '0001',
        section: '序言',
        level: 0
      };

      const metadata = extractChapterMetadata(frontmatter);

      expect(metadata.summary).toBeUndefined();
      expect(metadata.page_range).toBeUndefined();
    });
  });

  describe('estimateTokens', () => {
    it('中文应按字数/2估算', () => {
      const text = '这是一段中文测试文本';
      expect(estimateTokens(text)).toBe(Math.ceil(text.length / 2));
    });

    it('英文应按单词数估算', () => {
      const text = 'hello world test';
      expect(estimateTokens(text)).toBe(3);
    });

    it('混合文本应分别计算', () => {
      const text = '这是test混合文本';
      const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
      expect(estimateTokens(text)).toBe(Math.ceil(chineseChars / 2) + englishWords);
    });
  });

  describe('parseSectionPath', () => {
    it('应正确解析层级路径', () => {
      expect(parseSectionPath('第一篇 > 第一章 > MECE')).toEqual(['第一篇', '第一章', 'MECE']);
    });

    it('应处理单层路径', () => {
      expect(parseSectionPath('序言')).toEqual(['序言']);
    });

    it('应去除空白', () => {
      expect(parseSectionPath(' 第一篇 > 第一章 ')).toEqual(['第一篇', '第一章']);
    });
  });

  describe('extractHeadingFromPath', () => {
    it('应从文件名提取标题', () => {
      expect(extractHeadingFromPath('DeepReader/书名/04-第一章 阅读的活力与艺术.md'))
        .toBe('第一章 阅读的活力与艺术');
    });

    it('应处理无前缀的文件名', () => {
      expect(extractHeadingFromPath('DeepReader/书名/序言.md')).toBe('序言');
    });
  });

  describe('normalizeHeading', () => {
    it('应去除空格和#符号', () => {
      expect(normalizeHeading('### MECE 原则')).toBe('mece原则');
    });

    it('应统一标点符号', () => {
      expect(normalizeHeading('标题：副标题')).toBe('标题:副标题');
      expect(normalizeHeading('A，B，C')).toBe('a,b,c');
    });
  });
});
