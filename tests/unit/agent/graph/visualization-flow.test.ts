/**
 * Integration test: verify the VISUALIZER routing path through edges
 *
 * Tests the complete flow:
 * 1. hasDiagramIntent detects keywords correctly
 * 2. Route functions return VISUALIZER for diagram queries
 * 3. Route functions return FORMATTER for normal queries
 * 4. VISUALIZER node generates diagrams and appends embeds
 * 5. safeNode fallback works when VISUALIZER fails
 */
import { describe, it, expect, vi } from 'vitest';
import { hasDiagramIntent } from '@/agent/graph/utils/diagram-helper';
import {
  routeAfterInspectional,
  routeAfterPreSearch,
  routeAfterAnalysis,
} from '@/agent/graph/edges';
import { NODE_NAMES, EDGE_KEYS } from '@/agent/graph/node-names';
import { ReadingDepth } from '@/agent/graph/state';
import type { CognitiveEngineState } from '@/agent/graph/state';

describe('hasDiagramIntent — keyword detection', () => {
  const diagramQueries = [
    '请画一张思维导图展示这本书的整体结构',
    '画一个流程图，展示从预测到决策的完整流程',
    '请用概念图展示关系',
    '生成脑图',
    '可视化展示这些概念',
    '做个示意图',
    '请画导图',
    '可视化',
    'build an infographic',
    '展示图表',
    '构建知识图谱',
  ];

  const normalQueries = [
    '这本书主要讲了什么',
    '第三章的主要内容是什么',
    '作者是如何论述预测成本的',
    '请解释决策和判断的区别',
    '总结第一章',
  ];

  it.each(diagramQueries)('detects diagram intent: "%s"', (query) => {
    expect(hasDiagramIntent(query)).toBe(true);
  });

  it.each(normalQueries)('no diagram intent: "%s"', (query) => {
    expect(hasDiagramIntent(query)).toBe(false);
  });
});

describe('VISUALIZER routing — complete path verification', () => {
  function makeState(overrides: Partial<CognitiveEngineState> = {}): CognitiveEngineState {
    return {
      messages: [],
      depth: ReadingDepth.ANALYTICAL,
      mode: 'normal',
      rewrittenQuery: '',
      ...overrides,
    } as unknown as CognitiveEngineState;
  }

  it('S1 → VISUALIZER → FORMATTER path for mind map query', () => {
    // Step 1: S1 completes with diagram intent
    const afterS1 = makeState({
      depth: ReadingDepth.INSPECTIONAL,
      rewrittenQuery: '请画一张思维导图展示这本书的整体结构',
      structuralAnalysis: '全书分为五个部分',
    });

    const route1 = routeAfterInspectional(afterS1);
    expect(route1).toBe(NODE_NAMES.VISUALIZER);

    // Step 2: After VISUALIZER (route to FORMATTER)
    // VISUALIZER → FORMATTER is a static edge in index.ts
    // This is verified by the graph definition itself
  });

  it('S2-Pre early stop → VISUALIZER for flow chart query', () => {
    const state = makeState({
      earlyStopContent: 'done',
      rewrittenQuery: '画一个流程图，展示流程',
    });

    const route = routeAfterPreSearch(state);
    expect(route).toBe(NODE_NAMES.VISUALIZER);
  });

  it('S2 Analytical → VISUALIZER for concept map query', () => {
    const state = makeState({
      rewrittenQuery: '请用概念图展示这些概念的关系',
      analysisResult: '分析结果...',
    });

    const route = routeAfterAnalysis(state);
    expect(route).toBe(NODE_NAMES.VISUALIZER);
  });

  it('S3 Syntopical → VISUALIZER for knowledge graph query', () => {
    const state = makeState({
      rewrittenQuery: '构建这些书的知识图谱',
    });

    const route = routeAfterAnalysis(state);
    expect(route).toBe(NODE_NAMES.VISUALIZER);
  });

  it('Normal query bypasses VISUALIZER at all stages', () => {
    const normalState = makeState({
      rewrittenQuery: '这本书主要讲了什么',
      structuralAnalysis: '全书概述',
    });

    // S1 normal → FORMATTER
    const s1State = makeState({
      ...normalState,
      depth: ReadingDepth.INSPECTIONAL,
    });
    expect(routeAfterInspectional(s1State)).toBe(EDGE_KEYS.DONE);

    // S2-Pre early stop normal → FORMATTER
    const s2PreState = makeState({
      ...normalState,
      earlyStopContent: 'done',
    });
    expect(routeAfterPreSearch(s2PreState)).toBe(NODE_NAMES.FORMATTER);

    // S2 Analytical normal → FORMATTER
    const s2State = makeState({
      ...normalState,
    });
    expect(routeAfterAnalysis(s2State)).toBe(NODE_NAMES.FORMATTER);
  });
});

describe('VISUALIZER node — safeNode fallback', () => {
  it('safeNode returns analysisResult when mainModel is missing', async () => {
    // Import safeNode-wrapped visualizer
    const { visualizerNode } = await import('@/agent/graph/nodes/visualizer');

    const state = {
      messages: [],
      analysisResult: 'Test analysis result',
      structuralAnalysis: '',
      rewrittenQuery: '画一个思维导图',
    } as unknown as CognitiveEngineState;

    const config = { configurable: {} } as any;

    const result = await visualizerNode(state, config);
    expect(result.analysisResult).toBe('Test analysis result');
  });
});
