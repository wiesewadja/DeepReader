/**
 * JournalSearchService — 日记混合搜索（BM25 + 向量）
 */

import type { App } from 'obsidian';
import { searchBM25 } from '../pageindex/bm25';
import type { BM25Data } from '../pageindex/book-types';
import { cosineSearchJsonl, generateEmbeddings } from '../pageindex/vault/vectors';
import type { EmbeddingOptions } from '../pageindex/vault/types';
import type { DeepPDFSettings } from '../config/settings';
import { resolveRoleConfig } from '../config/providers';
import { toEmbeddingOptions } from '../config/role-adapters';
import { generateBookIdFromPath } from '../pageindex/book-indexer';
import { PAGEINDEX_DIR } from '../pageindex/paths.js';
import { getVaultPath } from '../utils/mobile-fs.js';

export interface JournalSearchResult {
	fileName: string;
	text: string;
	score: number;
}

export class JournalSearchService {
	constructor(
		private app: App,
		private settings: DeepPDFSettings,
		private indexDir: string,
	) {}

	async search(query: string, topK = 3): Promise<JournalSearchResult[]> {
		const indexDir = this.indexDir;

		// 1. BM25 search
		let bm25Results: { nodeId: string; score: number }[] = [];
		let bm25Data: BM25Data | null = null;
		try {
			bm25Data = JSON.parse(
				await this.app.vault.adapter.read(`${indexDir}bm25.json`),
			) as BM25Data;
			bm25Results = searchBM25(query, bm25Data, topK * 3);
		} catch { /* BM25 not available */ }

		// 2. Vector search
		let vectorResults: { nodeId: string; score: number }[] = [];
		const embOpts = this.getEmbeddingOptions();
		if (embOpts) {
			try {
				const embeddings = await generateEmbeddings([query], embOpts);
				if (embeddings.length > 0) {
					const vaultPath = getVaultPath(this.app);
					const raw = await cosineSearchJsonl(
						`${vaultPath}/${indexDir}vectors.jsonl`,
						embeddings[0],
						topK * 3,
					);
					vectorResults = raw.map(r => ({ nodeId: r.nodeId, score: r.score }));
				}
			} catch { /* vector search failed */ }
		}

		// 3. Score fusion (0.7 vector + 0.3 BM25)
		const fused = this.fuseScores(vectorResults, bm25Results, topK);

		// 4. Load text
		if (!bm25Data) {
			return fused.map(item => ({
				fileName: item.nodeId,
				text: '',
				score: item.score,
			}));
		}
		return fused.map(item => {
			const nodeText = bm25Data!.nodes[item.nodeId]?.text || '';
			return {
				fileName: item.nodeId,
				text: nodeText.length > 500 ? nodeText.slice(0, 500) + '...' : nodeText,
				score: item.score,
			};
		});
	}

	private getEmbeddingOptions(): EmbeddingOptions | null {
		const resolved = resolveRoleConfig('embedding', this.settings);
		return resolved ? toEmbeddingOptions(resolved) : null;
	}

	private fuseScores(
		vector: { nodeId: string; score: number }[],
		bm25: { nodeId: string; score: number }[],
		topK: number,
	): { nodeId: string; score: number }[] {
		const scoreMap = new Map<string, number>();
		for (const r of vector) scoreMap.set(r.nodeId, r.score * 0.7);
		for (const r of bm25) {
			const existing = scoreMap.get(r.nodeId) || 0;
			scoreMap.set(r.nodeId, existing + r.score * 0.3);
		}
		return [...scoreMap.entries()]
			.map(([nodeId, score]) => ({ nodeId, score }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);
	}
}

/** Helper: compute index dir from journalDir setting */
export function getJournalIndexDir(journalDir: string): string {
	const hash = generateBookIdFromPath(journalDir);
	return `${PAGEINDEX_DIR}/journal_${hash}/`;
}
