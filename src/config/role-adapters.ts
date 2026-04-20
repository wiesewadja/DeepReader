/**
 * 角色配置适配器
 *
 * 将新的 resolveRoleConfig() 返回值转换为底层 PageIndex 模块所需的旧格式。
 * 这是迁移期间的桥接层，Chunk 完成后底层也会统一到新 ProviderType。
 */

import type { ProviderType } from './providers';
import type { EmbeddingOptions } from '../pageindex/vault/types';
import type { BookIndexOptions } from '../pageindex/book-types';

/** resolveRoleConfig() 的返回值类型 */
interface ResolvedConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: string;
	embeddingBatchSize?: number;
	disableThinking?: boolean;
}

/**
 * 将 resolveRoleConfig('embedding') 结果转换为 EmbeddingOptions
 *
 * 新的 ProviderType 全部兼容 OpenAI API 格式，
 * 底层只需要知道用 openai 格式调用即可。
 */
export function toEmbeddingOptions(resolved: ResolvedConfig): EmbeddingOptions {
	return {
		provider: 'openai',  // 所有新 ProviderType 都兼容 OpenAI API
		model: resolved.model,
		apiKey: resolved.apiKey,
		baseUrl: resolved.baseUrl,
		batchSize: resolved.embeddingBatchSize,
	};
}

/**
 * 构建 proposition 索引所需的 LLM 配置
 */
export function toPropositionConfig(
	resolved: ResolvedConfig,
	cardsPer500Words: number,
): NonNullable<BookIndexOptions['propositions']> {
	return {
		enabled: true,
		model: resolved.model,
		apiKey: resolved.apiKey,
		baseUrl: resolved.baseUrl,
		cardsPer500Words,
	};
}

/**
 * 构建 reranker 配置
 */
export function toRerankerOptions(
	resolved: ResolvedConfig,
	rerankerWeight: number,
): { provider: 'openai'; model: string; apiKey: string; baseUrl: string; weight: number } {
	return {
		provider: 'openai',
		model: resolved.model,
		apiKey: resolved.apiKey,
		baseUrl: resolved.baseUrl,
		weight: rerankerWeight,
	};
}
