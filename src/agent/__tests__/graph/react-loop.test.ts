/**
 * Tests for the ReAct loop subgraph
 */

import { describe, it, expect, vi } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { runReactLoop, createReactLoopGraph } from '../../graph/subgraphs/react-loop.js';
import type { ReactLoopConfig } from '../../graph/subgraphs/react-loop.js';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// === Mock tools ===

function createMockTools() {
  const searchBook = tool(
    async (args) => {
      return JSON.stringify({
        matched_blocks: [
          { block_id: 'p001', text: `搜索结果: ${args.keywords?.join(',')}`, file_name: 'ch01.md' },
        ],
      });
    },
    {
      name: 'search_book',
      description: 'Search book',
      schema: z.object({
        keywords: z.array(z.string()),
        scope_node_ids: z.array(z.string()).optional(),
      }),
    },
  );

  const readSection = tool(
    async (args) => {
      return `章节内容 ${args.node_ids?.join(',') ?? args.node_id ?? ''} ^p001`;
    },
    {
      name: 'read_book_section',
      description: 'Read section',
      schema: z.object({
        node_ids: z.array(z.string()).optional(),
        node_id: z.string().optional(),
        block_id: z.string().optional(),
      }),
    },
  );

  return [searchBook, readSection];
}

// === Mock model that returns sequential responses ===

function createSequentialMockModel(responses: AIMessage[], forcedConclusionResponse?: AIMessage) {
  let callIndex = 0;

  const invoke = vi.fn().mockImplementation(async () => {
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return response;
  });

  const forcedInvoke = vi.fn().mockImplementation(async () => {
    return forcedConclusionResponse ?? new AIMessage('基于已有信息的最终分析结论');
  });

  return {
    bindTools: vi.fn().mockReturnValue({ invoke }),
    // Forced conclusion uses model.invoke directly (not bindTools)
    invoke: forcedInvoke,
  };
}

describe('ReAct Loop Subgraph', () => {
  describe('createReactLoopGraph', () => {
    it('should build a compilable graph', () => {
      const mockModel = createSequentialMockModel([
        new AIMessage({ content: '分析完成' }),
      ]);

      const config: ReactLoopConfig = {
        tools: createMockTools(),
        model: mockModel as any,
        maxIterations: 8,
        maxToolCalls: 5,
      };

      const graph = createReactLoopGraph(config);
      expect(graph).toBeDefined();

      const compiled = graph.compile();
      expect(compiled).toBeDefined();
    });
  });

  describe('runReactLoop', () => {
    it('should return content when model responds without tool calls', async () => {
      const mockModel = createSequentialMockModel([
        new AIMessage({ content: '直接分析结果，无需工具调用' }),
      ]);

      const result = await runReactLoop(
        [new SystemMessage('系统提示'), new HumanMessage('测试问题')],
        {
          tools: createMockTools(),
          model: mockModel as any,
          maxIterations: 8,
          maxToolCalls: 5,
        },
      );

      expect(result.finishReason).toBe('stop');
      expect(result.content).toBe('直接分析结果，无需工具调用');
      expect(result.iterations).toBe(1);
      expect(result.toolResults).toHaveLength(0);
    });

    it('should execute tool calls and continue the loop', async () => {
      let agentCallCount = 0;
      const invoke = vi.fn().mockImplementation(async () => {
        agentCallCount++;
        if (agentCallCount === 1) {
          return new AIMessage({
            content: '让我搜索一下',
            tool_calls: [{
              id: 'tc_1',
              name: 'search_book',
              args: { keywords: ['测试'] },
            }],
          });
        }
        return new AIMessage({ content: '搜索后的分析结果' });
      });

      const mockModel = {
        bindTools: vi.fn().mockReturnValue({ invoke }),
        invoke: vi.fn().mockResolvedValue(new AIMessage('不应被调用')),
      };

      const result = await runReactLoop(
        [new HumanMessage('测试问题')],
        {
          tools: createMockTools(),
          model: mockModel as any,
          maxIterations: 8,
          maxToolCalls: 5,
        },
      );
      expect(result.finishReason).toBe('stop');
      expect(result.content).toBe('搜索后的分析结果');
      expect(result.iterations).toBe(2);
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].toolName).toBe('search_book');
    });

    it('should apply toolInterceptor to tool arguments', async () => {
      const interceptor = vi.fn((toolName: string, args: Record<string, unknown>) => {
        if (toolName === 'search_book') {
          return { ...args, scope_node_ids: ['node_1', 'node_2'] };
        }
        return args;
      });

      let agentCallCount = 0;
      const invoke = vi.fn().mockImplementation(async () => {
        agentCallCount++;
        if (agentCallCount === 1) {
          return new AIMessage({
            content: '搜索中',
            tool_calls: [{
              id: 'tc_1',
              name: 'search_book',
              args: { keywords: ['MECE'] },
            }],
          });
        }
        return new AIMessage({ content: '拦截后的分析' });
      });

      const mockModel = {
        bindTools: vi.fn().mockReturnValue({ invoke }),
        invoke: vi.fn().mockResolvedValue(new AIMessage('不应被调用')),
      };

      await runReactLoop(
        [new HumanMessage('测试 scope 拦截')],
        {
          tools: createMockTools(),
          model: mockModel as any,
          maxIterations: 8,
          maxToolCalls: 5,
          toolInterceptor: interceptor,
        },
      );

      expect(interceptor).toHaveBeenCalledWith('search_book', { keywords: ['MECE'] });
    });

    it('should stop on max iterations with forced conclusion', async () => {
      // Model always wants to call tools with unique keywords each time
      let callCount = 0;
      const invoke = vi.fn().mockImplementation(async () => {
        callCount++;
        return new AIMessage({
          content: '继续搜索',
          tool_calls: [{
            id: `tc_${callCount}`,
            name: 'search_book',
            args: { keywords: [`keyword_${callCount}`] },
          }],
        });
      });

      const mockModel = {
        bindTools: vi.fn().mockReturnValue({ invoke }),
        invoke: vi.fn().mockResolvedValue(new AIMessage('基于已有信息的最终分析结论')),
      };

      const result = await runReactLoop(
        [new HumanMessage('测试迭代上限')],
        {
          tools: createMockTools(),
          model: mockModel as any,
          maxIterations: 2,
          maxToolCalls: 5,
        },
      );

      expect(result.finishReason).toBe('max_iterations');
      expect(result.content).toContain('最终分析结论');
    });

    it('should detect duplicate queries and stop', async () => {
      let callCount = 0;
      const invoke = vi.fn().mockImplementation(async () => {
        callCount++;
        // Always search with the same keywords
        return new AIMessage({
          content: '搜索中',
          tool_calls: [{
            id: `tc_${callCount}`,
            name: 'search_book',
            args: { keywords: ['重复关键词'] },
          }],
        });
      });

      const mockModel = {
        bindTools: vi.fn().mockReturnValue({ invoke }),
        invoke: vi.fn().mockResolvedValue(new AIMessage('强制结论')),
      };

      const result = await runReactLoop(
        [new HumanMessage('测试循环检测')],
        {
          tools: createMockTools(),
          model: mockModel as any,
          maxIterations: 8,
          maxToolCalls: 5,
        },
      );

      // Second call has same keywords → all duplicates → shouldContinue returns __end__
      // With the fix: loop detection triggers forced conclusion when toolResults exist
      // finishReason is now 'loop_detected' instead of the old buggy 'stop'
      expect(result.finishReason).toBe('loop_detected');
    });
  });
});
