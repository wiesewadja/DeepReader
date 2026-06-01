/**
 * EPUB 章节拆分单元测试
 *
 * 直接对 `splitLargeEpubPages` 真实实现进行端到端测试，
 * 确保生产代码中的正则/阈值与测试断言完全一致。
 */
import { describe, it, expect } from 'vitest';
import {
  splitLargeEpubPages,
  EPUB_SPLIT_THRESHOLD,
  type EpubChapter,
} from '@/pageindex/parsers/epub';
import type { PdfPage } from '@/pageindex/parsers/pdf';

// ── 测试夹具 ──

function makePage(text: string, tokenCount?: number): PdfPage {
  return { text, tokenCount: tokenCount ?? text.length };
}

function makeChapter(title: string, content: string, order: number): EpubChapter {
  return {
    id: `ch-${order}`,
    title,
    content,
    tokenCount: content.length,
    order,
    href: `chapter${order}.xhtml`,
  };
}

function buildInput(text: string) {
  const chapter = makeChapter('Original Chapter', text, 0);
  return { pages: [makePage(text)], chapters: [chapter] };
}

// ════════════════════════════════════════
// 阈值边界
// ════════════════════════════════════════

describe('splitLargeEpubPages - threshold', () => {
  it('passes through pages below threshold unchanged', () => {
    const smallText = 'a'.repeat(100);
    const { pages, chapters, split } = buildInput(smallText);
    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(false);
    expect(result.pages).toHaveLength(1);
    expect(result.chapters).toHaveLength(1);
    expect(result.pages[0].text).toBe(smallText);
  });

  it('does not mutate input arrays', () => {
    const pages = [makePage('foo bar', 10)];
    const chapters = [makeChapter('Title', 'foo bar', 0)];
    const pagesRef = pages;
    const chaptersRef = chapters;
    splitLargeEpubPages(pages, chapters);
    expect(pages).toBe(pagesRef);
    expect(chapters).toBe(chaptersRef);
  });

  it('uses threshold = 4500 tokens', () => {
    expect(EPUB_SPLIT_THRESHOLD).toBe(4500);
  });
});

// ════════════════════════════════════════
// Heading 模式识别
// ════════════════════════════════════════

describe('splitLargeEpubPages - heading patterns', () => {
  it('splits by ATX heading #', () => {
    const text = `前言\n内容...\n# 第一章 社交货币\n社交货币内容...\n# 第二章 诱因\n诱因内容...`;
    const { pages, chapters } = buildInput(text);
    // force above threshold so splitting kicks in
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(3);
    expect(result.pages[0].text).toContain('前言');
    expect(result.pages[1].text).toContain('社交货币');
    expect(result.pages[2].text).toContain('诱因');
  });

  it('splits by ATX heading ##', () => {
    const text = `前言\n内容...\n## 社交货币\n社交货币内容...\n## 诱因\n诱因内容...`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(3);
    expect(result.pages[1].text).toContain('社交货币');
    expect(result.pages[2].text).toContain('诱因');
  });

  it('splits by Chinese chapter markers 第X章', () => {
    const text = `前言\n一些内容\n第一章 社交货币\n社交货币内容\n第二章 诱因\n诱因内容\n第三章 情绪\n情绪内容`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(4);
    expect(result.pages[1].text).toMatch(/第一章/);
    expect(result.pages[2].text).toMatch(/第二章/);
    expect(result.pages[3].text).toMatch(/第三章/);
  });

  it('handles full-width space after 章', () => {
    const text = `前言\n第一章\u3000社交货币\n内容A\n第二章\u3000诱因\n内容B`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    // \s matches \u3000 (full-width space)
    expect(result.pages.length).toBe(3);
  });

  it('splits by English Chapter pattern', () => {
    const text = `Intro\nChapter 1 Social Currency\nContent A\nChapter 2 Triggers\nContent B`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(3);
    expect(result.pages[1].text).toContain('Chapter 1');
    expect(result.pages[2].text).toContain('Chapter 2');
  });

  it('does not split on unrelated text containing markers', () => {
    const text = `这是一段普通文字\n里面包含了第一章没有换行\n还有Chapter这个词`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    // no \n before marker → no split
    expect(result.pages.length).toBe(1);
  });

  it('handles complex real-world patterns', () => {
    const text = `前言\u3000Introduction\n\n我的研究从2008年开始\n\n第一章\u3000社交货币\u3000Social Currency\n\n人们为什么分享\n\n第二章\u3000诱因\u3000Triggers\n\n触发行为\n\n第三章\u3000情绪\u3000Emotion\n\n情感驱动\n\n后记`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(4);
    expect(result.pages[0].text).toContain('前言');
    expect(result.pages[1].text).toMatch(/第一章/);
    expect(result.pages[2].text).toMatch(/第二章/);
    expect(result.pages[3].text).toMatch(/第三章/);
    expect(result.pages[3].text).toContain('后记');
  });

  it('matches 第十X章 patterns', () => {
    const text = `内容\n第十章 总结\n结尾内容`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(2);
    expect(result.pages[1].text).toContain('第十章');
  });
});

// ════════════════════════════════════════
// Page 边界 + 标题生成
// ════════════════════════════════════════

describe('splitLargeEpubPages - mixed sizes', () => {
  it('keeps small pages intact and splits only large ones', () => {
    const small = makePage('small content', 100);
    const largeText = `第一章 A\n内容A\n第二章 B\n内容B\n第三章 C\n内容C`;
    const large = makePage(largeText, EPUB_SPLIT_THRESHOLD + 1);
    const chapters = [
      makeChapter('Ch1', 'small content', 0),
      makeChapter('Ch2', largeText, 1),
    ];

    const result = splitLargeEpubPages([small, large], chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(4); // 1 small + 3 splits
    expect(result.pages[0].text).toBe('small content');
    expect(result.pages[1].text).toContain('第一章');
    expect(result.pages[2].text).toContain('第二章');
    expect(result.pages[3].text).toContain('第三章');
  });

  it('keeps large page unsplit when it has no heading markers', () => {
    const text = 'A'.repeat(EPUB_SPLIT_THRESHOLD + 100);
    const { pages, chapters } = buildInput(text);
    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.pages.length).toBe(1);
    expect(result.pages[0].text).toBe(text);
  });

  it('generates titles from heading prefix for split chapters (Chinese markers)', () => {
    // 中文 第X章 提取整个前缀作为 title（“第一章”）
    const text = `前言\n第一章 开篇\n内容A\n第二章 展开\n内容B\n第三章 结尾\n内容C`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.chapters.length).toBe(4);
    expect(result.chapters[1].title).toContain('第一章');
    expect(result.chapters[2].title).toContain('第二章');
    expect(result.chapters[3].title).toContain('第三章');
  });

  it('ATX heading prefix: title is the marker only (existing behavior, not the full line)', () => {
    // ATX heading #/## 提取的 title 是前缀本身（# / ##），不是整行标题。
    // 这是 pre-existing 行为，保留以便后续重构时不产生静默变更。
    const text = `# Title A\n内容A\n## Title B\n内容B`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].title).toBe('#');
    expect(result.chapters[1].title).toBe('##');
  });
});
