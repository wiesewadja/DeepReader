#!/usr/bin/env node

/**
 * 从 .env 文件读取配置，注入到 test-vault 的 data.json
 * 用法: node scripts/inject-config.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

// ----- 读取 .env -----
const envPath = resolve(root, '.env');
if (!existsSync(envPath)) {
	console.log('⚠️  .env 不存在，跳过配置注入');
	console.log('   提示: cp .env.example .env && 编辑填入真实值');
	process.exit(0);
}

const envRaw = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envRaw.split('\n')) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) continue;
	const eq = trimmed.indexOf('=');
	if (eq === -1) continue;
	const key = trimmed.slice(0, eq).trim();
	const val = trimmed.slice(eq + 1).trim();
	if (val) env[key] = val;
}

function get(name) { return env[name] || ''; }
function getBool(name) { return env[name] === 'true'; }
function getInt(name, fallback) { return env[name] ? parseInt(env[name], 10) : fallback; }

// ----- 解析 role（格式: provider/model） -----
function parseRole(val) {
	if (!val) return undefined;
	const [provider, ...rest] = val.split('/');
	const model = rest.join('/'); // model 可能含 /，如 Qwen/Qwen3-Embedding-0.6B
	return model ? { provider, model } : { provider, model: '' };
}

// ----- 构建 data.json -----
const data = {
	providers: {
		minimax: { apiKey: get('DEEPREADER_MINIMAX_API_KEY') },
		deepseek: { apiKey: get('DEEPREADER_DEEPSEEK_API_KEY') },
		kimi: { apiKey: get('DEEPREADER_KIMI_API_KEY') },
		zhipu: { apiKey: get('DEEPREADER_ZHIPU_API_KEY') },
		siliconflow: { apiKey: get('DEEPREADER_SILICONFLOW_API_KEY') },
		openai: { apiKey: get('DEEPREADER_OPENAI_API_KEY') },
		xiaomi: {
			apiKey: get('DEEPREADER_XIAOMI_API_KEY'),
			fallbackApiKey: get('DEEPREADER_XIAOMI_FALLBACK_KEY'),
		},
		sensenova: { apiKey: get('DEEPREADER_SENSENOVA_API_KEY') },
		volcark: { apiKey: get('DEEPREADER_VOLCARK_API_KEY') },
		mineru: { apiKey: get('DEEPREADER_MINERU_API_KEY') },
	},
	roles: {
		chat: parseRole(get('DEEPREADER_ROLE_CHAT')) || { provider: 'xiaomi', model: 'mimo-v2.5-pro' },
		router: parseRole(get('DEEPREADER_ROLE_ROUTER')) || { provider: 'xiaomi', model: 'mimo-v2.5' },
		pageindex: parseRole(get('DEEPREADER_ROLE_PAGEINDEX')) || { provider: 'xiaomi', model: 'mimo-v2.5' },
		proposition: parseRole(get('DEEPREADER_ROLE_PROPOSITION')) || { provider: 'xiaomi', model: 'mimo-v2.5' },
		embedding: parseRole(get('DEEPREADER_ROLE_EMBEDDING')) || { provider: 'siliconflow', model: 'Qwen/Qwen3-Embedding-0.6B' },
		reranker: parseRole(get('DEEPREADER_ROLE_RERANKER')) || { provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' },
		tts: parseRole(get('DEEPREADER_ROLE_TTS')) || { provider: 'xiaomi', model: 'mimo-v2.5-tts' },
		imagegen: parseRole(get('DEEPREADER_ROLE_IMAGEGEN')) || null,
	},
	propositionCardsPer500Words: 1,
	rerankerWeight: parseFloat(get('DEEPREADER_RERANKER_WEIGHT') || '0.7'),
	apiPort: getInt('DEEPREADER_API_PORT', 6088),
	maxResults: getInt('DEEPREADER_MAX_RESULTS', 5),
	setupComplete: getBool('DEEPREADER_SETUP_COMPLETE'),
	maxPagesPerNode: 10,
	maxTokensPerNode: 20000,
	ifAddNodeSummary: true,
	forceMode: get('DEEPREADER_FORCE_MODE') || 'auto',
	lastCrossBookMode: false,
	lastCrossBookSessionId: '',
	booklistHistory: [],
	enableDebugLog: getBool('DEEPREADER_ENABLE_DEBUG_LOG'),
	lastDeepSearchMode: false,
	autoEnableReadingMode: env['DEEPREADER_AUTO_READING_MODE'] ? getBool('DEEPREADER_AUTO_READING_MODE') : true,
	readingModeStyle: get('DEEPREADER_READING_MODE_STYLE') || 'paginated',
	enableInkLayer: false,
	messageBubbleTheme: get('DEEPREADER_MESSAGE_THEME') || 'kami',
	autoTTS: false,
	enableVoiceReply: false,
	sensenovaApiKey: get('DEEPREADER_SENSENOVA_API_KEY'),
	enableHumanReview: false,
	langsmithApiKey: get('DEEPREADER_LANGSMITH_API_KEY'),
	langsmithProject: get('DEEPREADER_LANGSMITH_PROJECT') || 'DeepReader',
	langsmithEnabled: getBool('DEEPREADER_LANGSMITH_ENABLED'),
	proactiveGuidanceEnabled: env['DEEPREADER_PROACTIVE_GUIDANCE'] ? getBool('DEEPREADER_PROACTIVE_GUIDANCE') : false,
	proactiveCooldownMinutes: getInt('DEEPREADER_PROACTIVE_COOLDOWN', 5),
	journalDir: get('DEEPREADER_JOURNAL_DIR'),
	profileDimensions: [],
	wereadApiKey: get('DEEPREADER_WEREAD_API_KEY'),
	wereadSyncInterval: getInt('DEEPREADER_WEREAD_SYNC_INTERVAL', 0),
	wereadExcludeArticles: env['DEEPREADER_WEREAD_EXCLUDE_ARTICLES'] ? getBool('DEEPREADER_WEREAD_EXCLUDE_ARTICLES') : true,
	wereadNoteCountThreshold: getInt('DEEPREADER_WEREAD_NOTE_THRESHOLD', 1),
	enableZlibrary: getBool('DEEPREADER_ZLIBRARY_ENABLED'),
	zlibraryUserId: get('DEEPREADER_ZLIBRARY_USER_ID'),
	zlibraryUserKey: get('DEEPREADER_ZLIBRARY_USER_KEY'),
	zlibraryDomain: get('DEEPREADER_ZLIBRARY_DOMAIN'),
	piEnabled: getBool('DEEPREADER_PI_ENABLED'),
	customPiPath: get('DEEPREADER_PI_CUSTOM_PATH'),
	langfusePublicKey: get('DEEPREADER_LANGFUSE_PUBLIC_KEY'),
	langfuseSecretKey: get('DEEPREADER_LANGFUSE_SECRET_KEY'),
	langfuseBaseUrl: get('DEEPREADER_LANGFUSE_BASE_URL') || 'http://localhost:3000',
	langfuseEnabled: getBool('DEEPREADER_LANGFUSE_ENABLED'),
	savedSessions: {},
};

// ----- 读取并合并已有的 data.json -----
const dataPath = resolve(root, 'test-vault/.obsidian/plugins/deepreader-dev/data.json');
let finalData = { ...data };

if (existsSync(dataPath)) {
	try {
		const existing = JSON.parse(readFileSync(dataPath, 'utf-8'));
		
		// 1. 以已有的全部数据（含运行期会话历史、偏好等）为基础
		finalData = { ...existing };
		
		// 2. 细粒度覆盖来自 env 的提供商配置 (API key)
		finalData.providers = {
			...(existing.providers || {}),
			...(data.providers || {})
		};
		for (const provider of Object.keys(data.providers)) {
			finalData.providers[provider] = {
				...(existing.providers?.[provider] || {}),
				...(data.providers[provider] || {})
			};
		}

		// 3. 覆盖来自 env 的角色模型配置
		finalData.roles = {
			...(existing.roles || {}),
			...(data.roles || {})
		};

		// 4. 覆盖其他从 env 配置的字段，但保留没有被 env 定义覆盖的运行期状态
		const envFields = [
			'apiPort',
			'setupComplete',
			'enableDebugLog',
			'wereadApiKey',
			'enableZlibrary',
			'zlibraryUserId',
			'zlibraryUserKey',
			'zlibraryDomain',
			'piEnabled',
			'customPiPath',
			'langfusePublicKey',
			'langfuseSecretKey',
			'langfuseBaseUrl',
			'langfuseEnabled',
			'sensenovaApiKey',
			'langsmithApiKey',
			'langsmithProject',
			'langsmithEnabled',
			'propositionCardsPer500Words',
			'rerankerWeight',
			'maxResults',
			'forceMode',
			'autoEnableReadingMode',
			'readingModeStyle',
			'proactiveGuidanceEnabled',
			'proactiveCooldownMinutes',
			'journalDir',
			'wereadSyncInterval',
			'wereadExcludeArticles',
			'wereadNoteCountThreshold'
		];

		for (const field of envFields) {
			if (data[field] !== undefined) {
				finalData[field] = data[field];
			}
		}
	} catch (e) {
		console.warn('⚠️ 解析已有 data.json 失败，将生成全新配置', e);
	}
}

// ----- 输出 -----
if (dryRun) {
	console.log('🔍 [dry-run] 将写入以下配置:\n');
	console.log(JSON.stringify(finalData, null, 2));
	console.log(`\n目标: ${dataPath}`);
} else {
	writeFileSync(dataPath, JSON.stringify(finalData, null, 2) + '\n');
	console.log(`✅ 配置已注入: ${dataPath}`);

	// 统计已配置的 provider 数量
	const configured = Object.entries(finalData.providers || {})
		.filter(([, v]) => v && v.apiKey)
		.map(([k]) => k);
	if (configured.length) console.log(`   已配置 provider: ${configured.join(', ')}`);

	const extras = [
		finalData.wereadApiKey ? '微信读书' : '',
		finalData.langsmithEnabled ? 'LangSmith' : '',
		finalData.piEnabled ? 'PI Agent' : '',
		finalData.langfuseEnabled ? 'Langfuse' : '',
	].filter(Boolean).join('  ');
	if (extras) console.log(`   集成: ${extras}`);
}
