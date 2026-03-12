/**
 * HumanizedProgressAdapter - 将技术状态转换为拟人化显示
 *
 * 输入: 工具调用、LLM 状态
 * 输出: 用户友好的动作描述
 */

import type { HumanizedProgress, ReadingProgressItem, AgentAction } from './humanized-types';
import { TOOL_TO_ACTION, generateThoughtBubble } from './humanized-types';

/**
 * 工具调用记录（内部）
 */
interface ToolCallRecord {
	name: string;
	args: Record<string, unknown>;
	status: 'running' | 'completed' | 'failed';
	duration?: number;
}

export class HumanizedProgressAdapter {
	private toolCalls: ToolCallRecord[] = [];
	private currentContent: string = '';
	private iteration: number = 0;
	private maxIterations: number = 10;

	/**
	 * 记录工具调用开始
	 */
	recordToolStart(name: string, args: Record<string, unknown>): void {
		this.toolCalls.push({
			name,
			args,
			status: 'running',
		});
	}

	/**
	 * 记录工具调用完成
	 */
	recordToolComplete(name: string, duration: number): void {
		const tool = this.toolCalls.find((t) => t.name === name && t.status === 'running');
		if (tool) {
			tool.status = 'completed';
			tool.duration = duration;
		}
	}

	/**
	 * 记录工具调用失败
	 */
	recordToolFailed(name: string): void {
		const tool = this.toolCalls.find((t) => t.name === name && t.status === 'running');
		if (tool) {
			tool.status = 'failed';
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

		return {
			mainAction,
			readingSteps,
			thoughtBubble,
			generatedContent: this.currentContent,
			overallProgress,
		};
	}

	/**
	 * 确定当前主动作
	 */
	private determineMainAction(): AgentAction {
		const runningTools = this.toolCalls.filter((t) => t.status === 'running');

		if (runningTools.length > 0) {
			const tool = runningTools[runningTools.length - 1];
			const actionFn = TOOL_TO_ACTION[tool.name];

			if (
				tool.name.includes('search') ||
				tool.name.includes('get_chapter') ||
				tool.name.includes('toc')
			) {
				return { type: 'reading', detail: actionFn?.(tool.args) || '阅读中...' };
			}

			if (tool.name.includes('memory')) {
				return { type: 'thinking', detail: actionFn?.(tool.args) || '回忆中...' };
			}

			if (tool.name.includes('note') || tool.name.includes('write')) {
				return { type: 'writing', detail: actionFn?.(tool.args) || '整理中...' };
			}

			// 默认使用工具名对应的动作
			if (actionFn) {
				return { type: 'reading', detail: actionFn(tool.args) };
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
		return this.toolCalls.map((tool) => {
			const actionFn = TOOL_TO_ACTION[tool.name];
			const action = actionFn?.(tool.args) || tool.name;

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
	 * 重置
	 */
	reset(): void {
		this.toolCalls = [];
		this.currentContent = '';
		this.iteration = 0;
	}
}
