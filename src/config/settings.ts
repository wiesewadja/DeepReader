/**
 * DeepReader 插件设置类型定义
 */

import type { Booklist } from '../types/index.js';
import type { AIProviderAccount, AIRoles } from './ai-roles';

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
		mineru:      { apiKey: '' },
	};
}

	/** 新版默认的角色配置 */
	function defaultRoles(): AIRoles {
		return {
			chat:        { provider: 'xiaomi', model: 'mimo-v2.5-pro' },
			router:      { provider: 'xiaomi', model: 'mimo-v2.5' },
			pageindex:   { provider: 'xiaomi', model: 'mimo-v2.5' },
			proposition: { provider: 'xiaomi', model: 'mimo-v2.5' },
			embedding:   { provider: 'siliconflow', model: 'Qwen/Qwen3-Embedding-0.6B' },
			reranker:    { provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' },
			tts:         { provider: 'xiaomi', model: 'mimo-v2.5-tts-voicedesign' },
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
	lastSelectedIndexId: string | undefined;
	forceMode: string;
	lastCrossBookMode: boolean;
	lastCrossBookSessionId: string;
		booklistHistory: Booklist[];
		lastActiveBooklistId: string | undefined;
	chatCache?: Record<string, unknown>;
	enableDebugLog: boolean;
	/** @internal E2E 评估模式，由测试脚本注入 data.json */
	evalMode?: boolean;
	lastDeepSearchMode: boolean;

	// 阅读模式设置
	autoEnableReadingMode: boolean;
	readingModeStyle: 'paginated' | 'scrolling';
		messageBubbleTheme: 'notebook' | 'parchment' | 'clean' | 'chat' | 'kami';

	// TTS 语音朗读
	autoTTS: boolean;
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

		// 微信读书集成
		wereadApiKey: string;
		wereadAutoSync: boolean;
		wereadSyncInterval: number;
		wereadExcludeArticles: boolean;
		wereadNoteCountThreshold: number;
		wereadTemplateId: string;
		wereadCustomTemplate: string;

		// Z-Library 集成（功能开关 + 仅存登录后的 Cookie，不存明文密码）
		enableZlibrary: boolean;
		zlibraryUserId: string;
		zlibraryUserKey: string;
		zlibraryDomain: string;

		// Hermes MCP（保留配置块用于后续集成）
		pi?: {
			provider: string;
			model: string;
			apiKey?: string;
		};

		// 会话持久化
		savedSessions?: Record<string, string>;

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
	lastSelectedIndexId: undefined,
	forceMode: "auto",
	lastCrossBookMode: false,
	lastCrossBookSessionId: "",
		booklistHistory: [],
		lastActiveBooklistId: undefined,
	enableDebugLog: false,
	lastDeepSearchMode: false,

	// 阅读模式设置
	autoEnableReadingMode: true,
	readingModeStyle: 'paginated' as const,
		messageBubbleTheme: 'notebook' as const,

	// TTS 语音朗读
	autoTTS: false,
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

		// 微信读书集成
		wereadApiKey: '',
		wereadAutoSync: false,
		wereadSyncInterval: 30,
		wereadExcludeArticles: true,
		wereadNoteCountThreshold: 1,
		wereadTemplateId: 'merged',
		wereadCustomTemplate: '',

		// Z-Library 集成
		enableZlibrary: false,
		zlibraryUserId: '',
		zlibraryUserKey: '',
		zlibraryDomain: '',


};
