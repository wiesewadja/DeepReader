/**
 * extract_propositions Tool - 找出关键句子，提炼作者主旨
 *
 * 对应《如何阅读一本书》分析阅读规则6：
 * - 规则6：从最重要的句子中抓出作者的重要主旨（propositions）
 * - 主旨 = 作者对某事的判断/声明/观点
 * - 找出关键句，判断其是否构成主旨
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

const EXTRACT_PROPOSITIONS_DEFINITION: ToolDefinition = {
	type: 'function',
	function: {
		name: 'extract_propositions',
		description:
			'分析阅读（规则6）：从章节中提取作者的核心主旨和论点。返回关键句子、主旨陈述和论证结构。用于深入理解作者的观点。',
		parameters: {
			type: 'object',
			properties: {
				node_id: {
					type: 'string',
					description: '要分析的章节 ID',
				},
				focus_type: {
					type: 'string',
					enum: ['all', 'claims', 'arguments', 'definitions'],
					description: '提取重点类型：all（全部）、claims（主要论点）、arguments（论证过程）、definitions（定义说明）',
				},
				max_propositions: {
					type: 'number',
					description: '最多返回的主旨数量（默认 5）',
				},
			},
			required: ['node_id'],
		},
	},
};

export const extractPropositionsTool: ToolExecutor = {
	definition: EXTRACT_PROPOSITIONS_DEFINITION,

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		const nodeId = args.node_id as string;
		const focusType = (args.focus_type as string) || 'all';
		const maxPropositions = (args.max_propositions as number) || 5;

		if (!nodeId) {
			return 'Error: node_id 参数是必需的';
		}

		try {
			log('[extract_propositions] 提取主旨:', { nodeId, focusType, maxPropositions, indexId: context.indexId });

			// 获取章节内容
			const exportData = await deeppdfClient.exportIndex(context.indexId);
			const node = exportData.nodes.find((n) => n.node_id === nodeId);

			if (!node) {
				return `Error: 未找到章节 "${nodeId}"`;
			}

			// 提取主旨
			const propositions = extractPropositions(node.text, focusType, maxPropositions);

			// 格式化输出
			const result = formatPropositionsOutput(node.node_name, propositions, focusType);

			log('[extract_propositions] 提取完成，主旨数:', propositions.length);
			return result;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			logError('[extract_propositions] 提取失败:', errorMsg);
			return `Error extracting propositions: ${errorMsg}`;
		}
	},
};

/**
 * 主旨信息
 */
interface PropositionInfo {
	type: 'claim' | 'argument' | 'definition';
	sentence: string;
	importance: number; // 1-5
	indicators: string[]; // 指示词
}

/**
 * 提取主旨
 */
function extractPropositions(
	text: string,
	focusType: string,
	maxPropositions: number
): PropositionInfo[] {
	const sentences = splitIntoSentences(text);
	const candidates: PropositionInfo[] = [];

	// 主旨指示词
	const claimIndicators = [
		'因此', '所以', '由此可见', '这表明', '这证明',
		'我认为', '作者认为', '本书认为', '可以说',
		'结论是', '结果是', '关键在于',
		'therefore', 'thus', 'hence', 'so', 'consequently',
		'I argue', 'the thesis is', 'the point is',
	];

	const argumentIndicators = [
		'因为', '由于', '鉴于', '基于', '根据',
		'首先', '其次', '再次', '最后', '第一', '第二',
		'例如', '比如', '譬如', '以...为例',
		'because', 'since', 'as', 'for', 'due to',
		'first', 'second', 'finally', 'for example', 'for instance',
	];

	const definitionIndicators = [
		'是指', '即', '指的是', '定义为', '称为',
		'所谓', '意思是', '可以理解为',
		'means', 'refers to', 'is defined as', 'is called',
	];

	for (const sentence of sentences) {
		// 跳过太短或太长的句子
		if (sentence.length < 15 || sentence.length > 500) continue;

		const foundIndicators: string[] = [];
		let type: PropositionInfo['type'] = 'claim';
		let importance = 1;

		// 检查论点指示词
		for (const indicator of claimIndicators) {
			if (sentence.includes(indicator)) {
				foundIndicators.push(indicator);
				type = 'claim';
				importance = Math.max(importance, 4);
			}
		}

		// 检查论证指示词
		for (const indicator of argumentIndicators) {
			if (sentence.includes(indicator)) {
				foundIndicators.push(indicator);
				if (type !== 'claim') type = 'argument';
				importance = Math.max(importance, 3);
			}
		}

		// 检查定义指示词
		for (const indicator of definitionIndicators) {
			if (sentence.includes(indicator)) {
				foundIndicators.push(indicator);
				if (type !== 'claim') type = 'definition';
				importance = Math.max(importance, 2);
			}
		}

		// 额外的重要性判断
		if (isImportantSentence(sentence)) {
			importance = Math.max(importance, 3);
		}

		// 只保留有指示词或重要性高的句子
		if (foundIndicators.length > 0 || importance >= 3) {
			// 根据焦点类型过滤
			if (focusType !== 'all' && focusType !== type + 's') {
				continue;
			}

			candidates.push({
				type,
				sentence,
				importance,
				indicators: [...new Set(foundIndicators)],
			});
		}
	}

	// 按重要性排序并去重
	const sorted = candidates
		.sort((a, b) => b.importance - a.importance || b.indicators.length - a.indicators.length)
		.slice(0, maxPropositions * 2);

	// 去除过于相似的句子
	const unique: PropositionInfo[] = [];
	for (const prop of sorted) {
		if (unique.length >= maxPropositions) break;
		if (!unique.some((u) => similarity(u.sentence, prop.sentence) > 0.5)) {
			unique.push(prop);
		}
	}

	return unique;
}

/**
 * 将文本分割为句子
 */
function splitIntoSentences(text: string): string[] {
	// 中文和英文句子分隔
	const sentences = text
		.split(/(?<=[。！？.!?])\s*/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	return sentences;
}

/**
 * 判断是否为重要句子
 */
function isImportantSentence(sentence: string): boolean {
	// 包含关键动词
	const keyVerbs = [
		'证明', '表明', '说明', '揭示', '发现',
		'认为', '主张', '提出', '强调', '指出',
		'must', 'should', 'need to', 'essential', 'important',
		'prove', 'show', 'demonstrate', 'reveal',
	];

	for (const verb of keyVerbs) {
		if (sentence.toLowerCase().includes(verb)) {
			return true;
		}
	}

	// 包含强语气词
	const strongWords = [
		'必须', '一定', '必然', '绝对', '关键', '核心',
		'must', 'always', 'never', 'essential', 'crucial',
	];

	for (const word of strongWords) {
		if (sentence.toLowerCase().includes(word)) {
			return true;
		}
	}

	// 以结论性词语开头
	const conclusionStarts = [
		'因此', '所以', '总之', '综上所述', '由此可见',
		'therefore', 'thus', 'in conclusion', 'in summary',
	];

	for (const start of conclusionStarts) {
		if (sentence.startsWith(start)) {
			return true;
		}
	}

	return false;
}

/**
 * 简单的相似度计算（基于词汇重叠）
 */
function similarity(s1: string, s2: string): number {
	const words1 = new Set(s1.split(/\s+/));
	const words2 = new Set(s2.split(/\s+/));

	const intersection = new Set([...words1].filter((x) => words2.has(x)));
	const union = new Set([...words1, ...words2]);

	return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * 格式化输出
 */
function formatPropositionsOutput(
	chapterName: string,
	propositions: PropositionInfo[],
	focusType: string
): string {
	const lines: string[] = [];

	const typeLabel: Record<string, string> = {
		claim: '核心论点',
		argument: '论证过程',
		definition: '定义说明',
	};

	lines.push(`# 「${chapterName}」核心主旨`);
	lines.push('');

	if (propositions.length === 0) {
		lines.push('未能识别到明显的主旨或论点。');
		lines.push('');
		lines.push('可能的原因：');
		lines.push('- 该章节主要是描述性内容');
		lines.push('- 论点较为隐含，需要结合上下文理解');
		lines.push('- 建议使用 focus_type="all" 获取更全面的分析');
		return lines.join('\n');
	}

	lines.push(`共识别到 **${propositions.length}** 个主旨：`);
	lines.push('');

	// 按类型分组
	const grouped: Record<string, PropositionInfo[]> = {
		claim: [],
		argument: [],
		definition: [],
	};

	for (const prop of propositions) {
		grouped[prop.type].push(prop);
	}

	// 输出各组
	for (const [type, typeProps] of Object.entries(grouped)) {
		if (typeProps.length === 0) continue;
		if (focusType !== 'all' && focusType !== type + 's') continue;

		lines.push(`## ${typeLabel[type]}`);
		lines.push('');

		for (let i = 0; i < typeProps.length; i++) {
			const prop = typeProps[i];
			const importanceStars = '⭐'.repeat(prop.importance);

			lines.push(`### ${i + 1}. ${prop.indicators.length > 0 ? `[${prop.indicators[0]}]` : ''}`);
			lines.push('');
			lines.push(`> ${prop.sentence}`);
			lines.push('');
			lines.push(`重要性: ${importanceStars}`);
			if (prop.indicators.length > 1) {
				lines.push(`指示词: ${prop.indicators.join(', ')}`);
			}
			lines.push('');
		}
	}

	// 添加阅读建议
	lines.push('---');
	lines.push('');
	lines.push('💡 **阅读提示**: 主旨是作者的核心观点。要检验自己是否理解了主旨，试着：');
	lines.push('1. 用自己的话重述这个主旨');
	lines.push('2. 举出一个例子来说明这个主旨');
	lines.push('3. 思考这个主旨与你的经验或知识有何关联');

	return lines.join('\n');
}

