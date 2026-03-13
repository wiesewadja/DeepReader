/**
 * SessionStore - JSONL 文件会话存储
 *
 * 特性：
 * - 追加写入：只追加新消息，不重写整个文件
 * - 懒加载：按需加载会话，活跃会话缓存
 * - 会话锁：防止并发整合冲突
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type { ChatMessage } from '../types.js';
import { agentLog as log } from '../../utils/logger.js';
import {
	type Session,
	type SessionMeta,
	type SessionMetadataLine,
	type SessionMessageLine,
	type SessionsIndex,
	type SessionStoreConfig,
	DEFAULT_SESSION_STORE_CONFIG,
} from './types.js';

/** Sessions 目录路径 */
const SESSIONS_DIR = '.obsidian/plugins/deepreader/sessions';

/** 索引文件名 */
const INDEX_FILE = 'index.json';

/**
 * 获取本地时间字符串（YYYY-MM-DD HH:mm:ss 格式）
 */
function getLocalTimestamp(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	const hours = String(now.getHours()).padStart(2, '0');
	const minutes = String(now.getMinutes()).padStart(2, '0');
	const seconds = String(now.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export class SessionStore {
	private app: App;
	private config: Required<SessionStoreConfig>;
	private sessionsDir: string;
	private indexPath: string;

	/** 内存缓存（按最后访问时间排序，用于 LRU 淘汰） */
	private cache: Map<string, { session: Session; lastAccess: number }> = new Map();

	/** 会话锁（Promise 链） */
	private locks: Map<string, Promise<void>> = new Map();

	/** 索引缓存 */
	private indexCache: SessionsIndex | null = null;

	constructor(app: App, config?: SessionStoreConfig) {
		this.app = app;
		this.config = { ...DEFAULT_SESSION_STORE_CONFIG, ...config };
		this.sessionsDir = normalizePath(SESSIONS_DIR);
		this.indexPath = normalizePath(`${SESSIONS_DIR}/${INDEX_FILE}`);
	}

	/**
	 * 确保目录存在
	 */
	private async ensureDir(): Promise<void> {
		const exists = await this.app.vault.adapter.exists(this.sessionsDir);
		if (!exists) {
			await this.app.vault.adapter.mkdir(this.sessionsDir);
			log('[SessionStore] 创建 sessions 目录');
		}
	}

	/**
	 * 获取会话文件路径
	 */
	private getSessionPath(sessionId: string): string {
		return normalizePath(`${SESSIONS_DIR}/${sessionId}.jsonl`);
	}

	// ==================== 创建和保存 ====================

	/**
	 * 创建新会话
	 */
	async create(sessionId: string, indexId: string, isCrossBook?: boolean): Promise<Session> {
		await this.ensureDir();

		const now = Date.now();
		const session: Session = {
			sessionId,
			indexId,
			createdAt: now,
			updatedAt: now,
			messageCount: 0,
			lastConsolidated: 0,
			isCrossBook,
			messages: [],
		};

		// 写入 JSONL 文件（只有元数据行）
		await this.writeSessionFile(session);

		// 更新索引
		await this.addToIndex(session);

		// 加入缓存
		this.cache.set(sessionId, { session, lastAccess: Date.now() });

		log(`[SessionStore] 创建会话: ${sessionId}`);
		return session;
	}

	/**
	 * 保存会话（重写整个文件）
	 */
	async save(session: Session): Promise<void> {
		await this.ensureDir();
		await this.writeSessionFile(session);
		await this.updateIndex(session);
		this.cache.set(session.sessionId, { session, lastAccess: Date.now() });
	}

	/**
	 * 写入会话文件
	 */
	private async writeSessionFile(session: Session): Promise<void> {
		const path = this.getSessionPath(session.sessionId);
		const lines: string[] = [];

		// 第一行：元数据
		const metaLine: SessionMetadataLine = {
			_type: 'metadata',
			sessionId: session.sessionId,
			indexId: session.indexId,
			createdAt: new Date(session.createdAt).toISOString(),
			lastConsolidated: session.lastConsolidated,
			isCrossBook: session.isCrossBook,
		};
		lines.push(JSON.stringify(metaLine));

		// 后续行：消息
		for (const msg of session.messages) {
			const msgLine: SessionMessageLine = {
				role: msg.role as 'user' | 'assistant' | 'tool',
				content: msg.content,
				timestamp: getLocalTimestamp(),
				tool_calls: msg.tool_calls,
				tool_call_id: msg.tool_call_id,
				name: msg.name,
				hidden: msg.hidden,
			};
			lines.push(JSON.stringify(msgLine));
		}

		await this.app.vault.adapter.write(path, lines.join('\n') + '\n');
	}

	// ==================== 索引管理 ====================

	/**
	 * 读取索引文件
	 */
	private async readIndex(): Promise<SessionsIndex> {
		if (this.indexCache) {
			return this.indexCache;
		}

		try {
			const exists = await this.app.vault.adapter.exists(this.indexPath);
			if (!exists) {
				return { sessions: [], version: 1 };
			}

			const content = await this.app.vault.adapter.read(this.indexPath);
			this.indexCache = JSON.parse(content);
			return this.indexCache!;
		} catch (err) {
			log('[SessionStore] 读取索引失败:', err);
			return { sessions: [], version: 1 };
		}
	}

	/**
	 * 写入索引文件
	 */
	private async writeIndex(index: SessionsIndex): Promise<void> {
		await this.ensureDir();
		await this.app.vault.adapter.write(this.indexPath, JSON.stringify(index, null, 2));
		this.indexCache = index;
	}

	/**
	 * 添加会话到索引
	 */
	private async addToIndex(session: Session): Promise<void> {
		const index = await this.readIndex();

		// 检查是否已存在
		const existingIdx = index.sessions.findIndex(s => s.sessionId === session.sessionId);
		const meta = this.sessionToMeta(session);

		if (existingIdx >= 0) {
			index.sessions[existingIdx] = meta;
		} else {
			index.sessions.push(meta);
		}

		// 按更新时间排序（最新的在前）
		index.sessions.sort((a, b) => b.updatedAt - a.updatedAt);

		await this.writeIndex(index);
	}

	/**
	 * 更新索引中的会话
	 */
	private async updateIndex(session: Session): Promise<void> {
		await this.addToIndex(session);
	}

	/**
	 * 从索引移除会话
	 */
	private async removeFromIndex(sessionId: string): Promise<void> {
		const index = await this.readIndex();
		index.sessions = index.sessions.filter(s => s.sessionId !== sessionId);
		await this.writeIndex(index);
	}

	/**
	 * Session 转 SessionMeta
	 */
	private sessionToMeta(session: Session): SessionMeta {
		return {
			sessionId: session.sessionId,
			indexId: session.indexId,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			messageCount: session.messageCount,
			lastConsolidated: session.lastConsolidated,
			isCrossBook: session.isCrossBook,
		};
	}

	// ==================== 消息追加 ====================

	/**
	 * 追加消息到会话（高效追加写入）
	 */
	async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
		await this.ensureDir();

		// 获取会话（优先从缓存）
		const cached = this.cache.get(sessionId);
		let session: Session | undefined = cached?.session;
		if (!session) {
			session = await this.get(sessionId) ?? undefined;
			if (!session) {
				throw new Error(`Session not found: ${sessionId}`);
			}
		}

		// 更新内存中的会话
		session.messages.push(message);
		session.messageCount++;
		session.updatedAt = Date.now();

		// 追加到文件（只追加一行）
		const path = this.getSessionPath(sessionId);
		const msgLine: SessionMessageLine = {
			role: message.role as 'user' | 'assistant' | 'tool',
			content: message.content,
			timestamp: getLocalTimestamp(),
			tool_calls: message.tool_calls,
			tool_call_id: message.tool_call_id,
			name: message.name,
			hidden: message.hidden,
		};

		// 检查文件是否存在
		const exists = await this.app.vault.adapter.exists(path);
		if (!exists) {
			// 文件不存在，创建完整文件
			await this.writeSessionFile(session);
		} else {
			// 追加一行
			const line = JSON.stringify(msgLine) + '\n';
			const existing = await this.app.vault.adapter.read(path);
			await this.app.vault.adapter.write(path, existing + line);
		}

		// 更新索引
		await this.updateIndex(session);

		// 更新缓存
		this.cache.set(sessionId, { session, lastAccess: Date.now() });
	}

	/**
	 * 批量追加消息
	 */
	async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
		for (const msg of messages) {
			await this.appendMessage(sessionId, msg);
		}
	}

	// ==================== 会话加载 ====================

	/**
	 * 获取会话（懒加载）
	 */
	async get(sessionId: string): Promise<Session | null> {
		// 优先从缓存读取
		const cached = this.cache.get(sessionId);
		if (cached) {
			cached.lastAccess = Date.now();  // 更新访问时间
			return cached.session;
		}

		// 从文件加载
		const path = this.getSessionPath(sessionId);
		const exists = await this.app.vault.adapter.exists(path);
		if (!exists) {
			return null;
		}

		try {
			const content = await this.app.vault.adapter.read(path);
			const lines = content.trim().split('\n');

			if (lines.length === 0) {
				return null;
			}

			// 第一行是元数据
			const metaLine = JSON.parse(lines[0]) as SessionMetadataLine;

			// 后续行是消息
			const messages: ChatMessage[] = [];
			for (let i = 1; i < lines.length; i++) {
				if (!lines[i].trim()) continue;
				try {
					const msgLine = JSON.parse(lines[i]) as SessionMessageLine;
					messages.push({
						role: msgLine.role,
						content: msgLine.content,
						tool_calls: msgLine.tool_calls,
						tool_call_id: msgLine.tool_call_id,
						name: msgLine.name,
						hidden: msgLine.hidden,
						timestamp: msgLine.timestamp,
					});
				} catch (e) {
					log(`[SessionStore] 解析消息行失败: ${i}`, e);
				}
			}

			const session: Session = {
				sessionId: metaLine.sessionId,
				indexId: metaLine.indexId,
				createdAt: new Date(metaLine.createdAt).getTime(),
				updatedAt: Date.now(),
				messageCount: messages.length,
				lastConsolidated: metaLine.lastConsolidated,
				isCrossBook: metaLine.isCrossBook,
				messages,
			};

			// 加入缓存
			this.cache.set(sessionId, { session, lastAccess: Date.now() });

			// 限制缓存大小（LRU 淘汰）
			if (this.cache.size > this.config.maxCacheSize) {
				// 找到最久未访问的条目
				let oldestKey: string | null = null;
				let oldestTime = Infinity;
				for (const [key, value] of this.cache) {
					if (value.lastAccess < oldestTime) {
						oldestTime = value.lastAccess;
						oldestKey = key;
					}
				}
				if (oldestKey) {
					this.cache.delete(oldestKey);
					log(`[SessionStore] LRU 淘汰缓存: ${oldestKey}`);
				}
			}

			return session;
		} catch (err) {
			log(`[SessionStore] 加载会话失败: ${sessionId}`, err);
			return null;
		}
	}

	/**
	 * 获取会话的全部消息（UI 用）
	 */
	async getMessages(sessionId: string): Promise<ChatMessage[]> {
		const session = await this.get(sessionId);
		return session?.messages || [];
	}

	/**
	 * 获取会话的 LLM 历史格式（unconsolidated + 对齐）
	 */
	async getLLMHistory(sessionId: string): Promise<ChatMessage[]> {
		const session = await this.get(sessionId);
		if (!session) {
			return [];
		}

		// 1. 只加载未整合的消息
		const unconsolidated = session.messages.slice(session.lastConsolidated);

		// 2. 限制最大消息数
		const trimmed = unconsolidated.slice(-this.config.maxLLMMessages);

		// 3. 对齐到用户消息边界（避免 orphaned tool_result）
		const alignedStart = trimmed.findIndex(m => m.role === 'user');
		const aligned = alignedStart >= 0 ? trimmed.slice(alignedStart) : trimmed;

		return aligned;
	}

	// ==================== 会话查找 ====================

	/**
	 * 根据书籍 indexId 查找最近的会话
	 */
	async findSessionByIndexId(indexId: string): Promise<SessionMeta | null> {
		const index = await this.readIndex();
		return index.sessions.find(s => s.indexId === indexId) || null;
	}

	/**
	 * 获取跨书籍模式的最近会话
	 */
	async getCrossBookSession(): Promise<SessionMeta | null> {
		const index = await this.readIndex();
		return index.sessions.find(s => s.isCrossBook) || null;
	}

	/**
	 * 列出所有会话
	 */
	async listSessions(): Promise<SessionMeta[]> {
		const index = await this.readIndex();
		return index.sessions;
	}

	/**
	 * 删除会话
	 */
	async delete(sessionId: string): Promise<void> {
		// 删除文件
		const path = this.getSessionPath(sessionId);
		const exists = await this.app.vault.adapter.exists(path);
		if (exists) {
			await this.app.vault.adapter.remove(path);
		}

		// 从索引移除
		await this.removeFromIndex(sessionId);

		// 从缓存移除
		this.cache.delete(sessionId);

		log(`[SessionStore] 删除会话: ${sessionId}`);
	}

	// ==================== 并发控制 ====================

	/**
	 * 获取会话锁（用于防止并发整合）
	 * 使用队列模式确保请求按顺序执行
	 */
	async acquireLock(sessionId: string): Promise<void> {
		const existing = this.locks.get(sessionId);

		// 创建新锁
		let releaseLock: () => void;
		const lockPromise = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});

		// 存储释放函数
		(lockPromise as any).release = releaseLock!;

		if (existing) {
			// 等待现有锁释放后，再设置新锁
			await existing.finally(() => {
				this.locks.set(sessionId, lockPromise);
			});
		} else {
			this.locks.set(sessionId, lockPromise);
		}
	}

	/**
	 * 释放会话锁
	 */
	releaseLock(sessionId: string): void {
		const lock = this.locks.get(sessionId);
		if (lock && (lock as any).release) {
			(lock as any).release();
		}
		this.locks.delete(sessionId);
	}

	/**
	 * 更新 lastConsolidated（整合完成后调用）
	 */
	async updateLastConsolidated(sessionId: string, index: number): Promise<void> {
		const session = await this.get(sessionId);
		if (!session) {
			return;
		}

		session.lastConsolidated = index;

		// 只更新元数据行（第一行）
		const path = this.getSessionPath(sessionId);
		const content = await this.app.vault.adapter.read(path);
		const lines = content.split('\n');

		if (lines.length > 0) {
			const metaLine = JSON.parse(lines[0]) as SessionMetadataLine;
			metaLine.lastConsolidated = index;
			lines[0] = JSON.stringify(metaLine);
			await this.app.vault.adapter.write(path, lines.join('\n'));
		}

		// 更新缓存
		this.cache.set(sessionId, { session, lastAccess: Date.now() });

		// 更新索引
		await this.updateIndex(session);

		log(`[SessionStore] 更新 lastConsolidated: ${sessionId} -> ${index}`);
	}

	/**
	 * 清除索引缓存（用于强制刷新）
	 */
	clearIndexCache(): void {
		this.indexCache = null;
	}
}
