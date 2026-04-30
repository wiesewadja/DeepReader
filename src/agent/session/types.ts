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

/**
 * SessionStore 接口 — 会话持久化
 *
 * 消费者通过此接口访问会话数据，不依赖 JSONL 实现细节
 */
export interface ISessionStore {
	create(sessionId: string, indexId: string, isCrossBook?: boolean): Promise<Session>;
	save(session: Session): Promise<void>;
	appendMessage(sessionId: string, message: ChatMessage): Promise<void>;
	appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
	get(sessionId: string): Promise<Session | null>;
	getMessages(sessionId: string): Promise<ChatMessage[]>;
	getLLMHistory(sessionId: string): Promise<ChatMessage[]>;
	findSessionByIndexId(indexId: string): Promise<SessionMeta | null>;
	getCrossBookSession(): Promise<SessionMeta | null>;
	listSessions(): Promise<SessionMeta[]>;
	delete(sessionId: string): Promise<void>;
	deleteMessages(sessionId: string, messageIndices: number[]): Promise<void>;
	updateLastConsolidated(sessionId: string, index: number): Promise<void>;
}
