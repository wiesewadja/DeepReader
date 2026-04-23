/**
 * ProfileBuilder — 从用户笔记目录构建用户画像
 *
 * 扫描指定目录下的 Markdown 文件，建立 BM25 + 向量索引，
 * 并通过 LLM 分批提炼自然语言用户画像。
 */

import { TFile, TFolder, type App } from 'obsidian';
import type { DeepPDFSettings } from '../config/settings';
import { buildBM25Index } from '../pageindex/bm25';
import type { BM25Data } from '../pageindex/book-types';
import { generateBookId } from '../pageindex/book-indexer';
import {
	generateEmbeddings,
	writeVectorJsonl,
	writeChunkTexts,
} from '../pageindex/vault/vectors';
import type { VectorRecord, ChunkTextRecord, EmbeddingOptions } from '../pageindex/vault/types';
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

const PROFILE_SYSTEM_PROMPT = `你是一个用户画像分析专家。阅读用户的个人笔记、日记和随手记，提炼出一份自然语言的用户画像。

画像要求：
1. 用第二人称（"你"）描述，像朋友之间的了解
2. 涵盖：人生阶段、核心关注点、情感状态、兴趣领域、价值观线索
3. 500-1000 字
4. 不编造笔记中没有的内容
5. 如果有多个阶段的笔记，注意时间线变化`;

const INCREMENTAL_SYSTEM_PROMPT = `你是一个用户画像分析专家。用户有了新的笔记，请结合现有画像和新笔记，更新用户画像。

要求：
1. 保持自然语言叙述风格
2. 保留现有画像中仍然准确的内容
3. 根据新笔记补充或修正画像
4. 500-1000 字
5. 不编造笔记中没有的内容`;

export class ProfileBuilder {
	private app: App;
	private settings: DeepPDFSettings;
	private isBuilding = false;
	private abortController: AbortController | null = null;

	constructor(app: App, settings: DeepPDFSettings) {
		this.app = app;
		this.settings = settings;
	}

	private get vault() { return this.app.vault; }
	private get metaPath() { return 'DeepReader/.profile-meta.json'; }
	private get profilePath() { return 'DeepReader/USER_PROFILE.md'; }

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

	private getEmbeddingOptions(): EmbeddingOptions | null {
		const role = this.settings.roles?.embedding;
		if (!role) return null;
		const account = this.settings.providers?.[role.provider];
		if (!account?.apiKey) return null;

		// 将 ProviderType 映射到 EmbeddingOptions.provider
		const providerMap: Record<string, EmbeddingOptions['provider']> = {
			openai: 'openai', ollama: 'ollama', lmstudio: 'lmstudio', local: 'local',
		};
		const provider = providerMap[role.provider] || 'openai';

		return {
			provider,
			apiKey: account.apiKey,
			baseUrl: role.baseUrlOverride || account.baseUrl,
			model: role.model,
		};
	}

	// ── 画像生成 ──

	async generateProfile(
		files: TFile[],
		onProgress?: (p: BuildProgress) => void,
		signal?: AbortSignal,
	): Promise<string> {
		const { baseUrl, apiKey, model } = this.getChatConfig();

		// 分批：每批约 3000 字
		const BATCH_SIZE = 3000;
		const batches = this.splitIntoBatches(files, BATCH_SIZE);

		let accumulated = '';

		for (let i = 0; i < batches.length; i++) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

			onProgress?.({
				stage: 'generating',
				current: i + 1,
				total: batches.length,
				message: `提炼画像中... (${i + 1}/${batches.length})`,
			});

			const batchText = batches[i].join('\n\n');
			const contextBlock = accumulated
				? `\n\n<之前的分析>\n${accumulated}\n</之前的分析>`
				: '';

			accumulated = await this.callLLM(
				PROFILE_SYSTEM_PROMPT,
				`${batchText}${contextBlock}\n\n请分析这批笔记，${accumulated ? '结合之前的分析，' : ''}输出当前累积的用户画像。`,
				baseUrl, apiKey, model, signal,
			);
		}

		return accumulated;
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
		for (const f of newFiles) {
			let content = await this.vault.cachedRead(f);
			content = content.replace(/^---[\s\S]*?---\n*/, '').trim();
			if (content) newContent.push(`--- ${f.name} ---\n${content}`);
		}

		onProgress?.({
			stage: 'generating', current: 1, total: 1,
			message: '提炼画像中...',
		});

		return this.callLLM(
			INCREMENTAL_SYSTEM_PROMPT,
			`<当前画像>\n${profileBody}\n</当前画像>\n\n<新笔记>\n${newContent.join('\n\n')}\n</新笔记>\n\n请更新画像。`,
			baseUrl, apiKey, model, signal,
		);
	}

	private splitIntoBatches(files: TFile[], batchSize: number): string[][] {
		const batches: string[][] = [];
		let currentBatch: string[] = [];
		let currentLength = 0;

		for (const file of files) {
			const content = ''; // placeholder, will be read lazily
			void content; // suppress unused
			currentBatch.push(file.name);
			currentLength += file.stat.size;
			if (currentLength > batchSize && currentBatch.length > 1) {
				batches.push(currentBatch.slice(0, -1));
				currentBatch = [currentBatch[currentBatch.length - 1]];
				currentLength = file.stat.size;
			}
		}
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

		try {
			const meta = force ? null : await this.readMeta();
			const allFiles = await this.scanFiles();

			if (allFiles.length === 0) {
				throw new Error('目录中没有笔记文件');
			}

			onProgress?.({
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
					onProgress?.({ stage: 'done', current: 0, total: 0, message: '画像已是最新' });
					return;
				}
			} else {
				filesToProcess = allFiles;
			}

			// 建索引（所有文件）
			await this.buildIndex(allFiles, onProgress, signal);

			// 提炼画像
			const existingMeta = await this.readMeta();
			const profile = (existingMeta && !force && filesToProcess.length < allFiles.length)
				? await this.updateProfileIncremental(filesToProcess, onProgress, signal)
				: await this.generateProfile(filesToProcess, onProgress, signal);

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

			onProgress?.({
				stage: 'done', current: allFiles.length, total: allFiles.length,
				message: '画像已生成',
			});
		} finally {
			this.isBuilding = false;
			this.abortController = null;
		}
	}

	async deleteProfile(): Promise<void> {
		const indexDir = this.getIndexDir();
		try { await this.vault.adapter.rmdir(indexDir, true); } catch {}
		try { await this.vault.adapter.remove(this.metaPath); } catch {}
		try { await this.vault.adapter.remove(this.profilePath); } catch {}
	}
}
