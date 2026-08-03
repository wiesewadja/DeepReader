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
		volcark:     { apiKey: '' },
		mineru:      { apiKey: '' },
	};
}

	/** 新版默认的角色配置 */
	function defaultRoles(): AIRoles {
		return {
			chat:        { provider: 'volcark', model: 'doubao-seed-2.0-pro' },
			router:      { provider: 'volcark', model: 'doubao-seed-2.0-lite' },
			pageindex:   { provider: 'volcark', model: 'doubao-seed-2.0-lite' },
			proposition: { provider: 'volcark', model: 'doubao-seed-2.0-lite' },
			embedding:   { provider: 'volcark', model: 'doubao-embedding-vision' },
			reranker:    { provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' },
			tts:         { provider: 'volcark', model: 'doubao-seed-tts-2.0' },
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
	autoDualPage: boolean;

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
 * 配置完成状态推断：只要尚未标记完成（false / undefined）且已存在有效 provider key，
 * 即视为已完成配置并自动标记。
 *
 * 注意：DEFAULT_SETTINGS 里 setupComplete 默认为 false，loadSettings 的
 * Object.assign 会让该字段永远是 defined（不再是 undefined）。早期基于
 * `!== undefined` 的判断因此失效、推断分支永远走不到——这里改为基于「未完成」推断，
 * 让已有 provider key 的用户被正确标记，避免 onload 每次弹出设置引导。
 *
 * @returns true 如果本次把状态从「未完成」翻成了「已完成」（调用方据此 saveSettings）
 */
export function detectSetupComplete(settings: DeepPDFSettings): boolean {
	// 已标记完成，不重复推断（避免无谓的 saveSettings）
	if (settings.setupComplete === true) return false;
	const hasKey = Object.values(settings.providers || {})
		.some((p: any) => p?.apiKey);
	settings.setupComplete = !!hasKey;
	return hasKey;
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
	autoDualPage: true,

	// TTS 语音朗读
	autoTTS: false,
	sensenovaApiKey: "",

	// LangGraph 引擎设置
	enableHumanReview: false,

	// LangSmith 追踪配置
	langsmithApiKey: "",
	langsmithProject: "DeepReader",
	langsmithEnabled: false,

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
