/**
 * Tests for LangGraph bridge (runGraphEngine / resumeGraphExecution)
 *
 * Tests the FrontendAgent → LangGraph graph integration,
 * including HITL interrupt detection and resume flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, StateGraph, START, END, MemorySaver, interrupt, Command } from '@langchain/langgraph';

// === Test: Settings ===

describe('Settings', () => {
  it('should have enableHumanReview in settings interface', async () => {
    const { DEFAULT_SETTINGS } = await import('@/config/settings.js');
    expect(DEFAULT_SETTINGS).toHaveProperty('enableHumanReview');
    expect(DEFAULT_SETTINGS.enableHumanReview).toBe(false);
  });

  it('should NOT have useLangGraphEngine (removed)', async () => {
    const { DEFAULT_SETTINGS } = await import('@/config/settings.js');
    expect(DEFAULT_SETTINGS).not.toHaveProperty('useLangGraphEngine');
  });
});

// === Test: HITL interrupt in graph nodes ===

describe('HITL Interrupt in Graph Nodes', () => {
  const TestAnnotation = Annotation.Root({
    value: Annotation<string>({ reducer: (_, update) => update, default: () => '' }),
    reviewed: Annotation<boolean>({ reducer: (_, update) => update, default: () => false }),
  });

  it('should compile a graph with interrupt()', async () => {
    async function reviewNode(state: typeof TestAnnotation.State) {
      const resumeValue = interrupt({ question: '确认？', content: state.value }) as { approved: boolean; feedback: string } | undefined;
      return {
        reviewed: resumeValue?.approved ?? true,
      };
    }

    const graph = new StateGraph(TestAnnotation)
      .addNode('review', reviewNode)
      .addEdge(START, 'review')
      .addEdge('review', END);

    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    expect(compiled).toBeDefined();
  });

  it('should detect interrupt during stream', async () => {
    async function reviewNode(state: typeof TestAnnotation.State) {
      interrupt({ question: '确认？', content: state.value });
      return { reviewed: true };
    }

    const graph = new StateGraph(TestAnnotation)
      .addNode('review', reviewNode)
      .addEdge(START, 'review')
      .addEdge('review', END);

    const compiled = graph.compile({ checkpointer: new MemorySaver() });

    const chunks: any[] = [];
    const stream = await compiled.stream(
      { value: '测试内容' },
      { configurable: { thread_id: 'test-interrupt-1' } },
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const hasInterrupt = chunks.some(c =>
      c.__interrupt__ !== undefined ||
      Object.keys(c).some(k => k === '__interrupt__')
    );
    expect(hasInterrupt).toBe(true);
  });

  it('should resume from interrupt with Command', async () => {
    let reviewCalled = 0;

    async function reviewNode(state: typeof TestAnnotation.State) {
      reviewCalled++;
      const resumeValue = interrupt({ question: '确认？', content: state.value }) as { approved: boolean; feedback: string } | undefined;

      if (resumeValue?.approved === false) {
        return { value: `修正: ${resumeValue.feedback}`, reviewed: true };
      }
      return { reviewed: true };
    }

    const graph = new StateGraph(TestAnnotation)
      .addNode('review', reviewNode)
      .addEdge(START, 'review')
      .addEdge('review', END);

    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const threadId = 'test-resume-1';

    const stream1 = await compiled.stream(
      { value: '原始内容' },
      { configurable: { thread_id: threadId } },
    );
    const chunks1: any[] = [];
    for await (const chunk of stream1) {
      chunks1.push(chunk);
    }
    expect(reviewCalled).toBe(1);

    const stream2 = await compiled.stream(
      new Command({ resume: { approved: true, feedback: '' } }),
      { configurable: { thread_id: threadId } },
    );
    const chunks2: any[] = [];
    for await (const chunk of stream2) {
      chunks2.push(chunk);
    }

    expect(reviewCalled).toBe(2);
  });
});

// === Test: Edge routing ===

describe('Graph Edge Routing', () => {
  it('should route depth=0 to formatter (casual → S4)', async () => {
    const { routeByDepth } = await import('@/agent/graph/edges.js');
    expect(routeByDepth({ depth: 0 } as any)).toBe('formatter');
  });

  it('should route depth=2 to inspectional (scope narrowing before analytical)', async () => {
    const { routeByDepth } = await import('@/agent/graph/edges.js');
    expect(routeByDepth({ depth: 2, pdfName: 'test.pdf' } as any)).toBe('inspectional');
  });
});
