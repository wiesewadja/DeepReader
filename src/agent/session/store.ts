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
	type ISessionStore,
	DEFAULT_SESSION_STORE_CONFIG,
} from './types.js';

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

export class SessionStore implements ISessionStore {
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

	constructor(app: App, config?: SessionStoreConfig, pluginId: string = 'deepreader') {
		this.app = app;
		this.config = { ...DEFAULT_SESSION_STORE_CONFIG, ...config };
		const base = `.obsidian/plugins/${pluginId}/sessions`;
		this.sessionsDir = normalizePath(base);
		this.indexPath = normalizePath(`${base}/${INDEX_FILE}`);
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
		return normalizePath(`${this.sessionsDir}/${sessionId}.jsonl`);
	}

	/**
	 * 获取语音文件目录路径（与会话文件同级）
	 */
	private getVoiceDir(sessionId: string): string {
		return normalizePath(`${this.sessionsDir}/voice/${sessionId}`);
	}

	/**
	 * 获取语音文件路径
	 */
	private getVoicePath(sessionId: string, messageId: string): string {
		return normalizePath(`${this.getVoiceDir(sessionId)}/${messageId}.wav`);
	}

	/**
	 * 保存语音音频文件
	 * @returns 相对于 SESSIONS_DIR 的路径
	 */
	async saveVoiceAudio(sessionId: string, messageId: string, audioBuffer: ArrayBuffer): Promise<string> {
		const voiceDir = this.getVoiceDir(sessionId);

		// 确保语音目录存在
		const dirExists = await this.app.vault.adapter.exists(voiceDir);
		if (!dirExists) {
			await this.app.vault.adapter.mkdir(voiceDir);
		}

		// 将 ArrayBuffer 转换为 Uint8Array 后写入文件
		const uint8Array = new Uint8Array(audioBuffer);
		const voicePath = this.getVoicePath(sessionId, messageId);
		await this.app.vault.adapter.writeBinary(voicePath, uint8Array.buffer);

		// 返回相对路径（相对于 SESSIONS_DIR）
		const relativePath = `voice/${sessionId}/${messageId}.wav`;
		log(`[SessionStore] 保存语音文件: ${relativePath}`);
		return relativePath;
	}

	/**
	 * 加载语音音频文件
	 */
	async loadVoiceAudio(sessionId: string, relativePath: string): Promise<ArrayBuffer | null> {
		try {
			const fullPath = normalizePath(`${this.sessionsDir}/${relativePath}`);
			const exists = await this.app.vault.adapter.exists(fullPath);
			if (!exists) {
				log(`[SessionStore] 语音文件不存在: ${relativePath}`);
				return null;
			}

			const buffer = await this.app.vault.adapter.readBinary(fullPath);
			log(`[SessionStore] 加载语音文件: ${relativePath}`);
			return buffer;
		} catch (err) {
			log(`[SessionStore] 加载语音文件失败: ${relativePath}`, err);
			return null;
		}
	}


	/**
	 * 按预定路径保存语音文件（占位路径已写入 JSONL，音频异步到达后调用）
	 */
	async saveVoiceToPlaceholder(sessionId: string, messageId: string, audioBuffer: ArrayBuffer): Promise<void> {
		const voiceDir = this.getVoiceDir(sessionId);
		const dirExists = await this.app.vault.adapter.exists(voiceDir);
		if (!dirExists) {
			await this.app.vault.adapter.mkdir(voiceDir);
		}
		const uint8Array = new Uint8Array(audioBuffer);
		const voicePath = this.getVoicePath(sessionId, messageId);
		await this.app.vault.adapter.writeBinary(voicePath, uint8Array.buffer);
		log(`[SessionStore] 语音文件异步落盘: voice/${sessionId}/${messageId}.wav`);
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

		// 处理语音数据持久化：占位路径 + 异步落盘
		let voiceAudioPath: string | undefined;
		const voiceData = message as any;
		const messageId = voiceData.id || `msg_${Date.now()}`;
		const predictablePath = `voice/${sessionId}/${messageId}.wav`;

		if (voiceData.voiceAudio && voiceData.voiceAudio instanceof ArrayBuffer) {
			// 音频已就绪：直接写入文件
			voiceAudioPath = await this.saveVoiceAudio(sessionId, messageId, voiceData.voiceAudio);
		} else if (voiceData.enableVoiceReply && message.role === 'assistant') {
			// 音频尚未就绪：先写入占位路径，文件后续异步写入
			voiceAudioPath = predictablePath;
		}

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
			// 语音字段
			voiceAudioPath,
			voiceDuration: voiceData.voiceDuration,
			letterState: voiceData.letterState,
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
					const msg: ChatMessage = {
						role: msgLine.role,
						content: msgLine.content,
						tool_calls: msgLine.tool_calls,
						tool_call_id: msgLine.tool_call_id,
						name: msgLine.name,
						hidden: msgLine.hidden,
						timestamp: msgLine.timestamp,
					};

					// 恢复语音数据
					if (msgLine.voiceAudioPath) {
						const audioBuffer = await this.loadVoiceAudio(sessionId, msgLine.voiceAudioPath);
						if (audioBuffer) {
							(msg as any).voiceAudio = audioBuffer;
							(msg as any).voiceDuration = msgLine.voiceDuration;
							(msg as any).letterState = msgLine.letterState;
							(msg as any).voiceState = 'ready';  // 从文件加载后状态为 ready
						}
					}

					messages.push(msg);
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
	 * 会自动剥离用户消息中的 system_note 和运行时上下文（这些是动态生成的，不应持久化）
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

		// 4. 剥离用户消息中的 system_note 和运行时上下文（每次动态生成）
		const SYSTEM_NOTE_PATTERN = /<system_note>[\s\S]*?<\/system_note>\n\n/g;
		const RUNTIME_CONTEXT_PATTERN = /^\[运行时上下文[^\]]*\]\n[^\n]*(?:\n[^\n]*)*\n\n/;

		return aligned.map(m => {
			if (m.role === 'user' && typeof m.content === 'string') {
				let content = m.content;
				// 剥离 system_note（可能有多个）
				content = content.replace(SYSTEM_NOTE_PATTERN, '');
				// 剥离运行时上下文
				content = content.replace(RUNTIME_CONTEXT_PATTERN, '');
				return { ...m, content };
			}
			return m;
		});
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

	/**
	 * 删除指定消息（重写整个文件）
	 * @param sessionId 会话 ID
	 * @param messageIndices 要删除的消息索引数组（在 session.messages 中的索引）
	 */
	async deleteMessages(sessionId: string, messageIndices: number[]): Promise<void> {
		const session = await this.get(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		if (messageIndices.length === 0) {
			return;
		}

		// 按索引降序排序，从后往前删除（避免索引偏移问题）
		const sortedIndices = [...messageIndices].sort((a, b) => b - a);

		// 删除消息
		for (const index of sortedIndices) {
			if (index >= 0 && index < session.messages.length) {
				session.messages.splice(index, 1);
			}
		}

		// 更新元数据
		session.messageCount = session.messages.length;
		session.updatedAt = Date.now();

		// 如果 lastConsolidated 指向已删除的消息，需要调整
		if (session.lastConsolidated > session.messages.length) {
			session.lastConsolidated = session.messages.length;
		}

		// 重写整个文件
		await this.save(session);

		log(`[SessionStore] 删除了 ${messageIndices.length} 条消息: ${sessionId}`);
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
