/**
 * Session Storage 模块
 *
 * JSONL 文件会话存储，支持：
 * - 追加写入：只追加新消息，不重写整个文件
 * - 懒加载：按需加载会话，活跃会话缓存
 * - 会话锁：防止并发整合冲突
 */

export { SessionStore } from './store.js';
export type {
	Session,
	SessionMeta,
	SessionMetadataLine,
	SessionMessageLine,
	SessionsIndex,
	SessionStoreConfig,
} from './types.js';
export { DEFAULT_SESSION_STORE_CONFIG } from './types.js';
