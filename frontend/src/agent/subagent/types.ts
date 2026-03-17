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
	/** 是否来自缓存 */
	fromCache?: boolean;
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
	/** 缓存 TTL（毫秒，默认 300000 = 5分钟） */
	cacheTTL?: number;
	/** 速率限制重试次数（默认 3） */
	maxRetries?: number;
	/** 速率限制重试延迟（毫秒，默认 5000） */
	retryDelay?: number;
}

/**
 * 子 Agent 结果回调
 */
export type SubagentCallback = (task: SubagentTask) => void;

/**
 * 缓存条目
 */
interface CacheEntry {
	result: string;
	timestamp: number;
	taskId: string;
}

/**
 * 默认子 Agent 配置
 */
export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
	maxIterations: 5,
	timeout: 60000,
	cacheTTL: 300000, // 5 分钟
	maxRetries: 3,
	retryDelay: 5000, // 5 秒
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

/**
 * 生成任务描述的缓存键
 * 使用简单哈希避免过长的键
 */
export function hashDescription(description: string): string {
	let hash = 0;
	for (let i = 0; i < description.length; i++) {
		const char = description.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return `cache_${Math.abs(hash).toString(36)}`;
}

