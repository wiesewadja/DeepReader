/**
 * Agent 内容解析 — 将 XML 标签转换为 HTML/Markdown 格式
 * 利用 Obsidian 的渲染能力直接展示
 */

import { uiLog as log } from '../../utils/logger.js';
import type { AgentToolCall, AgentThought } from './types.js';

/**
 * 解析 Agent 内容
 *
 * 简化方案：不再提取 structured data，而是将 XML 标签转换为 HTML/Markdown 格式
 * 直接利用 Obsidian 的渲染能力。
 */
export function parseAgentContent(content: string): {
	thoughts: AgentThought[]; // 保持接口兼容，当前版本返回空数组
	toolCalls: AgentToolCall[];
	cleanedContent: string;
} {
	// 0. 提取并移除状态行
	// 后端发送的状态行格式示例：
	// - 💭 *正在分析您的问题...*
	// - 🔍 *正在查看文档目录...*
	// - 🔎 *正在搜索相关内容...*
	// - 📖 *正在读取指定页面...*
	//
	// 策略：状态行必须满足以下条件之一（避免误匹配正文中的普通句子）：
	// 1. 以 Emoji 开头，后跟可选斜体标记和状态关键词（最可靠）
	// 2. 整行以斜体标记包裹（*...*），且包含状态关键词，且长度 < 50 字符（备用）
	const statusKeywords = ['搜索中', '分析中', '整理中', '查看中', '阅读中', '查目录', '正在'];
	const keywordPattern = statusKeywords.join('|');

	// Emoji 范围：Miscellaneous Symbols, Dingbats, 以及 Emoji 范围
	const emojiPattern = '(?:[\\u2300-\\u27BF]|[\\uD83C-\\uD83E][\\uDC00-\\uDFFF]|[\\u2600-\\u26FF])';

	// 匹配模式 1：以 Emoji 开头的状态行（最可靠）
	// 例如：💭 *正在分析您的问题...*
	const emojiStatusRegex = new RegExp(
		`^\\s*${emojiPattern}\\s*\\*?(?:${keywordPattern})[^\\n]*\\*?\\s*$`,
		'gm'
	);

	// 匹配模式 2：纯斜体包裹的短状态行（备用，需满足长度限制）
	// 例如：*正在搜索...* （必须 < 50 字符）
	const italicStatusRegex = new RegExp(
		`^\\s*\\*(?:${keywordPattern})[^\\n]{0,40}\\*\\s*$`,
		'gm'
	);

	let currentStatus: string | undefined;

	// 优先从 Emoji 状态行提取
	let match;
	while ((match = emojiStatusRegex.exec(content)) !== null) {
		const line = match[0].trim();
		// 清理 Markdown 符号，只保留纯文本状态
		currentStatus = line.replace(/^\s*|\*+|\s*$/g, '').trim();
		log('[DeepPDF] 检测到 Emoji 状态行:', currentStatus);
	}

	// 如果没有 Emoji 状态行，尝试匹配斜体状态行
	if (!currentStatus) {
		while ((match = italicStatusRegex.exec(content)) !== null) {
			const line = match[0].trim();
			// 额外检查：整行长度必须 < 50（排除长句子）
			if (line.length < 50) {
				currentStatus = line.replace(/^\s*|\*+|\s*$/g, '').trim();
				log('[DeepPDF] 检测到斜体状态行:', currentStatus);
			}
		}
	}

	// 从正文中移除所有状态行（两种模式都移除）
	let processedContent = content.replace(emojiStatusRegex, '').replace(italicStatusRegex, '');

	// 1. 静默移除思考内容（不显示在最终回复中）

	// 移除闭合的 thought 标签及其内容
	const thoughtRegex = /<thought\b[^>]*>([\s\S]*?)<\/thought>/gi;
	processedContent = processedContent.replace(thoughtRegex, '');

	// 移除未闭合的 thought 标签（流式传输中可能出现）
	processedContent = processedContent.replace(/<thought\b[^>]*>[\s\S]*$/i, '');

	// 2. 移除 invoke 标签
	processedContent = processedContent
		.replace(/<invoke>/gi, '\n')
		.replace(/<\/invoke>/gi, '\n');

	// 2.1 移除 DSML 格式标签（DeepSeek API 返回的特殊格式）
	processedContent = processedContent
		.replace(/<\/?｜DSML｜[^>]*>/gi, '')
		.replace(/<｜DSML｜[^>]*$/gi, '')
		.replace(/<\/?DSML_[^>]*>/gi, '')
		.replace(/｜DSML｜/gi, '');

	// 3. 移除 tool_call 标签及其内容
	processedContent = processedContent.replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '');
	processedContent = processedContent.replace(/<tool_call[\s\S]*$/i, '');

	// 4. 移除中间说明文字（LLM 在调用工具前后的冗余说明）
	const intermediatePatterns = [
		/^.*让我[先再]*搜索.*[:：]?\s*$/gm,
		/^.*让我[先再]*查看.*[:：]?\s*$/gm,
		/^.*让我[先再]*阅读.*[:：]?\s*$/gm,
		/^.*让我[先再]*查找.*[:：]?\s*$/gm,
		/^.*现在让我.*[:：]?\s*$/gm,
		/^.*我来[帮]*您搜索.*[:：]?\s*$/gm,
		/^.*我来[帮]*您查看.*[:：]?\s*$/gm,
		/^.*我先查看.*[:：]?\s*$/gm,
		/^根据目录.*让我.*$/gm,
		/^我将.*搜索.*[:：]?\s*$/gm,
		/^让我[获取查找搜索查看阅读].*[,，].*$/gm,
		/^现在让我[开始]*.*[,，].*$/gm,
		/^基于.*让我.*$/gm,
		/^.*让我继续.*$/gm,
		/^.*让我使用.*技能.*$/gm,
		/^首先让我.*$/gm,
		/^.*我先[创建生成写].*$/gm,
		/^现在[创建生成写].*$/gm,
	];

	for (const pattern of intermediatePatterns) {
		processedContent = processedContent.replace(pattern, '');
	}

	// 4.1 移除连续的空行（由上面的替换产生）
	processedContent = processedContent.replace(/\n{3,}/g, '\n\n');

	// 5. 提取工具调用
	const toolCalls: AgentToolCall[] = [];
	const validToolNames = ['inspect_toc', 'read_page', 'hybrid_search'];
	const toolCallRegex = new RegExp(`(${validToolNames.join('|')})\\s*\\(([^)]*)\\)`, 'gi');
	let toolMatch;
	const seenToolCalls = new Set<string>();

	const errorIndicators = ['ERROR', 'error', 'Error', 'FAILED', 'failed', 'Failed', 'Exception', 'exception'];

	while ((toolMatch = toolCallRegex.exec(content)) !== null) {
		const toolName = toolMatch[1].toLowerCase();
		const args = toolMatch[2];
		const callKey = `${toolName}:${args}`;
		if (!seenToolCalls.has(callKey)) {
			seenToolCalls.add(callKey);
			const hasError = errorIndicators.some(indicator => args.includes(indicator));
			toolCalls.push({
				name: toolName,
				args: args,
				status: hasError ? 'error' : 'success'
			});
		}
	}

	// 后备策略：如果正则没提取到状态，且正文内容还很短(处于工具执行阶段)，尝试推断状态
	if (!currentStatus && toolCalls.length > 0 && processedContent.length < 20) {
		const lastTool = toolCalls[toolCalls.length - 1];
		if (lastTool.name === 'inspect_toc') currentStatus = '正在查看目录...';
		else if (lastTool.name === 'read_page') currentStatus = '正在阅读页面...';
		else if (lastTool.name === 'hybrid_search') currentStatus = '正在搜索内容...';
	}

	// 清理多余的连续空行
	processedContent = processedContent.replace(/\n{3,}/g, '\n\n').trim();

	return {
		thoughts: [],
		toolCalls,
		cleanedContent: processedContent,
	};
}
