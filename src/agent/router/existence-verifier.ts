/**
 * Existence Verifier — 存在性反查（BM25）
 *
 * 处理"书中有没有提到 X"类问题：用 BM25 反查确认书中是否真有该概念。
 *
 * 命中（强匹配）→ 升级到 ANALYTICAL（深度分析）
 * 未命中 → 强制 CASUAL + 设置 antiHallucinationQuery（formatter 输出"未提及"）
 *
 * 触发条件：
 * - LLM 主动标记 [ANTI_HALLUCINATION]
 * - 或 rawQuery 命中存在性正则（兜底）
 *
 * 简化版 T07：抽出独立 module 函数（不动 LangGraph 状态机）。
 * router.ts 调用此 module。状态机行为不变，路由结果一致。
 */

import type { App } from 'obsidian';
import { searchBookV2 } from '../../pageindex/book-search-v2.js';
import { agentLog as log } from '../../utils/logger.js';
import { ReadingDepth } from '../graph/state.js';

const EXISTENCE_PATTERN = /(?:有没有(?:提到|讲到|说到|涉及|讨论)|是否(?:提到|讲到|讨论|涉及)|里有没有|书中(?:有没有|是否))/;
const HIGHER_THRESHOLD = 0.5;

export interface ExistenceVerificationInput {
	/** 用户原始输入 */
	rawQuery: string;
	/** LLM 重写后的 query */
	standaloneQuery: string;
	/** LLM 决定的 depth */
	depth: ReadingDepth;
	/** 书的索引 ID */
	bookId?: string;
	/** Obsidian app */
	app?: App;
}

export interface ExistenceVerificationResult {
	depth: ReadingDepth;
	/** '' 表示未触发；非空字符串表示未命中，formatter 用此生成"未提及"回复 */
	antiHallucinationQuery: string;
}

/** 是否需要做存在性反查（正则匹配 + LLM 标记） */
export function needsExistenceCheck(rawQuery: string, standaloneQuery: string): boolean {
	return standaloneQuery.startsWith('[ANTI_HALLUCINATION]') || EXISTENCE_PATTERN.test(rawQuery);
}

/**
 * 从 rawQuery 提取核心概念（去掉"有没有提到"等填充词）。
 * 避免使用完整重写 query——书名和填充词会稀释 BM25 搜索导致假阳性。
 */
export function extractExistenceConcept(rawQuery: string, standaloneQuery: string): string {
	const extracted = rawQuery
		.replace(/.*?(?:有没有|是否|里有没有|书中(?:有没有|是否))(?:提到|讲到|说到|涉及|讨论)?\s*/, '')
		.replace(/[？?。！!《》]/g, '')
		.replace(/\s*(的|内容|相关|有关)$/, '')
		.replace(/^[的了着过吗呢吧啊]+\s*/, '')
		.replace(/\s*[的了着过吗呢吧啊]+$/, '')
		.trim();
	return extracted || standaloneQuery.replace('[ANTI_HALLUCINATION]', '').trim();
}

/**
 * 用 BM25 反查存在性。
 *
 * 不需要时（无触发条件 / 无 bookId / 无 app）直接 pass-through。
 */
export async function verifyExistence(
	input: ExistenceVerificationInput,
): Promise<ExistenceVerificationResult> {
	const { rawQuery, standaloneQuery, depth: incomingDepth, bookId, app } = input;

	if (!bookId || !app) {
		return { depth: incomingDepth, antiHallucinationQuery: '' };
	}

	if (!needsExistenceCheck(rawQuery, standaloneQuery)) {
		return { depth: incomingDepth, antiHallucinationQuery: '' };
	}

	const cleanQuery = extractExistenceConcept(rawQuery, standaloneQuery);
	const wasRegexTriggered = !standaloneQuery.startsWith('[ANTI_HALLUCINATION]');

	let depth = incomingDepth;
	if (wasRegexTriggered) {
		log(`[ExistenceVerifier] 正则兜底触发: LLM depth=${incomingDepth}, 提取概念="${cleanQuery}"`);
		depth = ReadingDepth.CASUAL;
	}

	try {
		const results = await searchBookV2({ query: cleanQuery, bookId, app, topK: 3, filePath: '' });
		const hasStrongMatch = results.some(r => {
			const score = r.score ?? 0;
			if (score < HIGHER_THRESHOLD) return false;
			const content = r.matchedBlocks?.map((b: { content: string }) => b.content).join(' ') || '';
			const concept = cleanQuery.replace(/[的了着过吗呢吧啊\s]/g, '');
			if (concept.length < 2) return content.includes(concept);
			for (let i = 0; i <= concept.length - 2; i++) {
				if (content.includes(concept.slice(i, i + 2))) return true;
			}
			return false;
		});

		if (hasStrongMatch) {
			log(`[ExistenceVerifier] "${cleanQuery}" 强命中，升级 depth→2`);
			return { depth: ReadingDepth.ANALYTICAL, antiHallucinationQuery: '' };
		}

		log(`[ExistenceVerifier] "${cleanQuery}" 未强命中 (results=${results.length}, topScore=${results[0]?.score?.toFixed(2) || 'N/A'})，强制 depth=0`);
		return { depth: ReadingDepth.CASUAL, antiHallucinationQuery: cleanQuery };
	} catch (e) {
		log(`[ExistenceVerifier] BM25 搜索失败: ${e instanceof Error ? e.message : String(e)}`);
		return { depth, antiHallucinationQuery: '' };
	}
}
