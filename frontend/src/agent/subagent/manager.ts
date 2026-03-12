/**
 * SubagentManager - 子 Agent 管理器
 *
 * 负责创建、执行和监控子 Agent 任务
 * 支持后台并行执行检索任务
 */

import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, ToolDefinition } from '../types';
import type { LLMClient } from '../llm-client';
import type { ToolRegistry, ToolContext } from '../tools/types';
import type { SubagentTask, SubagentConfig, SubagentCallback } from './types';
import { DEFAULT_SUBAGENT_CONFIG, DEFAULT_SUBAGENT_TOOLS } from './types';
import { runAgentLoop } from '../agent-loop';
import { agentLog } from '../../utils/logger';

export class SubagentManager {
	private client: LLMClient;
	private toolRegistry: ToolRegistry;
	private context: ToolContext;
	private config: SubagentConfig;
	private onResult?: SubagentCallback;

	/** 运行中的任务 */
	private runningTasks: Map<string, Promise<void>> = new Map();
	/** 任务信息 */
	private taskInfo: Map<string, SubagentTask> = new Map();
	/** 会话任务映射 */
	private sessionTasks: Map<string, Set<string>> = new Map();

	constructor(
		client: LLMClient,
		toolRegistry: ToolRegistry,
		context: ToolContext,
		config: Partial<SubagentConfig> = {},
		onResult?: SubagentCallback
	) {
		this.client = client;
		this.toolRegistry = toolRegistry;
		this.context = context;
		this.config = { ...DEFAULT_SUBAGENT_CONFIG, ...config };
		this.onResult = onResult;
	}

	/**
	 * 创建并启动子 Agent 任务
	 */
	spawn(description: string, label?: string, sessionId?: string): string {
		const taskId = uuidv4().slice(0, 8);
		const displayLabel =
			label || (description.length > 30 ? description.slice(0, 30) + '...' : description);

		// 创建取消控制器
		const abortController = new AbortController();

		const task: SubagentTask = {
			taskId,
			description,
			label: displayLabel,
			status: 'running',
			createdAt: Date.now(),
			sessionId,
			abortController,
		};

		this.taskInfo.set(taskId, task);

		// 启动异步任务
		const promise = this.runSubagent(taskId, description, abortController.signal);
		this.runningTasks.set(taskId, promise);

		// 关联到会话
		if (sessionId) {
			if (!this.sessionTasks.has(sessionId)) {
				this.sessionTasks.set(sessionId, new Set());
			}
			this.sessionTasks.get(sessionId)!.add(taskId);
		}

		agentLog(`[Subagent] 启动任务 ${taskId}: ${displayLabel}`);
		return taskId;
	}

	/**
	 * 执行子 Agent
	 */
	private async runSubagent(taskId: string, description: string, abortSignal: AbortSignal): Promise<void> {
		const task = this.taskInfo.get(taskId);
		if (!task) return;

		try {
			// 检查是否已取消
			if (abortSignal.aborted) {
				task.status = 'cancelled';
				task.completedAt = Date.now();
				return;
			}

			// 构建子 Agent 的系统提示
			const systemPrompt = this.buildSubagentPrompt();

			// 获取允许的工具
			const tools = this.getAllowedTools();

			// 初始消息
			const messages: ChatMessage[] = [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: description },
			];

			// 运行子 Agent 循环
			const result = await this.runLoop(taskId, messages, tools, abortSignal);

			// 再次检查是否已取消
			if (abortSignal.aborted) {
				task.status = 'cancelled';
				task.completedAt = Date.now();
				return;
			}

			// 更新任务状态
			task.status = 'completed';
			task.result = result;
			task.completedAt = Date.now();

			agentLog(`[Subagent] 任务 ${taskId} 完成`);
		} catch (error) {
			// 检查是否是取消导致的错误
			if (abortSignal.aborted) {
				task.status = 'cancelled';
				task.error = '任务已取消';
			} else {
				task.status = 'failed';
				task.error = error instanceof Error ? error.message : String(error);
			}
			task.completedAt = Date.now();

			agentLog(`[Subagent] 任务 ${taskId} ${task.status}: ${task.error || ''}`);
		} finally {
			this.runningTasks.delete(taskId);

			// 触发回调
			if (this.onResult) {
				this.onResult(task);
			}
		}
	}

	/**
	 * 运行子 Agent 循环
	 */
	private async runLoop(
		taskId: string,
		messages: ChatMessage[],
		tools: ToolDefinition[],
		abortSignal: AbortSignal
	): Promise<string> {
		let accumulatedContent = '';

		await new Promise<void>((resolve, reject) => {
			// 检查是否已取消
			if (abortSignal.aborted) {
				reject(new Error('任务已取消'));
				return;
			}

			const timeout = setTimeout(() => {
				reject(new Error('子 Agent 超时'));
			}, this.config.timeout);

			// 监听取消事件
			const abortHandler = () => {
				clearTimeout(timeout);
				reject(new Error('任务已取消'));
			};
			abortSignal.addEventListener('abort', abortHandler);

			runAgentLoop(this.client, messages, tools, this.toolRegistry, this.context, {
				maxIterations: this.config.maxIterations,
				abortSignal,  // 传递取消信号
				onContent: (text) => {
					accumulatedContent += text;
				},
				onProgress: () => {},
				onComplete: () => {
					clearTimeout(timeout);
					abortSignal.removeEventListener('abort', abortHandler);
					resolve();
				},
				onError: (error) => {
					clearTimeout(timeout);
					abortSignal.removeEventListener('abort', abortHandler);
					reject(new Error(error));
				},
			});
		});

		return accumulatedContent;
	}

	/**
	 * 构建子 Agent 系统提示
	 */
	private buildSubagentPrompt(): string {
		return `你是一个专门的分析助手，负责完成主助手分配给你的子任务。

## 任务
完成分配给你的具体任务，并返回简洁的结果摘要。

## 约束
- 专注于给定的任务
- 使用可用的工具获取信息
- 提供简洁的摘要，不要过度展开
- 如果无法完成任务，说明原因

## 禁止
- 不能与用户直接交流
- 不能创建新的子任务
- 最多执行 ${this.config.maxIterations} 轮

完成任务后，直接返回你的发现。`;
	}

	/**
	 * 获取允许的工具列表
	 */
	private getAllowedTools(): ToolDefinition[] {
		// 子 Agent 可用的工具（受限）
		const allowed = this.config.allowedTools || DEFAULT_SUBAGENT_TOOLS;

		// 从工具注册表获取工具定义
		const allTools = Array.from(this.toolRegistry.values()).map((e) => e.definition);
		return allTools.filter((tool) => allowed.includes(tool.function.name));
	}

	/**
	 * 获取任务状态
	 */
	getTask(taskId: string): SubagentTask | undefined {
		return this.taskInfo.get(taskId);
	}

	/**
	 * 列出所有任务
	 */
	listTasks(sessionId?: string): SubagentTask[] {
		if (sessionId) {
			const taskIds = this.sessionTasks.get(sessionId) || new Set();
			return Array.from(taskIds)
				.map((id) => this.taskInfo.get(id))
				.filter((t): t is SubagentTask => t !== undefined);
		}
		return Array.from(this.taskInfo.values());
	}

	/**
	 * 取消任务
	 */
	async cancel(taskId: string): Promise<boolean> {
		const task = this.taskInfo.get(taskId);
		if (!task || task.status !== 'running') {
			return false;
		}

		// 使用 AbortController 取消任务
		if (task.abortController) {
			task.abortController.abort();
		}

		task.status = 'cancelled';
		task.completedAt = Date.now();

		agentLog(`[Subagent] 取消任务 ${taskId}`);
		return true;
	}

	/**
	 * 取消会话的所有任务
	 */
	async cancelBySession(sessionId: string): Promise<number> {
		const taskIds = this.sessionTasks.get(sessionId) || new Set();
		let count = 0;

		for (const taskId of taskIds) {
			if (await this.cancel(taskId)) {
				count++;
			}
		}

		return count;
	}

	/**
	 * 清理已完成的任务
	 */
	cleanup(): number {
		let count = 0;

		for (const [taskId, task] of this.taskInfo) {
			if (task.status !== 'running') {
				this.taskInfo.delete(taskId);

				// 从会话映射中移除
				if (task.sessionId) {
					this.sessionTasks.get(task.sessionId)?.delete(taskId);
				}

				count++;
			}
		}

		return count;
	}

	/**
	 * 等待所有任务完成
	 */
	async waitForAll(): Promise<void> {
		const promises = Array.from(this.runningTasks.values());
		await Promise.all(promises);
	}

	/**
	 * 等待指定任务完成
	 * @param taskId 任务 ID
	 * @param timeout 超时时间（毫秒），默认 60000
	 */
	async waitFor(taskId: string, timeout: number = 60000): Promise<SubagentTask | undefined> {
		const promise = this.runningTasks.get(taskId);

		if (promise) {
			// 使用 Promise.race 实现超时
			await Promise.race([
				promise,
				new Promise<void>((resolve) => setTimeout(resolve, timeout)),
			]);
		}

		return this.taskInfo.get(taskId);
	}
}
