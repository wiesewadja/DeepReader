/**
 * 记忆系统类型定义
 *
 * 双层记忆系统：
 * - Session (短期): JSONL 文件存储（SessionStore）
 * - MEMORY.md (长期): 用户画像、偏好
 * - HISTORY.md (时间线): 对话历史日志
 */

import type { ChatMessage } from '../types';

/**
 * 记忆类别
 */
export type MemoryCategory = 'preference' | 'correction' | 'info' | 'insight';

/**
 * 会话缓存条目（旧格式，保留用于回退兼容）
 * @deprecated 使用 SessionStore 替代
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
	/** 关键引用链接（新增） */
	references: string[];
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
	/** 跳过阈值：条目长度小于此值视为闲聊（新增） */
	skipThreshold: number;
	/** 加载到 LLM 的最大对话摘要数（新增） */
	maxDialogueSummaries: number;
}

/**
 * 默认整合器配置
 *
 * tokenThreshold: 触发整合的阈值
 *   - 尽早整合用户画像信息，避免早期对话的偏好信息丢失
 *   - 约 3000 tokens（6000 中文字符），2-3 轮对话即触发
 */
export const DEFAULT_CONSOLIDATOR_CONFIG: ConsolidatorConfig = {
	tokenThreshold: 3000,
	targetRatio: 0.5,
	maxRounds: 5,
	skipThreshold: 20,
	maxDialogueSummaries: 10,
};

/**
 * MemoryStore 接口 — 长期记忆 + 历史日志的读写
 *
 * 消费者通过此接口访问记忆，不依赖具体实现
 */
export interface IMemoryStore {
	readLongTermMemory(): Promise<string | null>;
	writeLongTermMemory(content: string): Promise<void>;
	getMemoryLineCount(): Promise<number>;
	appendHistory(entry: string): Promise<void>;
	readHistory(limit?: number): Promise<string>;
	searchHistory(query: string, limit?: number): Promise<string[]>;
	searchDialogueSummaries(bookName: string, limit?: number): Promise<string[]>;
	getReadingSummary(): Promise<string>;
	getMemoryContext(): Promise<string>;
	needsCompression(): Promise<boolean>;
	initializeMemory(): Promise<void>;
}
