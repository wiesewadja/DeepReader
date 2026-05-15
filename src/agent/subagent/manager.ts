/**
 * SubagentManager - 子 Agent 管理器
 *
 * 负责创建、执行和监控子 Agent 任务
 * 支持后台并行执行检索任务
 */

import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, ToolDefinition } from '../types';
import type { LLMClient } from '../llm-client';
import type { ITraceContext } from '../tracing/types';
import type { ToolRegistry, ToolContext } from '../tools/types';
import type { SubagentTask, SubagentConfig, SubagentCallback, AgentLoopRunner } from './types';
import { DEFAULT_SUBAGENT_CONFIG, DEFAULT_SUBAGENT_TOOLS, hashDescription } from './types';
import type { ISubagentManager } from './types';
import { agentLog } from '../../utils/logger';

/** 缓存条目类型 */
interface CacheEntry {
	result: string;
	timestamp: number;
	taskId: string;
}

export class SubagentManager implements ISubagentManager {
	private runLoopFn: AgentLoopRunner;
	private client: LLMClient;
	private toolRegistry: ToolRegistry;
	private context: ToolContext;
	private config: SubagentConfig;
	private onResult?: SubagentCallback;
	private traceCtx?: ITraceContext;

	/** 运行中的任务 */
	private runningTasks: Map<string, Promise<void>> = new Map();
	/** 任务信息 */
	private taskInfo: Map<string, SubagentTask> = new Map();
	/** 会话任务映射 */
	private sessionTasks: Map<string, Set<string>> = new Map();
	/** 结果缓存 */
	private cache: Map<string, CacheEntry> = new Map();

	constructor(
		runLoop: AgentLoopRunner,
		client: LLMClient,
		toolRegistry: ToolRegistry | undefined,
		context: ToolContext,
		config: Partial<SubagentConfig> = {},
		onResult?: SubagentCallback,
		traceCtx?: ITraceContext
	) {
		this.runLoopFn = runLoop;
		this.client = client;
		this.toolRegistry = toolRegistry ?? new Map();
		this.context = context;
		this.config = { ...DEFAULT_SUBAGENT_CONFIG, ...config };
			this.traceCtx = traceCtx;
		this.onResult = onResult;
	}

	/**
	 * 检查缓存是否有有效结果
	 */
	private checkCache(description: string): CacheEntry | null {
		const key = hashDescription(description);
		const entry = this.cache.get(key);

		if (!entry) return null;

		const ttl = this.config.cacheTTL || 300000;
		const now = Date.now();

		if (now - entry.timestamp > ttl) {
			// 缓存过期
			this.cache.delete(key);
			return null;
		}

		return entry;
	}

	/**
	 * 保存结果到缓存
	 */
	private saveToCache(description: string, result: string, taskId: string): void {
		const key = hashDescription(description);
		this.cache.set(key, {
			result,
			timestamp: Date.now(),
			taskId,
		});
		agentLog(`[Subagent] 缓存结果: ${key}`);
	}

	/**
	 * 清理过期缓存
	 */
	cleanupCache(): number {
		const ttl = this.config.cacheTTL || 300000;
		const now = Date.now();
		let count = 0;

		for (const [key, entry] of this.cache) {
			if (now - entry.timestamp > ttl) {
				this.cache.delete(key);
				count++;
			}
		}

		if (count > 0) {
			agentLog(`[Subagent] 清理 ${count} 个过期缓存`);
		}
		return count;
	}

	/**
	 * 创建并启动子 Agent 任务
	 */
	spawn(description: string, label?: string, sessionId?: string): string {
		// 先检查缓存
		const cached = this.checkCache(description);
		if (cached) {
			agentLog(`[Subagent] 命中缓存: ${cached.taskId}`);
			// 直接返回缓存结果
			const taskId = uuidv4().slice(0, 8);
			const task: SubagentTask = {
				taskId,
				description,
				label: label || description.slice(0, 30),
				status: 'completed',
				result: cached.result,
				createdAt: Date.now(),
				completedAt: Date.now(),
				sessionId,
				fromCache: true,
			};
			this.taskInfo.set(taskId, task);

			// 关联到会话
			if (sessionId) {
				if (!this.sessionTasks.has(sessionId)) {
					this.sessionTasks.set(sessionId, new Set());
				}
				this.sessionTasks.get(sessionId)!.add(taskId);
			}

			// 触发回调
			if (this.onResult) {
				setTimeout(() => this.onResult!(task), 0);
			}

			return taskId;
		}

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
	 * 执行子 Agent（带速率限制重试）
	 */
	private async runSubagent(taskId: string, description: string, abortSignal: AbortSignal): Promise<void> {
		const task = this.taskInfo.get(taskId);
		if (!task) return;

		const maxRetries = this.config.maxRetries || 3;
		const retryDelay = this.config.retryDelay || 5000;
		let lastError: string = '';

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

				// 保存到缓存
				this.saveToCache(description, result, taskId);

				agentLog(`[Subagent] 任务 ${taskId} 完成`);
				return; // 成功，退出

			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				lastError = errorMsg;

				// 检查是否是速率限制错误
				const isRateLimit = errorMsg.includes('速率限制') ||
				                    errorMsg.includes('rate limit') ||
				                    errorMsg.includes('429');

				// 检查是否是取消导致的错误
				if (abortSignal.aborted) {
					task.status = 'cancelled';
					task.error = '任务已取消';
					task.completedAt = Date.now();
					agentLog(`[Subagent] 任务 ${taskId} 已取消`);
					return;
				}

				if (isRateLimit && attempt < maxRetries) {
					// 速率限制，等待后重试
					const delay = retryDelay * (attempt + 1); // 递增延迟
					agentLog(`[Subagent] 任务 ${taskId} 遇到速率限制，${delay/1000}秒后重试 (${attempt + 1}/${maxRetries})`);
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				} else {
					// 其他错误或重试次数用尽
					task.status = 'failed';
					task.error = errorMsg;
					task.completedAt = Date.now();
					agentLog(`[Subagent] 任务 ${taskId} 失败: ${errorMsg}`);
					return;
				}
			}
		}

		// 所有重试都失败
		task.status = 'failed';
		task.error = lastError;
		task.completedAt = Date.now();

		agentLog(`[Subagent] 任务 ${taskId} 失败（重试${maxRetries}次后）: ${lastError}`);
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
		// 检查是否已取消
		if (abortSignal.aborted) {
			throw new Error('任务已取消');
		}

		let accumulatedContent = '';
		let timeout: ReturnType<typeof setTimeout> | null = null;
		let abortHandler: (() => void) | null = null;

		try {
			await new Promise<void>((resolve, reject) => {
				// 设置超时
				timeout = setTimeout(() => {
					reject(new Error('子 Agent 超时'));
				}, this.config.timeout);

				// 监听取消事件
				abortHandler = () => {
					if (timeout) clearTimeout(timeout);
					reject(new Error('任务已取消'));
				};
				abortSignal.addEventListener('abort', abortHandler);

				// 正确处理 async 函数返回的 Promise
				this.runLoopFn(this.client, messages, tools, this.toolRegistry, this.context, {
					maxIterations: this.config.maxIterations,
					abortSignal,  // 传递取消信号
					onContent: (text) => {
						accumulatedContent += text;
					},
					onProgress: () => {},
					onComplete: () => {
						if (timeout) clearTimeout(timeout);
						resolve();
					},
					onError: (error) => {
						if (timeout) clearTimeout(timeout);
						reject(new Error(error));
					},
				}).then(() => {
					// runAgentLoop 正常完成（返回消息历史）
					// 注意：onComplete 已经在上面被调用了
				}).catch((err) => {
					// 捕获 runAgentLoop 内部的异步错误
					agentLog(`[Subagent] runAgentLoop Promise 异常: ${err}`);
					if (timeout) clearTimeout(timeout);
					reject(err);
				});
			});
		} finally {
			// 确保清理资源
			if (timeout) clearTimeout(timeout);
			if (abortHandler) {
				abortSignal.removeEventListener('abort', abortHandler);
			}
		}

		return accumulatedContent;
	}

	/**
	 * 构建子 Agent 系统提示
	 *
	 * 子代理是纯粹的执行器，只做主代理明确要求的事
	 */
	private buildSubagentPrompt(): string {
		// 构建文档上下文
		let docContext = '';
		if (this.context.documentMetadata?.title) {
			docContext = `\n## 当前文档
- 文件名: ${this.context.pdfName || '未知'}
- 标题: ${this.context.documentMetadata.title}`;
			if (this.context.documentMetadata.page_count) {
				docContext += `\n- 总页数: ${this.context.documentMetadata.page_count}`;
			}
		}

		return `你是主助手的执行单元，严格完成分配的原子任务。
${docContext}

## 核心原则

**你是执行器，不是决策者。**
- 只做任务描述中明确要求的事
- 不要扩展、不要推测、不要添加额外内容
- 完成后立即返回，不要继续探索

## 可用工具
- search_markdown_text: 搜索当前文档内容
- read_markdown_section: 获取指定章节的完整内容
- get_document_outline: 获取当前文档的目录结构

## 执行规则

1. **严格限定范围**：只处理任务中指定的章节/内容
2. **最小调用**：用最少的工具调用完成任务
3. **直接返回**：返回原始数据或简洁摘要，不做深度分析
4. **快速失败**：如果无法完成，立即报告原因

## 禁止

- ❌ 不要做任务描述之外的任何事
- ❌ 不要尝试"帮助"或"提供更多价值"
- ❌ 不能创建新的子任务
- ❌ 不能与用户交流
- ❌ 最多执行 ${this.config.maxIterations} 轮

## 输出格式

直接返回任务结果，格式如下：
\`\`\`
[任务完成的简要说明]
[请求的具体数据/内容]
\`\`\`

记住：快、准、不发散。`;
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
