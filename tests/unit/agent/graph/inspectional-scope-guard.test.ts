/**
 * Tests for the scope hard-guard logic shared between S1 Inspectional and S2-Pre.
 *
 * Verifies the fix for issue: "回报函数工程"在 24 章存在但被 inspectional 漏选
 *
 * We test the LLM-output → enforced-scope transformation, not the LLM call itself.
 * The LLM call is mocked; what matters is the post-processing logic.
 */

import { describe, it, expect } from 'vitest';
import { enforceScopeHardGuard, formatGuardInjectedLog } from '@/agent/graph/utils/scope-guard';
import { extractCitedNodeIds } from '@/agent/graph/utils/chapter-reference-parser';

describe('enforceScopeHardGuard (shared scope hard-guard)', () => {
  describe('current chapter injection', () => {
    it('forces current chapter into scope when LLM dropped it (回报函数工程 case)', () => {
      // Reproducing the bug: 24章 was dropped, LLM returned only 21/22/25/31/38
      const llmScope = ['0021', '0022', '0025', '0031', '0038'];
      const result = enforceScopeHardGuard(llmScope, '0024', [], '');
      expect(result.scope).toContain('0024');
      expect(result.scope).toEqual(['0021', '0022', '0025', '0031', '0038', '0024']);
    });

    it('does not duplicate current chapter if LLM already included it', () => {
      const llmScope = ['0024', '0021'];
      const result = enforceScopeHardGuard(llmScope, '0024', [], '');
      expect(result.scope.filter(id => id === '0024')).toHaveLength(1);
    });

    it('handles undefined current chapter gracefully', () => {
      const llmScope = ['0021'];
      const result = enforceScopeHardGuard(llmScope, undefined, [], '');
      expect(result.scope).toEqual(['0021']);
    });
  });

  describe('cited chapter injection (T0/T2 case)', () => {
    it('forces user-cited chapter into scope (T2: [[24 - ]])', () => {
      // T2: user said "不，[[24 - ]] 这里就有这个概念"
      const messages = ['不，[[24 - ]] 这里就有这个概念'];
      const cited = extractCitedNodeIds(messages);
      const llmScope = ['0021', '0038', '0028', '0031'];  // T2's actual wrong scope
      const result = enforceScopeHardGuard(llmScope, '0024', cited, '');
      expect(result.scope).toContain('0024');
    });

    it('cited chapters take priority over current chapter (T0: user cites 24, current is 22)', () => {
      // Simulating T0: user is reading chapter 22 but explicitly cites 24
      const messages = ['回报函数工程 — 24 -'];
      const cited = extractCitedNodeIds(messages);
      const result = enforceScopeHardGuard(['0021', '0025'], '0022', cited, '');
      expect(result.scope).toContain('0024');
      expect(result.scope).toContain('0022');
    });
  });

  describe('exclusion reason logging', () => {
    it('logs LLM exclusion reason when forcing injection anyway', () => {
      const llmScope = ['0021'];
      const result = enforceScopeHardGuard(llmScope, '0024', [], '摘要与问题主题完全无关');
      expect(result.scope).toContain('0024');
      expect(result.injected.some(i => i.llmExclusionReason === '摘要与问题主题完全无关')).toBe(true);
    });

    it('does not add llmExclusionReason when LLM did not explicitly exclude', () => {
      const llmScope = ['0021'];
      const result = enforceScopeHardGuard(llmScope, '0024', [], '');
      expect(result.injected.some(i => i.llmExclusionReason !== undefined)).toBe(false);
    });
  });

  describe('injected metadata shape', () => {
    it('marks cited injections with reason="cited"', () => {
      const result = enforceScopeHardGuard([], undefined, ['0024'], '');
      expect(result.injected).toContainEqual({ id: '0024', reason: 'cited' });
    });

    it('marks current chapter injection with reason="current"', () => {
      const result = enforceScopeHardGuard([], '0024', [], '');
      expect(result.injected).toContainEqual({ id: '0024', reason: 'current' });
    });

    it('does not record injected for chapters already in LLM scope', () => {
      const result = enforceScopeHardGuard(['0024'], '0024', [], '');
      expect(result.injected).toHaveLength(0);
    });
  });

  describe('multi-layer defense', () => {
    it('handles all three signals together: current + cited + LLM scope', () => {
      const messages = ['对比 [[21 - ]] 和 [[24 - ]]', '什么是判断'];
      const cited = extractCitedNodeIds(messages);
      const result = enforceScopeHardGuard(['0025', '0031'], '0022', cited, '');
      expect(result.scope).toContain('0021');
      expect(result.scope).toContain('0024');
      expect(result.scope).toContain('0022');
      expect(result.scope).toContain('0025');
      expect(result.scope).toContain('0031');
    });
  });
});

describe('regression: full pipeline (cited → enforced → pre_search guard)', () => {
  it('end-to-end: 4 round trip 24 章 would now be in scope', () => {
    // Simulating the full flow:
    // 1. LLM scope is wrong (drops 0024)
    // 2. S1 hard-guard injects 0024
    // 3. pre_search would also inject 0024 (defense in depth)

    const userMessages = [
      '什么是回报函数工程',
      '不，[[24 - ]] 这里就有这个概念',
      '再搜索下 回报函数工程',
      '这里就有这些概念',
    ];

    // Step 1: LLM scope (wrong)
    const wrongLlmScope = ['0021', '0022', '0025', '0038', '0031'];

    // Step 2: Extract cited
    const cited = extractCitedNodeIds(userMessages);
    expect(cited).toContain('0024');

    // Step 3: S1 hard-guard
    const s1Result = enforceScopeHardGuard(wrongLlmScope, '0024', cited, '');
    expect(s1Result.scope).toContain('0024');

    // Step 4: pre_search hard-guard (defense in depth) — same guard re-applied
    const finalScope = s1Result.scope;
    const reGuard = enforceScopeHardGuard(finalScope, '0024', cited, '');
    expect(reGuard.scope).toContain('0024');
  });
});

describe('formatGuardInjectedLog', () => {
  it('returns empty string for empty injection list', () => {
    expect(formatGuardInjectedLog([])).toBe('');
  });

  it('formats cited injection with reason prefix', () => {
    expect(formatGuardInjectedLog([{ id: '0021', reason: 'cited' }])).toBe('cited:0021');
  });

  it('formats current injection with reason prefix', () => {
    expect(formatGuardInjectedLog([{ id: '0024', reason: 'current' }])).toBe('current:0024');
  });

  it('appends llm-said annotation when present', () => {
    const out = formatGuardInjectedLog([
      { id: '0024', reason: 'current', llmExclusionReason: '摘要与问题主题完全无关' },
    ]);
    expect(out).toBe('current:0024(llm-said:"摘要与问题主题完全无关")');
  });

  it('joins multiple injections with comma', () => {
    const out = formatGuardInjectedLog([
      { id: '0021', reason: 'cited' },
      { id: '0024', reason: 'current' },
    ]);
    expect(out).toBe('cited:0021, current:0024');
  });
});
