import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { routeFromStart, routeByDepth, routeAfterInspectional } from '@/agent/graph/edges';
import { NODE_NAMES, EDGE_KEYS } from '@/agent/graph/node-names';
import { buildProactiveSystemPrompt, buildSocraticDialoguePrompt, buildSocraticDialogueUserMessage } from '@/agent/prompts/utils/index.js';

describe('proactive edge routing', () => {
  describe('routeFromStart', () => {
    it('routes to inspectional when mode=proactive and book selected', () => {
      const state = { mode: 'proactive', depth: 1, pdfName: 'test.pdf' } as any;
      expect(routeFromStart(state)).toBe(NODE_NAMES.INSPECTIONAL);
    });

    it('routes to inspectional when mode=normal and book selected', () => {
      const state = { mode: 'normal', pdfName: 'test.pdf' } as any;
      expect(routeFromStart(state)).toBe(NODE_NAMES.INSPECTIONAL);
    });

    it('routes to inspectional when mode is undefined and book selected', () => {
      const state = { pdfName: 'test.pdf' } as any;
      expect(routeFromStart(state)).toBe(NODE_NAMES.INSPECTIONAL);
    });

    it('routes to formatter when no book selected', () => {
      const state = { mode: 'normal' } as any;
      expect(routeFromStart(state)).toBe(NODE_NAMES.FORMATTER);
    });
  });

  describe('routeAfterInspectional — proactive', () => {
    it('routes to done for inspectional when Excalidraw available', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { mode: 'proactive', proactiveTrigger: 'inspectional', depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('routes to done for inspectional when Excalidraw not available', () => {
      const state = { mode: 'proactive', proactiveTrigger: 'inspectional', depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('routes to done for highlight trigger', () => {
      const state = { mode: 'proactive', proactiveTrigger: 'highlight', depth: 1 } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('routes to done for chapter trigger', () => {
      const state = { mode: 'proactive', proactiveTrigger: 'chapter', depth: 1 } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('routes to done when proactiveTrigger is undefined', () => {
      const state = { mode: 'proactive', depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });
  });

  describe('routeAfterInspectional — socratic', () => {
    it('routes to done (formatter) when mode=socratic', () => {
      const state = { mode: 'socratic', depth: 2, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('mode=normal routes to pre_search', () => {
      const state = { mode: 'normal', depth: 2, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(NODE_NAMES.PRE_SEARCH);
    });
  });
});

describe('buildProactiveSystemPrompt', () => {
  it('returns base proactive prompt for inspectional', () => {
    const prompt = buildProactiveSystemPrompt('inspectional', false);
    expect(prompt).toContain('助产士');
  });

  it('returns diagram prompt for inspectional + hasDiagram', () => {
    const prompt = buildProactiveSystemPrompt('inspectional', true);
    expect(prompt).toContain('结构图');
  });

  it('returns highlight prompt for highlight trigger', () => {
    const prompt = buildProactiveSystemPrompt('highlight', false);
    expect(prompt).toContain('划线');
  });
});

describe('Socratic dialogue prompt', () => {
  it('contains dialogue rules', () => {
    const prompt = buildSocraticDialoguePrompt();
    expect(prompt).toContain('助产士');
    expect(prompt).toContain('追问');
  });

  it('builds user message with chat history', () => {
    const history = [
      { role: 'user', content: '测试问题' },
      { role: 'assistant', content: '这是AI的回答' },
    ];
    const msg = buildSocraticDialogueUserMessage('用户回复内容', history);
    expect(msg).toContain('conversation_history');
    expect(msg).toContain('测试问题');
    expect(msg).toContain('用户回复内容');
  });
});
