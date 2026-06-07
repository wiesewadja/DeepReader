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

  it('Chinese chapter marker: title is the heading text after marker (not the marker itself)', () => {
    // 修复后: split 出来的 chapter title 是 prefix 之后的 heading 文本，不是 prefix 本身
    // 例: "第一章 开篇" → title="开篇"（不是"第一章"）
    const text = `前言\n第一章 开篇\n内容A\n第二章 展开\n内容B\n第三章 结尾\n内容C`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.chapters.length).toBe(4);
    expect(result.chapters[1].title).toBe('开篇');
    expect(result.chapters[2].title).toBe('展开');
    expect(result.chapters[3].title).toBe('结尾');
  });

  it('ATX heading: title is the full heading text, not the prefix', () => {
    // 修复后: ATX heading 提取的 title 是 prefix 之后的 heading 文本
    // 例: "## Title B" → title="Title B"（不是"##"）
    const text = `# Title A\n内容A\n## Title B\n内容B`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].title).toBe('Title A');
    expect(result.chapters[1].title).toBe('Title B');
  });

  it('ATX heading ## 中文: title is the heading text, not "##"', () => {
    // 真实场景: AI 极简经济学 索引时被 splitLargeEpubPages 切碎，
    // 修复前所有 ## 标题子节点 title="##"，导致 S1 Inspectional 无法 scope
    const text = `前言\n## 判断的价值\n内容A\n## 回报函数工程\n内容B\n## 整合\n内容C`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.chapters.length).toBe(4);
    // 第一段无 heading prefix，保留原 chapter.title
    expect(result.chapters[0].title).toBe('Original Chapter');
    // 后续段: heading 全文作为 title
    expect(result.chapters[1].title).toBe('判断的价值');
    expect(result.chapters[2].title).toBe('回报函数工程');
    expect(result.chapters[3].title).toBe('整合');
  });

  it('English chapter marker: title is the heading text after "Chapter N"', () => {
    // 英文场景: "Chapter 1 Social Currency" → title="Social Currency"
    const text = `Intro\nChapter 1 Social Currency\nContent A\nChapter 2 Triggers\nContent B`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.chapters.length).toBe(3);
    expect(result.chapters[1].title).toBe('Social Currency');
    expect(result.chapters[2].title).toBe('Triggers');
  });

  it('Part marker: title is the heading text after "Part X"', () => {
    // Part 标记: "Part I Introduction" → title="Introduction"
    const text = `Preface\nPart I Introduction\nContent A\nPart II Methods\nContent B`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    expect(result.chapters.length).toBe(3);
    expect(result.chapters[1].title).toBe('Introduction');
    expect(result.chapters[2].title).toBe('Methods');
  });

  it('falls back to chapter.title when heading has no text after prefix', () => {
    // 防御: 当 heading 文本为空时（如 "## " 单独成行），回退到 chapter.title
    const text = `前言\n## \n内容A\n## 真实标题\n内容B`;
    const { pages, chapters } = buildInput(text);
    pages[0].tokenCount = EPUB_SPLIT_THRESHOLD + 1;

    const result = splitLargeEpubPages(pages, chapters);

    expect(result.split).toBe(true);
    // 第一段（含"前言"）保留原 title "Original Chapter"
    expect(result.chapters[0].title).toBe('Original Chapter');
    // 第二段 heading 为空，回退到 chapter.title
    expect(result.chapters[1].title).toBe('Original Chapter');
    // 第三段正常
    expect(result.chapters[2].title).toBe('真实标题');
  });
});
