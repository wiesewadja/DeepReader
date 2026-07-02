/**
 * formatter-helpers.ts 单元测试
 *
 * 任务 1：extractRetrievedBlocks — 按记录聚合提取 block 原文
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/logger.js', () => ({ agentLog: vi.fn() }));

import { extractRetrievedBlocks, buildFormatterUserMessage, type RetrievedBlock } from '@/agent/prompts/utils/formatter-helpers';
import type { ToolResultSnapshot } from '@/agent/graph/state';

function snap(nodeId: string, blockIds: string[], excerpt: string): ToolResultSnapshot {
  return {
    toolName: 'search_book',
    args: { query: 'q', node_id: nodeId },
    result: excerpt,
    originalResultLength: excerpt.length,
    extractedBlockIds: blockIds,
  };
}

const NFM: Record<string, string> = {
  '0008': '08 - 研究社会影响的过程.md',
  '0012': '12 - 内在吸引力.md',
};

describe('extractRetrievedBlocks', () => {
  it('按记录聚合：一条记录多 blockId 共享一份 excerpt', () => {
    const out = extractRetrievedBlocks([snap('0008', ['b1', 'b2'], '原文片段')], NFM);
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe('08 - 研究社会影响的过程');
    expect(out[0].blockIds).toEqual(['b1', 'b2']);
    expect(out[0].excerpt).toBe('原文片段');
  });

  it('多记录 → 多个 block，fileName 来自 nodeFileMap 并去 .md', () => {
    const out = extractRetrievedBlocks([
      snap('0008', ['b1'], '片段A'),
      snap('0012', ['b2'], '片段B'),
    ], NFM);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.fileName)).toEqual(['08 - 研究社会影响的过程', '12 - 内在吸引力']);
  });

  it('node_id 缺失 → 跳过', () => {
    const s = snap('0008', ['b1'], 'x');
    s.args = { query: 'q' };
    expect(extractRetrievedBlocks([s], NFM)).toHaveLength(0);
  });

  it('nodeFileMap 无映射 → 跳过', () => {
    expect(extractRetrievedBlocks([snap('9999', ['b1'], 'x')], NFM)).toHaveLength(0);
  });

  it('extractedBlockIds 空 → 跳过', () => {
    expect(extractRetrievedBlocks([snap('0008', [], 'x')], NFM)).toHaveLength(0);
  });

  it('result 空 → 跳过', () => {
    expect(extractRetrievedBlocks([snap('0008', ['b1'], '')], NFM)).toHaveLength(0);
  });

  it('maxCharsPerBlock 截断 excerpt', () => {
    const long = '一'.repeat(500);
    const out = extractRetrievedBlocks([snap('0008', ['b1'], long)], NFM, { maxCharsPerBlock: 10 });
    expect(out[0].excerpt).toBe('一'.repeat(10));
  });

  it('maxBlocks 限制入池记录数', () => {
    const out = extractRetrievedBlocks([
      snap('0008', ['b1'], 'a'),
      snap('0012', ['b2'], 'b'),
    ], NFM, { maxBlocks: 1 });
    expect(out).toHaveLength(1);
  });

  it('跨记录去重 blockId：第二条全重复则跳过', () => {
    const out = extractRetrievedBlocks([
      snap('0008', ['b1'], '片段A'),
      snap('0012', ['b1'], '片段B'),
    ], NFM);
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe('08 - 研究社会影响的过程');
  });

  it('跨记录去重 blockId：第二条部分新则保留新 id', () => {
    const out = extractRetrievedBlocks([
      snap('0008', ['b1'], '片段A'),
      snap('0012', ['b1', 'b2'], '片段B'),
    ], NFM);
    expect(out).toHaveLength(2);
    expect(out[1].blockIds).toEqual(['b2']);
  });
});

describe('buildFormatterUserMessage — retrieved_blocks 注入', () => {
  const blocks: RetrievedBlock[] = [
    { fileName: '08 - 研究社会影响的过程', blockIds: ['b1', 'b2'], excerpt: '社会影响的原文' },
  ];

  it('有 blocks → prompt 含 <retrieved_blocks> 段，格式 【书/文件#^b1 #^b2】', () => {
    const msg = buildFormatterUserMessage(
      '问题', '分析结果', '疯传', [], undefined, undefined, undefined, undefined,
      false, undefined, undefined, blocks,
    );
    expect(msg).toContain('<retrieved_blocks>');
    expect(msg).toContain('【疯传/08 - 研究社会影响的过程#^b1 #^b2】');
    expect(msg).toContain('社会影响的原文');
    expect(msg).toContain('</retrieved_blocks>');
  });

  it('空 blocks → 不注入 <retrieved_blocks>', () => {
    const msg = buildFormatterUserMessage('问题', '分析', '疯传', []);
    expect(msg).not.toContain('<retrieved_blocks>');
  });

  it('multiBook=true → block 行无书名前缀', () => {
    const msg = buildFormatterUserMessage(
      '问题', '分析', '疯传', [], undefined, undefined, undefined, undefined,
      true, undefined, undefined, blocks,
    );
    expect(msg).toContain('【08 - 研究社会影响的过程#^b1 #^b2】');
    expect(msg).not.toContain('疯传/08');
  });
});
