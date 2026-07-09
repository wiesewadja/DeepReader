import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { TOOL_EXECUTION_TIMEOUT_MS } from '@/agent/config/agent-constants';
import { executeSingleToolCall, executeToolBatch } from '@/agent/graph/subgraphs/tool-execution';
import type { SubgraphConfig } from '@/agent/graph/subgraphs/tool-execution';
import type { ToolCallLike } from '@/agent/graph/utils/tool-call-parser';

/** 构造一个 invoke 永远 pending 的假工具（模拟挂死） */
function makeHangingTool(name: string): StructuredToolInterface {
  return {
    name,
    description: 'hanging tool',
    schema: undefined,
    invoke: vi.fn(() => new Promise(() => {})),
  } as unknown as StructuredToolInterface;
}

/** 构造一个立即 resolve 的假工具 */
function makeFastTool(name: string, result: string): StructuredToolInterface {
  return {
    name,
    description: 'fast tool',
    schema: undefined,
    invoke: vi.fn(async () => result),
  } as unknown as StructuredToolInterface;
}

function tc(name: string, args: Record<string, unknown> = {}): ToolCallLike {
  return { id: `call_${name}`, name, function: { arguments: JSON.stringify(args), name } };
}

describe('executeSingleToolCall — 超时包裹', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('单工具挂死时，在 TOOL_EXECUTION_TIMEOUT_MS 内返回 timed out 错误 ToolMessage', async () => {
    const hanging = makeHangingTool('weread_search');
    const promise = executeSingleToolCall(tc('weread_search'), [hanging], undefined);

    // 推进到刚好超时
    await vi.advanceTimersByTimeAsync(TOOL_EXECUTION_TIMEOUT_MS);
    const result = await promise;

    expect(result.msg.content).toEqual(expect.stringContaining('timed out'));
    expect(result.msg.content).toEqual(expect.stringContaining('weread_search'));
    expect(result.record).toBeNull();
  });

  it('正常工具不受超时影响，返回结果', async () => {
    const fast = makeFastTool('search_book', 'ok-result');
    const result = await executeSingleToolCall(tc('search_book'), [fast], undefined);
    expect(result.msg.content).toBe('ok-result');
    expect(result.record).not.toBeNull();
  });

  it('批量中一个工具挂死时，其余工具结果正常返回（并行不被单点拖垮）', async () => {
    const tools: StructuredToolInterface[] = [
      makeFastTool('search_book', 'fast-result'),
      makeHangingTool('weread_search'),
    ];
    const config: SubgraphConfig = {
      tools,
      model: {} as never,
      maxIterations: 1,
      maxToolCalls: 2,
    };
    const promise = executeToolBatch([tc('search_book'), tc('weread_search')], tools, config);
    await vi.advanceTimersByTimeAsync(TOOL_EXECUTION_TIMEOUT_MS);
    const { messages } = await promise;

    const contents = messages.map(m => m.content as string);
    expect(contents).toContain('fast-result');
    expect(contents.some(c => c.includes('timed out'))).toBe(true);
  });
});
