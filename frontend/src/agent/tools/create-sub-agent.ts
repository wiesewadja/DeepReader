/**
 * create_sub_agent Tool - 创建子 Agent 处理子任务
 *
 * 子 Agent 用于：
 * - 并行检索多个章节
 * - 深度分析特定内容
 * - 后台执行不需要立即响应的任务
 *
 * 使用 SubagentManager 管理任务生命周期
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import type { SubagentManager } from '../subagent/manager.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

/**
 * create_sub_agent 工具定义
 */
const CREATE_SUB_AGENT_DEFINITION: ToolDefinition = {
	type: 'function',
	function: {
		name: 'create_sub_agent',
		description: `创建子代理执行独立检索任务。

**何时必须使用**：
- 需要读取 3 个及以上章节
- 跨多个信息源查询
- 任务可拆分为独立子任务

**任务必须是原子化的**：
✅ "读取第1章，返回所有核心概念"
✅ "读取第2章，提取关键论点"
✅ "搜索包含'神经网络'的段落"
❌ "分析这本书"（太宽泛）
❌ "理解第1章"（不够具体）

**并行执行**：多个独立子任务可同时调用本工具（wait_for_result=true）

**可用工具**：search_doc, get_chapter, get_toc`,
		parameters: {
			type: 'object',
			properties: {
				task: {
					type: 'string',
					description: '子代理要执行的原子任务，必须有明确输出',
				},
				label: {
					type: 'string',
					description: '任务标签（可选，用于识别）',
				},
				wait_for_result: {
					type: 'boolean',
					description: '是否等待结果（建议 true）',
				},
			},
			required: ['task'],
		},
	},
};

/**
 * check_sub_agent 工具定义
 */
const CHECK_SUB_AGENT_DEFINITION: ToolDefinition = {
	type: 'function',
	function: {
		name: 'check_sub_agent',
		description: `检查子助手的执行状态和结果。

返回：
- 任务状态（running/completed/failed/cancelled）
- 执行结果（如果已完成）
- 错误信息（如果失败）`,
		parameters: {
			type: 'object',
			properties: {
				task_id: {
					type: 'string',
					description: '要检查的任务 ID',
				},
			},
			required: ['task_id'],
		},
	},
};

/**
 * 创建 SubagentManager 工厂
 *
 * 由于 SubagentManager 需要在会话级别管理，
 * 这个工厂函数允许延迟注入 manager
 */
let globalSubagentManager: SubagentManager | null = null;

/**
 * 设置全局 SubagentManager
 */
export function setSubagentManager(manager: SubagentManager): void {
	globalSubagentManager = manager;
	log('[SubAgent] SubagentManager 已设置');
}

/**
 * 获取全局 SubagentManager
 */
export function getSubagentManager(): SubagentManager | null {
	return globalSubagentManager;
}

/**
 * 创建 create_sub_agent 工具执行器
 */
export function makeCreateSubAgentTool(_app: any): ToolExecutor {
	return {
		definition: CREATE_SUB_AGENT_DEFINITION,

		async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
			const task = args.task as string;
			const label = args.label as string | undefined;
			const waitForResult = args.wait_for_result === true;  // 默认 false

			if (!task || typeof task !== 'string') {
				return 'Error: task 参数是必需的，且必须是字符串';
			}

			const manager = getSubagentManager();
			if (!manager) {
				return 'Error: SubagentManager 未初始化。请确保在会话开始时设置 SubagentManager。';
			}

			try {
				log('[SubAgent] 创建子任务:', task.slice(0, 50));

				// 获取当前会话 ID
				const sessionId = context.sessionId;

				// 创建子任务
				const taskId = manager.spawn(task, label, sessionId);

				// 如果需要等待结果
				if (waitForResult) {
					log('[SubAgent] 等待任务完成:', taskId);

					// 使用 manager.waitFor 替代轮询
					const taskInfo = await manager.waitFor(taskId, 60000);

					if (taskInfo) {
						if (taskInfo.status === 'completed') {
							return `子任务完成：\n${taskInfo.result || '(无结果)'}`;
						} else if (taskInfo.status === 'failed') {
							return `子任务失败：${taskInfo.error || '未知错误'}`;
						} else if (taskInfo.status === 'cancelled') {
							return `子任务已取消`;
						} else {
							return `子任务超时（等待了 60 秒）。任务 ID: ${taskId}，状态: ${taskInfo.status}`;
						}
					}

					return `任务不存在: ${taskId}`;
				}

				// 异步执行，立即返回任务 ID
				return JSON.stringify({
					success: true,
					taskId,
					message: `子助手已启动，任务 ID: ${taskId}`,
					note: '子助手完成后，使用 check_sub_agent 工具检查结果',
				});
			} catch (e) {
				const errorMsg = e instanceof Error ? e.message : String(e);
				logError('[SubAgent] 执行失败:', errorMsg);
				return `Error in sub-agent execution: ${errorMsg}`;
			}
		},
	};
}

/**
 * 创建 check_sub_agent 工具执行器
 */
export function makeCheckSubAgentTool(_app: any): ToolExecutor {
	return {
		definition: CHECK_SUB_AGENT_DEFINITION,

		async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
			const taskId = args.task_id as string;

			if (!taskId || typeof taskId !== 'string') {
				return 'Error: task_id 参数是必需的，且必须是字符串';
			}

			const manager = getSubagentManager();
			if (!manager) {
				return 'Error: SubagentManager 未初始化。';
			}

			try {
				const task = manager.getTask(taskId);

				if (!task) {
					return JSON.stringify({
						success: false,
						error: '任务不存在',
						taskId,
					});
				}

				return JSON.stringify({
					success: true,
					taskId: task.taskId,
					label: task.label,
					status: task.status,
					result: task.result,
					error: task.error,
					createdAt: task.createdAt,
					completedAt: task.completedAt,
				});
			} catch (e) {
				const errorMsg = e instanceof Error ? e.message : String(e);
				logError('[SubAgent] 检查任务失败:', errorMsg);
				return `Error checking sub-agent: ${errorMsg}`;
			}
		},
	};
}

// 导出默认工具实例
export const createSubAgentTool: ToolExecutor = {
	definition: CREATE_SUB_AGENT_DEFINITION,
	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		const tool = makeCreateSubAgentTool(context.app);
		return tool.execute(args, context);
	},
};

export const checkSubAgentTool: ToolExecutor = {
	definition: CHECK_SUB_AGENT_DEFINITION,
	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		const tool = makeCheckSubAgentTool(context.app);
		return tool.execute(args, context);
	},
};
