/**
 * find_key_terms Tool - 识别并定义关键词汇和专业术语
 *
 * 对应《如何阅读一本书》分析阅读规则5：
 * - 规则5：找出重要的单字（word），透过它们与作者达成共识（coming to terms）
 * - 找出关键词汇，确认作者在这些词汇上的特殊用法
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

const FIND_KEY_TERMS_DEFINITION: ToolDefinition = {
	type: 'function',
	function: {
		name: 'find_key_terms',
		description:
			'分析阅读（规则5）：识别章节或全书中的关键词汇和专业术语。返回术语列表、定义和上下文。用于理解作者使用的核心概念。',
		parameters: {
			type: 'object',
			properties: {
				scope: {
					type: 'string',
					enum: ['chapter', 'book'],
					description: '分析范围：chapter（当前章节，需提供 node_id）或 book（整本书）',
				},
				node_id: {
					type: 'string',
					description: '章节 ID（当 scope=chapter 时必需）',
				},
				max_terms: {
					type: 'number',
					description: '最多返回的术语数量（默认 10）',
				},
			},
			required: ['scope'],
		},
	},
};

export const findKeyTermsTool: ToolExecutor = {
	definition: FIND_KEY_TERMS_DEFINITION,

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		const scope = args.scope as string;
		const nodeId = args.node_id as string | undefined;
		const maxTerms = (args.max_terms as number) || 10;

		try {
			log('[find_key_terms] 识别术语:', { scope, nodeId, maxTerms, indexId: context.indexId });

			let textToAnalyze: string;
			let scopeDescription: string;

			if (scope === 'chapter') {
				if (!nodeId) {
					return 'Error: node_id 参数在 scope=chapter 时是必需的';
				}

				// 获取章节内容
				const exportData = await deeppdfClient.exportIndex(context.indexId);
				const node = exportData.nodes.find((n) => n.node_id === nodeId);

				if (!node) {
					return `Error: 未找到章节 "${nodeId}"`;
				}

				textToAnalyze = node.text;
				scopeDescription = `章节「${node.node_name}」`;
			} else {
				// 整本书：采样多个章节
				const exportData = await deeppdfClient.exportIndex(context.indexId);
				const sampledNodes = exportData.nodes.slice(0, 10);
				textToAnalyze = sampledNodes.map((n) => n.text).join('\n\n');
				scopeDescription = `《${context.pdfName || '本书'}》`;
			}

			// 提取术语
			const terms = extractKeyTerms(textToAnalyze, maxTerms);

			// 格式化输出
			const result = formatTermsOutput(scopeDescription, terms);

			log('[find_key_terms] 识别完成，术语数:', terms.length);
			return result;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			logError('[find_key_terms] 识别失败:', errorMsg);
			return `Error finding key terms: ${errorMsg}`;
		}
	},
};

/**
 * 术语信息
 */
interface TermInfo {
	term: string;
	frequency: number;
	contexts: string[];
	likelyType: '专业术语' | '关键概念' | '人名/地名' | '缩写';
}

/**
 * 提取关键术语
 */
function extractKeyTerms(text: string, maxTerms: number): TermInfo[] {
	// 停用词列表
	const stopWords = new Set([
		// 中文停用词
		'的', '是', '在', '和', '与', '或', '有', '被', '将', '能', '会', '了', '着', '过',
		'这', '那', '个', '之', '以', '为', '于', '也', '都', '就', '而', '及', '等', '中',
		'上', '下', '不', '又', '很', '但', '如', '要', '可', '对', '到', '从', '把', '比',
		// 英文停用词
		'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
		'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
		'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
		'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
		'as', 'if', 'when', 'where', 'which', 'who', 'what', 'how', 'why', 'all', 'each',
	]);

	// 提取候选术语
	const candidates: Map<string, { count: number; contexts: string[] }> = new Map();

	// 1. 提取中文术语（2-6字的专有名词模式）
	// 匹配引号内的词、书名号内的词、带定义的词
	const quotedTerms = text.match(/["「『]([^"「』」』]+)["」』]/g) || [];
	for (const match of quotedTerms) {
		const term = match.slice(1, -1).trim();
		if (term.length >= 2 && term.length <= 10 && !stopWords.has(term)) {
			const existing = candidates.get(term) || { count: 0, contexts: [] };
			existing.count += 2; // 引号内的词权重更高
			existing.contexts.push(extractContext(text, term));
			candidates.set(term, existing);
		}
	}

	// 2. 提取带定义的术语（"XX是指"、"XX即"等）
	const definitionPatterns = [
		/([^\s，。！？]{2,8})(?:是指|即|指的是|定义为|称为)/g,
		/(?:所谓|定义的)([^\s，。！？]{2,8})(?:，|：|是)/g,
	];

	for (const pattern of definitionPatterns) {
		let match;
		while ((match = pattern.exec(text)) !== null) {
			const term = match[1].trim();
			if (!stopWords.has(term) && term.length >= 2) {
				const existing = candidates.get(term) || { count: 0, contexts: [] };
				existing.count += 3; // 有定义的术语权重最高
				existing.contexts.push(extractContext(text, term));
				candidates.set(term, existing);
			}
		}
	}

	// 3. 提取高频专业词汇（全大写、混合大小写、含数字的词）
	const technicalTerms = text.match(/[A-Z][A-Z0-9]{2,}/g) || [];
	const mixedCaseTerms = text.match(/[a-z]+[A-Z][a-zA-Z]*/g) || [];

	for (const term of [...technicalTerms, ...mixedCaseTerms]) {
		if (!stopWords.has(term.toLowerCase())) {
			const existing = candidates.get(term) || { count: 0, contexts: [] };
			existing.count += 1;
			existing.contexts.push(extractContext(text, term));
			candidates.set(term, existing);
		}
	}

	// 4. 提取重复出现的多字词组
	const chinesePhrases = text.match(/[\u4e00-\u9fa5]{3,6}/g) || [];
	const phraseCount: Map<string, number> = new Map();
	for (const phrase of chinesePhrases) {
		if (!stopWords.has(phrase)) {
			phraseCount.set(phrase, (phraseCount.get(phrase) || 0) + 1);
		}
	}

	for (const [phrase, count] of phraseCount) {
		if (count >= 3) {
			const existing = candidates.get(phrase) || { count: 0, contexts: [] };
			existing.count += count;
			existing.contexts.push(extractContext(text, phrase));
			candidates.set(phrase, existing);
		}
	}

	// 排序并取前 N 个
	const sortedTerms = Array.from(candidates.entries())
		.filter(([term]) => term.length >= 2)
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, maxTerms);

	// 转换为 TermInfo
	return sortedTerms.map(([term, info]) => ({
		term,
		frequency: info.count,
		contexts: info.contexts.slice(0, 2),
		likelyType: classifyTerm(term),
	}));
}

/**
 * 提取上下文
 */
function extractContext(text: string, term: string): string {
	const index = text.indexOf(term);
	if (index === -1) return '';

	const start = Math.max(0, index - 30);
	const end = Math.min(text.length, index + term.length + 30);

	let context = text.slice(start, end);

	// 添加省略号
	if (start > 0) context = '...' + context;
	if (end < text.length) context = context + '...';

	return context.replace(/\n/g, ' ').trim();
}

/**
 * 分类术语类型
 */
function classifyTerm(term: string): TermInfo['likelyType'] {
	// 全大写或含数字 - 可能是缩写
	if (/^[A-Z0-9]+$/.test(term) || /[A-Z]{2,}/.test(term)) {
		return '缩写';
	}

	// 驼峰命名 - 可能是专业术语
	if (/[a-z][A-Z]/.test(term)) {
		return '专业术语';
	}

	// 中文名称 - 根据长度判断
	if (/[\u4e00-\u9fa5]/.test(term)) {
		if (term.length <= 3) {
			return '关键概念';
		}
		return '专业术语';
	}

	return '关键概念';
}

/**
 * 格式化输出
 */
function formatTermsOutput(scopeDescription: string, terms: TermInfo[]): string {
	const lines: string[] = [];

	lines.push(`# ${scopeDescription} 关键术语`);
	lines.push('');

	if (terms.length === 0) {
		lines.push('未能识别到明显的专业术语或关键概念。');
		lines.push('');
		lines.push('建议：');
		lines.push('- 尝试分析更具体的章节');
		lines.push('- 检查文本是否包含专业内容');
		return lines.join('\n');
	}

	lines.push(`共识别到 **${terms.length}** 个关键术语：`);
	lines.push('');

	// 按类型分组
	const groupedTerms: Record<TermInfo['likelyType'], TermInfo[]> = {
		'专业术语': [],
		'关键概念': [],
		'人名/地名': [],
		'缩写': [],
	};

	for (const term of terms) {
		groupedTerms[term.likelyType].push(term);
	}

	// 输出各组
	for (const [type, typeTerms] of Object.entries(groupedTerms)) {
		if (typeTerms.length === 0) continue;

		lines.push(`## ${type}`);
		lines.push('');

		for (const term of typeTerms) {
			lines.push(`### ${term.term}`);
			lines.push(`- **出现频次**: ${term.frequency}`);

			if (term.contexts.length > 0) {
				lines.push(`- **上下文示例**: "${term.contexts[0]}"`);
			}

			lines.push('');
		}
	}

	// 添加使用提示
	lines.push('---');
	lines.push('');
	lines.push('💡 **提示**: 理解这些术语的准确含义对于深入阅读本书至关重要。');
	lines.push('建议在阅读过程中特别关注作者对这些术语的定义和使用方式。');

	return lines.join('\n');
}
