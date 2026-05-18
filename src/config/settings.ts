/**
 * DeepReader 插件设置类型定义
 */

import type { ProviderType } from './types.js';
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

/** 新版默认的服务商账号（固定 7 个 + 用户可新增自定义） */
function defaultProviders(): Record<string, AIProviderAccount> {
	return {
		minimax:     { apiKey: '' },
		deepseek:    { apiKey: '' },
		kimi:        { apiKey: '' },
		siliconflow: { apiKey: '' },
		openai:      { apiKey: '' },
		xiaomi:      { apiKey: '' },
		sensenova:   { apiKey: '' },
	};
}

	/** 新版默认的角色配置 */
	function defaultRoles(): AIRoles {
		return {
			chat:        { provider: 'xiaomi', model: 'mimo-v2.5' },
			router:      { provider: 'xiaomi', model: 'mimo-v2-flash' },
			pageindex:   { provider: 'xiaomi', model: 'mimo-v2.5' },
			proposition: { provider: 'xiaomi', model: 'mimo-v2.5' },
			embedding:   { provider: 'siliconflow', model: 'BAAI/bge-m3' },
			reranker:    null,
			tts:         { provider: 'xiaomi', model: 'mimo-v2.5-tts' },
			imagegen:    null,
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

	// === 首次配置 ===
	setupComplete: boolean;

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
	enableInkLayer: boolean;
		messageBubbleTheme: 'notebook' | 'parchment' | 'clean' | 'chat' | 'kami';

	// TTS 语音播报
	autoTTS: boolean;
	enableVoiceReply: boolean; // 语音对话+书信回复模式
	// SenseNova 信息图生成 API Key
	sensenovaApiKey: string;

	// LangGraph 引擎设置
	enableHumanReview: boolean;

	// 用户画像
	journalDir: string;
		profileDimensions: { key: string; label: string }[];

	// LangSmith 追踪配置（LangGraph 引擎专用）
	langsmithApiKey: string;
	langsmithProject: string;
	langsmithEnabled: boolean;

	// Proactive guidance settings
	proactiveGuidanceEnabled: boolean;
	proactiveCooldownMinutes: number;

	// ═══════════════════════════════════════════════════════════
	// 旧版字段（迁移期间保留，Chunk 3 后删除）
	// ═══════════════════════════════════════════════════════════

	/** @deprecated 迁移到 providers.deepseek.apiKey */
	deepseekApiKey?: string;
	/** @deprecated 迁移到 providers.openai.apiKey */
	openaiApiKey?: string;
	/** @deprecated 迁移到 providers.kimi.apiKey */
	kimiApiKey?: string;
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

/**
 * 老用户升级兼容：如果 setupComplete 未定义但已有有效 provider key，自动标记。
 *
 * @returns true 如果需要持久化（检测到老用户已有 key）
 */
export function detectSetupComplete(settings: DeepPDFSettings): boolean {
	if (settings.setupComplete !== undefined) return false;
	const hasKey = Object.values(settings.providers || {})
		.some((p: any) => p?.apiKey);
	settings.setupComplete = !!hasKey;
	return !!hasKey;
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

	// === 首次配置 ===
	setupComplete: false,

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
	enableInkLayer: true,
		messageBubbleTheme: 'notebook' as const,

	// TTS 语音播报
	autoTTS: false,
	enableVoiceReply: false,
	sensenovaApiKey: "",

	// LangGraph 引擎设置
	enableHumanReview: false,

	// LangSmith 追踪配置
	langsmithApiKey: "",
	langsmithProject: "DeepReader",
	langsmithEnabled: false,

		// Proactive guidance
		proactiveGuidanceEnabled: true,
		proactiveCooldownMinutes: 5,

		// 用户画像
		journalDir: "",
		profileDimensions: [],
};
