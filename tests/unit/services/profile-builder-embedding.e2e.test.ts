/**
 * E2E: ProfileBuilder Embedding 批量诊断
 *
 * 复现并定位 "embedding batch 528-544 failed: 400" 错误。
 * 使用真实 Embedding API（SiliconFlow Qwen3-Embedding-0.6B）。
 *
 * 测试策略：
 *   1. 单条正常文本 → 基线
 *   2. 单条空文本 → 确认是否触发 400
 *   3. 单条含控制字符文本 → 确认是否触发 400
 *   4. 单条超长文本 → 确认 token 限制
 *   5. 批量 16 条正常文本 → 模拟 ProfileBuilder BATCH
 *   6. 批量 16 条混合（含空/控制字符） → 复现真实场景
 *   7. 大批量 500 条 → 接近真实 batch 528-544 场景
 *   8. 用 ProfileBuilder 实际目录文件测试
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fsSync from 'fs';
import * as path from 'path';

// ─── 配置 ─────────────────────────────────────────────────────────────

const VAULT_PATH = path.resolve(
	process.env.VAULT_PATH || path.join(process.cwd(), 'test-vault'),
);
const DATA_JSON = path.join(
	VAULT_PATH, '.obsidian', 'plugins', 'deepreader-dev', 'data.json',
);
const SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1';

interface ProviderInfo { apiKey: string; baseUrl?: string }
interface RoleInfo { provider: string; model: string }

function getEmbeddingConfig() {
	const envKey = process.env.EMBEDDING_API_KEY;
	if (envKey) {
		return {
			provider: 'openai' as const,
			apiKey: envKey,
			model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
			baseUrl: process.env.EMBEDDING_BASE_URL,
		};
	}
	try {
		if (!fsSync.existsSync(DATA_JSON)) return null;
		const raw = JSON.parse(fsSync.readFileSync(DATA_JSON, 'utf-8'));
		const providers: Record<string, ProviderInfo> = raw.providers || {};
		const roles: Record<string, RoleInfo> = raw.roles || {};
		const embRole = roles.embedding;
		if (!embRole) return null;
		const providerInfo = providers[embRole.provider];
		if (!providerInfo?.apiKey) return null;
		return {
			provider: 'openai' as const,
			apiKey: providerInfo.apiKey,
			model: embRole.model,
			baseUrl: providerInfo.baseUrl || (embRole.provider === 'siliconflow' ? SILICONFLOW_BASE : undefined),
		};
	} catch {
		return null;
	}
}

type EmbConfig = NonNullable<ReturnType<typeof getEmbeddingConfig>>;

// ─── 直接调用 API（绕过 generateEmbeddings，排除代码层干扰）──────────

async function rawEmbeddingRequest(texts: string[], config: EmbConfig) {
	const body: Record<string, unknown> = {
		model: config.model,
		input: texts,
	};
	const res = await fetch(`${config.baseUrl}/embeddings`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify(body),
	});
	const json = await res.json();
	return { status: res.status, body: json };
}

// ─── 通过 generateEmbeddings 调用（验证代码层）──────────────────────

async function callGenerateEmbeddings(texts: string[], config: EmbConfig) {
	const { generateEmbeddings } = await import('@/pageindex/vault/vectors.js');
	return generateEmbeddings(texts, config);
}

// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!getEmbeddingConfig())('ProfileBuilder Embedding 诊断', () => {
	let config: EmbConfig;

	beforeAll(() => {
		config = getEmbeddingConfig()!;
		console.log(`  API: ${config.baseUrl}`);
		console.log(`  Model: ${config.model}`);
	});

	// ── Test 1: 基线 — 单条正常文本 ──

	it('单条正常文本应成功', async () => {
		const { status, body } = await rawEmbeddingRequest(['这是一段测试文本'], config);
		expect(status).toBe(200);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].embedding.length).toBeGreaterThan(0);
		console.log(`  ✅ 基线通过: 维度=${body.data[0].embedding.length}`);
	});

	// ── Test 2: 空文本 ──

	it('单条空文本应返回 400（验证 API 行为）', async () => {
		const { status, body } = await rawEmbeddingRequest([''], config);
		console.log(`  空文本: status=${status}, body=${JSON.stringify(body).slice(0, 200)}`);
		// 记录行为，不做断言——我们需要知道 API 怎么处理
		if (status >= 400) {
			console.log(`  ⚠️ 空文本触发 ${status} 错误！这就是 batch 失败的可能原因`);
		}
	});

	// ── Test 3: 控制字符 ──

	it('含控制字符文本不触发 400', async () => {
		const texts = [
			'包含\x00null byte的文本',
			'包含\x07bell字符',
			'包含\x1b escape字符',
			'包含\t tab和\r回车的文本',
		];
		const { status, body } = await rawEmbeddingRequest(texts, config);
		console.log(`  控制字符: status=${status}`);
		if (status >= 400) {
			console.log(`  ⚠️ 控制字符触发 ${status}: ${JSON.stringify(body).slice(0, 300)}`);
		} else {
			console.log(`  ✅ 控制字符未触发错误`);
		}
	});

	// ── Test 4: 超长文本 ──

	it('超长文本（>8000 token）应返回错误或截断', async () => {
		// Qwen3-Embedding-0.6B max tokens = 8192
		// 用 10000 字符的中文文本模拟
		const longText = '这是测试文本。'.repeat(1000);
		console.log(`  超长文本长度: ${longText.length} 字符`);
		const { status, body } = await rawEmbeddingRequest([longText], config);
		console.log(`  超长文本: status=${status}`);
		if (status >= 400) {
			console.log(`  ⚠️ 超长文本触发 ${status}: ${JSON.stringify(body).slice(0, 300)}`);
		}
	});

	// ── Test 5: 批量 16 条正常文本 ──

	it('批量 16 条正常文本应成功', async () => {
		const texts = Array.from({ length: 16 }, (_, i) => `第 ${i + 1} 段：关于控制论的基本概念讨论。`);
		const { status, body } = await rawEmbeddingRequest(texts, config);
		expect(status).toBe(200);
		expect(body.data).toHaveLength(16);
		console.log(`  ✅ 16 条批量成功`);
	});

	// ── Test 6: 批量 16 条混合（含空/控制字符）──

	it('批量混合文本：定位哪条触发 400', async () => {
		// 逐步添加有问题的文本，看 API 怎么反应
		const cases: { label: string; texts: string[] }[] = [
			{ label: '15正常+1空', texts: [...Array.from({ length: 15 }, (_, i) => `文本${i}`), ''] },
			{ label: '15正常+1控制字符', texts: [...Array.from({ length: 15 }, (_, i) => `文本${i}`), '包含\x00空字节'] },
			{ label: '15正常+1纯空格', texts: [...Array.from({ length: 15 }, (_, i) => `文本${i}`), '   '] },
		];

		for (const c of cases) {
			const { status, body } = await rawEmbeddingRequest(c.texts, config);
			const result = status >= 400 ? `❌ ${status}` : `✅ ${status}`;
			console.log(`  ${c.label}: ${result}`);
			if (status >= 400) {
				console.log(`    error: ${JSON.stringify(body).slice(0, 200)}`);
			}
		}
	});

	// ── Test 7: 大批量渐进测试 ──

	it('渐进批量测试：32/64/128/256 条，定位批量上限', async () => {
		const sizes = [32, 64, 128, 256];
		for (const size of sizes) {
			const texts = Array.from({ length: size }, (_, i) =>
				`第 ${i + 1} 段文本内容，讨论控制论中反馈机制与系统稳定性的关系。段落编号 ${i}。`
			);
			const { status, body } = await rawEmbeddingRequest(texts, config);
			const result = status >= 400 ? `❌ ${status}` : `✅ ${status}`;
			console.log(`  批量 ${size}: ${result}`);
			if (status >= 400) {
				console.log(`    error: ${JSON.stringify(body).slice(0, 200)}`);
				break;
			}
		}
	}, 30000);

	// ── Test 8: 用 raw API 验证清洗逻辑（绕过 Obsidian requestUrl）──

	it('raw API: 清洗后的混合文本批量请求', async () => {
		// 模拟 ProfileBuilder 的清洗逻辑
		const rawTexts = ['', '正常文本', '   ', '包含\x00控制字符', '', '又是一段正常文本'];
		const cleaned = rawTexts
			.map(t => t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') || ' ');
		console.log(`  清洗前: ${JSON.stringify(rawTexts.map(t => t.length))}`);
		console.log(`  清洗后: ${JSON.stringify(cleaned.map(t => t.length))}`);

		const { status, body } = await rawEmbeddingRequest(cleaned, config);
		console.log(`  清洗后批量: status=${status}`);
		if (status >= 400) {
			console.log(`  error: ${JSON.stringify(body).slice(0, 300)}`);
		}
		expect(status).toBe(200);
	});

	// ── Test 9: 用 test-vault 中的真实 .md 文件测试 ──

	it('读取 test-vault 中的 .md 文件并模拟 ProfileBuilder 批量 embedding', async () => {
		// 递归收集 test-vault 中所有 .md 文件
		const mdFiles: string[] = [];
		function walkDir(dir: string) {
			for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory() && !entry.name.startsWith('.')) walkDir(full);
				else if (entry.name.endsWith('.md')) mdFiles.push(full);
			}
		}
		walkDir(VAULT_PATH);
		console.log(`  test-vault 中 .md 文件: ${mdFiles.length} 个`);

		// 模拟 ProfileBuilder 的文本处理
		const texts: string[] = [];
		for (const f of mdFiles) {
			let content = fsSync.readFileSync(f, 'utf-8');
			content = content.replace(/^---[\s\S]*?---\n*/, '');
			if (!content.trim()) continue;
			texts.push(content.trim().slice(0, 2000));
		}
		console.log(`  有效文本: ${texts.length} 条`);

		if (texts.length === 0) return;

		// 按 BATCH=16 分批测试
		const BATCH = 16;
		let failCount = 0;
		for (let i = 0; i < texts.length; i += BATCH) {
			const batch = texts.slice(i, i + BATCH);
			const { status, body } = await rawEmbeddingRequest(batch, config);
			if (status >= 400) {
				failCount++;
				console.log(`  ❌ batch ${i}-${i + batch.length} FAILED: ${JSON.stringify(body).slice(0, 200)}`);
				// 逐条定位问题文本
				for (let j = 0; j < batch.length; j++) {
					const { status: s2, body: b2 } = await rawEmbeddingRequest([batch[j]], config);
					if (s2 >= 400) {
						console.log(`    问题文本 [${j}]: 长度=${batch[j].length}, 前100字="${batch[j].slice(0, 100)}"`);
						console.log(`    error: ${JSON.stringify(b2).slice(0, 200)}`);
					}
				}
			}
		}
		console.log(`  总计: ${Math.ceil(texts.length / BATCH)} 批, ${failCount} 批失败`);
		expect(failCount).toBe(0);
	}, 60000);
});
