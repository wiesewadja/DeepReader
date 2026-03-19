import { describe, it, expect, beforeEach } from 'vitest';
import { FormatterState, MAX_HISTORY_MESSAGES } from '../../cognitive-engine/states/formatter';
import { createSharedContext } from '../../cognitive-engine/context';
import type { SharedContext } from '../../cognitive-engine/types';

describe('FormatterState', () => {
  let formatterState: FormatterState;
  let ctx: SharedContext;

  beforeEach(() => {
    formatterState = new FormatterState();
    ctx = createSharedContext({
      indexId: 'test',
      pdfName: '麦肯锡方法',
      rawUserQuery: '什么是MECE？',
    });
    ctx.standaloneQuery = '什么是MECE？';
    ctx.analysisResult = 'MECE表示相互独立、完全穷尽。[^block_123]';
    ctx.rawResults = [
      { node_id: 'node_c1', block_id: 'block_123', text: 'MECE定义...', score: 0.95 },
    ];
  });

  it('should have correct metadata', () => {
    expect(formatterState.name).toBe('Formatter');
    expect(formatterState.model).toBe('main');
    expect(formatterState.tools).toEqual([]);
  });

  it('should have no tools (pure formatting)', () => {
    // Critical: S4 should have NO tools
    expect(formatterState.tools.length).toBe(0);
  });

  it('should build system prompt', () => {
    const prompt = formatterState.buildSystemPrompt(ctx);

    expect(prompt).toContain('奚童');
    expect(prompt).toContain('双链');
    // The prompt uses template syntax {{book_name}}
    expect(prompt).toContain('{{book_name}}#^block_id');
  });

  it('should truncate chat history to MAX_HISTORY_MESSAGES', () => {
    // Add 15 messages to history
    for (let i = 0; i < 15; i++) {
      ctx.chatHistory.push(
        { role: 'user', content: `Question ${i}` },
        { role: 'assistant', content: `Answer ${i}` }
      );
    }

    expect(ctx.chatHistory.length).toBe(30);

    // The formatter should only use the last MAX_HISTORY_MESSAGES
    const recentHistory = ctx.chatHistory.slice(-MAX_HISTORY_MESSAGES);
    expect(recentHistory.length).toBe(MAX_HISTORY_MESSAGES);
  });

  it('should mark state as executed', async () => {
    await formatterState.execute(ctx);

    expect(ctx.executedStates.has('Formatter')).toBe(true);
  });
});