/**
 * 常见 embedding 模型的 dimensions 映射表
 *
 * 旧版 EmbeddingSettings 有 dimensions 字段，重构后移除该字段，
 * 改为根据模型名自动推断。未知模型返回 undefined，调用方降级为不指定 dimensions。
 */

export const EMBEDDING_DIMENSIONS: Record<string, number> = {
	// OpenAI
	'text-embedding-3-small': 1536,
	'text-embedding-3-large': 3072,
	'text-embedding-ada-002': 1536,
	// 智谱
	'embedding-3': 2048,
	'text-embedding-v3': 1024,
	// 硅基流动 / BAAI
	'bge-m3': 1024,
	'BAAI/bge-m3': 1024,
	// MiniMax
	'embo-01': 1536,
};

/**
 * 根据 embedding 模型名推断向量维度
 * @returns 维度数；未知模型返回 undefined
 */
export function inferEmbeddingDimensions(model: string): number | undefined {
	if (!model) return undefined;
	// 先精确匹配，再尝试去掉前缀匹配
	return EMBEDDING_DIMENSIONS[model] ?? EMBEDDING_DIMENSIONS[model.split('/').pop() ?? ''];
}
