/**
 * create_sub_agent Tool - 创建子 Agent 处理子任务
 *
 * 行为规则：
 * 1. 子 Agent 与主 Agent 串行执行（不允许多个子 Agent 并行）
 * 2. 子 Agent 通过 task_context 获取必要上下文
 * 3. 子 Agent 使用专属 log 标识
 * 4. 超时或取消时直接报错
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

const CREATE_SUB_AGENT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_sub_agent',
    description: `Create a sub-agent to handle a subtask. Use this when:
- The task involves multiple chapters
- Context might overflow
- Need focused processing on a specific part

The sub-agent executes independently and returns results to the main agent.`,
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Clear description of the subtask',
        },
        context: {
          type: 'object',
          properties: {
            book_structure: {
              type: 'string',
              description: 'Book structure (TOC) information',
            },
            previous_results: {
              type: 'string',
              description: 'Results from previous steps',
            },
            focus_nodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Node IDs to focus on',
            },
            tool_context: {
              type: 'object',
              description: 'ToolContext info (indexId, pdfName, markdownFiles)',
            },
          },
        },
        output_format: {
          type: 'string',
          description: 'Expected output format (e.g., "概念列表，包含名称、定义、所在章节")',
        },
      },
      required: ['task'],
    },
  },
};

export const createSubAgentTool: ToolExecutor = {
  definition: CREATE_SUB_AGENT_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const task = args.task as string;
    const contextData = args.context as Record<string, unknown> | undefined;
    const outputFormat = args.output_format as string | undefined;

    if (!task) {
      return 'Error: task parameter is required';
    }

    try {
      log('[SubAgent] 创建子 Agent:', task);

      // 构建子 Agent 的 system prompt
      const subSystemPrompt = `你是一个专门处理子任务的 AI 助手。

## 任务
${task}

## 上下文
${contextData?.book_structure ? `书籍结构：\n${contextData.book_structure}` : ''}
${contextData?.previous_results ? `前置结果：\n${contextData.previous_results}` : ''}
${contextData?.focus_nodes ? `关注章节：${(contextData.focus_nodes as string[]).join(', ')}` : ''}

## 输出格式
${outputFormat || '根据任务要求自然输出'}

## 规则
- 专注完成指定任务
- 使用可用工具获取信息
- 完成后直接返回结果，不要多余的解释`;

      // 创建子 Agent 的 LLM 客户端（复用主 Agent 的配置）
      // 注意：这里需要从 context 或全局获取 API 配置
      // 暂时返回提示信息，实际实现需要获取 LLM 配置
      log('[SubAgent] 子 Agent 任务已定义，等待实际实现');
      log('[SubAgent] task:', task);
      log('[SubAgent] context:', JSON.stringify(contextData, null, 2));
      log('[SubAgent] output_format:', outputFormat);

      // TODO: 实际调用 runAgentLoop
      // 需要从外部传入 LLM 配置（apiKey, baseUrl, model 等）
      // 当前返回占位信息

      return `[SubAgent] 任务已接收：${task}

注意：create_sub_agent 工具需要 LLM 配置才能完整执行。
当前版本为占位实现，请在后续版本中完善。`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[SubAgent] 执行失败:', errorMsg);
      return `Error in sub-agent execution: ${errorMsg}`;
    }
  },
};
