/**
 * ProfileBuilder — 从用户笔记目录构建用户画像
 *
 * 扫描指定目录下的 Markdown 文件，建立 BM25 + 向量索引，
 * 并通过 LLM 分批提炼自然语言用户画像。
 */

import { TFile, TFolder, type App } from 'obsidian';
import type { DeepPDFSettings } from '../config/settings';
import { resolveRoleConfig } from '../config/providers';
import { toEmbeddingOptions } from '../config/role-adapters';
import { buildBM25Index } from '../pageindex/bm25';
import { generateBookId } from '../pageindex/book-indexer';
import {
	generateEmbeddings,
	writeVectorJsonl,
	writeChunkTexts,
} from '../pageindex/vault/vectors';
import type { VectorRecord, ChunkTextRecord } from '../pageindex/vault/types';
import { fetchWithCorsFallback } from '../utils/safe-request';

export interface ProfileMeta {
	sourceDir: string;
	lastBuildTime: string;
	processedFiles: Record<string, { mtime: string; size: number }>;
	indexId: string;
	fileCount: number;
}

export interface BuildProgress {
	stage: 'scanning' | 'indexing' | 'generating' | 'done';
	current: number;
	total: number;
	message: string;
}

const PROFILE_SYSTEM_PROMPT = `你是一个认识了用户很多年的老朋友。现在你读到了他的一些私人笔记、随手记和语音转述。

请用你的理解，写一段关于他的描绘。不是冷冰冰的分析报告，而是像在跟另一个朋友提起他时的那种语气——带着理解、带着温度。

留意时间线：人的状态是流动的。他在 2021 年的焦虑，到 2024 年可能变成了从容。如果你在不同时期的笔记里看到了变化，把它写出来，那才是真实的他。

写的时候注意：
- 用「你」来称呼他，就像当面聊天
- 关注他这个人本身：他正处在人生的什么阶段、在意什么、为什么事开心或困扰、在往哪个方向走
- 如果笔记里有他对家人、工作、自我的思考，把这些线索串起来
- 不要过度解读，他写什么你就理解什么
- 500-1000 字`;

const MERGE_SYSTEM_PROMPT = `你是一个认识了用户很多年的老朋友。你从不同时期、不同片段的笔记中分别写了一些关于他的描绘，现在需要把它们合在一起。

合的时候注意：
- 这不是拼贴，是融合。同一个主题在不同片段里被提到，保留最丰富、最打动人的那一版
- 时间线很重要。他年轻时执着的事，后来可能放下了；曾经困扰他的，现在可能想通了。把这种变化写出来
- 保留那些特别具体的细节——某一天他说的一句话、一个比喻、一次顿悟。这些比概括性的标签有价值得多
- 用「你」称呼他，语气像老朋友在描绘一个很了解的人
- 500-1000 字
- 不编造他没有说过的话`;

const SUMMARY_SYSTEM_PROMPT = `你是一个认识了用户很多年的老朋友，现在要给另一个朋友简要介绍他。

不是列标签，是让人听完后能"感受到"他是谁。注意以下要点：

1. 他正处在人生的什么阶段，往哪个方向走
2. 他真正在意的事，不是表面说的，是你观察到他反复挂在心上的
3. 他的性格底色——是焦虑驱动还是好奇驱动，是独处充电还是人群充电
4. 他和身边人的关系，有没有特别的牵挂或负担
5. 如果他在不同时期有明显变化，用一两句话勾勒这种转变

写 500-800 字。用"他"来称呼。不用面面俱到，抓住最能定义他的那几条线。像一个了解他的人，在灯下跟朋友谈起他时会说的话。`;

const INCREMENTAL_SYSTEM_PROMPT = `你是一个认识了用户很多年的老朋友。你对他已经有所了解，现在他又写了一些新的笔记。

请结合你对他的已有了解和新笔记，更新你对他的描绘。

注意：
- 他可能没变，那就不需要改。但如果有新的想法或状态出现，把它补充进去
- 保持老朋友的语气，用「你」称呼他
- 500-1000 字
- 不编造他没有说过的话`;

export class ProfileBuilder {
	private app: App;
	private settings: DeepPDFSettings;
	private isBuilding = false;
	private abortController: AbortController | null = null;
	/** 当前构建进度（设置页可读取） */
	latestProgress: BuildProgress | null = null;
	private buildPromise: Promise<void> | null = null;
	private bufferMutex: Promise<void> = Promise.resolve();

	constructor(app: App, settings: DeepPDFSettings) {
		this.app = app;
		this.settings = settings;
	}

	/** Refresh settings reference (call when settings change) */
	updateSettings(settings: DeepPDFSettings): void {
		this.settings = settings;
	}

	private get vault() { return this.app.vault; }
	private get metaPath() { return 'DeepReader/.profile-meta.json'; }
	private get profilePath() { return 'DeepReader/USER_PROFILE.md'; }
	private get summaryPath() { return 'DeepReader/.profile-summary.txt'; }

	getIndexDir(): string {
		const hash = generateBookId(this.settings.journalDir);
		return `.pageindex/journal_${hash}/`;
	}

	getIsBuilding(): boolean { return this.isBuilding; }

	cancel(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	// ── 文件扫描 ──

	async scanFiles(): Promise<TFile[]> {
		const dir = this.settings.journalDir;
		if (!dir) return [];
		const folder = this.vault.getAbstractFileByPath(dir);
		if (!folder || !(folder instanceof TFolder)) return [];

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
		collect(folder);
		return files.sort((a, b) => a.stat.mtime - b.stat.mtime);
	}

	// ── 元数据读写 ──

	async readMeta(): Promise<ProfileMeta | null> {
		try {
			const content = await this.vault.adapter.read(this.metaPath);
			return JSON.parse(content);
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

			const nodeId = generateBookId(file.path);
			nodes.push({ id: nodeId, text: content.trim(), level: 'L1' });
		}

		if (nodes.length === 0) return;

		// BM25
		const bm25 = buildBM25Index(nodes);
		await this.vault.adapter.write(`${indexDir}bm25.json`, JSON.stringify(bm25));

		// Embedding（如果已配置）
		const embOpts = this.getEmbeddingOptions();
		if (embOpts) {
			const vectors: VectorRecord[] = [];
			const chunks: ChunkTextRecord[] = [];

			for (let i = 0; i < nodes.length; i++) {
				if (signal?.aborted) return;
				const node = nodes[i];
				const text = node.text.slice(0, 8000);

				try {
					const embeddings = await generateEmbeddings([text], embOpts);
					if (embeddings.length > 0) {
						vectors.push({
							chunkId: node.id, nodeId: node.id, blockIds: [],
							type: 'summary', level: 'L1', vector: embeddings[0],
						});
						chunks.push({
							chunkId: node.id, nodeId: node.id, blockIds: [],
							text, type: 'summary',
						});
					}
				} catch (e) {
					console.warn('[ProfileBuilder] embedding failed for', node.id, e);
				}
			}

			if (vectors.length > 0) {
				const vaultPath = (this.vault.adapter as any).getBasePath?.() || (this.vault as any).basePath || '';
				await writeVectorJsonl(`${vaultPath}/${indexDir}vectors.jsonl`, vectors);
				await writeChunkTexts(`${vaultPath}/${indexDir}chunks.jsonl`, chunks);
			}
		}
	}

	private getEmbeddingOptions() {
		const resolved = resolveRoleConfig('embedding', this.settings);
		return resolved ? toEmbeddingOptions(resolved) : null;
	}


	// ── 画像摘要 ──

	async generateSummary(profileText: string, signal?: AbortSignal): Promise<string> {
		const { baseUrl, apiKey, model } = this.getChatConfig();
		const summary = await this.callLLM(
			SUMMARY_SYSTEM_PROMPT,
			`以下是关于他的详细描绘：\n\n${profileText}\n\n请压缩成一段简短摘要。`,
			baseUrl, apiKey, model, signal,
		);
		return summary.trim();
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

	/**
	 * 累计对话轮数，每 10 轮提炼一次更新摘要
	 * 通过 bufferMutex 保证并发安全
	 */
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
			console.warn('[ProfileBuilder] accumulateConversationRound failed:', (e as Error).message);
		}
	}

	// ── 画像生成 ──

	async generateProfile(
		files: TFile[],
		onProgress?: (p: BuildProgress) => void,
		signal?: AbortSignal,
	): Promise<string> {
		const { baseUrl, apiKey, model } = this.getChatConfig();

		// 读取所有文件内容
		const contents: string[] = [];
		for (const file of files) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			let content = await this.vault.cachedRead(file);
			content = content.replace(/^---[\s\S]*?---\n*/, '').trim();
			if (content) contents.push(`--- ${file.name} ---\n${content}`);
		}

		if (contents.length === 0) return '';

		// 按大小分批
		const BATCH_SIZE = 6000;
		const batches = this.batchBySize(contents, BATCH_SIZE);

		// 每批独立提炼（不依赖前序结果），可并行
		const CONCURRENCY = 8;
		const partialProfiles: string[] = [];
		let done = 0;

		for (let i = 0; i < batches.length; i += CONCURRENCY) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

			const chunk = batches.slice(i, i + CONCURRENCY);
			const results = await Promise.all(
				chunk.map(async (batch, idx) => {
					const batchText = batch.join('\n\n');
					return this.callLLM(
						PROFILE_SYSTEM_PROMPT,
						`以下是他的部分笔记：\n\n${batchText}\n\n请写一段关于他的描绘。`,
						baseUrl, apiKey, model, signal,
					);
				}),
			);

			for (const r of results) {
				if (r) partialProfiles.push(r);
			}

			done += chunk.length;
			onProgress?.({
				stage: 'generating',
				current: done,
				total: batches.length,
				message: `提炼画像中... (${done}/${batches.length})`,
			});
		}

		// 如果只有一份局部画像，直接返回
		if (partialProfiles.length <= 1) return partialProfiles[0] || '';

		// 合并所有局部画像
		onProgress?.({
			stage: 'generating',
			current: batches.length,
			total: batches.length,
			message: `合并画像中...（${partialProfiles.length} 份局部分析）`,
		});

		const merged = await this.callLLM(
			MERGE_SYSTEM_PROMPT,
			partialProfiles.map((p, i) => `<画像片段${i + 1}>\n${p}\n</画像片段${i + 1}>`).join('\n\n')
			+ '\n\n请把它们融合成一段完整的描绘。',
			baseUrl, apiKey, model, signal,
		);

		return merged;
	}

	private async updateProfileIncremental(
		newFiles: TFile[],
		onProgress?: (p: BuildProgress) => void,
		signal?: AbortSignal,
	): Promise<string> {
		const { baseUrl, apiKey, model } = this.getChatConfig();
		const existingProfile = await this.readProfile();
		const profileBody = existingProfile?.replace(/^---[\s\S]*?---\n*/, '') || '';

		const newContent: string[] = [];
		let totalChars = 0;
		const MAX_INCREMENTAL_CHARS = 12000;
		for (const f of newFiles) {
			let content = await this.vault.cachedRead(f);
			content = content.replace(/^---[\s\S]*?---\n*/, '').trim();
			if (content) {
				const entry = `--- ${f.name} ---\n${content}`;
				newContent.push(entry);
				totalChars += entry.length;
				if (totalChars > MAX_INCREMENTAL_CHARS) break;
			}
		}

		onProgress?.({
			stage: 'generating', current: 1, total: 1,
			message: '提炼画像中...',
		});

		return this.callLLM(
			INCREMENTAL_SYSTEM_PROMPT,
			`<你对他的了解>\n${profileBody}\n</你对他的了解>\n\n<他新写的笔记>\n${newContent.join('\n\n')}\n</他新写的笔记>\n\n请更新你对他的描绘。`,
			baseUrl, apiKey, model, signal,
		);
	}

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
		const chatRole = this.settings.roles?.chat;
		const account = chatRole ? this.settings.providers?.[chatRole.provider] : null;

		if (!account?.apiKey || !chatRole?.model) {
			throw new Error('未配置 Chat 模型，无法生成画像');
		}

		const baseUrl = chatRole.baseUrlOverride || account.baseUrl || 'https://api.openai.com/v1';
		return { baseUrl, apiKey: account.apiKey, model: chatRole.model };
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
			throw new Error(`LLM 请求失败: ${response.status}`);
		}

		const data = await response.json();
		return data.choices?.[0]?.message?.content || '';
	}

	// ── 主构建流程 ──

	async build(
		onProgress?: (p: BuildProgress) => void,
		force = false,
	): Promise<void> {
		if (this.isBuilding) return;

		const dir = this.settings.journalDir;
		if (!dir) throw new Error('未配置笔记目录');

		const folder = this.vault.getAbstractFileByPath(dir);
		if (!folder || !(folder instanceof TFolder)) {
			throw new Error(`目录 "${dir}" 不存在`);
		}

		this.isBuilding = true;
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		// 包装 onProgress：同时更新 latestProgress，设置页可随时读取
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

			let filesToProcess: TFile[];
			if (meta && !force) {
				filesToProcess = allFiles.filter(f => {
					const prev = meta.processedFiles[f.path];
					if (!prev) return true;
					return f.stat.mtime > new Date(prev.mtime).getTime();
				});
				if (filesToProcess.length === 0) {
					emit({ stage: 'done', current: 0, total: 0, message: '画像已是最新' });
					return;
				}
			} else {
				filesToProcess = allFiles;
			}

			// 建索引（所有文件）
			await this.buildIndex(allFiles, emit, signal);

			// 提炼画像
			const existingMeta = await this.readMeta();
			const profile = (existingMeta && !force && filesToProcess.length < allFiles.length)
				? await this.updateProfileIncremental(filesToProcess, emit, signal)
				: await this.generateProfile(filesToProcess, emit, signal);

			// 写入画像文件
			const now = new Date().toISOString();
			const profileContent = `---
created: ${existingMeta?.lastBuildTime || now}
updated: ${now}
sourceDir: "${dir}"
fileCount: ${allFiles.length}
---

## 用户画像

${profile}
`;
			await this.vault.adapter.write(this.profilePath, profileContent);

			// 生成摘要
			emit({ stage: 'generating', current: 0, total: 1, message: '生成摘要中...' });
			const summary = await this.generateSummary(profile, signal);
			if (summary) {
				await this.vault.adapter.write(this.summaryPath, summary);
			}

			// 更新 meta
			const processedFiles: Record<string, { mtime: string; size: number }> = {};
			for (const f of allFiles) {
				processedFiles[f.path] = {
					mtime: new Date(f.stat.mtime).toISOString(),
					size: f.stat.size,
				};
			}
			await this.writeMeta({
				sourceDir: dir,
				lastBuildTime: now,
				processedFiles,
				indexId: this.getIndexDir().split('/').pop() || '',
				fileCount: allFiles.length,
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
			try { await this.vault.adapter.remove(this.bufferPath); } catch {}
	}
}
