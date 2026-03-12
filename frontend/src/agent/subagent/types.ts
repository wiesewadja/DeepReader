/**
 * 子 Agent 系统类型定义
 *
 * 用于后台并行执行检索任务
 */

/**
 * 子 Agent 任务状态
 */
export type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 子 Agent 任务
 */
export interface SubagentTask {
	/** 任务 ID */
	taskId: string;
	/** 任务描述 */
	description: string;
	/** 显示标签 */
	label: string;
	/** 状态 */
	status: SubagentStatus;
	/** 结果（完成时） */
	result?: string;
	/** 错误信息（失败时） */
	error?: string;
	/** 创建时间 */
	createdAt: number;
	/** 完成时间 */
	completedAt?: number;
	/** 所属会话 ID */
	sessionId?: string;
	/** 取消控制器 */
	abortController?: AbortController;
}

/**
 * 子 Agent 配置
 */
export interface SubagentConfig {
	/** 最大迭代次数（默认 5） */
	maxIterations: number;
	/** 允许的工具列表（null 表示使用默认集） */
	allowedTools?: string[];
	/** 超时时间（毫秒，默认 60000） */
	timeout: number;
}

/**
 * 子 Agent 结果回调
 */
export type SubagentCallback = (task: SubagentTask) => void;

/**
 * 默认子 Agent 配置
 */
export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
	maxIterations: 5,
	timeout: 60000,
};

/**
 * 子 Agent 可用的默认工具列表
 */
export const DEFAULT_SUBAGENT_TOOLS = [
	'search_doc',
	'get_chapter',
	'get_toc',
	'search_read_books',
];
