/**
 * 服务商预设配置
 *
 * 支持多 Provider 预设（如火山方舟 Agent Plan：volcark + xiaomi + siliconflow）。
 */

import type { AIRoleConfig } from './ai-roles';
import type { RoleType } from './types';

export interface AdditionalProvider {
	provider: string;
	roleAssignments: Partial<Record<RoleType, string>>;
	website?: string;
}

/** 预设配置 */
export interface ProviderPreset {
	id: string;
	label: string;
	description: string;
	provider: string;
	free: boolean;
	recommended?: boolean;
	website?: string;
	roleAssignments: Partial<Record<RoleType, string>>;

	/** @deprecated 使用 additionalProviders 替代 */
	secondaryProvider?: string;
	/** @deprecated 使用 additionalProviders 替代 */
	secondaryRoleAssignments?: Partial<Record<RoleType, string>>;
	secondaryWebsite?: string;

	/** 额外的 Provider 分配（支持多个） */
	additionalProviders?: AdditionalProvider[];
}

/**
 * 预设列表
 */
export const PRESETS: ProviderPreset[] = [
	{
		id: 'agent-plan',
		label: '火山方舟 Agent Plan',
		description: '豆包对话+语音 + SiliconFlow 重排',
		provider: 'volcark',
		free: false,
		recommended: true,
		website: 'https://console.volcengine.com/ark',
		roleAssignments: {
			chat: 'doubao-seed-2.0-pro',
			router: 'doubao-seed-2.0-lite',
			pageindex: 'doubao-seed-2.0-lite',
			proposition: 'doubao-seed-2.0-lite',
			embedding: 'doubao-embedding-vision',
			tts: 'doubao-seed-tts-2.0',
		},
		additionalProviders: [
			{
				provider: 'siliconflow',
				roleAssignments: {
					reranker: 'Qwen/Qwen3-Reranker-0.6B',
				},
				website: 'https://cloud.siliconflow.cn',
			},
		],
	},
	{
		id: 'xitong',
		label: 'MIMO Token Plan',
		description: 'MIMO 对话 + SiliconFlow 搜索，一个配置全搞定',
		provider: 'xiaomi',
		free: false,
		website: 'https://platform.xiaomimimo.com',
		roleAssignments: {
			chat: 'mimo-v2.5-pro',
			router: 'mimo-v2.5',
			pageindex: 'mimo-v2.5',
			proposition: 'mimo-v2.5',
			tts: 'mimo-v2.5-tts-voicedesign',
		},
		secondaryProvider: 'siliconflow',
		secondaryRoleAssignments: {
			embedding: 'Qwen/Qwen3-Embedding-0.6B',
			reranker: 'Qwen/Qwen3-Reranker-0.6B',
		},
		secondaryWebsite: 'https://cloud.siliconflow.cn',
	},
];

/** 根据 ID 查找预设 */
export function getPresetById(id: string): ProviderPreset | undefined {
	return PRESETS.find(p => p.id === id);
}

/**
 * 获取预设的所有额外 Provider（合并 secondary + additionalProviders 以保持向后兼容）
 */
export function getAllAdditionalProviders(preset: ProviderPreset): AdditionalProvider[] {
	const result: AdditionalProvider[] = [];

	if (preset.secondaryProvider && preset.secondaryRoleAssignments) {
		result.push({
			provider: preset.secondaryProvider,
			roleAssignments: preset.secondaryRoleAssignments,
			website: preset.secondaryWebsite,
		});
	}

	if (preset.additionalProviders) {
		result.push(...preset.additionalProviders);
	}

	return result;
}

/**
 * 将预设的角色分配构建为 roles 对象
 *
 * 合并主 Provider 和有 Key 的额外 Provider 的角色分配。
 * 无 Key 的额外 Provider 不参与角色构建，由调用方单独降级。
 *
 * @param providersWithKeys 有 API Key 的额外 Provider 集合（不传则包含全部）
 */
export function buildRolesFromPreset(
	preset: ProviderPreset,
	providersWithKeys?: Set<string>,
): Record<string, AIRoleConfig | null> {
	const roles: Record<string, AIRoleConfig | null> = {};

	for (const [role, model] of Object.entries(preset.roleAssignments)) {
		roles[role] = { provider: preset.provider, model };
	}

	for (const additional of getAllAdditionalProviders(preset)) {
		if (providersWithKeys && !providersWithKeys.has(additional.provider)) continue;
		for (const [role, model] of Object.entries(additional.roleAssignments)) {
			roles[role] = { provider: additional.provider, model };
		}
	}

	return roles;
}

/**
 * 检测当前 settings 是否匹配某个预设
 *
 * 当所有角色的 provider + model 完全一致时返回该预设，否则返回 null。
 */
export function detectCurrentPreset(
	roles: Record<string, { provider: string; model: string } | null>,
): ProviderPreset | null {
	return PRESETS.find(p => {
		const allPrimaryMatch = Object.entries(p.roleAssignments).every(([role, model]) => {
			const r = roles[role];
			return r?.provider === p.provider && r?.model === model;
		});
		if (!allPrimaryMatch) return false;

		for (const additional of getAllAdditionalProviders(p)) {
			const allMatch = Object.entries(additional.roleAssignments).every(([role, model]) => {
				const r = roles[role];
				return r?.provider === additional.provider && r?.model === model;
			});
			if (!allMatch) return false;
		}

		return true;
	}) ?? null;
}

/**
 * 预览角色分配（纯函数，无副作用）
 *
 * UI 预览用：给定选中的预设 + 哪些额外 Provider 有 Key，算出各角色的预览分配。
 * 是 buildRolesFromPreset 的薄封装，补齐全部 RoleType（未分配的角色为 null）。
 *
 * @param presetId 预设 ID
 * @param providersWithKeys 有 API Key 的额外 Provider 集合
 */
export function computePreviewRoles(
	presetId: string,
	providersWithKeys: Set<string>,
): Record<RoleType, AIRoleConfig | null> {
	const preset = getPresetById(presetId);
	if (!preset) throw new Error(`Unknown preset: ${presetId}`);

	const built = buildRolesFromPreset(preset, providersWithKeys);
	const roles: Record<RoleType, AIRoleConfig | null> = {
		chat: null,
		router: null,
		pageindex: null,
		proposition: null,
		embedding: null,
		reranker: null,
		tts: null,
		imagegen: null,
	};
	for (const [role, cfg] of Object.entries(built)) {
		roles[role as RoleType] = cfg;
	}
	return roles;
}
