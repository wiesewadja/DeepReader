/**
 * HumanizedProgressAdapter - 将技术状态转换为拟人化显示
 *
 * 输入: 工具调用、LLM 状态
 * 输出: 用户友好的动作描述
 */

import type { HumanizedProgress, ReadingProgressItem, AgentAction, ReadingLevel } from './humanized-types';
import { TOOL_TO_ACTION, generateThoughtBubble, TOOL_TO_READING_LEVEL } from './humanized-types';

/**
 * 工具调用记录（内部）
 */
interface ToolCallRecord {
	/** 唯一标识符（用于区分同名工具的多次调用） */
	id: string;
	/** 工具名称 */
	name: string;
	/** 工具参数 */
	args: Record<string, unknown>;
	/** 调用状态 */
	status: 'running' | 'completed' | 'failed';
	/** 执行时长（毫秒） */
	duration?: number;
}

/** 生成唯一 ID */
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class HumanizedProgressAdapter {
	private toolCalls: ToolCallRecord[] = [];
	private currentContent: string = '';
	private iteration: number = 0;
	private maxIterations: number = 10;
	/** 当前运行中工具的 ID 映射（工具名 -> ID 列表） */
	private runningByTool: Map<string, string[]> = new Map();
	/** markdown 文件映射（node_id -> 文件路径） */
	private markdownFiles?: Record<string, string>;
	/** 会话中达到的最高阅读层次（持续显示） */
	private sessionHighestLevel: ReadingLevel | undefined;

	/**
	 * 设置 markdown 文件映射
	 */
	setMarkdownFiles(files: Record<string, string> | undefined): void {
		this.markdownFiles = files;
	}

	/**
	 * 记录工具调用开始
	 * @returns 工具调用 ID，用于后续 complete/failed 调用
	 */
	recordToolStart(name: string, args: Record<string, unknown>): string {
		const id = generateId();
		this.toolCalls.push({
			id,
			name,
			args,
			status: 'running',
		});

		// 追踪运行中的工具
		const running = this.runningByTool.get(name) || [];
		running.push(id);
		this.runningByTool.set(name, running);

		return id;
	}

	/**
	 * 记录工具调用完成
	 * @param idOrName 工具调用 ID 或工具名（兼容旧代码）
	 */
	recordToolComplete(idOrName: string, duration: number): void {
		// 先尝试按 ID 查找
		const byId = this.toolCalls.find((t) => t.id === idOrName && t.status === 'running');
		if (byId) {
			byId.status = 'completed';
			byId.duration = duration;
			this.removeFromRunning(byId.name, byId.id);
			return;
		}

		// 兼容旧代码：按名称查找最后一个运行中的
		const running = this.runningByTool.get(idOrName);
		if (running && running.length > 0) {
			const lastId = running[running.length - 1];
			const tool = this.toolCalls.find((t) => t.id === lastId);
			if (tool) {
				tool.status = 'completed';
				tool.duration = duration;
				this.removeFromRunning(idOrName, lastId);
			}
		}
	}

	/**
	 * 记录工具调用失败
	 * @param idOrName 工具调用 ID 或工具名（兼容旧代码）
	 */
	recordToolFailed(idOrName: string): void {
		// 先尝试按 ID 查找
		const byId = this.toolCalls.find((t) => t.id === idOrName && t.status === 'running');
		if (byId) {
			byId.status = 'failed';
			this.removeFromRunning(byId.name, byId.id);
			return;
		}

		// 兼容旧代码：按名称查找最后一个运行中的
		const running = this.runningByTool.get(idOrName);
		if (running && running.length > 0) {
			const lastId = running[running.length - 1];
			const tool = this.toolCalls.find((t) => t.id === lastId);
			if (tool) {
				tool.status = 'failed';
				this.removeFromRunning(idOrName, lastId);
			}
		}
	}

	/**
	 * 从运行中列表移除
	 */
	private removeFromRunning(name: string, id: string): void {
		const running = this.runningByTool.get(name);
		if (running) {
			const idx = running.indexOf(id);
			if (idx >= 0) {
				running.splice(idx, 1);
			}
		}
	}

	/**
	 * 更新生成内容
	 */
	updateContent(content: string): void {
		this.currentContent = content;
	}

	/**
	 * 设置迭代轮数
	 */
	setIteration(iteration: number, maxIterations: number): void {
		this.iteration = iteration;
		this.maxIterations = maxIterations;
	}

	/**
	 * 转换为拟人化进度
	 */
	toHumanizedProgress(): HumanizedProgress {
		// 确定当前主动作
		const mainAction = this.determineMainAction();

		// 生成阅读步骤
		const readingSteps = this.generateReadingSteps();

		// 生成思考气泡
		const thoughtBubble = this.shouldShowThought()
			? generateThoughtBubble(this.determineThoughtContext())
			: undefined;

		// 计算整体进度
		const overallProgress = this.calculateProgress();

		// 确定当前阅读层次
		const currentReadingLevel = this.determineReadingLevel();

		return {
			mainAction,
			readingSteps,
			thoughtBubble,
			generatedContent: this.currentContent,
			overallProgress,
			currentReadingLevel,
		};
	}

	/**
	 * 确定当前主动作
	 */
	private determineMainAction(): AgentAction {
		const runningTools = this.toolCalls.filter((t) => t.status === 'running');
		const context = { markdownFiles: this.markdownFiles };

		if (runningTools.length > 0) {
			const tool = runningTools[runningTools.length - 1];
			const actionFn = TOOL_TO_ACTION[tool.name];

			if (
				tool.name.includes('search') ||
				tool.name.includes('read_markdown') ||
				tool.name.includes('outline')
			) {
				return { type: 'reading', detail: actionFn?.(tool.args, context) || '阅读中...' };
			}

			if (tool.name.includes('memory')) {
				return { type: 'thinking', detail: actionFn?.(tool.args, context) || '回忆中...' };
			}

			if (tool.name.includes('note') || tool.name.includes('write')) {
				return { type: 'writing', detail: actionFn?.(tool.args, context) || '整理中...' };
			}

			// Skill 工具 - 加载专业技能
			if (tool.name.toLowerCase() === 'skill') {
				return { type: 'thinking', detail: actionFn?.(tool.args, context) || '加载专业技能...' };
			}

			// 默认使用工具名对应的动作
			if (actionFn) {
				return { type: 'reading', detail: actionFn(tool.args, context) };
			}
		}

		if (this.currentContent) {
			return { type: 'writing', detail: '整理回答中...' };
		}

		return { type: 'thinking', detail: '思考中...' };
	}

	/**
	 * 生成阅读步骤列表
	 */
	private generateReadingSteps(): ReadingProgressItem[] {
		const context = { markdownFiles: this.markdownFiles };
		return this.toolCalls.map((tool) => {
			const actionFn = TOOL_TO_ACTION[tool.name];
			const action = actionFn?.(tool.args, context) || tool.name;

			let status: ReadingProgressItem['status'] = 'pending';
			if (tool.status === 'completed') status = 'done';
			else if (tool.status === 'running') status = 'current';

			return {
				action,
				status,
				duration: tool.duration,
			};
		});
	}

	/**
	 * 是否显示思考气泡
	 */
	private shouldShowThought(): boolean {
		// 在以下情况显示思考气泡：
		// 1. 刚开始（没有工具调用）
		// 2. 完成一批工具调用后
		// 3. 开始生成内容时

		const completedCount = this.toolCalls.filter((t) => t.status === 'completed').length;
		const runningCount = this.toolCalls.filter((t) => t.status === 'running').length;

		return (
			this.toolCalls.length === 0 ||
			(completedCount > 0 && runningCount === 0) ||
			(completedCount >= 2 && !this.currentContent)
		);
	}

	/**
	 * 确定思考上下文
	 */
	private determineThoughtContext():
		| 'starting'
		| 'found'
		| 'confused'
		| 'summarizing'
		| 'reflecting' {
		const failedCount = this.toolCalls.filter((t) => t.status === 'failed').length;
		const completedCount = this.toolCalls.filter((t) => t.status === 'completed').length;

		if (failedCount > 0) return 'confused';
		if (this.toolCalls.length === 0) return 'starting';
		if (this.currentContent) return 'summarizing';
		if (completedCount >= 3) return 'reflecting';
		return 'found';
	}

	/**
	 * 计算整体进度
	 */
	private calculateProgress(): number {
		const completedCount = this.toolCalls.filter((t) => t.status === 'completed').length;
		const total = Math.max(this.toolCalls.length, 1);

		// 工具调用占 60%，内容生成占 40%
		const toolProgress = (completedCount / total) * 60;
		const contentProgress = this.currentContent ? 40 : 0;

		return Math.min(100, toolProgress + contentProgress);
	}

	/**
	 * 确定当前阅读层次
	 * 根据已调用和正在调用的工具，返回最高层次
	 * 同时更新会话最高层次（用于持续显示）
	 * 注意：skill 不属于阅读层次，不影响徽章显示
	 */
	private determineReadingLevel(): ReadingLevel | undefined {
		// 阅读层次优先级（skill 不参与层次判断）
		const levelPriority: ReadingLevel[] = ['syntopical', 'analytical', 'inspectional', 'elementary'];

		// 检查所有已调用和正在调用的工具（排除 skill）
		const activeTools = this.toolCalls.filter(
			(t) => (t.status === 'running' || t.status === 'completed') && t.name.toLowerCase() !== 'skill'
		);

		let currentLevel: ReadingLevel | undefined;

		for (const level of levelPriority) {
			const hasLevelTool = activeTools.some((tool) => {
				const toolLevel = TOOL_TO_READING_LEVEL[tool.name];
				return toolLevel === level;
			});
			if (hasLevelTool) {
				currentLevel = level;
				break;
			}
		}

		// 更新会话最高层次（只升级不降级）
		if (currentLevel) {
			const currentIndex = levelPriority.indexOf(currentLevel);
			const sessionIndex = this.sessionHighestLevel ? levelPriority.indexOf(this.sessionHighestLevel) : -1;
			if (currentIndex < sessionIndex || sessionIndex === -1) {
				this.sessionHighestLevel = currentLevel;
			}
		}

		// 返回会话最高层次（持续显示，而非仅当前工具层次）
		return this.sessionHighestLevel;
	}

	/**
	 * 重置（新会话时调用）
	 */
	reset(): void {
		this.toolCalls = [];
		this.currentContent = '';
		this.iteration = 0;
		this.sessionHighestLevel = undefined;
	}
}
