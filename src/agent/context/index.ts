/**
 * Context 模块导出
 *
 * 提供上下文构建和管理的公共 API
 */

// ContextBuilder
export { ContextBuilder } from './builder.js';
export type {
	ContextBuilderConfig,
	DocumentMetadata,
	IContextBuilder,
} from './builder.js';

// ContextLoader（保持兼容）
export { ContextLoader } from './loader.js';
export type { UserContext } from './loader.js';
