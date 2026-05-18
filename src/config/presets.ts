/**
 * 服务商预设配置 — "一键配置"数据定义
 *
 * 每个预设对应一个推荐的服务商组合，用户只需填一个 API Key 即可自动分配所有角色。
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
}

/**
 * 预设列表
 *
 * roleAssignments 中每个 key 是角色名，value 是该角色使用的默认模型。
 * 未列出的角色保持 null。
 */
export const PRESETS: ProviderPreset[] = [
	{
		id: 'xiaomi-token-plan',
		label: '小米 MIMO',
		description: '订阅制全模态，一个 Key 搞定对话+TTS（embedding/reranker/图片生成需其他服务商）',
		provider: 'xiaomi',
		free: false,
		recommended: true,
		website: 'https://platform.xiaomimimo.com',
		roleAssignments: {
			chat: 'mimo-v2.5',
			router: 'mimo-v2.5',
			pageindex: 'mimo-v2.5',
			proposition: 'mimo-v2.5',
			embedding: 'BAAI/bge-m3',
		},
	},
	{
		id: 'siliconflow-all',
		label: '硅基流动 · 全功能',
		description: '一个 Key 搞定对话、语义搜索、智能排序',
		provider: 'siliconflow',
		free: true,
		website: 'https://cloud.siliconflow.cn',
		roleAssignments: {
			chat: 'Qwen/Qwen3-8B',
			router: 'Qwen/Qwen3-8B',
			pageindex: 'Qwen/Qwen3-8B',
			embedding: 'BAAI/bge-m3',
			reranker: 'BAAI/bge-reranker-v2-m3',
		},
	},
	{
		id: 'deepseek-economy',
		label: 'DeepSeek · 精简',
		description: '最低成本的纯对话模式',
		provider: 'deepseek',
		free: false,
		roleAssignments: {
			chat: 'deepseek-chat',
			router: 'deepseek-chat',
			pageindex: 'deepseek-chat',
		},
	},
	{
		id: 'openai-standard',
		label: 'OpenAI · 标准',
		description: '国际标准，效果稳定',
		provider: 'openai',
		free: false,
		roleAssignments: {
			chat: 'gpt-4o',
			router: 'gpt-4o',
			pageindex: 'gpt-4o',
			embedding: 'text-embedding-3-small',
		},
	},
];

/** 根据 ID 查找预设 */
export function getPresetById(id: string): ProviderPreset | undefined {
	return PRESETS.find(p => p.id === id);
}

/**
 * 将预设的角色分配应用到 settings.roles
 *
 * @returns 新的 roles 对象（不修改原对象）
 */
export function buildRolesFromPreset(preset: ProviderPreset): Record<string, AIRoleConfig | null> {
	const roles: Record<string, AIRoleConfig | null> = {};
	for (const [role, model] of Object.entries(preset.roleAssignments)) {
		roles[role] = { provider: preset.provider, model };
	}
	return roles;
}

/**
 * 检测当前 settings 是否匹配某个预设
 *
 * 当所有预设分配的角色 provider + model 完全一致时返回该预设，否则返回 null。
 */
export function detectCurrentPreset(
	roles: Record<string, { provider: string; model: string } | null>,
): ProviderPreset | null {
	return PRESETS.find(p =>
		Object.entries(p.roleAssignments).every(([role, model]) => {
			const r = roles[role];
			return r?.provider === p.provider && r?.model === model;
		})
	) ?? null;
}
