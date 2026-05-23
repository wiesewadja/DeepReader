/**
 * AI 服务商配置
 * 定义各服务商的 Base URL、默认模型、能力矩阵和辅助函数
 */

import type { DeepPDFSettings } from './settings';
import type { RoleType } from './types.js';
import type { ProviderType } from './types.js';
export type { ProviderType } from './types.js';
import { ROLE_CAPABILITY } from './ai-roles';
import { getPresetById, buildRolesFromPreset } from './presets';

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
	/** @deprecated 仅迁移模块内部使用，迁移完成后删除 */
	legacyApiKeyField?: keyof DeepPDFSettings;
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
	xiaomi: {
		baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
		defaultModel: 'mimo-v2.5',
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
	custom: {
		baseUrl: '', // 使用用户输入的 baseUrl
		defaultModel: '',
		legacyApiKeyField: 'customApiKey',
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

	const defaultModel = role === 'tts' && provider === 'minimax'
		? (MINIMAX_TTS_MODELS[0] || builtInConfig?.defaultModel || '')
		: (builtInConfig?.defaultModel || '');
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

/**
 * 获取服务商的 baseUrl（固定服务商返回预设值，自定义服务商从 account 取）
 */
export function getProviderBaseUrl(id: string, settings: DeepPDFSettings): string {
	const builtInConfig = PROVIDER_CONFIGS[id as ProviderType];
	if (builtInConfig) return builtInConfig.baseUrl;
	const account = (settings.providers as Record<string, unknown>)[id];
	if (account && typeof account === 'object') {
		const raw = (account as { baseUrl?: string }).baseUrl || '';
			return raw ? normalizeBaseUrl(raw) : '';
	}
	return '';
}

// ═══════════════════════════════════════════════════════════════
// 预设配置
// ═══════════════════════════════════════════════════════════════

	// ═══════════════════════════════════════════════════════════════

/**
 * 应用预设配置：填写 API Key + 自动分配角色
 *
 * 支持双 Provider 预设（如奚童：小米 MIMO + SiliconFlow）。
 * 修改 settings 对象（原地修改）。
 *
 * @param presetId 预设 ID
 * @param primaryApiKey 主 Provider 的 API Key
 * @param settings 设置对象
 * @param secondaryApiKey 第二 Provider 的 API Key（可选，缺失时对应角色降级）
 */
export function applyPreset(
	presetId: string,
	primaryApiKey: string,
	settings: DeepPDFSettings,
	secondaryApiKey?: string,
): void {
	const preset = getPresetById(presetId);
	if (!preset) throw new Error(`Unknown preset: ${presetId}`);

	// 填写主 Provider Key
	const providers = settings.providers as Record<string, { apiKey?: string; baseUrl?: string; name?: string; fallbackApiKey?: string }>;
	if (!providers[preset.provider]) {
		providers[preset.provider] = { apiKey: primaryApiKey };
	} else {
		providers[preset.provider].apiKey = primaryApiKey;
	}

	// 填写第二 Provider Key
	if (preset.secondaryProvider && secondaryApiKey) {
		if (!providers[preset.secondaryProvider]) {
			providers[preset.secondaryProvider] = { apiKey: secondaryApiKey };
		} else {
			providers[preset.secondaryProvider].apiKey = secondaryApiKey;
		}
	}

	// 分配角色（含降级处理）
	const withSecondary = !!secondaryApiKey;
	const roles = buildRolesFromPreset(preset, withSecondary);

	// 无第二 Key 时的降级处理
	if (!withSecondary && preset.secondaryProvider && preset.secondaryRoleAssignments) {
		for (const role of Object.keys(preset.secondaryRoleAssignments)) {
			if (role === 'router') {
				// router 降级到主 Provider 的默认模型
				const fallbackModel = preset.roleAssignments.chat || Object.values(preset.roleAssignments)[0];
				roles[role] = { provider: preset.provider, model: fallbackModel };
			} else {
				// embedding/reranker 禁用
				roles[role] = null;
			}
		}
	}

	for (const [role, config] of Object.entries(roles)) {
		(settings.roles as unknown as Record<string, unknown>)[role] = config;
	}
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
 * 服务商显示名称映射
 */
/**
 * MiniMax TTS 模型列表（/v1/models 不返回非文本模型，故硬编码）
 */
export const MINIMAX_TTS_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
];

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
	custom: '自定义',
};
