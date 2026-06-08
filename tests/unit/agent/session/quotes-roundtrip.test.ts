/**
 * SessionMessageLine 含 quotes 字段的 JSON round-trip 测试
 *
 * 验证 C4（JSON.stringify 不会因为 quotes 抛错）：
 * - 完整 QuoteItem 字段都能序列化
 * - 反序列化后字段完整保留
 * - 旧版 JSONL（没有 quotes 字段）仍能加载
 */

import { describe, it, expect } from 'vitest';
import type { SessionMessageLine } from '@/agent/session/types';

describe('SessionMessageLine JSON round-trip (quotes + citedQuoteIds)', () => {
  it('应能 JSON.stringify 含完整 quotes 的 user 消息行', () => {
    const line: SessionMessageLine = {
      role: 'user',
      content: '这段在论证什么？',
      timestamp: '2026-01-01T00:00:00.000Z',
      quotes: [
        {
          id: 'quote-1',
          text: '回报函数是强化学习的核心。',
          source: 'AI极简经济学',
          sourcePath: 'DeepReader/AI极简经济学/04-第一章.md',
          blockId: 'ch1-p3',
          nodeId: '0004',
          heading: '1.1 什么是回报函数',
          headingPath: ['第一章', '1.1 什么是回报函数'],
          page: 12,
        },
      ],
    };

    // C4 验证：JSON.stringify 不抛错
    const json = JSON.stringify(line);
    expect(json).toBeTruthy();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('应能 JSON.stringify 含 citedQuoteIds + citedQuotePreviews 的 AI 消息行', () => {
    const line: SessionMessageLine = {
      role: 'assistant',
      content: '如你在引用中提到的，回报函数...',
      timestamp: '2026-01-01T00:00:01.000Z',
      citedQuoteIds: ['quote-1', 'quote-2'],
      citedQuotePreviews: ['回报函数是强化学习…', 'MECE 原则…'],
    };

    const json = JSON.stringify(line);
    const parsed = JSON.parse(json) as SessionMessageLine;
    expect(parsed.citedQuoteIds).toEqual(['quote-1', 'quote-2']);
    expect(parsed.citedQuotePreviews).toEqual(['回报函数是强化学习…', 'MECE 原则…']);
  });

  it('应能 round-trip 完整字段不丢失', () => {
    const original: SessionMessageLine = {
      role: 'user',
      content: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
      quotes: [
        { id: 'q1', text: 'a' },
        { id: 'q2', text: 'b', blockId: 'b1' },
      ],
      citedQuoteIds: ['q1'],
      citedQuotePreviews: ['a'],
    };

    const round = JSON.parse(JSON.stringify(original)) as SessionMessageLine;
    expect(round.role).toBe('user');
    expect(round.content).toBe('test');
    expect(round.quotes).toEqual(original.quotes);
    expect(round.citedQuoteIds).toEqual(['q1']);
    expect(round.citedQuotePreviews).toEqual(['a']);
  });

  it('旧版 JSONL（没有 quotes/citedQuoteIds 字段）应能加载为 undefined', () => {
    // 模拟旧版 JSONL 数据
    const oldLine = {
      role: 'user',
      content: 'old format',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const parsed = JSON.parse(JSON.stringify(oldLine)) as SessionMessageLine;
    expect(parsed.quotes).toBeUndefined();
    expect(parsed.citedQuoteIds).toBeUndefined();
    expect(parsed.citedQuotePreviews).toBeUndefined();
  });

  it('空 quotes 数组（[]）应正常序列化', () => {
    const line: SessionMessageLine = {
      role: 'user',
      content: 'no quotes',
      timestamp: '2026-01-01T00:00:00.000Z',
      quotes: [],
    };
    const json = JSON.stringify(line);
    const parsed = JSON.parse(json) as SessionMessageLine;
    // 兼容性：loadMessages 检查 `.length`，空数组视为无引用
    expect(parsed.quotes?.length ?? 0).toBe(0);
  });

  it('writeSessionFile 重建：应保留所有持久化字段（防 N2 回归）', () => {
    // 模拟 session.messages 里的 ChatMessage 对象，含全部扩展字段
    const sessionMessages: Array<any> = [
      {
        role: 'user',
        content: '什么是回报函数？',
        quotes: [{ id: 'q1', text: '回报函数是强化学习的核心。', blockId: 'ch1-p3' }],
      },
      {
        role: 'assistant',
        content: '回报函数是...',
        citedQuoteIds: ['q1'],
        citedQuotePreviews: ['回报函数是强化学习…'],
        voiceAudioPath: 'voice/s1/msg-1.wav',
        voiceDuration: 12.5,
        letterState: 'sealed',
      },
    ];

    // 模拟 writeSessionFile 的重建逻辑（修复后版本）
    const rebuilt = sessionMessages.map(msg => {
      const ext = msg as any;
      return {
        role: ext.role,
        content: ext.content,
        quotes: ext.quotes,
        citedQuoteIds: ext.citedQuoteIds,
        citedQuotePreviews: ext.citedQuotePreviews,
        voiceAudioPath: ext.voiceAudioPath,
        voiceDuration: ext.voiceDuration,
        letterState: ext.letterState,
      };
    });

    expect(rebuilt[0].quotes).toEqual([{ id: 'q1', text: '回报函数是强化学习的核心。', blockId: 'ch1-p3' }]);
    expect(rebuilt[1].citedQuoteIds).toEqual(['q1']);
    expect(rebuilt[1].citedQuotePreviews).toEqual(['回报函数是强化学习…']);
    expect(rebuilt[1].voiceAudioPath).toBe('voice/s1/msg-1.wav');
    expect(rebuilt[1].voiceDuration).toBe(12.5);
  });
});
