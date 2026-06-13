import { describe, it, expect } from 'vitest';
import {
  routeAfterInspectional,
  routeAfterPreSearch,
  routeAfterAnalysis,
} from '@/agent/graph/edges';
import { NODE_NAMES, EDGE_KEYS } from '@/agent/graph/node-names';
import { ReadingDepth } from '@/agent/graph/state';
import type { CognitiveEngineState } from '@/agent/graph/state';

function makeState(overrides: Partial<CognitiveEngineState> = {}): CognitiveEngineState {
  return {
    messages: [],
    depth: ReadingDepth.ANALYTICAL,
    mode: 'normal',
    rewrittenQuery: '',
    ...overrides,
  } as unknown as CognitiveEngineState;
}

describe('routeAfterInspectional', () => {
  it('depth=1 + diagram intent → visualizer', () => {
    const state = makeState({
      depth: ReadingDepth.INSPECTIONAL,
      rewrittenQuery: '请画一张思维导图展示这本书的整体结构',
      structuralAnalysis: '全书分为五个部分',
    });
    expect(routeAfterInspectional(state)).toBe(NODE_NAMES.VISUALIZER);
  });

  it('depth=1 + no diagram intent → formatter', () => {
    const state = makeState({
      depth: ReadingDepth.INSPECTIONAL,
      rewrittenQuery: '这本书主要讲了什么',
      structuralAnalysis: '全书概述',
    });
    expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
  });

  it('depth=1 + S1 error → formatter (skip visualizer)', () => {
    const state = makeState({
      depth: ReadingDepth.INSPECTIONAL,
      rewrittenQuery: '画一个流程图',
      structuralAnalysis: '',
      nodeErrors: { inspectional: { message: 'failed', recoverable: false, fallbackAction: 'skip_to_formatter' } },
    });
    expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
  });

  it('depth=1 + no structuralAnalysis → formatter (skip visualizer)', () => {
    const state = makeState({
      depth: ReadingDepth.INSPECTIONAL,
      rewrittenQuery: '画一个流程图',
      structuralAnalysis: '',
    });
    expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
  });

  it('depth=2 → pre-search', () => {
    const state = makeState({
      depth: ReadingDepth.ANALYTICAL,
      rewrittenQuery: '画一个流程图',
    });
    expect(routeAfterInspectional(state)).toBe(NODE_NAMES.PRE_SEARCH);
  });

  it('depth=3 → syntopical', () => {
    const state = makeState({
      depth: ReadingDepth.SYNTOPICAL,
    });
    expect(routeAfterInspectional(state)).toBe(NODE_NAMES.SYNTOPICAL);
  });

  it('mode=socratic → formatter', () => {
    const state = makeState({
      mode: 'socratic',
      depth: ReadingDepth.ANALYTICAL,
    });
    expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
  });

  it('mode=proactive → formatter', () => {
    const state = makeState({
      mode: 'proactive',
      depth: ReadingDepth.INSPECTIONAL,
      rewrittenQuery: '画一个思维导图',
      structuralAnalysis: '分析结果',
    });
    expect(routeAfterInspectional(state)).toBe(EDGE_KEYS.DONE);
  });
});

describe('routeAfterPreSearch', () => {
  it('no early stop → analytical', () => {
    const state = makeState({ earlyStopContent: '' });
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.ANALYTICAL);
  });

  it('early stop + diagram intent → visualizer', () => {
    const state = makeState({
      earlyStopContent: 'done',
      rewrittenQuery: '画一个流程图展示流程',
    });
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.VISUALIZER);
  });

  it('early stop + no diagram intent → formatter', () => {
    const state = makeState({
      earlyStopContent: 'done',
      rewrittenQuery: '这本书讲了什么',
    });
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.FORMATTER);
  });

  it('correctionDetected overrides early stop → analytical', () => {
    const state = makeState({
      earlyStopContent: 'done',
      rewrittenQuery: '画一个思维导图',
      correctionDetected: true,
    });
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.ANALYTICAL);
  });

  it('verifiedFullBookHits overrides early stop → analytical', () => {
    const state = makeState({
      earlyStopContent: 'done',
      rewrittenQuery: '画一个流程图',
      verifiedFullBookHits: [{ blockId: 'b1', score: 0.9 }],
    });
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.ANALYTICAL);
  });
});

describe('routeAfterAnalysis', () => {
  it('diagram intent → visualizer', () => {
    const state = makeState({
      rewrittenQuery: '请用可视化展示这些概念的关系',
    });
    expect(routeAfterAnalysis(state)).toBe(NODE_NAMES.VISUALIZER);
  });

  it('no diagram intent → formatter', () => {
    const state = makeState({
      rewrittenQuery: '解释一下第三章的主要内容',
    });
    expect(routeAfterAnalysis(state)).toBe(NODE_NAMES.FORMATTER);
  });

  it('flow chart keyword → visualizer', () => {
    const state = makeState({
      rewrittenQuery: '画一个流程图，展示从预测到决策的完整流程',
    });
    expect(routeAfterAnalysis(state)).toBe(NODE_NAMES.VISUALIZER);
  });

  it('mind map keyword → visualizer', () => {
    const state = makeState({
      rewrittenQuery: '生成思维导图',
    });
    expect(routeAfterAnalysis(state)).toBe(NODE_NAMES.VISUALIZER);
  });

  it('concept map keyword → visualizer', () => {
    const state = makeState({
      rewrittenQuery: '请用概念图展示关系',
    });
    expect(routeAfterAnalysis(state)).toBe(NODE_NAMES.VISUALIZER);
  });

  it('knowledge graph keyword → visualizer', () => {
    const state = makeState({
      rewrittenQuery: '构建知识图谱',
    });
    expect(routeAfterAnalysis(state)).toBe(NODE_NAMES.VISUALIZER);
  });
});
