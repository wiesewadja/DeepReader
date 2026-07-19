/**
 * AI 服务商配置
 * 定义各服务商的 Base URL、默认模型、能力矩阵和辅助函数
 */

import type { DeepPDFSettings } from './settings';
import type { RoleType , ProviderType } from './types.js';
export type { ProviderType } from './types.js';
import { ROLE_CAPABILITY } from './ai-roles';
import { getPresetById, buildRolesFromPreset, getAllAdditionalProviders } from './presets';

/** 服务商能力矩阵 */
export interface ProviderCapabilities {
	chat: boolean;
	embedding: boolean;
	reranker: boolean;
	tts?: boolean;
	imagegen?: boolean;
}

export interface ProviderConfig {
	baseUrl: string;
	defaultModel: string;
	/** 用于连接测试的模型（当 defaultModel 不支持 /chat/completions 时） */
	chatTestModel?: string;
	website?: string;
	supportsModelList?: boolean;         // false = custom，展示文本输入
	capabilities: ProviderCapabilities;
}

/**
 * 各服务商的预设配置
 */
export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
	minimax: {
		baseUrl: 'https://api.minimaxi.com/v1',
		defaultModel: 'MiniMax-M2.7',
		supportsModelList: true,
		capabilities: { chat: true, embedding: true, reranker: false, tts: false, imagegen: true },
	},
	deepseek: {
		baseUrl: 'https://api.deepseek.com',
		defaultModel: 'deepseek-v4-flash',
		supportsModelList: true,
		capabilities: { chat: true, embedding: false, reranker: false },
	},
	kimi: {
		baseUrl: 'https://api.moonshot.cn/v1',
		defaultModel: 'kimi-k2.5',
		supportsModelList: true,
		capabilities: { chat: true, embedding: false, reranker: false },
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
		supportsModelList: true,
		capabilities: { chat: true, embedding: true, reranker: true },
	},
	xiaomi: {
		baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
		defaultModel: 'mimo-v2.5-pro',
		supportsModelList: true,
		capabilities: { chat: true, embedding: false, reranker: false, tts: true, imagegen: false },
	},
	sensenova: {
		baseUrl: 'https://token.sensenova.cn/v1',
		defaultModel: 'sensenova-u1-fast',
		chatTestModel: 'sensenova-6.7-flash-lite',
		supportsModelList: true,
		capabilities: { chat: true, embedding: false, reranker: false, imagegen: true },
	},
	volcark: {
		baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
		defaultModel: 'doubao-seed-2.0-pro',
		supportsModelList: true,
		capabilities: { chat: true, embedding: true, reranker: false, tts: false, imagegen: false },
	},
	custom: {
		baseUrl: '', // 使用用户输入的 baseUrl
		defaultModel: '',
		supportsModelList: true,
		capabilities: { chat: true, embedding: true, reranker: true },
	},
};

/**
 * 规范化 base URL：确保 OpenAI 兼容路径
 *
 * 用户可能输入：
 *   https://example.com/proxy        → 需要 /v1
 *   https://example.com/proxy/       → 需要 /v1
 *   https://example.com/proxy/v1     → 已完整
 *   https://example.com/proxy/v1/    → 已完整
 *   https://example.com/proxy/v2     → 其他版本，保留
 *
 * 规则：去掉尾部斜杠，如果末尾没有 /vN 则追加 /v1
 */
export function normalizeBaseUrl(url: string): string {
	if (!url) return '';
	const trimmed = url.replace(/\/+$/, '');
	if (/\/v\d+$/.test(trimmed)) return trimmed;
	return trimmed + '/v1';
}

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
): { apiKey: string; baseUrl: string; model: string; provider: string; embeddingBatchSize?: number; disableThinking?: boolean; fallbackApiKey?: string; fallbackBaseUrl?: string } | null {
	const roleConfig = (settings.roles as unknown as Record<string, unknown>)?.[role];
	if (!roleConfig || typeof roleConfig !== 'object') return null;

	const { provider, model, baseUrlOverride, embeddingBatchSize, disableThinking } = roleConfig as {
		provider: string;
		model: string;
		baseUrlOverride?: string;
		embeddingBatchSize?: number;
		disableThinking?: boolean;
	};

	const account = (settings.providers as Record<string, unknown>)?.[provider];
	if (!account || typeof account !== 'object') return null;

	const apiKey = (account as { apiKey?: string }).apiKey || '';
	if (!apiKey) return null; // 未填写 Key

	// 固定服务商有预设 baseUrl 和 defaultModel，自定义服务商从 account 取
	const builtInConfig = PROVIDER_CONFIGS[provider as ProviderType];
	const rawBaseUrl =
		baseUrlOverride ||
		(account as { baseUrl?: string }).baseUrl ||
		(builtInConfig?.baseUrl || '');

	// 对自定义服务商自动规范化 base URL（补 /v1）；内置服务商的自定义覆盖也做规范化
	const needsNormalize = !builtInConfig || (!!baseUrlOverride || !!(account as { baseUrl?: string }).baseUrl);
	const baseUrl = (needsNormalize && rawBaseUrl) ? normalizeBaseUrl(rawBaseUrl) : rawBaseUrl;

	const defaultModel = builtInConfig?.defaultModel || '';
	const resolvedModel = model || defaultModel;

	// Xiaomi fallback：Token Plan 失败时使用 MIMO API
	const fallbackApiKey = provider === 'xiaomi' ? (account as { fallbackApiKey?: string }).fallbackApiKey : undefined;
	const fallbackBaseUrl = provider === 'xiaomi'
		? ((account as { fallbackBaseUrl?: string }).fallbackBaseUrl || 'https://api.xiaomimimo.com/v1')
		: undefined;

	return { apiKey, baseUrl, model: resolvedModel, provider, embeddingBatchSize, disableThinking, fallbackApiKey, fallbackBaseUrl };
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

// ═══════════════════════════════════════════════════════════════
// 预设配置
// ═══════════════════════════════════════════════════════════════


/**
 * 应用预设配置：填写 API Key + 自动分配角色
 *
 * 支持多 Provider 预设。修改 settings 对象（原地修改）。
 *
 * @param presetId 预设 ID
 * @param primaryApiKey 主 Provider 的 API Key
 * @param settings 设置对象
 * @param secondaryApiKey 兼容旧接口：第二 Provider 的 API Key（可选）
 * @param additionalApiKeys 额外 Provider 的 API Key 映射（provider → apiKey）
 */
export function applyPreset(
	presetId: string,
	primaryApiKey: string,
	settings: DeepPDFSettings,
	secondaryApiKey?: string,
	additionalApiKeys?: Record<string, string>,
): void {
	const preset = getPresetById(presetId);
	if (!preset) throw new Error(`Unknown preset: ${presetId}`);

	const providers = settings.providers as Record<string, { apiKey?: string; baseUrl?: string; name?: string; fallbackApiKey?: string }>;

	// 填写主 Provider Key
	if (!providers[preset.provider]) {
		providers[preset.provider] = { apiKey: primaryApiKey };
	} else {
		providers[preset.provider].apiKey = primaryApiKey;
	}

	const allAdditional = getAllAdditionalProviders(preset);

	// 填写旧版 secondaryProvider Key（向后兼容）
	if (preset.secondaryProvider && secondaryApiKey) {
		if (!providers[preset.secondaryProvider]) {
			providers[preset.secondaryProvider] = { apiKey: secondaryApiKey };
		} else {
			providers[preset.secondaryProvider].apiKey = secondaryApiKey;
		}
	}

	// 填写新版 additionalProviders Key
	if (additionalApiKeys) {
		for (const [providerId, apiKey] of Object.entries(additionalApiKeys)) {
			if (!apiKey) continue;
			if (!providers[providerId]) {
				providers[providerId] = { apiKey };
			} else {
				providers[providerId].apiKey = apiKey;
			}
		}
	}

	// 计算有 Key 的额外 Provider 集合（按 provider 分别降级）
	const providersWithKeys = new Set<string>();
	for (const additional of allAdditional) {
		const hasKey = additionalApiKeys?.[additional.provider] ||
			(preset.secondaryProvider === additional.provider && !!secondaryApiKey);
		if (hasKey) providersWithKeys.add(additional.provider);
	}

	// 构建角色：只包含有 Key 的额外 Provider
	const roles = buildRolesFromPreset(preset, providersWithKeys);

	// 未提供 Key 的额外 Provider → 按 provider 分别降级
	for (const additional of allAdditional) {
		if (providersWithKeys.has(additional.provider)) continue;
		for (const role of Object.keys(additional.roleAssignments)) {
			if (role === 'router') {
				const fallbackModel = preset.roleAssignments.chat || Object.values(preset.roleAssignments)[0];
				roles[role] = { provider: preset.provider, model: fallbackModel };
			} else {
				roles[role] = null;
			}
		}
	}

	for (const [role, config] of Object.entries(roles)) {
		(settings.roles as unknown as Record<string, unknown>)[role] = config;
	}
}

// ═══════════════════════════════════════════════════════════════
// MiniMax TTS 模型列表（/v1/models 不返回非文本模型，故硬编码）
// ═══════════════════════════════════════════════════════════════
export const XIAOMI_TTS_MODELS = [
  'mimo-v2.5-tts',
  'mimo-v2.5-tts-voicedesign',
];

export const PROVIDER_LABELS: Record<ProviderType, string> = {
	minimax: 'MiniMax',
	deepseek: 'DeepSeek',
	kimi: 'Kimi (Moonshot)',
	siliconflow: '硅基流动 (SiliconFlow)',
	openai: 'OpenAI',
	xiaomi: '小米 MIMO',
	sensenova: '商汤 (SenseNova)',
	volcark: '火山方舟 (Agent Plan)',
	custom: '自定义',
};
