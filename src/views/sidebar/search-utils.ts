/**
 * 搜索/排序工具函数
 *
 * 从 SidebarView 提取的纯函数，无类依赖。
 */

import { Notice } from 'obsidian';
import { uiLog as log } from '../../utils/logger.js';

/**
 * Re-ranking 机制
 * 结合向量相似度、关键词匹配和文本长度进行重新排序
 */
export function rerankResults(results: any[], query: string): any[] {
	if (results.length === 0) return results;

	log(`[DeepPDF] [rerank] 开始 Re-ranking ${results.length} 个结果`);

	const queryLower = query.toLowerCase();
	const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

	return results.map((result, index) => {
		const text = result.text || "";
		const textLower = text.toLowerCase();
		let score = 0;

		const distance = result.metadata?.distance || result.metadata?.similarity || 0;
		const similarityScore = distance === 0 ? 1.0 : (distance < 0.5 ? 0.7 : (distance < 1 ? 0.5 : 0.3));
		score += similarityScore * 30;

		const exactMatchCount = (textLower.match(new RegExp(queryLower, 'g')) || []).length;
		score += exactMatchCount * 15;

		let partialMatchScore = 0;
		queryTerms.forEach(term => {
			const termCount = (textLower.match(new RegExp(term, 'g')) || []).length;
			partialMatchScore += termCount * 3;
		});
		score += partialMatchScore;

		const firstMatchPos = textLower.indexOf(queryLower);
		if (firstMatchPos !== -1) {
			if (firstMatchPos < text.length * 0.2) {
				score += 10;
			}
		}

		const textLength = text.length;
		if (textLength > 100 && textLength < 800) {
			score += 5;
		} else if (textLength >= 800 && textLength < 1500) {
			score += 2;
		}

		const section = result.metadata?.section || result.metadata?.node_name || "";
		const sectionLower = section.toLowerCase();
		if (sectionLower && queryTerms.some(term => sectionLower.includes(term))) {
			score += 12;
		}

		score += (results.length - index) * 0.1;

		return { ...result, _rerankScore: score };
	})
		.sort((a, b) => (b._rerankScore || 0) - (a._rerankScore || 0))
		.map(({ _rerankScore, ...result }) => result);
}

/**
 * 构建 context 时考虑 token 限制
 */
export function buildContextWithTokenLimit(results: any[], maxTokens: number): any[] {
	const limitedResults = [];
	let currentTokens = 0;

	for (const result of results) {
		const tokens = estimateTokens(result.text || "");
		if (currentTokens + tokens > maxTokens) {
			log(`[DeepPDF] [buildContext] 达到 token 限制 (${currentTokens}/${maxTokens})，剩余 ${results.length - limitedResults.length} 个结果被截断`);
			break;
		}
		limitedResults.push(result);
		currentTokens += tokens;
	}

	return limitedResults;
}

/**
 * 简单的 token 估算（英文约 4 字符/token，中文约 2 字符/token）
 */
export function estimateTokens(text: string): number {
	if (!text) return 0;

	const chineseChars = (text.match(/[一-龥]/g) || []).length;
	const englishChars = text.length - chineseChars;

	return Math.ceil(chineseChars / 2 + englishChars / 4);
}

/**
 * 复制文本到剪贴板
 */
export function copyToClipboard(text: string): void {
	navigator.clipboard.writeText(text).then(() => {
		new Notice("已复制到剪贴板");
	}).catch(() => {
		new Notice("复制失败");
	});
}
