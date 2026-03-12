/**
 * 记忆系统类型定义
 *
 * 双层记忆系统：
 * - Session (短期): data.json 中的 chatCache
 * - MEMORY.md (长期): 用户画像、偏好
 * - HISTORY.md (时间线): 对话历史日志
 */

import type { ChatMessage } from '../types';

/**
 * 记忆类别
 */
export type MemoryCategory = 'preference' | 'correction' | 'info' | 'insight';

/**
 * 会话缓存条目（存储在 data.json 的 chatCache 中）
 */
export interface ChatCacheEntry {
	sessionId: string;
	indexId: string;
	lastUpdated: number;
	messages: ChatMessage[];
	isCrossBook?: boolean;
	/** 已整合到长期记忆的消息索引（默认 0） */
	lastConsolidated?: number;
}

/**
 * 会话元数据（扩展）
 */
export interface SessionMetadata {
	sessionId: string;
	indexId: string;
	lastUpdated: number;
	/** 已整合到长期记忆的消息索引 */
	lastConsolidated: number;
}

/**
 * 记忆整合结果（LLM save_memory 工具返回）
 */
export interface ConsolidationResult {
	/** HISTORY.md 条目 */
	historyEntry: string;
	/** MEMORY.md 更新内容 */
	memoryUpdate: string;
}

/**
 * 整合器配置
 */
export interface ConsolidatorConfig {
	/** 触发整合的 Token 阈值 */
	tokenThreshold: number;
	/** 目标压缩比例 */
	targetRatio: number;
	/** 最大整合轮数 */
	maxRounds: number;
}

/**
 * 默认整合器配置
 */
export const DEFAULT_CONSOLIDATOR_CONFIG: ConsolidatorConfig = {
	tokenThreshold: 40000,
	targetRatio: 0.5,
	maxRounds: 5,
};
