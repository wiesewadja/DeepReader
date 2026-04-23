/**
 * DeepReader 插件设置类型定义
 */

import type { ProviderType } from './providers';
import type { AIProviderAccount, AIRoles } from './ai-roles';

// ═══════════════════════════════════════════════════════════════
// 旧版子配置类型（迁移期间保留，Chunk 3 后删除）
// ═══════════════════════════════════════════════════════════════

/** @deprecated 迁移到 roles.embedding + providers */
export interface EmbeddingSettings {
	provider: "openai" | "ollama" | "lmstudio" | "local";
	model?: string;
	apiKey?: string;
	baseUrl?: string;
	dimensions?: number;
}

/** @deprecated 迁移到 roles.reranker + rerankerWeight */
export interface RerankerSettings {
	enabled: boolean;
	provider?: "lmstudio" | "ollama" | "openai";
	model?: string;
	apiKey?: string;
	baseUrl?: string;
	weight?: number;  // 0.0-1.0, default 0.7
}

/** @deprecated 迁移到 roles.proposition + propositionCardsPer500Words */
export interface PropositionSettings {
	enabled: boolean;
	model: string;
	apiKey?: string;
	baseUrl: string;
	cardsPer500Words?: number;
}

// ═══════════════════════════════════════════════════════════════
// 新版两层架构字段
// ═══════════════════════════════════════════════════════════════

/** 新版默认的服务商账号（固定 6 个 + 用户可新增自定义） */
function defaultProviders(): Record<string, AIProviderAccount> {
	return {
		deepseek:    { apiKey: '' },
		kimi:        { apiKey: '' },
		zhipu:       { apiKey: '' },
		minimax:     { apiKey: '' },
		siliconflow: { apiKey: '' },
		openai:      { apiKey: '' },
		xiaomi:      { apiKey: '' },
	};
}

/** 新版默认的角色配置 */
function defaultRoles(): AIRoles {
	return {
		chat:        { provider: 'deepseek', model: 'deepseek-chat' },
		router:      { provider: 'deepseek', model: 'deepseek-chat' },
		pageindex:   { provider: 'deepseek', model: 'deepseek-chat' },
		proposition: { provider: 'siliconflow', model: 'Qwen/Qwen3-8B' },
		embedding:   null,
		reranker:    null,
		tts:         null,
	};
}

export interface DeepPDFSettings {
	// === 新增：两层架构 ===
	providers: Record<string, AIProviderAccount>;
	roles: AIRoles;
	propositionCardsPer500Words: number;
	rerankerWeight: number;             // 0-1，默认 0.7

	// === 保留：非 AI 配置字段 ===
	apiPort: number;
	maxResults: number;

	// PDF 索引设置
	maxPagesPerNode: number;
	maxTokensPerNode: number;
	ifAddNodeSummary: boolean;

	// 状态存储
	lastSelectedIndexId: string;
	forceMode: string;
	lastCrossBookMode: boolean;
	lastCrossBookSessionId: string;
	chatCache?: Record<string, unknown>;
	enableDebugLog: boolean;
	lastDeepSearchMode: boolean;

	// 阅读模式设置
	autoEnableReadingMode: boolean;
	readingModeStyle: 'paginated' | 'scrolling';

	// TTS 语音播报
	autoTTS: boolean;
	enableVoiceReply: boolean; // 语音对话+书信回复模式

	// Langfuse 追踪配置
	langfusePublicKey: string;
	langfuseSecretKey: string;
	langfuseBaseUrl: string;
	langfuseEnabled: boolean;

	// UI 状态
	lastSettingsTab: string;

	// LangGraph 引擎设置
	enableHumanReview: boolean;

	// LangSmith 追踪配置（LangGraph 引擎专用）
	langsmithApiKey: string;
	langsmithProject: string;
	langsmithEnabled: boolean;

	// ═══════════════════════════════════════════════════════════
	// 旧版字段（迁移期间保留，Chunk 3 后删除）
	// ═══════════════════════════════════════════════════════════

	/** @deprecated 迁移到 providers.deepseek.apiKey */
	deepseekApiKey?: string;
	/** @deprecated 迁移到 providers.openai.apiKey */
	openaiApiKey?: string;
	/** @deprecated 迁移到 providers.kimi.apiKey */
	kimiApiKey?: string;
	/** @deprecated 迁移到 providers.zhipu.apiKey */
	zhipuApiKey?: string;
	/** @deprecated 迁移到 providers.custom.apiKey */
	customApiKey?: string;
	/** @deprecated 迁移到 roles.chat.provider + roles.chat.model */
	llmProvider?: ProviderType;
	/** @deprecated 迁移到 roles.chat.model */
	llmModel?: string;
	/** @deprecated 迁移到 providers.custom.baseUrl */
	apiUrl?: string;
	/** @deprecated 迁移到 roles.router */
	fastModelEnabled?: boolean;
	/** @deprecated 迁移到 roles.router.provider */
	fastModelProvider?: ProviderType;
	/** @deprecated 迁移到 roles.router.model */
	fastModelName?: string;
	/** @deprecated 迁移到 roles.router.baseUrlOverride */
	fastModelApiUrl?: string;
	/** @deprecated 迁移到 roles.embedding */
	embedding?: EmbeddingSettings;
	/** @deprecated 迁移到 roles.proposition */
	propositions?: PropositionSettings;
	/** @deprecated 迁移到 roles.reranker + rerankerWeight */
	reranker?: RerankerSettings;
}

export const DEFAULT_SETTINGS: DeepPDFSettings = {
	// === 新增：两层架构 ===
	providers: defaultProviders(),
	roles: defaultRoles(),
	propositionCardsPer500Words: 1,
	rerankerWeight: 0.7,

	// === 保留字段 ===
	apiPort: 6088,
	maxResults: 5,

	// PDF 索引设置
	maxPagesPerNode: 10,
	maxTokensPerNode: 20000,
	ifAddNodeSummary: true,

	// 状态存储
	lastSelectedIndexId: "",
	forceMode: "auto",
	lastCrossBookMode: false,
	lastCrossBookSessionId: "",
	enableDebugLog: false,
	lastDeepSearchMode: false,

	// 阅读模式设置
	autoEnableReadingMode: true,
	readingModeStyle: 'paginated' as const,

	// TTS 语音播报
	autoTTS: false,
	enableVoiceReply: false,

	// Langfuse 追踪配置
	langfusePublicKey: "",
	langfuseSecretKey: "",
	langfuseBaseUrl: "http://localhost:3000",
	langfuseEnabled: false,

	// UI 状态
	lastSettingsTab: "llm",

	// LangGraph 引擎设置
	enableHumanReview: false,

	// LangSmith 追踪配置
	langsmithApiKey: "",
	langsmithProject: "DeepReader",
	langsmithEnabled: false,
};
