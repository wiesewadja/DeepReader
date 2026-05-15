import { describe, it, expect, vi } from 'vitest';
import { processGraphStream } from '../stream-processor';

function mockCallbacks() {
  return {
    onProgress: vi.fn(),
    onContent: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
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
    const cb = mockCallbacks(); // no onVoiceReady
    const pipeline = vi.fn();
    const chunks = [{ formatter: { formattedOutput: '内容' } }];

    await processGraphStream(fromChunks(chunks), cb, {}, pipeline);

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
});
