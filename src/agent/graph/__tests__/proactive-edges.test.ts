import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { routeFromStart, routeByDepth, routeAfterInspectional } from '../edges';
import { NODE_NAMES, EDGE_KEYS } from '../node-names';
import { buildProactiveSystemPrompt, buildSocraticDialoguePrompt, buildSocraticDialogueUserMessage } from '../prompts/proactive-formatter-prompt';

describe('proactive edge routing', () => {
  describe('routeFromStart', () => {
    it('routes to inspectional when isProactive=true', () => {
      const state = { isProactive: true, depth: 1 } as any;
      expect(routeFromStart(state)).toBe(NODE_NAMES.INSPECTIONAL);
    });

    it('routes to router when isProactive=false', () => {
      const state = { isProactive: false } as any;
      expect(routeFromStart(state)).toBe(NODE_NAMES.ROUTER);
    });

    it('routes to router when isProactive is undefined', () => {
      const state = {} as any;
      expect(routeFromStart(state)).toBe(NODE_NAMES.ROUTER);
    });
  });

  describe('routeAfterInspectional — proactive', () => {
    beforeEach(() => {
      delete (globalThis as any).ExcalidrawAutomate;
    });
    afterEach(() => {
      delete (globalThis as any).ExcalidrawAutomate;
    });

    it('routes to visualizer for inspectional when Excalidraw available', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, proactiveTrigger: 'inspectional', depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(NODE_NAMES.VISUALIZER);
    });

    it('routes to done for inspectional when Excalidraw not available', () => {
      const state = { isProactive: true, proactiveTrigger: 'inspectional', depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('routes to done for highlight trigger even with Excalidraw', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, proactiveTrigger: 'highlight', depth: 1 } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('routes to done for chapter trigger even with Excalidraw', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, proactiveTrigger: 'chapter', depth: 1 } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('routes to done when proactiveTrigger is undefined', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });
  });

  describe('routeAfterInspectional — socratic', () => {
    it('routes to done (formatter) when isSocratic=true', () => {
      const state = { isSocratic: true, depth: 2, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
    });

    it('isSocratic does not interfere when false', () => {
      const state = { isSocratic: false, depth: 2, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe(NODE_NAMES.PRE_SEARCH);
    });
  });

  describe('routeByDepth — unchanged', () => {
    it('still routes depth=0 to formatter', () => {
      const state = { depth: 0 } as any;
      expect(routeByDepth(state)).toBe(NODE_NAMES.FORMATTER);
    });

    it('still routes depth>=1 to inspectional', () => {
      const state = { depth: 2 } as any;
      expect(routeByDepth(state)).toBe(NODE_NAMES.INSPECTIONAL);
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
