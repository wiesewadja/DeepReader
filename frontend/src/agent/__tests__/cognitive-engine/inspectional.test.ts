import { describe, it, expect, beforeEach } from 'vitest';
import { InspectionalState } from '../../cognitive-engine/states/inspectional';
import { createSharedContext } from '../../cognitive-engine/context';
import type { SharedContext } from '../../cognitive-engine/types';

describe('InspectionalState', () => {
  let inspectionalState: InspectionalState;
  let ctx: SharedContext;

  beforeEach(() => {
    inspectionalState = new InspectionalState();
    ctx = createSharedContext({
      indexId: 'test',
      pdfName: 'Test Book',
      rawUserQuery: '什么是MECE？',
    });
    ctx.standaloneQuery = '什么是MECE？';
  });

  it('should have correct metadata', () => {
    expect(inspectionalState.name).toBe('Inspectional');
    expect(inspectionalState.model).toBe('fast');
    expect(inspectionalState.tools).toEqual(['get_document_outline']);
  });

  it('should only have get_document_outline tool (no search_markdown_text)', () => {
    // Critical: S1 should NOT have search_markdown_text to prevent LLM from reading body
    expect(inspectionalState.tools).not.toContain('search_markdown_text');
    expect(inspectionalState.tools).toContain('get_document_outline');
  });

  it('should build correct system prompt', () => {
    const prompt = inspectionalState.buildSystemPrompt(ctx);

    // Prompt should contain inspectional reading concepts
    expect(prompt).toContain('scopeNodeIds');
    expect(prompt).toContain('检视阅读');
  });

  it('should mark state as executed after execution', async () => {
    await inspectionalState.execute(ctx);

    expect(ctx.executedStates.has('Inspectional')).toBe(true);
  });
});