/**
 * 服务商预设配置 — 奚童预设
 *
 * 奚童预设使用双 Provider：小米 MIMO（对话）+ SiliconFlow（搜索）。
 */

import type { RoleType } from './types';
import type { AIRoleConfig } from './ai-roles';

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

	/** 奚童预设：第二 Provider（SiliconFlow） */
	secondaryProvider?: string;
	secondaryRoleAssignments?: Partial<Record<RoleType, string>>;
	secondaryWebsite?: string;
}

/**
 * 预设列表 — 只有奚童
 */
export const PRESETS: ProviderPreset[] = [
	{
		id: 'xitong',
		label: '奚童',
		description: 'MIMO 对话 + SiliconFlow 搜索，一个配置全搞定',
		provider: 'xiaomi',
		free: false,
		recommended: true,
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
 * 将预设的角色分配构建为 roles 对象
 *
 * 合并主 Provider 和第二 Provider 的角色分配。
 * 未列出的角色保持 null。
 *
 * @param withSecondary 是否包含第二 Provider 角色（用于降级判断）
 */
export function buildRolesFromPreset(
	preset: ProviderPreset,
	withSecondary = true,
): Record<string, AIRoleConfig | null> {
	const roles: Record<string, AIRoleConfig | null> = {};

	for (const [role, model] of Object.entries(preset.roleAssignments)) {
		roles[role] = { provider: preset.provider, model };
	}

	if (withSecondary && preset.secondaryProvider && preset.secondaryRoleAssignments) {
		for (const [role, model] of Object.entries(preset.secondaryRoleAssignments)) {
			roles[role] = { provider: preset.secondaryProvider, model };
		}
	}

	return roles;
}

/**
 * 检测当前 settings 是否匹配某个预设（含第二 Provider）
 *
 * 当所有角色的 provider + model 完全一致时返回该预设，否则返回 null。
 */
export function detectCurrentPreset(
	roles: Record<string, { provider: string; model: string } | null>,
): ProviderPreset | null {
	return PRESETS.find(p => {
		const expected = buildRolesFromPreset(p);

		// 检查主 Provider 角色
		const allPrimaryMatch = Object.entries(p.roleAssignments).every(([role, model]) => {
			const r = roles[role];
			return r?.provider === p.provider && r?.model === model;
		});
		if (!allPrimaryMatch) return false;

		// 检查第二 Provider 角色
		if (p.secondaryProvider && p.secondaryRoleAssignments) {
			return Object.entries(p.secondaryRoleAssignments).every(([role, model]) => {
				const r = roles[role];
				return r?.provider === p.secondaryProvider && r?.model === model;
			});
		}

		return true;
	}) ?? null;
}
