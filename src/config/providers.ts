/**
 * AI 服务商配置
 * 定义各服务商的 Base URL、默认模型、能力矩阵和辅助函数
 */

import type { DeepPDFSettings } from './settings';
import type { RoleType } from './ai-roles';
import { ROLE_CAPABILITY } from './ai-roles';

export type ProviderType = 'deepseek' | 'kimi' | 'zhipu' | 'minimax' | 'siliconflow' | 'openai' | 'custom';

/** 服务商能力矩阵 */
export interface ProviderCapabilities {
	chat: boolean;
	embedding: boolean;
	reranker: boolean;
}

export interface ProviderConfig {
	baseUrl: string;
	defaultModel: string;
	/** @deprecated 仅迁移模块内部使用，迁移完成后删除 */
	legacyApiKeyField?: keyof DeepPDFSettings;
	website?: string;
	supportsModelList?: boolean;         // false = minimax/custom，展示文本输入
	capabilities: ProviderCapabilities;
}

/**
 * 各服务商的预设配置
 */
export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
	deepseek: {
		baseUrl: 'https://api.deepseek.com',
		defaultModel: 'deepseek-chat',
		legacyApiKeyField: 'deepseekApiKey',
		supportsModelList: true,
		capabilities: { chat: true, embedding: false, reranker: false },
	},
	kimi: {
		baseUrl: 'https://api.moonshot.cn/v1',
		defaultModel: 'kimi-k2.5',
		legacyApiKeyField: 'kimiApiKey',
		supportsModelList: true,
		capabilities: { chat: true, embedding: false, reranker: false },
	},
	zhipu: {
		baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
		defaultModel: 'glm-4-flash',
		legacyApiKeyField: 'zhipuApiKey',
		supportsModelList: true,
		capabilities: { chat: true, embedding: true, reranker: false },
	},
	minimax: {
		baseUrl: 'https://api.minimax.chat/v1',
		defaultModel: 'MiniMax-Text-01',
		supportsModelList: false,
		capabilities: { chat: true, embedding: true, reranker: false },
	},
	siliconflow: {
		baseUrl: 'https://api.siliconflow.cn/v1',
		defaultModel: 'Qwen/Qwen3-8B',
		supportsModelList: true,
		capabilities: { chat: true, embedding: true, reranker: true },
	},
	openai: {
		baseUrl: 'https://api.openai.com/v1',
		defaultModel: 'gpt-4o',
		legacyApiKeyField: 'openaiApiKey',
		supportsModelList: true,
		capabilities: { chat: true, embedding: true, reranker: true },
	},
	custom: {
		baseUrl: '', // 使用用户输入的 baseUrl
		defaultModel: '',
		legacyApiKeyField: 'customApiKey',
		supportsModelList: false,
		capabilities: { chat: true, embedding: true, reranker: true },
	},
};

/**
 * 解析某角色的运行时配置，供各功能模块调用
 *
 * 支持固定服务商（ProviderType）和自定义服务商（string ID）。
 * @returns 配置对象；以下情况返回 null：
 *   - 角色为 null（可选角色未配置）
 *   - 服务商账号不存在（数据损坏）
 *   - apiKey 为空字符串（服务商未填写 Key）
 */
export function resolveRoleConfig(
	role: RoleType,
	settings: DeepPDFSettings,
): { apiKey: string; baseUrl: string; model: string; provider: string; embeddingBatchSize?: number } | null {
	const roleConfig = (settings.roles as unknown as Record<string, unknown>)?.[role];
	if (!roleConfig || typeof roleConfig !== 'object') return null;

	const { provider, model, baseUrlOverride, embeddingBatchSize } = roleConfig as {
		provider: string;
		model: string;
		baseUrlOverride?: string;
		embeddingBatchSize?: number;
	};

	const account = (settings.providers as Record<string, unknown>)?.[provider];
	if (!account || typeof account !== 'object') return null;

	const apiKey = (account as { apiKey?: string }).apiKey || '';
	if (!apiKey) return null; // 未填写 Key

	// 固定服务商有预设 baseUrl 和 defaultModel，自定义服务商从 account 取
	const builtInConfig = PROVIDER_CONFIGS[provider as ProviderType];
	const baseUrl =
		baseUrlOverride ||
		(account as { baseUrl?: string }).baseUrl ||
		(builtInConfig?.baseUrl || '');

	const resolvedModel = model || builtInConfig?.defaultModel || '';

	return { apiKey, baseUrl, model: resolvedModel, provider, embeddingBatchSize };
}

/**
 * 获取某角色可用的服务商列表（已配置非空 Key 且具备所需能力）
 *
 * 同时返回固定服务商和自定义服务商（自定义服务商视为具备所有能力）。
 */
export function getAvailableProvidersForRole(
	role: RoleType,
	settings: DeepPDFSettings,
): string[] {
	const required = ROLE_CAPABILITY[role];
	const providers = settings.providers;
	if (!providers) return [];

	const result: string[] = [];

	for (const id of Object.keys(providers)) {
		const account = (providers as Record<string, unknown>)[id];
		if (!account || typeof account !== 'object') continue;
		if (!(account as { apiKey?: string }).apiKey) continue;

		// 固定服务商：检查能力矩阵
		const builtInConfig = PROVIDER_CONFIGS[id as ProviderType];
		if (builtInConfig) {
			if (!builtInConfig.capabilities[required]) continue;
		}
		// 自定义服务商：视为具备所有能力

		result.push(id);
	}

	return result;
}

/**
 * 获取服务商的显示名称
 */
export function getProviderName(id: string, settings: DeepPDFSettings): string {
	if (PROVIDER_LABELS[id as ProviderType]) return PROVIDER_LABELS[id as ProviderType];
	const account = (settings.providers as Record<string, unknown>)?.[id];
	if (account && typeof account === 'object') {
		return (account as { name?: string }).name || id;
	}
	return id;
}

/**
 * 获取服务商的 baseUrl（固定服务商返回预设值，自定义服务商从 account 取）
 */
export function getProviderBaseUrl(id: string, settings: DeepPDFSettings): string {
	const builtInConfig = PROVIDER_CONFIGS[id as ProviderType];
	if (builtInConfig) return builtInConfig.baseUrl;
	const account = (settings.providers as Record<string, unknown>)?.[id];
	if (account && typeof account === 'object') {
		return (account as { baseUrl?: string }).baseUrl || '';
	}
	return '';
}

// ═══════════════════════════════════════════════════════════════
// 旧版兼容函数（迁移期间保留，Chunk 3 后删除）
// ═══════════════════════════════════════════════════════════════

/**
 * 获取服务商的默认模型
 */
export function getProviderDefaultModel(provider: ProviderType): string {
	return PROVIDER_CONFIGS[provider]?.defaultModel || 'deepseek-chat';
}

/**
 * 获取当前服务商的配置信息
 * @deprecated 迁移完成后删除，改用 resolveRoleConfig
 */
export function getProviderConfig(
	settings: Pick<DeepPDFSettings, 'llmProvider' | 'apiUrl'>
): ProviderConfig & { provider: ProviderType } {
	let provider = settings.llmProvider as ProviderType;

	// 向后兼容：将旧的 google 映射到 custom
	if ((provider as string) === 'google') {
		provider = 'custom';
	}

	// 映射当前 5 种到新的 7 种
	if (provider === 'minimax' || provider === 'siliconflow') {
		provider = 'deepseek'; // 旧版不可能直接用这两种做 LLM
	}

	const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.deepseek;

	return {
		...config,
		provider,
		baseUrl: provider === 'custom' ? (settings.apiUrl || '') : config.baseUrl,
	};
}

/**
 * 服务商显示名称映射
 */
export const PROVIDER_LABELS: Record<ProviderType, string> = {
	deepseek: 'DeepSeek',
	kimi: 'Kimi (Moonshot)',
	zhipu: '智谱 (GLM)',
	minimax: 'MiniMax',
	siliconflow: '硅基流动 (SiliconFlow)',
	openai: 'OpenAI',
	custom: '自定义',
};
