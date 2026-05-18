/**
 * 旧版配置一次性迁移模块
 *
 * 检测旧版字段是否存在，若存在则执行迁移并删除旧字段。
 * 迁移是幂等的：对已迁移的数据再次执行不会改变结果。
 */

import type { DeepPDFSettings } from './settings';
import type { ProviderType } from './providers';
import { PROVIDER_CONFIGS } from './providers';
import type { AIRoleConfig, AIProviderAccount } from './ai-roles';
import { DEFAULT_SETTINGS } from './settings';

/** 需要检测的旧版字段名列表 */
const LEGACY_FIELDS = [
	'deepseekApiKey', 'kimiApiKey', 'openaiApiKey', 'customApiKey',
	'apiUrl', 'llmProvider', 'llmModel',
	'fastModelEnabled', 'fastModelProvider', 'fastModelName', 'fastModelApiUrl',
	'embedding', 'reranker', 'propositions',
];

/**
 * 检测是否需要迁移（检查原始加载数据，而非合并后的 settings）
 */
export function needsMigration(rawData: Record<string, unknown>): boolean {
	return LEGACY_FIELDS.some(f => f in rawData);
}

/**
 * 执行一次性迁移，返回新版 DeepPDFSettings
 * 迁移完成后旧字段从返回对象中删除
 */
export function migrateSettings(
	rawData: Record<string, unknown>,
	defaults: DeepPDFSettings,
): DeepPDFSettings {
	// 以默认值为基础，用 rawData 覆盖
	const result: DeepPDFSettings = Object.assign({}, defaults, rawData);

	// 1. 迁移 API Keys → providers
	const apiKeyMap: Record<string, ProviderType> = {
		deepseekApiKey: 'deepseek',
		kimiApiKey: 'kimi',

		openaiApiKey: 'openai',
		customApiKey: 'custom',
	};

	if (!result.providers) {
		result.providers = { ...defaults.providers };
	}

	for (const [field, provider] of Object.entries(apiKeyMap)) {
		const key = (rawData as Record<string, unknown>)[field] as string | undefined;
		if (key) {
			result.providers[provider] = {
				...result.providers[provider],
				apiKey: key,
			};
		}
	}

	// 2. 迁移 apiUrl → providers.custom.baseUrl
	const apiUrl = (rawData as Record<string, unknown>).apiUrl as string | undefined;
	if (apiUrl) {
		const existing = (result.providers as Record<string, unknown>)['custom'] as { apiKey?: string; baseUrl?: string } | undefined;
		(result.providers as Record<string, unknown>)['custom'] = {
			apiKey: existing?.apiKey || '',
			baseUrl: apiUrl,
			name: '自定义 (迁移)',
		};
	}

	// 3. 初始化 roles（如果不存在）
	if (!result.roles) {
		result.roles = { ...defaults.roles };
	}

	// 4. 迁移 chat 角色：llmProvider + llmModel
	const llmProvider = (rawData as Record<string, unknown>).llmProvider as ProviderType | undefined;
	const llmModel = (rawData as Record<string, unknown>).llmModel as string | undefined;

	if (llmProvider) {
		const provider = normalizeOldProvider(llmProvider);
		result.roles.chat = {
			provider,
			model: llmModel || PROVIDER_CONFIGS[provider]?.defaultModel || 'deepseek-chat',
		};
	}

	// 5. 迁移 router 角色：fastModelProvider + fastModelName
	const fastProvider = (rawData as Record<string, unknown>).fastModelProvider as ProviderType | undefined;
	const fastName = (rawData as Record<string, unknown>).fastModelName as string | undefined;
	const fastApiUrl = (rawData as Record<string, unknown>).fastModelApiUrl as string | undefined;

	if (fastProvider) {
		const provider = normalizeOldProvider(fastProvider);
		result.roles.router = {
			provider,
			model: fastName || PROVIDER_CONFIGS[provider]?.defaultModel || 'deepseek-chat',
			baseUrlOverride: fastApiUrl || undefined,
		};
	}

	// 6. pageindex 继承 chat 配置
	result.roles.pageindex = { ...result.roles.chat };

	// 7. 迁移 proposition 角色
	const propositions = (rawData as Record<string, unknown>).propositions as {
		enabled?: boolean;
		model?: string;
		apiKey?: string;
		baseUrl?: string;
		cardsPer500Words?: number;
	} | undefined;

	if (propositions) {
		const cardsPer500Words = propositions.cardsPer500Words ?? 1;
		result.propositionCardsPer500Words = cardsPer500Words;

		if (propositions.enabled !== false) {
			const provider = inferProviderFromBaseUrl(propositions.baseUrl);
			const propApiKey = propositions.apiKey;

			if (provider !== 'custom' || propApiKey) {
				// 将 proposition 的 apiKey 同步到对应服务商
				if (propApiKey && provider !== 'custom') {
					result.providers[provider] = {
						...result.providers[provider],
						apiKey: result.providers[provider]?.apiKey || propApiKey,
					};
				} else if (propApiKey && provider === 'custom') {
					result.providers.custom = {
						...result.providers.custom,
						apiKey: result.providers.custom?.apiKey || propApiKey,
						baseUrl: propositions.baseUrl || result.providers.custom?.baseUrl || '',
					};
				}

				result.roles.proposition = {
					provider,
					model: propositions.model || 'Qwen/Qwen3-8B',
				};
			} else {
				result.roles.proposition = null;
			}
		} else {
			result.roles.proposition = null;
		}
	}

	// 8. 迁移 embedding 角色
	const embedding = (rawData as Record<string, unknown>).embedding as {
		provider?: string;
		model?: string;
		apiKey?: string;
		baseUrl?: string;
		dimensions?: number;
	} | undefined;

	if (embedding) {
		const oldProvider = embedding.provider || 'openai';

		if (oldProvider === 'local') {
			result.roles.embedding = null;
		} else {
			const newProvider = mapEmbeddingProvider(oldProvider);
			const needsApiKey = newProvider !== 'custom';

			// 检查对应服务商是否有有效 Key
			const hasValidKey = needsApiKey
				? !!(result.providers[newProvider]?.apiKey)
				: !!embedding.apiKey;

			if (hasValidKey || embedding.apiKey) {
				// 同步 embedding 的 apiKey 到对应服务商
				if (embedding.apiKey) {
					if (newProvider === 'custom') {
						result.providers.custom = {
							...result.providers.custom,
							apiKey: result.providers.custom?.apiKey || embedding.apiKey,
							baseUrl: embedding.baseUrl || result.providers.custom?.baseUrl || '',
						};
					} else {
						result.providers[newProvider] = {
							...result.providers[newProvider],
							apiKey: result.providers[newProvider]?.apiKey || embedding.apiKey,
						};
					}
				}

				result.roles.embedding = {
					provider: newProvider,
					model: embedding.model || '',
				};
			} else {
				// Key 无效，降级为 null
				result.roles.embedding = null;
			}
		}
	}

	// 9. 迁移 reranker 角色
	const reranker = (rawData as Record<string, unknown>).reranker as {
		enabled?: boolean;
		provider?: string;
		model?: string;
		apiKey?: string;
		baseUrl?: string;
		weight?: number;
	} | undefined;

	if (reranker) {
		result.rerankerWeight = reranker.weight ?? 0.7;

		if (reranker.enabled !== false && reranker.provider) {
			const newProvider = mapRerankerProvider(reranker.provider);

			if (reranker.apiKey) {
				if (newProvider === 'custom') {
					result.providers.custom = {
						...result.providers.custom,
						apiKey: result.providers.custom?.apiKey || reranker.apiKey,
						baseUrl: reranker.baseUrl || result.providers.custom?.baseUrl || '',
					};
				} else {
					result.providers[newProvider] = {
						...result.providers[newProvider],
						apiKey: result.providers[newProvider]?.apiKey || reranker.apiKey,
					};
				}
			}

			const hasValidKey = !!(result.providers[newProvider]?.apiKey);
			if (hasValidKey) {
				result.roles.reranker = {
					provider: newProvider,
					model: reranker.model || '',
				};
			} else {
				result.roles.reranker = null;
			}
		} else {
			result.roles.reranker = null;
		}
	}

	// 10. 删除所有旧字段
	for (const field of LEGACY_FIELDS) {
		delete (result as unknown as Record<string, unknown>)[field];
	}

	return result;
}

// ═══════════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════════

/** 旧版 ProviderType（5 种）→ 新版（7 种） */
function normalizeOldProvider(p: string): ProviderType {
	if (p === 'google') return 'custom';
	if (p in PROVIDER_CONFIGS) return p as ProviderType;
	return 'deepseek';
}

/** 旧版 embedding provider 枚举 → 新版 ProviderType */
function mapEmbeddingProvider(old: string): ProviderType {
	switch (old) {
		case 'openai': return 'openai';
		case 'ollama':
		case 'lmstudio': return 'custom';
		default: return 'custom';
	}
}

/** 旧版 reranker provider 枚举 → 新版 ProviderType */
function mapRerankerProvider(old: string): ProviderType {
	switch (old) {
		case 'openai': return 'openai';
		case 'lmstudio':
		case 'ollama': return 'custom';
		default: return 'custom';
	}
}

/** 从 baseUrl 推断服务商 */
function inferProviderFromBaseUrl(baseUrl: string | undefined): ProviderType {
	if (!baseUrl) return 'custom';
	if (baseUrl.includes('api.siliconflow.cn')) return 'siliconflow';
	if (baseUrl.includes('api.deepseek.com')) return 'deepseek';
	if (baseUrl.includes('api.openai.com')) return 'openai';

	if (baseUrl.includes('api.moonshot.cn')) return 'kimi';
	return 'custom';
}
