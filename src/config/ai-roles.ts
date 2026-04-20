/**
 * AI 服务配置两层架构 — 核心类型定义
 *
 * 第一层：AIProviderAccount（服务商账号）
 * 第二层：AIRoleConfig（用途角色分配）
 */

import type { ProviderType } from './providers';

/** 六种用途角色 */
export type RoleType = 'chat' | 'router' | 'pageindex' | 'proposition' | 'embedding' | 'reranker';

/** 各角色所需的能力类型 */
export type RequiredCapability = 'chat' | 'embedding' | 'reranker';

/** 角色到所需能力的映射 */
export const ROLE_CAPABILITY: Record<RoleType, RequiredCapability> = {
	chat: 'chat',
	router: 'chat',
	pageindex: 'chat',
	proposition: 'chat',
	embedding: 'embedding',
	reranker: 'reranker',
};

/** 第一层：服务商账号信息 */
export interface AIProviderAccount {
	apiKey: string;
	baseUrl?: string;          // 自定义服务商必填
	name?: string;             // 显示名称（自定义服务商用）
}

/** 第二层：某用途角色的服务商和模型配置 */
export interface AIRoleConfig {
	provider: string;             // ProviderType 或自定义服务商 ID
	model: string;                // 空字符串 = 使用服务商默认模型
	baseUrlOverride?: string;     // 覆盖该角色的 baseUrl
	embeddingBatchSize?: number;  // embedding 角色专用：每批最大文本数（默认 32）
	disableThinking?: boolean;    // undefined=自动检测, true=强制禁用, false=不禁用
}

/** 六种用途角色的完整配置 */
export interface AIRoles {
	chat: AIRoleConfig;                    // 必填
	router: AIRoleConfig;                  // 必填
	pageindex: AIRoleConfig;               // 必填
	proposition: AIRoleConfig | null;      // null = 禁用命题卡片
	embedding: AIRoleConfig | null;        // null = 禁用，降级 BM25
	reranker: AIRoleConfig | null;         // null = 禁用重排序
}

/** 判断是否为固定服务商（非自定义） */
export function isBuiltInProvider(id: string): id is ProviderType {
	return id in ({} as Record<ProviderType, unknown>) && [
		'deepseek', 'kimi', 'zhipu', 'minimax', 'siliconflow', 'openai',
	].includes(id);
}
