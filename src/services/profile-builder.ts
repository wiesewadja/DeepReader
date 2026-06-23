/**
 * ProfileBuilder — 从用户笔记目录构建用户画像
 *
 * 多源并行构建：
 *   数据源: 用户笔记目录 + 微信读书同步数据
 *   Stage 1: 并行抽取维度事实 + 阅读画像 + 构建索引
 *   Stage 2: 基于全部事实生成多维度画像与摘要
 */

import { TFile, TFolder, type App } from 'obsidian';
import { resolveRoleConfig } from '../config/providers';
import { toEmbeddingOptions } from '../config/role-adapters';
import type { DeepPDFSettings } from '../config/settings';
import { buildBM25Index } from '../pageindex/bm25';
import { generateBookIdFromPath } from '../pageindex/book-indexer';
import { PAGEINDEX_DIR } from '../pageindex/paths.js';
import type { VectorRecord, ChunkTextRecord } from '../pageindex/vault/types';
import {
	generateEmbeddings,
	writeVectorJsonl,
	writeChunkTexts,
} from '../pageindex/vault/vectors';
import { bookNotePath } from '../utils/book-paths';
import { serviceLog } from '../utils/logger.js';
import { getVaultPath } from '../utils/mobile-fs.js';
import { fetchWithCorsFallback } from '../utils/safe-request';
import type { WereadSyncState } from '../weread/types';
import { sanitizeFileName } from '../weread/utils/file';
import {
	DEFAULT_DIMENSIONS,
	type ProfileFactDimension,
	type ProfileFacts,
	parseFactsText,
	mergeFacts,
	createEmptyFacts,
	buildDimensionList,
} from './profile-facts';

export interface ProfileMeta {
	sourceDir: string;
	lastBuildTime: string;
	processedFiles: Record<string, { mtime: string; size: number }>;
	indexId: string;
	fileCount: number;
	factCount: number;
	dimensionKeys: string[];
}

export interface BuildProgress {
	stage: 'scanning' | 'indexing' | 'extracting' | 'weread' | 'synthesizing' | 'summarizing' | 'done';
	current: number;
	total: number;
	message: string;
}

// ═══ Stage 1 Prompt ═══

const EXTRACT_SYSTEM_PROMPT_TEMPLATE = `你是一个善于观察的人。现在你读到了用户的一些私人笔记、随手记和语音转述。

请从中提取关于用户的**具体事实**。只提取笔记中明确提到的，不要推测和发挥。

按以下维度分类输出。每个维度下列出观察到的具体事实，用分号（；）分隔。如果没有涉及某个维度，留空。

输出格式（严格遵循）：
{{DIMENSION_LINES}}

注意：
- 只提取客观事实和明确表达的态度，不写概括性评价
- 保留用户说过的原话（用引号标注）
- 标注时间线索（如"2025年初"）
- 每个事实尽量简洁，一句话一个事实`;

// ═══ Stage 2 Prompt ═══


const WEREAD_EXTRACT_SYSTEM_PROMPT = `你是一个善于观察的人。现在你读到了一个用户在微信读书上的阅读记录，包括他读过的书、划线内容、写的想法和书评。

请从中提取关于用户的**阅读画像**。具体关注：
- 他读什么类型的书（领域、主题偏好）
- 他反复关注的话题（通过划线内容推断）
- 他对书中内容的思考深度（通过想法/书评推断）
- 他的阅读习惯（速度、完读率、笔记频率）
- 值得注意的具体阅读体验（引用原话）

输出格式：
[阅读画像] 事实1；事实2；...

注意：
- 只提取明确可见的，不推测
- 保留划线原文（用引号标注）
- 标注书籍来源（如「在《书名》中划线：...」）`;
const SYNTHESIZE_SYSTEM_PROMPT = `你是一个认识了用户很多年的老朋友。你从他的笔记和阅读记录中提取了关于他方方面面的事实。

请基于这些事实，按以下结构描绘他。每个维度独立成段。

输出格式（严格遵循每个维度标题）：

## 身份与阶段
## 家庭与关系
## 工作与事业
## 兴趣与投入
## 性格与思维
## 情绪与状态
## 价值观与信念
## 阅读画像

规则：
- 用「你」称呼他
- 保留具体细节——他说过的原话、比喻、顿悟
- 时间线上有明显变化的要写出来
- 如果某个维度没有事实，写「暂无足够信息」
- 不编造他没有说过的话
- 每个维度的标题必须是「## 维度名」格式，不要修改标题文字`;

export class ProfileBuilder {
	private app: App;
	private settings: DeepPDFSettings;
	private isBuilding = false;
	private abortController: AbortController | null = null;
	latestProgress: BuildProgress | null = null;
	private bufferMutex: Promise<void> = Promise.resolve();

	constructor(app: App, settings: DeepPDFSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: DeepPDFSettings): void {
		this.settings = settings;
	}

	private get vault() { return this.app.vault; }
	private get metaPath() { return 'DeepReader/.profile-meta.json'; }
	private get profilePath() { return 'DeepReader/USER_PROFILE.md'; }
	private get summaryPath() { return 'DeepReader/.profile-summary.txt'; }
	private get factsPath() { return 'DeepReader/.profile-facts.json'; }

	getIndexDir(): string {
		const hash = generateBookIdFromPath(this.settings.journalDir);
		return `${PAGEINDEX_DIR}/journal_${hash}/`;
	}

	getIsBuilding(): boolean { return this.isBuilding; }

	cancel(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	// ── 维度列表 ──

	private getDimensions(): ProfileFactDimension[] {
		return buildDimensionList(this.settings.profileDimensions || []);
	}

	// ── 文件扫描 ──

	async scanFiles(): Promise<TFile[]> {
		const files: TFile[] = [];
		const collect = (f: TFolder) => {
			for (const child of f.children) {
				if (child instanceof TFile && child.extension === 'md') {
					if (!child.name.startsWith('.') && !child.name.startsWith('_')) {
						files.push(child);
					}
				} else if (child instanceof TFolder) {
					collect(child);
				}
			}
		};

		// 1. Scan user's journalDir
		const dir = this.settings.journalDir;
		if (dir) {
			const folder = this.vault.getAbstractFileByPath(dir);
			if (folder && folder instanceof TFolder) {
				collect(folder);
			}
		}

		// 2. Scan "书籍摘录" directory (Scheme B integration)
		const excerptFolder = this.vault.getAbstractFileByPath('书籍摘录');
		if (excerptFolder && excerptFolder instanceof TFolder) {
			collect(excerptFolder);
		}

		// Remove duplicate files based on path
		const uniqueFiles: TFile[] = [];
		const seenPaths = new Set<string>();
		for (const f of files) {
			if (!seenPaths.has(f.path)) {
				seenPaths.add(f.path);
				uniqueFiles.push(f);
			}
		}

		return uniqueFiles.sort((a, b) => a.stat.mtime - b.stat.mtime);
	}

	// ── 元数据读写 ──

	async readMeta(): Promise<ProfileMeta | null> {
		try {
			const content = await this.vault.adapter.read(this.metaPath);
			const data = JSON.parse(content); return validateMeta(data) ? data : null;
		} catch { return null; }
	}

	async writeMeta(meta: ProfileMeta): Promise<void> {
		await this.vault.adapter.write(this.metaPath, JSON.stringify(meta, null, 2));
	}

	async readProfile(): Promise<string | null> {
		try {
			return await this.vault.adapter.read(this.profilePath);
		} catch { return null; }
	}

	// ── Facts 读写 ──

	async readFacts(): Promise<ProfileFacts | null> {
		try {
			const content = await this.vault.adapter.read(this.factsPath);
			const data = JSON.parse(content); return validateFacts(data);
		} catch { return null; }
	}

	async writeFacts(facts: ProfileFacts): Promise<void> {
		await this.vault.adapter.write(this.factsPath, JSON.stringify(facts, null, 2));
	}

	// ── 索引构建 ──

	async buildIndex(
		files: TFile[],
		onProgress?: (p: BuildProgress) => void,
		signal?: AbortSignal,
	): Promise<void> {
		const indexDir = this.getIndexDir();
		await this.vault.adapter.mkdir(indexDir);

		const nodes: { id: string; text: string; level: 'L1' }[] = [];
		for (let i = 0; i < files.length; i++) {
			if (signal?.aborted) return;
			onProgress?.({
				stage: 'indexing',
				current: i,
				total: files.length,
				message: `建立索引... (${i + 1}/${files.length})`,
			});

			const file = files[i];
			let content = await this.vault.cachedRead(file);
			content = content.replace(/^---[\s\S]*?---\n*/, '');
			if (!content.trim()) continue;

			const nodeId = generateBookIdFromPath(file.path);
			nodes.push({ id: nodeId, text: content.trim(), level: 'L1' });
		}

		if (nodes.length === 0) return;

		// BM25
		const bm25 = buildBM25Index(nodes);
		await this.vault.adapter.write(`${indexDir}bm25.json`, JSON.stringify(bm25));

		// Embedding（如果已配置）— 分批处理，每批 16 个
		const embOpts = this.getEmbeddingOptions();
		if (embOpts) {
			const vectors: VectorRecord[] = [];
			const chunks: ChunkTextRecord[] = [];
			const BATCH = 16;

			for (let i = 0; i < nodes.length; i += BATCH) {
				if (signal?.aborted) return;
				const batch = nodes.slice(i, i + BATCH);
				const texts = batch
					.map(n => ({ id: n.id, text: n.text.slice(0, 2000).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') }))
					.filter(n => n.text.trim());
				if (texts.length === 0) continue;

				onProgress?.({
					stage: 'indexing',
					current: Math.min(i + BATCH, nodes.length),
					total: nodes.length,
					message: `生成向量... (${Math.min(i + BATCH, nodes.length)}/${nodes.length})`,
				});

				try {
					const embeddings = await generateEmbeddings(texts.map(t => t.text), embOpts);
					for (let j = 0; j < texts.length && j < embeddings.length; j++) {
						vectors.push({
							chunkId: texts[j].id, nodeId: texts[j].id, blockIds: [],
							type: 'summary', level: 'L1', vector: embeddings[j],
						});
						chunks.push({
							chunkId: texts[j].id, nodeId: texts[j].id, blockIds: [],
							text: texts[j].text, type: 'summary',
						});
					}
				} catch (e) {
				serviceLog.warn(`[ProfileBuilder] embedding batch ${i}-${i + batch.length} failed:`, e);
				}
			}

			if (vectors.length > 0) {
				const vaultPath = getVaultPath(this.app);
				await writeVectorJsonl(`${vaultPath}/${indexDir}vectors.jsonl`, vectors);
				await writeChunkTexts(`${vaultPath}/${indexDir}chunks.jsonl`, chunks);
			}
		}
	}

	private getEmbeddingOptions() {
		const resolved = resolveRoleConfig('embedding', this.settings);
		return resolved ? toEmbeddingOptions(resolved) : null;
	}

	// ── Stage 1: 维度事实抽取 ──

	async extractFacts(
		files: TFile[],
		onProgress?: (p: BuildProgress) => void,
		signal?: AbortSignal,
	): Promise<Record<string, string[]>> {
		const { baseUrl, apiKey, model } = this.getChatConfig();
		const dimensions = this.getDimensions();

		// 并发读取文件内容（每批 50 个）
		const contents: string[] = [];
		const READ_BATCH = 50;
		for (let i = 0; i < files.length; i += READ_BATCH) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const slice = files.slice(i, i + READ_BATCH);
			const results = await Promise.all(
				slice.map(async f => {
					let c = await this.vault.cachedRead(f);
					c = c.replace(/^---[\s\S]*?---\n*/, '').trim();
					return c ? `--- ${f.name} ---\n${c}` : '';
				}),
			);
			contents.push(...results.filter(Boolean));
			onProgress?.({
				stage: 'extracting',
				current: Math.min(i + READ_BATCH, files.length),
				total: files.length,
				message: `读取笔记中... (${Math.min(i + READ_BATCH, files.length)}/${files.length})`,
			});
		}

		if (contents.length === 0) return {};

		// 按大小分批（12000 字符/批，减少 LLM 调用次数）
		const batches = this.batchBySize(contents, 12000);
		const CONCURRENCY = 5;
		const allFacts: Record<string, string[]> = {};
		for (const d of dimensions) { allFacts[d.key] = []; }

		const systemPrompt = EXTRACT_SYSTEM_PROMPT_TEMPLATE
			.replace('{{DIMENSION_LINES}}', dimensions.map(d => `[${d.label.replace(/[\[\]\n\r]/g, '')}] `).join('\n').trimEnd());

		for (let i = 0; i < batches.length; i += CONCURRENCY) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

			const chunk = batches.slice(i, i + CONCURRENCY);
			const results = await Promise.all(
				chunk.map(batch => {
					const batchText = batch.join('\n\n');
					return this.callLLM(
						systemPrompt,
						`以下是他的部分笔记：\n\n${batchText}\n\n请按维度提取事实。`,
						baseUrl, apiKey, model, signal,
					).catch(() => '');
				}),
			);

			for (const text of results) {
				if (!text) continue;
				const batchFacts = parseFactsText(text, dimensions);
				for (const d of dimensions) {
					if (batchFacts[d.key]) {
						allFacts[d.key].push(...batchFacts[d.key]);
					}
				}
			}

			const done = Math.min(i + CONCURRENCY, batches.length);
			onProgress?.({
				stage: 'extracting',
				current: done,
				total: batches.length,
				message: `抽取事实中... (${done}/${batches.length})`,
			});
		}

		return allFacts;
	}

	// ── 微信读书阅读画像抽取 ──

	private async extractWereadFacts(
		onProgress?: (p: BuildProgress) => void,
		signal?: AbortSignal,
	): Promise<Record<string, string[]>> {
		const emptyResult: Record<string, string[]> = { reading: [] };

		if (!this.settings.wereadApiKey) {
			onProgress?.({ stage: 'weread', current: 0, total: 0, message: '跳过微信读书（未配置 API Key）' });
			return emptyResult;
		}

		let syncState: WereadSyncState;
		try {
			const raw = await this.vault.adapter.read(`${PAGEINDEX_DIR}/weread/sync-state.json`);
			syncState = JSON.parse(raw) as WereadSyncState;
		} catch {
			onProgress?.({ stage: 'weread', current: 0, total: 0, message: '跳过微信读书（尚未同步）' });
			return emptyResult;
		}

		const books = Object.values(syncState.syncedBooks);
		if (books.length === 0) {
			onProgress?.({ stage: 'weread', current: 0, total: 0, message: '跳过微信读书（无已同步书籍）' });
			return emptyResult;
		}

		onProgress?.({ stage: 'weread', current: 0, total: books.length, message: '读取微信读书数据...' });

		const facts: string[] = [];
		const totalBooks = books.length;
		const finishedBooks = books.filter(b => (b.progress ?? 0) >= 100).length;
		const totalNotes = books.reduce((s, b) => s + b.noteCount + b.reviewCount, 0);
		const readingTimes = books.filter(b => b.readingTime).map(b => b.readingTime!);
		const totalReadingHours = readingTimes.length > 0
			? Math.round(readingTimes.reduce((s, t) => s + t, 0) / 3600)
			: 0;

		facts.push(`共阅读 ${totalBooks} 本书`);
		if (finishedBooks > 0) {
			facts.push(`读完 ${finishedBooks} 本，完读率 ${Math.round(finishedBooks / totalBooks * 100)}%`);
		}
		if (totalNotes > 0) {
			facts.push(`累计做笔记/划线 ${totalNotes} 条`);
		}
		if (totalReadingHours > 0) {
			facts.push(`累计阅读时长约 ${totalReadingHours} 小时`);
		}

		const bookContents: string[] = [];
		const READ_BATCH = 10;
		for (let i = 0; i < books.length; i += READ_BATCH) {
			if (signal?.aborted) return emptyResult;
			const slice = books.slice(i, i + READ_BATCH);
			const results = await Promise.all(
				slice.map(async b => {
					const safeName = sanitizeFileName(b.title);
					const path = bookNotePath(safeName);
					try {
						const content = await this.vault.adapter.read(path);
						return content.replace(/^---[\s\S]*?---\n*/, '').trim();
					} catch { return ''; }
				}),
			);
			for (const c of results) {
				if (c) bookContents.push(c);
			}
			onProgress?.({
				stage: 'weread',
				current: Math.min(i + READ_BATCH, books.length),
				total: books.length,
				message: `读取微信读书笔记... (${Math.min(i + READ_BATCH, books.length)}/${books.length})`,
			});
		}

		if (bookContents.length > 0) {
			const { baseUrl, apiKey, model } = this.getChatConfig();
			const batches = this.batchBySize(bookContents, 12000);
			const CONCURRENCY = 3;

			for (let i = 0; i < batches.length; i += CONCURRENCY) {
				if (signal?.aborted) return emptyResult;
				const chunk = batches.slice(i, i + CONCURRENCY);
				const results = await Promise.all(
					chunk.map(batch => {
						const batchText = batch.join('\n\n');
						return this.callLLM(
							WEREAD_EXTRACT_SYSTEM_PROMPT,
							`以下是他的微信读书阅读记录：\n\n${batchText}\n\n请提取阅读画像事实。`,
							baseUrl, apiKey, model, signal,
						).catch(() => '');
					}),
				);

				for (const text of results) {
					if (!text) continue;
					const parsed = parseFactsText(text, [{ key: 'reading', label: '阅读画像' }]);
					if (parsed.reading) facts.push(...parsed.reading);
				}

				onProgress?.({
					stage: 'weread',
					current: Math.min(i + CONCURRENCY, batches.length),
					total: batches.length,
					message: `抽取阅读画像... (${Math.min(i + CONCURRENCY, batches.length)}/${batches.length})`,
				});
			}
		}

		return { reading: facts };
	}

	// ── Stage 2: 画像 + 摘要（一次 LLM 调用） ──

	async synthesizeAndSummarize(
		facts: Record<string, string[]>,
		signal?: AbortSignal,
	): Promise<{ profileText: string; summaryText: string }> {
		const { baseUrl, apiKey, model } = this.getChatConfig();
		const dimensions = this.getDimensions();

		const factsText = dimensions
			.map(d => {
				const items = facts[d.key] || [];
				if (items.length === 0) return '';
				return `【${d.label}】\n${items.map(f => `- ${f}`).join('\n')}`;
			})
			.filter(Boolean)
			.join('\n\n');

		if (!factsText) return { profileText: '', summaryText: '' };

		const combined = await this.callLLM(
			SYNTHESIZE_SYSTEM_PROMPT,
			`以下是从他的笔记和阅读记录中提取的关于他的各方面事实：\n\n${factsText}\n\n请按维度描绘他。\n\n完成后，输出一行「<<<PROFILE_SUMMARY_SPLIT>>>」，然后输出精炼的维度摘要（每个维度 2-3 句话，用"他"称呼，500-800 字）。`,
			baseUrl, apiKey, model, signal,
		);

		const parts = combined.split('<<<PROFILE_SUMMARY_SPLIT>>>').map(s => s.trim());
		return {
			profileText: parts[0] || '',
			summaryText: parts[1] || '',
		};
	}

	async readSummary(): Promise<string | null> {
		try {
			return await this.vault.adapter.read(this.summaryPath);
		} catch { return null; }
	}

	// ── 对话后增量更新 ──

	private static readonly UPDATE_INTERVAL = 10;
	private static readonly CONVERSATION_UPDATE_PROMPT = `你是一个认识了用户很多年的老朋友。你对他有一个已有的了解，现在你旁观了他和 AI 助手的最近几轮对话。

请判断这些对话是否暴露了你之前不知道的关于他的新信息。比如：
- 他对某个话题的反应暴露了新的态度或情感
- 他提到了你之前不了解的经历、关系或计划
- 他的提问方式或关注点揭示了他当下的状态变化

如果有新发现，把它们自然融入已有描绘中，不破坏原有结构和时间线。
如果没有新信息，返回原文不要做任何修改。

重要：只补充确定的新发现，不要推测。保持「他」的称呼。500-800 字。`;

	private get bufferPath() { return 'DeepReader/.profile-buffer.json'; }

	accumulateConversationRound(
		userMessage: string,
		assistantMessage: string,
	): void {
		this.bufferMutex = this.bufferMutex.then(() =>
			this.doAccumulateRound(userMessage, assistantMessage)
		);
	}

	private async doAccumulateRound(
		userMessage: string,
		assistantMessage: string,
	): Promise<void> {
		try {
			let rounds: Array<{ user: string; assistant: string }> = [];
			try {
				const raw = await this.vault.adapter.read(this.bufferPath);
				rounds = JSON.parse(raw).rounds || [];
			} catch { /* 首次 */ }

			rounds.push({ user: userMessage.slice(0, 800), assistant: assistantMessage.slice(0, 800) });

			if (rounds.length < ProfileBuilder.UPDATE_INTERVAL) {
				await this.vault.adapter.write(this.bufferPath, JSON.stringify({ rounds }));
				return;
			}

			const summary = await this.readSummary();
			if (!summary) {
				await this.vault.adapter.write(this.bufferPath, JSON.stringify({ rounds: [] }));
				return;
			}

			const conversationText = rounds
				.map((r, i) => `第${i + 1}轮\n用户：${r.user}\n助手：${r.assistant}`)
				.join('\n\n');

			const { baseUrl, apiKey, model } = this.getChatConfig();
			const updated = await this.callLLM(
				ProfileBuilder.CONVERSATION_UPDATE_PROMPT,
				`<你对他的了解>\n${summary}\n</你对他的了解>\n\n<最近${rounds.length}轮对话>\n${conversationText}\n</最近${rounds.length}轮对话>\n\n请更新你对他的描绘。如果没有新发现，返回原文。`,
				baseUrl, apiKey, model,
			);

			const trimmed = updated.trim();
			if (trimmed && trimmed !== summary) {
				await this.vault.adapter.write(this.summaryPath, trimmed);
			}

			await this.vault.adapter.write(this.bufferPath, JSON.stringify({ rounds: [] }));
		} catch (e) {
		serviceLog.warn('[ProfileBuilder] accumulateConversationRound failed:', (e as Error).message);
		}
	}

	// ── 工具方法 ──

	private batchBySize(items: string[], batchSize: number): string[][] {
		const batches: string[][] = [];
		let currentBatch: string[] = [];
		let currentLength = 0;

		for (const item of items) {
			currentBatch.push(item);
			currentLength += item.length;
			if (currentLength > batchSize && currentBatch.length > 1) {
				batches.push(currentBatch.slice(0, -1));
				currentBatch = [currentBatch[currentBatch.length - 1]];
				currentLength = currentBatch[0].length;
			}
		}
		if (currentBatch.length > 0) batches.push(currentBatch);
		return batches;
	}

	private getChatConfig(): { baseUrl: string; apiKey: string; model: string } {
		const resolved = resolveRoleConfig('chat', this.settings);
		if (!resolved) {
			throw new Error('未配置 Chat 模型，无法生成画像');
		}
		return { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, model: resolved.model };
	}

	private async callLLM(
		system: string, user: string,
		baseUrl: string, apiKey: string, model: string,
		signal?: AbortSignal,
	): Promise<string> {
		const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
		const body = JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			temperature: 0.3,
		});

		const response = await fetchWithCorsFallback(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body,
			signal,
		});

		if (!response.ok) {
			throw new Error(`LLM 请求失败: ${response.status} (${model} @ ${baseUrl})`);
		}

		const data = await response.json();
		return data.choices?.[0]?.message?.content || '';
	}

	// ── 主构建流程 ──

	async build(
		onProgress?: (p: BuildProgress) => void,
		force = false,
	): Promise<void> {
		if (this.isBuilding) {
			throw new Error("构建正在进行中，请稍后再试");
		}

		const dir = this.settings.journalDir;
		if (!dir) throw new Error('未配置笔记目录');

		let folder = this.vault.getAbstractFileByPath(dir);
		if (!folder || !(folder instanceof TFolder)) {
			if (await this.vault.adapter.exists(dir)) {
				folder = this.vault.getAbstractFileByPath(dir);
			}
			if (!folder || !(folder instanceof TFolder)) {
				throw new Error(`目录 "${dir}" 不存在`);
			}
		}

		this.isBuilding = true;
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		const emit = (p: BuildProgress) => {
			this.latestProgress = p;
			onProgress?.(p);
		};

		try {
			const meta = force ? null : await this.readMeta();
			const allFiles = await this.scanFiles();

			if (allFiles.length === 0) {
				throw new Error('目录中没有笔记文件');
			}

			emit({
				stage: 'scanning', current: 0, total: allFiles.length,
				message: `读取笔记中... (${allFiles.length} 篇)`,
			});

			// 建索引（所有文件）
			await this.buildIndex(allFiles, emit, signal);

			// 确定需要处理的文件
			let filesToExtract: TFile[];
			let existingFacts: ProfileFacts | null;

			if (force) {
				filesToExtract = allFiles;
				existingFacts = null;
			} else if (meta) {
				filesToExtract = allFiles.filter(f => {
					const prev = meta.processedFiles[f.path];
					if (!prev) return true;
					return f.stat.mtime > new Date(prev.mtime).getTime();
				});
				existingFacts = await this.readFacts();
				if (filesToExtract.length === 0 && existingFacts) {
					emit({ stage: 'done', current: 0, total: 0, message: '画像已是最新' });
					return;
				}
			} else {
				filesToExtract = allFiles;
				existingFacts = null;
			}

			// Stage 1: 抽取事实
			emit({ stage: 'extracting', current: 0, total: 0, message: '准备抽取事实...' });
			const newFacts = await this.extractFacts(filesToExtract, emit, signal);

			// 合并事实
			const dimensions = this.getDimensions();
			const mergedFacts = existingFacts
				? mergeFacts(existingFacts.dimensions, newFacts)
				: newFacts;

			// 保存 facts
			const factsData: ProfileFacts = {
				version: 1,
				sourceDir: dir,
				lastExtractTime: new Date().toISOString(),
				dimensions: mergedFacts,
			};
			await this.writeFacts(factsData);

				// Stage 2: 生成画像 + 摘要
				emit({ stage: 'synthesizing', current: 0, total: 1, message: '生成画像与摘要...' });
				const { profileText, summaryText } = await this.synthesizeAndSummarize(mergedFacts, signal);

				// 写入画像文件
				const now = new Date().toISOString();
				const profileContent = `---
created: ${meta?.lastBuildTime || now}
updated: ${now}
sourceDir: "${dir}"
fileCount: ${allFiles.length}
---

## 用户画像

${profileText}
`;
				await this.vault.adapter.write(this.profilePath, profileContent);

				// 写入摘要
				if (summaryText) {
					await this.vault.adapter.write(this.summaryPath, summaryText);
				}

			// 更新 meta
			const processedFiles: Record<string, { mtime: string; size: number }> = {};
			for (const f of allFiles) {
				processedFiles[f.path] = {
					mtime: new Date(f.stat.mtime).toISOString(),
					size: f.stat.size,
				};
			}

			const totalFacts = Object.values(mergedFacts).reduce((sum, arr) => sum + arr.length, 0);
			await this.writeMeta({
				sourceDir: dir,
				lastBuildTime: now,
				processedFiles,
				indexId: this.getIndexDir().split('/').pop() || '',
				fileCount: allFiles.length,
				factCount: totalFacts,
				dimensionKeys: dimensions.map(d => d.key),
			});

			emit({
				stage: 'done', current: allFiles.length, total: allFiles.length,
				message: '画像已生成',
			});
		} finally {
			this.isBuilding = false;
			this.abortController = null;
			this.latestProgress = null;
		}
	}

	async deleteProfile(): Promise<void> {
		const indexDir = this.getIndexDir();
		try { await this.vault.adapter.rmdir(indexDir, true); } catch {}
		try { await this.vault.adapter.remove(this.metaPath); } catch {}
		try { await this.vault.adapter.remove(this.profilePath); } catch {}
		try { await this.vault.adapter.remove(this.summaryPath); } catch {}
		try { await this.vault.adapter.remove(this.factsPath); } catch {}
		try { await this.vault.adapter.remove(this.bufferPath); } catch {}
	}
}

// ── 校验工具 ──

function validateMeta(data: any): data is ProfileMeta {
	return data
		&& typeof data.sourceDir === 'string'
		&& typeof data.lastBuildTime === 'string'
		&& data.processedFiles && typeof data.processedFiles === 'object';
}

function validateFacts(data: any): ProfileFacts | null {
	if (!data || data.version !== 1 || typeof data.sourceDir !== 'string') return null;
	if (!data.dimensions || typeof data.dimensions !== 'object') return null;
	for (const [k, v] of Object.entries(data.dimensions)) {
		if (!Array.isArray(v)) { data.dimensions[k] = []; }
		else { data.dimensions[k] = v.filter((x: any) => typeof x === 'string'); }
	}
	return data as ProfileFacts;
}
