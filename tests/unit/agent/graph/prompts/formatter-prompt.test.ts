/**
 * Tests for buildFormatterUserMessage — specifically the retrieval_coverage block.
 *
 * The block exists to give S4 metadata about which chapters were searched vs.
 * the user's current chapter. When isCoverageGap=true, S4 should silently
 * trust the analysis (L5 state-machine restart handles negative claims
 * upstream of S4 — see utils/claim-verifier.ts). S4 must NEVER expose the
 * gap to the user as a disclaimer. Product principle: fix errors silently,
 * never make the user tolerate AI's internal failure modes.
 */

import { describe, it, expect } from 'vitest';
import { buildFormatterUserMessage } from '@/agent/graph/prompts/formatter-prompt';

describe('buildFormatterUserMessage — retrieval coverage', () => {
  it('emits coverage-gap guidance when current chapter is missing from searches', () => {
    const out = buildFormatterUserMessage(
      '什么是回报函数工程',
      'analysis says 未出现',
      'AI极简经济学',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      {
        searchedNodeIds: ['0021', '0022', '0025'],
        currentNodeId: '0024',
        isCoverageGap: true,
      },
    );
    expect(out).toContain('<retrieval_coverage>');
    expect(out).toContain('0024');
    expect(out).toContain('L5 状态机重启');
  });

  it('omits coverage-gap guidance when current chapter IS covered', () => {
    const out = buildFormatterUserMessage(
      '什么是回报函数工程',
      'analysis content',
      'AI极简经济学',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      {
        searchedNodeIds: ['0021', '0022', '0024'],
        currentNodeId: '0024',
        isCoverageGap: false,
      },
    );
    expect(out).toContain('<retrieval_coverage>');
    expect(out).not.toContain('L5 状态机重启');
  });

  it('shows "(无)" when searchedNodeIds is empty and no current chapter', () => {
    const out = buildFormatterUserMessage(
      '什么是回报函数工程',
      '',
      'AI极简经济学',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      {
        searchedNodeIds: [],
        currentNodeId: undefined,
        isCoverageGap: false,
      },
    );
    expect(out).toContain('<retrieval_coverage>');
    expect(out).toContain('(无)');
    expect(out).toContain('(未知)');
  });

  it('omits retrieval_coverage block entirely when no signal exists', () => {
    const out = buildFormatterUserMessage(
      '什么是回报函数工程',
      '',
      'AI极简经济学',
      [],
    );
    expect(out).not.toContain('<retrieval_coverage>');
  });

  it('NEVER references the dead "补充检索结果" marker (L5 is now upstream)', () => {
    const out = buildFormatterUserMessage(
      '什么是回报函数工程',
      '',
      'AI极简经济学',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      {
        searchedNodeIds: ['0021'],
        currentNodeId: '0024',
        isCoverageGap: true,
      },
    );
    // The supplement marker mechanism was moved to S2-Pre state machine restart
    expect(out).not.toContain('补充检索结果');
  });

  it('NEVER tells S4 to expose "检索失败" or "未覆盖" to the user', () => {
    const out = buildFormatterUserMessage(
      '什么是回报函数工程',
      '',
      'AI极简经济学',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      {
        searchedNodeIds: ['0021'],
        currentNodeId: '0024',
        isCoverageGap: true,
      },
    );
    // The product principle: don't make the user tolerate AI's internal failures
    expect(out).not.toContain('明确告知用户');
    expect(out).not.toContain('如实告知用户');
    expect(out).not.toContain('搪塞');
    expect(out).not.toContain('我刚才的检索没覆盖');
  });
});
