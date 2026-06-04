/**
 * link-validator.ts 现状行为回归测试
 *
 * 目标：固化 link-validator 当前行为（不改实现），为后续重构提供 baseline。
 * 当前被 views/sidebar/agent-chat-controller.ts:505 调用，是 wiki 链接校验的 active 路径。
 */

import { describe, it, expect, vi } from 'vitest';

// Mock logger (link-validator 依赖)
vi.mock('@/utils/logger.js', () => ({
  toolsLog: vi.fn(),
  error: vi.fn(),
}));

import {
  parseWikiLink,
  fuzzyMatchFile,
  validateAndCorrectLinks,
  extractReferencedChapters,
} from '@/agent/utils/link-validator';
import type { App } from 'obsidian';

// Mock App with vault adapter
function createMockApp(adapterOverrides: Record<string, any> = {}) {
  return {
    vault: {
      adapter: {
        exists: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
        ...adapterOverrides,
      },
    },
  } as unknown as App;
}

describe('parseWikiLink', () => {
  it('parses link with folder and filename', () => {
    const result = parseWikiLink('[[西方史纲/08-八、抗议.md|八、抗议]]');
    expect(result).toEqual({
      fullPath: '西方史纲/08-八、抗议.md',
      displayText: '八、抗议',
      folder: '西方史纲',
      filename: '08-八、抗议.md',
    });
  });

  it('parses link without alias (uses filename as display)', () => {
    const result = parseWikiLink('[[西方史纲/08-八、抗议.md]]');
    expect(result?.displayText).toBe('08-八、抗议.md');
    expect(result?.folder).toBe('西方史纲');
  });

  it('returns null for non-wiki text', () => {
    expect(parseWikiLink('plain text')).toBeNull();
    expect(parseWikiLink('[[incomplete')).toBeNull();
  });

  it('handles file without folder', () => {
    const result = parseWikiLink('[[01-intro.md|简介]]');
    expect(result?.fullPath).toBe('01-intro.md');
    expect(result?.folder).toBe('');
    expect(result?.filename).toBe('01-intro.md');
  });
});

describe('fuzzyMatchFile', () => {
  it('returns exact match when target filename exists', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({
        files: ['DeepReader/西方史纲/08-八、抗议.md', 'DeepReader/西方史纲/01-序.md'],
        folders: [],
      }),
    });
    const result = await fuzzyMatchFile(app, '西方史纲', '08-八、抗议.md');
    expect(result).toBe('DeepReader/西方史纲/08-八、抗议.md');
  });

  it('returns null when folder does not exist', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(false),
    });
    const result = await fuzzyMatchFile(app, '不存在的书', '01.md');
    expect(result).toBeNull();
  });

  it('fuzzy matches by stripped title (removes chapter number prefix)', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({
        files: [
          'DeepReader/西方史纲/08-八、抗议.md',
          'DeepReader/西方史纲/01-序.md',
        ],
        folders: [],
      }),
    });
    // 传入错误编号但标题匹配
    const result = await fuzzyMatchFile(app, '西方史纲', '07-八、抗议.md');
    expect(result).toBe('DeepReader/西方史纲/08-八、抗议.md');
  });

  it('returns null when no match above similarity threshold (0.5)', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({
        files: ['DeepReader/西方史纲/01-完全不同的章节.md'],
        folders: [],
      }),
    });
    const result = await fuzzyMatchFile(app, '西方史纲', '99-八、抗议.md');
    expect(result).toBeNull();
  });
});

describe('validateAndCorrectLinks', () => {
  it('keeps link as-is when file exists', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const content = 'see [[西方史纲/01-序.md|序]] for context';
    const result = await validateAndCorrectLinks(app, content);
    expect(result.correctedContent).toBe(content);
    expect(result.validatedLinks).toHaveLength(1);
    expect(result.validatedLinks[0].isCorrected).toBe(false);
  });

  it('corrects link to fuzzy-matched file', async () => {
    const app = createMockApp({
      exists: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes('07-八、抗议')) return false;
        if (path === 'DeepReader/西方史纲') return true;
        return false;
      }),
      list: vi.fn().mockResolvedValue({
        files: ['DeepReader/西方史纲/08-八、抗议.md'],
        folders: [],
      }),
    });
    const content = 'see [[西方史纲/07-八、抗议.md|七、抗议]]';
    const result = await validateAndCorrectLinks(app, content);
    expect(result.correctedContent).toContain('08-八、抗议.md');
    expect(result.validatedLinks[0].isCorrected).toBe(true);
  });

  it('keeps link as-is when no match found (no deletion)', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(false),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const content = 'see [[西方史纲/99-不存在的章节.md|九十九]]';
    const result = await validateAndCorrectLinks(app, content);
    expect(result.correctedContent).toBe(content);
    expect(result.validatedLinks[0].existsPath).toBeNull();
  });

  it('extracts chapter index from filename prefix', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const result = await validateAndCorrectLinks(app, '[[西方史纲/08-八、抗议.md|八]]');
    expect(result.validatedLinks[0].chapterIndex).toBe(8);
  });

  it('handles multiple links in same content', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const content = '[[西方史纲/01-序.md|序]] and [[西方史纲/02-论.md|论]]';
    const result = await validateAndCorrectLinks(app, content);
    expect(result.validatedLinks).toHaveLength(2);
    expect(result.validatedLinks[0].chapterIndex).toBe(1);
    expect(result.validatedLinks[1].chapterIndex).toBe(2);
  });
});

describe('extractReferencedChapters', () => {
  it('extracts unique chapter indices from validated links', () => {
    const validatedLinks = [
      { original: 'a', corrected: 'a', isCorrected: false, existsPath: 'p1', chapterIndex: 1 },
      { original: 'b', corrected: 'b', isCorrected: false, existsPath: 'p2', chapterIndex: 2 },
      { original: 'c', corrected: 'c', isCorrected: false, existsPath: 'p3', chapterIndex: 1 }, // dup
      { original: 'd', corrected: 'd', isCorrected: false, existsPath: null, chapterIndex: null }, // null
    ] as any;
    const result = extractReferencedChapters(validatedLinks);
    expect(result).toEqual([1, 2]);
  });

  it('returns empty array when no chapters referenced', () => {
    const validatedLinks = [
      { original: 'a', corrected: 'a', isCorrected: false, existsPath: null, chapterIndex: null },
    ] as any;
    expect(extractReferencedChapters(validatedLinks)).toEqual([]);
  });
});
