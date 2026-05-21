import { describe, it, expect, vi } from 'vitest';
import { processGraphStream } from '../stream-processor';

function mockCallbacks() {
  return {
    onProgress: vi.fn(),
    onContent: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onHumanizedProgress: vi.fn(),
    onContentComplete: vi.fn<() => Promise<string>>(),
    onReasoning: vi.fn(),
    onVoiceReady: vi.fn(),
    onVoiceChunk: vi.fn(),
    abortSignal: undefined as AbortSignal | undefined,
  };
}

async function* fromChunks(chunks: unknown[]): AsyncIterable<unknown> {
  for (const c of chunks) yield c;
}

describe('processGraphStream', () => {
  it('returns empty messages for empty stream', async () => {
    const result = await processGraphStream(fromChunks([]), mockCallbacks());
    expect(result.messages).toEqual([]);
    expect(result.interrupted).toBeUndefined();
  });

  it('skips null and non-object chunks', async () => {
    const chunks = [null, 'string', 42, undefined];
    const result = await processGraphStream(fromChunks(chunks), mockCallbacks());
    expect(result.messages).toEqual([]);
  });

  it('collects formattedOutput from node updates', async () => {
    const cb = mockCallbacks();
    const chunks = [{ formatter: { formattedOutput: '你好世界' } }];
    const result = await processGraphStream(fromChunks(chunks), cb);

    expect(result.messages).toEqual([{ role: 'assistant', content: '你好世界' }]);
    expect(cb.onContent).toHaveBeenCalledWith('你好世界');
    expect(cb.onProgress).toHaveBeenCalledWith('正在整理笔记...');
    expect(cb.onComplete).toHaveBeenCalled();
  });

  it('keeps last formattedOutput when multiple updates', async () => {
    const cb = mockCallbacks();
    const chunks = [
      { formatter: { formattedOutput: '第一版' } },
      { formatter: { formattedOutput: '最终版' } },
    ];
    const result = await processGraphStream(fromChunks(chunks), cb);

    expect(result.messages).toEqual([{ role: 'assistant', content: '最终版' }]);
    expect(cb.onContent).toHaveBeenCalledTimes(2);
  });

  it('detects interrupt and returns early', async () => {
    const cb = mockCallbacks();
    const chunks = [
      { __interrupt__: [{ value: { nodeId: 'analytical', content: '请确认分析' } }] },
    ];
    const result = await processGraphStream(fromChunks(chunks), cb);

    expect(result.interrupted).toEqual({ nodeId: 'analytical', content: '请确认分析' });
    expect(result.messages).toEqual([]);
    expect(cb.onComplete).not.toHaveBeenCalled();
  });

  it('interrupt falls back to question field', async () => {
    const cb = mockCallbacks();
    const chunks = [
      { __interrupt__: [{ value: { nodeId: 'formatter', question: '满意吗？' } }] },
    ];
    const result = await processGraphStream(fromChunks(chunks), cb);

    expect(result.interrupted?.content).toBe('满意吗？');
    expect(result.interrupted?.nodeId).toBe('formatter');
  });

  it('interrupt with empty array does not set interruptedNode', async () => {
    const cb = mockCallbacks();
    const chunks = [
      { formatter: { formattedOutput: '内容' } },
      { __interrupt__: [] },
    ];
    const result = await processGraphStream(fromChunks(chunks), cb);

    expect(result.interrupted).toBeUndefined();
    expect(result.messages).toEqual([{ role: 'assistant', content: '内容' }]);
  });

  it('interrupt breaks out of stream (ignores later chunks)', async () => {
    const cb = mockCallbacks();
    const chunks = [
      { __interrupt__: [{ value: { nodeId: 's1', content: '中断' } }] },
      { formatter: { formattedOutput: '不应出现' } },
    ];
    const result = await processGraphStream(fromChunks(chunks), cb);

    expect(cb.onContent).not.toHaveBeenCalled();
    expect(result.interrupted?.content).toBe('中断');
  });

  it('skips null stateUpdate in node records', async () => {
    const cb = mockCallbacks();
    const chunks = [{ router: null, analytical: undefined }];
    const result = await processGraphStream(fromChunks(chunks), cb);

    expect(cb.onProgress).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
  });

  it('fires voicePipeline callback when conditions met', async () => {
    const cb = { ...mockCallbacks(), onVoiceReady: vi.fn() };
    const pipeline = vi.fn();
    const chunks = [{ formatter: { formattedOutput: '语音内容' } }];

    await processGraphStream(fromChunks(chunks), cb, {}, pipeline);

    expect(pipeline).toHaveBeenCalledWith('语音内容', {}, cb);
  });

  it('does not fire voicePipeline without onVoiceReady', async () => {
    const { onVoiceReady: _, ...cb } = { ...mockCallbacks() };
    const pipeline = vi.fn();
    const chunks = [{ formatter: { formattedOutput: '内容' } }];

    await processGraphStream(fromChunks(chunks), cb as any, {}, pipeline);

    expect(pipeline).not.toHaveBeenCalled();
  });

  it('does not fire voicePipeline when no formattedOutput', async () => {
    const cb = { ...mockCallbacks(), onVoiceReady: vi.fn() };
    const pipeline = vi.fn();
    const chunks = [{ router: { depth: 2 } }];

    await processGraphStream(fromChunks(chunks), cb, {}, pipeline);

    expect(pipeline).not.toHaveBeenCalled();
  });

  it('maps unknown node names to raw name', async () => {
    const cb = mockCallbacks();
    const chunks = [{ unknown_node: { formattedOutput: 'x' } }];
    await processGraphStream(fromChunks(chunks), cb);

    expect(cb.onProgress).toHaveBeenCalledWith('unknown_node');
  });
  // ── onHumanizedProgress 回调测试 ──

  it('calls onHumanizedProgress for analytical node', async () => {
    const cb = mockCallbacks();
    const chunks = [{ analytical: { formattedOutput: '分析结果' } }];
    await processGraphStream(fromChunks(chunks), cb);

    expect(cb.onHumanizedProgress).toHaveBeenCalledTimes(1);
    const progress = cb.onHumanizedProgress.mock.calls[0][0];
    expect(progress.mainAction.type).toBe('reading');
    expect(progress.mainAction.detail).toBe('正在深度分析原文...');
    expect(progress.currentReadingLevel).toBe('analytical');
  });

  it('calls onHumanizedProgress for each known node', async () => {
    const cb = mockCallbacks();
    const chunks = [
      { router: {} },
      { inspectional: {} },
      { analytical: {} },
      { formatter: { formattedOutput: '结果' } },
    ];
    await processGraphStream(fromChunks(chunks), cb);

    expect(cb.onHumanizedProgress).toHaveBeenCalledTimes(4);
    const types = cb.onHumanizedProgress.mock.calls.map((c: any) => c[0].mainAction.type);
    expect(types).toEqual(['thinking', 'reading', 'reading', 'writing']);
  });

  it('does not call onHumanizedProgress for unknown nodes', async () => {
    const cb = mockCallbacks();
    const chunks = [{ unknown_node: { formattedOutput: 'x' } }];
    await processGraphStream(fromChunks(chunks), cb);

    expect(cb.onHumanizedProgress).not.toHaveBeenCalled();
  });

  it('maps syntopical node to correct reading level', async () => {
    const cb = mockCallbacks();
    const chunks = [{ syntopical: {} }];
    await processGraphStream(fromChunks(chunks), cb);

    const progress = cb.onHumanizedProgress.mock.calls[0][0];
    expect(progress.mainAction.type).toBe('reading');
    expect(progress.currentReadingLevel).toBe('syntopical');
  });

});
