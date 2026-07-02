import { describe, it, expect, vi } from 'vitest';
import { visualizerNode } from '@/agent/graph/nodes/visualizer';
import type { CognitiveEngineState } from '@/agent/graph/state';
import type { EngineCallbacks } from '@/agent/graph/shared-context';

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
  // 单次生成：invoke 返回 {filename, elements}
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
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const mockToolContext = {
    vault: {
      app: { vault: { adapter: mockAdapter } },
      plugin: {} as any,
    },
    book: {} as any,
  };

  const { sharedContext: ctxOverride, ...rest } = overrides;
  return {
    configurable: {
      mainModel: mockModel,
      sharedContext: {
        toolContext: mockToolContext,
        ...ctxOverride,
      },
      ...rest,
    },
  } as any;
}

/**
 * Flush pending microtasks/macrotasks so fire-and-forget async work completes.
 */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('visualizerNode (fire-and-forget)', () => {
  it('returns immediately without waiting for diagram generation', async () => {
    const state = makeState();
    const config = makeConfig();

    const t0 = Date.now();
    const result = await visualizerNode(state, config);
    const elapsed = Date.now() - t0;

    // 节点本身必须秒回（< 50ms 视为同步返回）
    expect(elapsed).toBeLessThan(50);
    // 同步返回时不应包含 embed（embed 走 onDiagramReady 回调）
    expect(result.analysisResult).toBe(state.analysisResult);
    expect(result.analysisResult).not.toContain('![[Excalidraw');
  });

  it('triggers onDiagramStart synchronously before returning', async () => {
    const state = makeState();
    const onDiagramStart = vi.fn();
    const config = makeConfig({
      callbacks: { onDiagramStart } as EngineCallbacks,
    });

    const resultPromise = visualizerNode(state, config);
    // 此时 onDiagramStart 应该已经被同步调用（在 await 之前）
    expect(onDiagramStart).toHaveBeenCalledTimes(1);

    await resultPromise;
  });

  it('triggers onDiagramReady asynchronously with embed after generation', async () => {
    const state = makeState();
    const onDiagramStart = vi.fn();
    const onDiagramReady = vi.fn();
    const config = makeConfig({
      callbacks: { onDiagramStart, onDiagramReady } as EngineCallbacks,
    });

    await visualizerNode(state, config);
    // 异步任务还没跑完
    expect(onDiagramReady).not.toHaveBeenCalled();

    await flushAsync();

    expect(onDiagramReady).toHaveBeenCalledTimes(1);
    expect(onDiagramReady).toHaveBeenCalledWith(expect.stringMatching(/!\[\[Excalidraw\/test-diagram-\d+\.excalidraw\.md\]\]/));
  });

  it('calls onDiagramFailed (not onDiagramReady) when generation fails (LLM returns invalid JSON)', async () => {
    const state = makeState();
    const onDiagramReady = vi.fn();
    const onDiagramFailed = vi.fn();
    const config = makeConfig({
      callbacks: { onDiagramStart: vi.fn(), onDiagramReady, onDiagramFailed } as EngineCallbacks,
    });
    config.configurable.mainModel.invoke.mockResolvedValue({
      content: 'not json at all',
    });

    await visualizerNode(state, config);
    await flushAsync();

    expect(onDiagramReady).not.toHaveBeenCalled();
    // 失败时必须通知前端，否则占位气泡永远卡住
    expect(onDiagramFailed).toHaveBeenCalledTimes(1);
    expect(onDiagramFailed).toHaveBeenCalledWith(expect.stringContaining('失败'));
  });

  it('calls onDiagramFailed when generateDiagram throws (含超时)', async () => {
    const state = makeState();
    const onDiagramReady = vi.fn();
    const onDiagramFailed = vi.fn();
    const config = makeConfig({
      callbacks: { onDiagramStart: vi.fn(), onDiagramReady, onDiagramFailed } as EngineCallbacks,
    });
    // 模拟 invoke 抛错（如超时 reject、网络错误）
    // diagram-helper 内部 catch 会吞掉错误返回空字符串，visualizer 走 !embed 分支
    config.configurable.mainModel.invoke.mockRejectedValue(new Error('画图超时 (90s)'));

    await visualizerNode(state, config);
    await flushAsync();

    expect(onDiagramReady).not.toHaveBeenCalled();
    // 失败时必须通知前端（无论 diagram-helper 吞错返回空，还是 rethrow）
    expect(onDiagramFailed).toHaveBeenCalledTimes(1);
  });

  it('does not call onDiagramFailed when aborted (用户主动取消不是失败)', async () => {
    const state = makeState();
    const onDiagramReady = vi.fn();
    const onDiagramFailed = vi.fn();
    const controller = new AbortController();
    controller.abort(); // 进入节点前已 abort
    const config = makeConfig({
      sharedContext: { abortSignal: controller.signal },
      callbacks: { onDiagramStart: vi.fn(), onDiagramReady, onDiagramFailed } as EngineCallbacks,
    });

    await visualizerNode(state, config);
    await flushAsync();

    // abort 是用户取消，既不 ready 也不 failed
    expect(onDiagramReady).not.toHaveBeenCalled();
    expect(onDiagramFailed).not.toHaveBeenCalled();
  });

  it('skips entirely when mainModel is missing (no callbacks fired)', async () => {
    const state = makeState();
    const onDiagramStart = vi.fn();
    const onDiagramReady = vi.fn();
    const config = makeConfig({
      mainModel: null,
      callbacks: { onDiagramStart, onDiagramReady } as EngineCallbacks,
    });

    const result = await visualizerNode(state, config);
    await flushAsync();

    expect(result.analysisResult).toBe(state.analysisResult);
    expect(onDiagramStart).not.toHaveBeenCalled();
    expect(onDiagramReady).not.toHaveBeenCalled();
  });

  it('skips entirely when no analysis content available', async () => {
    const state = makeState({ analysisResult: '', structuralAnalysis: '' });
    const onDiagramStart = vi.fn();
    const onDiagramReady = vi.fn();
    const config = makeConfig({
      callbacks: { onDiagramStart, onDiagramReady } as EngineCallbacks,
    });

    const result = await visualizerNode(state, config);
    await flushAsync();

    expect(result.analysisResult).toBe('');
    expect(onDiagramStart).not.toHaveBeenCalled();
    expect(onDiagramReady).not.toHaveBeenCalled();
  });

  it('uses structuralAnalysis when analysisResult is empty', async () => {
    const state = makeState({
      analysisResult: '',
      structuralAnalysis: '书籍结构分析',
    });
    const onDiagramReady = vi.fn();
    const config = makeConfig({
      callbacks: { onDiagramStart: vi.fn(), onDiagramReady } as EngineCallbacks,
    });

    await visualizerNode(state, config);
    await flushAsync();

    expect(onDiagramReady).toHaveBeenCalledTimes(1);
  });

  it('does not crash main flow when async task throws', async () => {
    const state = makeState();
    const onDiagramReady = vi.fn();
    const config = makeConfig({
      callbacks: { onDiagramStart: vi.fn(), onDiagramReady } as EngineCallbacks,
    });
    // 让 model.invoke 抛错
    config.configurable.mainModel.invoke.mockRejectedValue(new Error('LLM network error'));

    // 节点应正常返回
    const result = await visualizerNode(state, config);
    expect(result.analysisResult).toBe(state.analysisResult);

    // 异步任务失败不应崩溃，也不应调用 onDiagramReady
    await flushAsync();
    expect(onDiagramReady).not.toHaveBeenCalled();
  });

  it('does not fire callbacks when callbacks object is absent (backward compatible)', async () => {
    const state = makeState();
    // 不传 callbacks
    const config = makeConfig();

    const result = await visualizerNode(state, config);
    await flushAsync();

    // 不崩溃，节点正常返回
    expect(result.analysisResult).toBe(state.analysisResult);
  });

  describe('abort handling', () => {
    it('skips generation entirely when abortSignal already aborted at entry', async () => {
      const state = makeState();
      const onDiagramStart = vi.fn();
      const onDiagramReady = vi.fn();
      const controller = new AbortController();
      controller.abort();
      const config = makeConfig({
        callbacks: { onDiagramStart, onDiagramReady } as EngineCallbacks,
        sharedContext: { abortSignal: controller.signal },
      });

      await visualizerNode(state, config);
      await flushAsync();

      // onDiagramStart 同步触发（节点入口前不检查 abort），但 onDiagramReady 永不触发
      expect(onDiagramStart).toHaveBeenCalledTimes(1);
      expect(onDiagramReady).not.toHaveBeenCalled();
      // model.invoke 不应被调用
      expect(config.configurable.mainModel.invoke).not.toHaveBeenCalled();
    });

    it('discards result when abortSignal fires during await (post-await check)', async () => {
      const state = makeState();
      const onDiagramReady = vi.fn();
      const controller = new AbortController();

      const config = makeConfig({
        callbacks: { onDiagramStart: vi.fn(), onDiagramReady } as EngineCallbacks,
        sharedContext: { abortSignal: controller.signal },
      });
      // 在 invoke 完成时触发 abort，模拟"await 进行中用户中断"
      config.configurable.mainModel.invoke.mockImplementation(() => {
        controller.abort();
        return Promise.resolve({
          content: JSON.stringify({
            filename: 'should-be-discarded',
            elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }],
          }),
        });
      });

      await visualizerNode(state, config);
      await flushAsync();

      // 图表已生成但 abortSignal 在 await 后被检测到，结果应被丢弃
      expect(onDiagramReady).not.toHaveBeenCalled();
    });
  });
});
