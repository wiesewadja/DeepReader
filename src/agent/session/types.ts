/**
 * Session Storage 类型定义
 *
 * JSONL 文件存储会话消息，支持追加写入和懒加载
 */

import type { ChatMessage } from '../types.js';

/**
 * 会话元数据（存储在 JSONL 第一行和 index.json 中）
 */
export interface SessionMeta {
	sessionId: string;
	indexId: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	/** 已整合到长期记忆的消息索引 */
	lastConsolidated: number;
	isCrossBook?: boolean;
}

/**
 * 完整会话对象（内存中使用）
 */
export interface Session extends SessionMeta {
	messages: ChatMessage[];
}

/**
 * JSONL 文件中的元数据行
 */
export interface SessionMetadataLine {
	_type: 'metadata';
	sessionId: string;
	indexId: string;
	createdAt: string;
	lastConsolidated: number;
	isCrossBook?: boolean;
}

/**
 * JSONL 文件中的消息行
 * 注：不存储 system 消息（system prompt 每次动态生成）
 */
export interface SessionMessageLine {
	role: 'user' | 'assistant' | 'tool';
	content: string;
	timestamp: string;
	tool_calls?: ChatMessage['tool_calls'];
	tool_call_id?: string;
	name?: string;
	hidden?: boolean;
	// 语音书信回复持久化字段
	voiceAudioPath?: string;  // 音频文件相对路径（相对于 sessions 目录）
	voiceDuration?: number;   // 语音时长（秒）
	letterState?: 'sealing' | 'sealed' | 'opened';  // 信封状态
}

/**
 * 索引文件结构
 */
export interface SessionsIndex {
	sessions: SessionMeta[];
	version: number;
}

/**
 * SessionStore 配置
 */
export interface SessionStoreConfig {
	/** 最大缓存会话数 */
	maxCacheSize?: number;
	/** 最大加载消息数（LLM 历史） */
	maxLLMMessages?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_SESSION_STORE_CONFIG: Required<SessionStoreConfig> = {
	maxCacheSize: 10,
	maxLLMMessages: 500,
};
