/**
 * outline_structure Tool - 提取书籍整体结构和纲要
 *
 * 对应《如何阅读一本书》分析阅读规则2-3：
 * - 规则2：使用一个单一的句子，或最多几句话（一小段文字）来叙述整本书的内容
 * - 规则3：将书中重要篇章列举出来，说明它们如何按照顺序组成一个整体的架构
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

const OUTLINE_STRUCTURE_DEFINITION: ToolDefinition = {
	type: 'function',
	function: {
		name: 'outline_structure',
		description:
			'分析阅读（规则2-3）：提取书籍整体结构和纲要。返回书籍核心主题、章节层级结构和各部分的功能说明。用于深入理解书籍的组织架构。',
		parameters: {
			type: 'object',
			properties: {
				detail_level: {
					type: 'string',
					enum: ['brief', 'normal', 'detailed'],
					description: '纲要详细程度：brief（仅主要章节）、normal（默认，包含子章节）、detailed（包含章节摘要）',
				},
			},
			required: [],
		},
	},
};

export const outlineStructureTool: ToolExecutor = {
	definition: OUTLINE_STRUCTURE_DEFINITION,

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		const detailLevel = (args.detail_level as string) || 'normal';

		try {
			log('[outline_structure] 分析书籍结构:', { indexId: context.indexId, detailLevel });

			// 获取目录和导出数据
			const [toc, exportData] = await Promise.all([
				deeppdfClient.getTableOfContents(context.indexId),
				deeppdfClient.exportIndex(context.indexId),
			]);

			if (!toc.chapters || toc.chapters.length === 0) {
				return `无法获取 "${context.pdfName}" 的目录结构`;
			}

			// 构建结构纲要
			const outline = buildOutline(toc.book_name, toc.chapters, exportData.nodes, detailLevel);

			log('[outline_structure] 分析完成，章节数:', toc.chapters.length);
			return outline;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			logError('[outline_structure] 分析失败:', errorMsg);
			return `Error analyzing book structure: ${errorMsg}`;
		}
	},
};

/**
 * 章节信息（来自 API）
 */
interface ChapterInfo {
	title: string;
	start_page: number;
	end_page: number;
}

/**
 * 节点信息（来自 API）
 */
interface NodeInfo {
	node_id: string;
	node_name: string;
	section: string;
	page_range: string;
	text: string;
}

/**
 * 构建结构纲要
 */
function buildOutline(
	bookName: string,
	chapters: ChapterInfo[],
	nodes: NodeInfo[],
	detailLevel: string
): string {
	const lines: string[] = [];

	// 书名和总览
	lines.push(`# 《${bookName}》结构纲要`);
	lines.push('');
	lines.push(`**总页数**: ${chapters[0]?.start_page || 1}-${chapters[chapters.length - 1]?.end_page || '?'}`);
	lines.push(`**章节数**: ${chapters.length}`);
	lines.push('');

	// 识别书籍类型和主题
	const bookTheme = inferBookTheme(chapters, nodes);
	lines.push(`**核心主题**: ${bookTheme}`);
	lines.push('');

	// 分隔线
	lines.push('---');
	lines.push('');

	// 章节结构
	lines.push('## 篇章结构');
	lines.push('');

	if (detailLevel === 'brief') {
		// 简要模式：仅显示主要章节（通常是顶层或编号章节）
		const mainChapters = chapters.filter((ch) => isMainChapter(ch.title));
		for (const chapter of mainChapters) {
			const pageRange = chapter.start_page === chapter.end_page
				? `p.${chapter.start_page}`
				: `p.${chapter.start_page}-${chapter.end_page}`;
			lines.push(`### ${chapter.title} (${pageRange})`);
			lines.push('');
		}
	} else {
		// 普通/详细模式：显示所有章节
		for (const chapter of chapters) {
			const pageRange = chapter.start_page === chapter.end_page
				? `p.${chapter.start_page}`
				: `p.${chapter.start_page}-${chapter.end_page}`;

			const isMain = isMainChapter(chapter.title);
			const prefix = isMain ? '### ' : '- ';
			const indent = isMain ? '' : '  ';

			lines.push(`${indent}${prefix}${chapter.title} (${pageRange})`);

			// 详细模式：添加章节摘要
			if (detailLevel === 'detailed' && isMain) {
				const summary = getChapterSummary(chapter.title, nodes);
				if (summary) {
					lines.push('');
					lines.push(`> ${summary}`);
					lines.push('');
				}
			}
		}
	}

	// 添加架构分析
	lines.push('');
	lines.push('---');
	lines.push('');
	lines.push('## 架构分析');
	lines.push('');
	lines.push(generateStructureAnalysis(chapters));

	return lines.join('\n');
}

/**
 * 判断是否为主要章节
 */
function isMainChapter(title: string): boolean {
	// 匹配常见的章节编号模式
	const mainPatterns = [
		/^第[一二三四五六七八九十\d]+[章部篇]/, // 中文章节
		/^Chapter\s*\d+/i, // 英文章节
		/^Part\s*\d+/i, // 英文部分
		/^[一二三四五六七八九十]+[、.．]/, // 中文数字编号
		/^\d+[、.．\s]/, // 阿拉伯数字编号
	];

	return mainPatterns.some((pattern) => pattern.test(title.trim()));
}

/**
 * 推断书籍主题
 */
function inferBookTheme(chapters: ChapterInfo[], nodes: NodeInfo[]): string {
	// 从章节标题和前几个节点中提取关键词
	const titles = chapters.map((c) => c.title).join(' ');
	const nodeTexts = nodes
		.slice(0, 5)
		.map((n) => n.text.slice(0, 200))
		.join(' ');

	const combinedText = titles + ' ' + nodeTexts;

	// 简单的关键词提取（实际应用中可以用更复杂的 NLP）
	const keywords = extractKeywords(combinedText);

	if (keywords.length > 0) {
		return keywords.slice(0, 5).join('、');
	}

	return '（未能自动识别）';
}

/**
 * 简单关键词提取
 */
function extractKeywords(text: string): string[] {
	// 移除常见停用词
	const stopWords = new Set([
		'的', '是', '在', '和', '与', '或', '有', '被', '将', '能', '会',
		'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
		'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
	]);

	// 提取中文词组（2-4字）和英文单词
	const chineseWords = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
	const englishWords = text.match(/[a-zA-Z]{4,}/gi) || [];

	const allWords = [...chineseWords, ...englishWords];

	// 统计词频
	const wordCount: Record<string, number> = {};
	for (const word of allWords) {
		const lower = word.toLowerCase();
		if (!stopWords.has(lower) && !stopWords.has(word)) {
			wordCount[word] = (wordCount[word] || 0) + 1;
		}
	}

	// 返回高频词
	return Object.entries(wordCount)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([word]) => word);
}

/**
 * 获取章节摘要
 */
function getChapterSummary(chapterTitle: string, nodes: NodeInfo[]): string {
	// 查找匹配的节点
	const matchingNode = nodes.find(
		(n) => n.node_name === chapterTitle || n.node_name.includes(chapterTitle)
	);

	if (!matchingNode) return '';

	// 提取第一段作为摘要
	const firstParagraph = matchingNode.text.split('\n\n')[0];
	if (firstParagraph && firstParagraph.length > 50) {
		return firstParagraph.slice(0, 150) + (firstParagraph.length > 150 ? '...' : '');
	}

	return '';
}

/**
 * 生成结构分析
 */
function generateStructureAnalysis(chapters: ChapterInfo[]): string {
	const mainChapters = chapters.filter((ch) => isMainChapter(ch.title));
	const totalMain = mainChapters.length;

	if (totalMain === 0) {
		return '本书未采用传统章节划分，可能是文集或连续性文本。';
	}

	// 分析章节长度分布
	const chapterLengths = mainChapters.map((ch) => ch.end_page - ch.start_page + 1);
	const avgLength = Math.round(chapterLengths.reduce((a, b) => a + b, 0) / chapterLengths.length);

	const analysis: string[] = [];

	// 结构类型判断
	if (totalMain <= 3) {
		analysis.push('本书结构较为简洁，分为少量大章节，适合系统性学习。');
	} else if (totalMain <= 10) {
		analysis.push(`本书共 ${totalMain} 个主要章节，结构清晰，便于逐章阅读。`);
	} else {
		analysis.push(`本书共 ${totalMain} 个章节，内容丰富，建议先浏览目录把握整体脉络。`);
	}

	// 章节长度分析
	if (avgLength < 10) {
		analysis.push('各章节较短，适合碎片化阅读。');
	} else if (avgLength > 30) {
		analysis.push('各章节篇幅较长，建议预留充足阅读时间。');
	}

	return analysis.join(' ');
}
