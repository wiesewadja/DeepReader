import { describe, it, expect, vi } from 'vitest';
import { visualizerNode } from '@/agent/graph/nodes/visualizer';
import type { CognitiveEngineState } from '@/agent/graph/state';

function makeState(overrides: Partial<CognitiveEngineState> = {}): CognitiveEngineState {
  return {
    messages: [],
    depth: 1,
    mode: 'normal',
    rewrittenQuery: '画一个思维导图',
    analysisResult: '全书分为五个部分：预测、决策、工具、战略、社会',
    ...overrides,
  } as unknown as CognitiveEngineState;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  const mockModel = {
    invoke: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        filename: 'test-diagram',
        elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }],
      }),
    }),
  };
  const mockAdapter = {
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  };
  const mockToolContext = {
    vault: {
      app: { vault: { adapter: mockAdapter } },
      plugin: {} as any,
    },
    book: {} as any,
  };

  return {
    configurable: {
      mainModel: mockModel,
      toolContext: mockToolContext,
      ...overrides,
    },
  } as any;
}

describe('visualizerNode', () => {
  it('generates diagram and appends embed to analysisResult', async () => {
    const state = makeState();
    const config = makeConfig();

    const result = await visualizerNode(state, config);

    expect(result.analysisResult).toContain('全书分为五个部分');
    expect(result.analysisResult).toContain('![[Excalidraw/test-diagram.excalidraw]]');
  });

  it('falls back gracefully when mainModel is missing', async () => {
    const state = makeState();
    const config = makeConfig({ mainModel: null });

    const result = await visualizerNode(state, config);

    expect(result.analysisResult).toBe(state.analysisResult);
    // Should NOT contain embed
    expect(result.analysisResult).not.toContain('![[Excalidraw');
  });

  it('falls back gracefully when toolContext is missing', async () => {
    const state = makeState();
    const config = makeConfig({ toolContext: null });

    const result = await visualizerNode(state, config);

    expect(result.analysisResult).toBe(state.analysisResult);
  });

  it('falls back when no analysis content available', async () => {
    const state = makeState({ analysisResult: '', structuralAnalysis: '' });
    const config = makeConfig();

    const result = await visualizerNode(state, config);

    expect(result.analysisResult).toBe('');
  });

  it('appends embed to structuralAnalysis when analysisResult is empty', async () => {
    const state = makeState({
      analysisResult: '',
      structuralAnalysis: '书籍结构分析内容',
    });
    const config = makeConfig();

    const result = await visualizerNode(state, config);

    expect(result.structuralAnalysis).toContain('书籍结构分析内容');
    expect(result.structuralAnalysis).toContain('![[Excalidraw/test-diagram.excalidraw]]');
  });

  it('returns original result when LLM fails to generate valid JSON', async () => {
    const state = makeState();
    const config = makeConfig();
    config.configurable.mainModel.invoke.mockResolvedValue({
      content: 'This is not JSON at all, just plain text',
    });

    const result = await visualizerNode(state, config);

    expect(result.analysisResult).toBe(state.analysisResult);
    expect(result.analysisResult).not.toContain('![[Excalidraw');
  });

  it('returns original result when generateDiagram returns empty', async () => {
    const state = makeState();
    const config = makeConfig();
    // Return JSON but missing elements
    config.configurable.mainModel.invoke.mockResolvedValue({
      content: JSON.stringify({ filename: 'test' }),
    });

    const result = await visualizerNode(state, config);

    expect(result.analysisResult).toBe(state.analysisResult);
  });
});
