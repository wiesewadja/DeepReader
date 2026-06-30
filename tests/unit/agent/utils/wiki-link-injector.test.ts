/**
 * wiki-link-injector.ts 单元测试
 *
 * Step 1 升级现有链接（修死链 + 补 blockId + alias）
 * Step 2 主题词内嵌（按上下文从多 block 里择优）
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/logger.js', () => ({
  agentLog: vi.fn(),
}));

import { upgradeInlineWikiLinks, type InjectionContext } from '@/agent/graph/utils/wiki-link-injector';
import type { ToolResultSnapshot } from '@/agent/graph/state';

const FULL_NODE_FILE_MAP: Record<string, string> = {
  '0008': '08 - 研究社会影响的过程.md',
  '0012': '12 - 内在吸引力.md',
  '0014': '14 - 游戏竞赛.md',
  '0033': '33 - 任何情感都能激发共享行为吗.md',
  '0052': '52 - 第六章 故事 Stories.md',
};

function makeCtx(over: Partial<InjectionContext> = {}): InjectionContext {
  return {
    toolResultsSnapshot: [],
    nodeFileMap: { ...FULL_NODE_FILE_MAP },
    pdfName: '疯传',
    crossBookMode: false,
    ...over,
  };
}

function snap(nodeId: string, blockId: string, excerpt: string): ToolResultSnapshot {
  return {
    toolName: 'pre_search',
    args: { query: 'auto', node_id: nodeId },
    result: excerpt,
    originalResultLength: excerpt.length,
    extractedBlockIds: [blockId],
  };
}

describe('Step 1 — 升级现有章节链接', () => {
  it('4 位前缀死链 → 修真实文件名 + 补 blockId + alias', () => {
    const content = '正如你在[[疯传/0033 - 任何情感都能激发共享行为吗]]中看到的…';
    const ctx = makeCtx({ toolResultsSnapshot: [snap('0033', 'p32-002', '情感共享')] });
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toBe('正如你在[[疯传/33 - 任何情感都能激发共享行为吗#^p32-002|任何情感都能激发共享行为吗]]中看到的…');
  });

  it('无 blockId 命中：仍修死链 + 补 alias', () => {
    const content = '[[疯传/0052 - 第六章 故事 Stories]] 提到…';
    expect(upgradeInlineWikiLinks(content, makeCtx())).toBe('[[疯传/52 - 第六章 故事 Stories|第六章 故事 Stories]] 提到…');
  });

  it('同章节多 block，按链接上下文择优（非第一个）', () => {
    const content = '好奇心是关键。[[疯传/12 - 内在吸引力|见本章]] 讲了这个。';
    const ctx = makeCtx({
      toolResultsSnapshot: [
        snap('0012', 'p11-004', '好奇心是内在吸引力的核心驱动'),
        snap('0012', 'p11-008', '游戏化机制让分享更有趣'),
      ],
    });
    const out = upgradeInlineWikiLinks(content, ctx);
    // 上下文"好奇心是关键"更匹配 p11-004（讲好奇心），非 p11-008
    expect(out).toContain('#^p11-004');
    expect(out).not.toContain('p11-008');
  });
});

describe('Step 2 — 主题词内嵌（按上下文择优 block）', () => {
  it('主题词第一次出现位置内嵌，单 block 直接用', () => {
    const content = '内在吸引力是指通过新奇、惊异或打破常规的事物来激发人们的好奇心。';
    const ctx = makeCtx({ toolResultsSnapshot: [snap('0012', 'p11-004', '内在吸引力激发好奇心')] });
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toBe('[[疯传/12 - 内在吸引力#^p11-004|内在吸引力]]是指通过新奇、惊异或打破常规的事物来激发人们的好奇心。');
  });

  it('同章节多 block，按主题词所在句子择优最匹配段', () => {
    // 12 章两个 block：p11-004 讲好奇心，p11-008 讲游戏化
    const content = '好奇心是内在吸引力的核心，新奇事物激发探索欲。';
    const ctx = makeCtx({
      toolResultsSnapshot: [
        snap('0012', 'p11-004', '好奇心是内在吸引力的核心驱动'),
        snap('0012', 'p11-008', '游戏化机制让分享更有趣'),
      ],
    });
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toContain('#^p11-004');
    expect(out).not.toContain('p11-008');
  });

  it('不同句子匹配同章节不同 block', () => {
    const content = '第一句讲好奇心是核心。第二句讲游戏化机制很有趣。';
    // 但同章节主题词"内在吸引力"未出现 → 用文件名标题词匹配不到，跳过
    // 这里验证：主题词未出现则不内嵌
    const ctx = makeCtx({
      toolResultsSnapshot: [snap('0012', 'p11-004', '好奇心'), snap('0012', 'p11-008', '游戏化')],
    });
    // 12章主题词"内在吸引力"不在 content → 不内嵌
    expect(upgradeInlineWikiLinks(content, ctx)).toBe(content);
  });

  it('主题词已在链接 alias 内 → 跳到下一次出现内嵌', () => {
    const content = '[[疯传/08 - 研究社会影响的过程|内在吸引力相关]] 讲了内在吸引力。';
    const ctx = makeCtx({ toolResultsSnapshot: [snap('0012', 'p11-004', '内在吸引力好奇心')] });
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toBe('[[疯传/08 - 研究社会影响的过程|内在吸引力相关]] 讲了[[疯传/12 - 内在吸引力#^p11-004|内在吸引力]]。');
  });

  it('主题词未在回答出现 → 不插入', () => {
    const content = '今天天气真好，适合出门散步。';
    const ctx = makeCtx({ toolResultsSnapshot: [snap('0012', 'p11-004', '内在吸引力')] });
    expect(upgradeInlineWikiLinks(content, ctx)).toBe(content);
  });

  it('主题词出现多次只内嵌第一次', () => {
    const content = '第一次讲研究社会影响的过程。第二次讲研究社会影响的过程。';
    const ctx = makeCtx({ toolResultsSnapshot: [snap('0008', 'p7-002', '研究社会影响')] });
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toBe('第一次讲[[疯传/08 - 研究社会影响的过程#^p7-002|研究社会影响的过程]]。第二次讲研究社会影响的过程。');
  });

  it('无 toolResults / 无 nodeFileMap 原样返回', () => {
    expect(upgradeInlineWikiLinks('纯文本回答。', makeCtx({ toolResultsSnapshot: [] }))).toBe('纯文本回答。');
    expect(upgradeInlineWikiLinks('纯文本。', makeCtx({ nodeFileMap: {} }))).toBe('纯文本。');
  });

  it('pickBestBlock 返回 null（excerpt 与上下文无重叠）时不内嵌、不锁死 done', () => {
    // excerpt"游戏竞赛"与正文完全无关 → bigram 0 → null → 不内嵌（不产生无 blockId 的文件级链接）
    const content = '今天天气晴朗。研究社会影响的过程很有意思。';
    const ctx = makeCtx({
      toolResultsSnapshot: [snap('0008', 'p7-002', '游戏竞赛通过让用户参与和分享提升品牌')],
    });
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toBe(content);
    expect(out).not.toContain('[[疯传/08');
  });

  it('search_book 一条记录多 blockId 全量入池，链接能补 blockId', () => {
    const content = '[[疯传/08 - 研究社会影响的过程]] 很重要。';
    const ctx = makeCtx({
      toolResultsSnapshot: [{
        toolName: 'search_book', args: { node_id: '0008' },
        result: '研究社会影响的过程', originalResultLength: 100,
        extractedBlockIds: ['p7-001', 'p7-002', 'p7-003'],
      }],
    });
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toMatch(/#\^p7-00[123]/);
  });

  it('crossBookMode=true 时 Step2 不内嵌（避免缺书名前缀死链）', () => {
    const content = '内在吸引力是指通过新奇事物激发好奇心。';
    const ctx = makeCtx({
      crossBookMode: true,
      pdfName: '',
      toolResultsSnapshot: [snap('0012', 'p11-004', '内在吸引力好奇心')],
    });
    expect(upgradeInlineWikiLinks(content, ctx)).toBe(content);
  });
});

describe('文件名归一化', () => {
  it('en-dash – 分隔的文件名也能去序号（alias 不残留序号）', () => {
    const content = '[[书/03–标题]] 讲了概念。';
    const ctx: InjectionContext = {
      toolResultsSnapshot: [],
      nodeFileMap: { '0003': '03–标题.md' },
      pdfName: '书',
      crossBookMode: false,
    };
    const out = upgradeInlineWikiLinks(content, ctx);
    expect(out).toBe('[[书/03–标题|标题]] 讲了概念。');
  });
});
