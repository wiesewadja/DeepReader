import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticalState } from '../../cognitive-engine/states/analytical';
import { createSharedContext } from '../../cognitive-engine/context';
import type { SharedContext } from '../../cognitive-engine/types';

describe('AnalyticalState', () => {
  let analyticalState: AnalyticalState;
  let ctx: SharedContext;

  beforeEach(() => {
    analyticalState = new AnalyticalState();
    ctx = createSharedContext({
      indexId: 'test',
      pdfName: 'Test Book',
      rawUserQuery: '什么是MECE？',
    });
    ctx.standaloneQuery = '什么是MECE？';
  });

  it('should have correct metadata', () => {
    expect(analyticalState.name).toBe('Analytical');
    expect(analyticalState.model).toBe('main');
    expect(analyticalState.tools).toEqual(['search_markdown_text', 'read_markdown_section']);
  });

  it('should call S1 if scopeNodeIds not set (cumulative guarantee)', async () => {
    // scopeNodeIds is undefined initially
    expect(ctx.scopeNodeIds).toBeUndefined();

    await analyticalState.execute(ctx);

    // After execution, scopeNodeIds should be set (by S1)
    expect(ctx.scopeNodeIds).toBeDefined();
    expect(ctx.scopeNodeIds?.length).toBeGreaterThan(0);
  });

  it('should not call S1 if scopeNodeIds already set', async () => {
    ctx.scopeNodeIds = ['node_c3'];

    await analyticalState.execute(ctx);

    // Should preserve existing scope (not call S1)
    expect(ctx.scopeNodeIds).toEqual(['node_c3']);
  });

  it('should build system prompt with scope', () => {
    ctx.scopeNodeIds = ['node_c4', 'node_c5'];

    const prompt = analyticalState.buildSystemPrompt(ctx);

    // Prompt should contain scope information
    expect(prompt).toContain('node_c4');
    expect(prompt).toContain('node_c5');
    // Prompt should contain analytical reading concepts (艾德勒 or 分析阅读)
    expect(prompt).toMatch(/艾德勒|分析阅读|诠释内容/);
  });

  it('should mark state as executed', async () => {
    await analyticalState.execute(ctx);

    expect(ctx.executedStates.has('Analytical')).toBe(true);
  });
});