/**
 * DeepPDF 消息组件
 * 实现 ChatGPT 风格的聊天消息界面，支持 Markdown 渲染和流式更新
 */

import { App, MarkdownRenderer, Component, HoverParent, HoverPopover, MarkdownView } from 'obsidian';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';
import type { QuoteMetadata } from '../chat-input/chat-input';
import { SelectionMenu } from '../excerpt/selection-menu';
import { uiLog as log, error as logError } from '../../utils/logger.js';

/**
 * 消息角色类型
 */
export type MessageRole = 'user' | 'assistant';

/**
 * Agent 工具调用数据结构
 */
export interface AgentToolCall {
	/** 工具名称 */
	name: string;
	/** 工具参数 */
	args: string;
	/** 执行状态 */
	status: 'pending' | 'success' | 'error';
	/** 执行结果 */
	result?: string;
}

/**
 * Agent 思考过程数据结构
 */
export interface AgentThought {
	/** 思考内容 */
	content: string;
	/** 步骤编号 */
	step?: number;
}

/**
 * 解析 Agent 内容
 *
 * 简化方案：不再提取 structured data，而是将 XML 标签转换为 HTML/Markdown 格式
 * 直接利用 Obsidian 的渲染能力。
 */
export function parseAgentContent(content: string): {
	thoughts: AgentThought[]; // 保持接口兼容，但返回空数组
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
	// 用户只需要看到执行状态提示，不需要看到思考过程

	// 移除闭合的 thought 标签及其内容
	const thoughtRegex = /<thought\b[^>]*>([\s\S]*?)<\/thought>/gi;
	processedContent = processedContent.replace(thoughtRegex, '');

	// 移除未闭合的 thought 标签（流式传输中可能出现）
	// 移除 <thought...> 到文末的所有内容
	processedContent = processedContent.replace(/<thought\b[^>]*>[\s\S]*$/i, '');

	// 2. 移除 invoke 标签
	processedContent = processedContent
		.replace(/<invoke>/gi, '\n')
		.replace(/<\/invoke>/gi, '\n');

	// 2.1 移除 DSML 格式标签（DeepSeek API 返回的特殊格式）
	// 格式如: </｜DSML｜invoke>, </｜DSML｜function_calls>, <｜DSML｜...>
	processedContent = processedContent
		.replace(/<\/?｜DSML｜[^>]*>/gi, '')  // 闭合标签
		.replace(/<｜DSML｜[^>]*$/gi, '')     // 未闭合标签
		.replace(/<\/?DSML_[^>]*>/gi, '')    // DSML_xxx 格式
		.replace(/｜DSML｜/gi, '');           // 纯文本残留

	// 3. 移除 tool_call 标签及其内容
	processedContent = processedContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
	processedContent = processedContent.replace(/<tool_call>[\s\S]*$/i, ''); // 未闭合的

	// 4. 移除中间说明文字（LLM 在调用工具前后的冗余说明）
	// 这些文字通常以特定模式开头，不应该显示给用户
	const intermediatePatterns = [
		// 整行模式
		/^.*让我[先再]*搜索.*[:：]?\s*$/gm,      // "让我搜索..."
		/^.*让我[先再]*查看.*[:：]?\s*$/gm,      // "让我查看..."
		/^.*让我[先再]*阅读.*[:：]?\s*$/gm,      // "让我阅读..."
		/^.*让我[先再]*查找.*[:：]?\s*$/gm,      // "让我查找..."
		/^.*现在让我.*[:：]?\s*$/gm,             // "现在让我..."
		/^.*我来[帮]*您搜索.*[:：]?\s*$/gm,      // "我来帮您搜索..."
		/^.*我来[帮]*您查看.*[:：]?\s*$/gm,      // "我来帮您查看..."
		/^.*我先查看.*[:：]?\s*$/gm,             // "我先查看..."
		/^根据目录.*让我.*$/gm,                  // "根据目录...让我..."
		/^我将.*搜索.*[:：]?\s*$/gm,             // "我将搜索..."
		// 段落内模式（可能不是单独一行）
		/^让我[获取查找搜索查看阅读].*[,，].*$/gm,  // "让我获取...,以便..."
		/^现在让我[开始]*.*[,，].*$/gm,           // "现在让我开始创建..."
		/^基于.*让我.*$/gm,                       // "基于...让我..."
		/^.*让我继续.*$/gm,                       // "让我继续获取..."
		/^.*让我使用.*技能.*$/gm,                 // "让我使用知识卡片生成技能..."
		/^首先让我.*$/gm,                         // "首先让我..."
		/^.*我先[创建生成写].*$/gm,               // "我先创建..."
		/^现在[创建生成写].*$/gm,                  // "现在创建..."
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

	// 错误指示符列表（用于判断工具调用是否失败）
	const errorIndicators = ['ERROR', 'error', 'Error', 'FAILED', 'failed', 'Failed', 'Exception', 'exception'];

	while ((toolMatch = toolCallRegex.exec(content)) !== null) {
		const toolName = toolMatch[1].toLowerCase();
		const args = toolMatch[2];
		const callKey = `${toolName}:${args}`;
		if (!seenToolCalls.has(callKey)) {
			seenToolCalls.add(callKey);
			// 判断状态：
			// - error: args 包含明确的错误指示符（如 "ERROR:", "Exception:", "FAILED"）
			// - success: 其他情况（默认成功，因为工具调用已完成并返回了结果）
			//
			// 注意：这里只检查 args 是否包含错误信息，因为工具调用语法本身出现
			// 就意味着调用已经完成（成功或失败）
			const hasError = errorIndicators.some(indicator => args.includes(indicator));
			toolCalls.push({
				name: toolName,
				args: args,
				status: hasError ? 'error' : 'success'
			});
		}
	}

	// 后备策略：如果正则没提取到状态，且正文内容还很短(处于工具执行阶段)，尝试推断状态
	// 一旦正文内容变长，说明已经开始回答，不再显示工具状态
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

/**
 * 消息数据结构
 */
export interface MessageData {
	/** 消息唯一标识 */
	id: string;
	/** 消息角色（用户或 AI） */
	role: MessageRole;
	/** 消息内容（纯文本或 Markdown） */
	content: string;
	/** 时间戳 */
	timestamp: string;
	/** 可选：是否正在生成 */
	isStreaming?: boolean;
	/** 可选：是否为 Agent 消息 */
	isAgentMessage?: boolean;
	/** 可选：Agent 思考过程 */
	agentThoughts?: AgentThought[];
	/** 可选：Agent 工具调用列表 */
	agentToolCalls?: AgentToolCall[];
	/** 可选：当前状态文本（如"正在搜索..."） */
	currentStatus?: string;
	/** 可选：当前阅读层次 */
	readingLevel?: 'elementary' | 'inspectional' | 'analytical' | 'syntopical' | 'skill';
	/** 可选：已完成步骤列表 */
	completedSteps?: string[];
	/** 可选：关联的 PDF 文件名 */
	pdfName?: string;
	/** 可选：关联的页码 */
	page?: number;
	/** 可选：关联的用户问题 */
	question?: string;
	/** 可选：对话 ID */
	conversationId?: string;
	/** 可选：是否隐藏（用于画像更新消息，不显示但发送给 LLM） */
	hidden?: boolean;
	/** 可选：是否折叠（用于长消息的折叠显示） */
	collapsed?: boolean;
}


/**
 * HTML 转义工具函数
 */
function escapeHtml(text: string): string {
	if (!text) return '';
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * 格式化时间戳
 */
function formatTimestamp(isoString: string): string {
	try {
		const date = new Date(isoString);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	} catch (e) {
		return '';
	}
}

/**
 * 从 Markdown 内容中提取特定块引用的内容
 * @param content - 完整的 Markdown 内容
 * @param blockRef - 块引用 ID（如 "page-175"）
 * @returns 提取的章节内容，如果找不到则返回空字符串
 */
function extractSectionByBlockRef(content: string, blockRef: string): string {
	const lines = content.split('\n');

	// 查找块引用的位置 ^blockRef
	const blockRefPattern = new RegExp(`^\\^${blockRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
	let blockIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		if (blockRefPattern.test(lines[i])) {
			blockIndex = i;
			break;
		}
	}

	// 如果找到块引用，提取从块引用到下一个标题或块引用之间的内容
	if (blockIndex !== -1) {
		const sectionLines: string[] = [];

		// 从块引用之后开始收集内容
		for (let i = blockIndex + 1; i < lines.length; i++) {
			const line = lines[i];

			// 遇到任何标题（# 开头）或块引用（^ 开头）时停止
			if (/^#+\s/.test(line) || /^\^\w+/.test(line)) {
				break;
			}

			sectionLines.push(line);
		}

		const result = sectionLines.join('\n').trim();
		log('[extractSectionByBlockRef] Found block ref at index:', blockIndex);
		log('[extractSectionByBlockRef] Extracted lines:', sectionLines.length);
		return result;
	}

	// 如果没有找到块引用，尝试查找包含页码信息的标题
	// 例如: "### 第 175 页" 或类似格式
	const pageMatch = blockRef.match(/page-(\d+)/);
	if (pageMatch) {
		const pageNumber = parseInt(pageMatch[1]);
		const pagePattern = new RegExp(`^#+\\s*第\\s*${pageNumber}\\s*页`, 'm');

		for (let i = 0; i < lines.length; i++) {
			if (pagePattern.test(lines[i])) {
				const sectionLines: string[] = [lines[i]]; // 包含标题本身

				// 收集标题之后的内容，直到下一个标题
				for (let j = i + 1; j < lines.length; j++) {
					const line = lines[j];
					// 遇到任何标题时停止
					if (/^#+\s/.test(line)) {
						break;
					}
					sectionLines.push(line);
				}

				return sectionLines.join('\n').trim();
			}
		}
	}

	// 如果都找不到，返回空字符串
	return '';
}

/**
 * 处理内部链接的点击和悬停事件
 *
 * 注意：Obsidian 链接的解析和渲染由 Obsidian 原生的 MarkdownRenderer 处理。
 * 我们不使用自定义的 parseObsidianLinks/renderObsidianLink 函数，因为：
 * 1. MarkdownRenderer 已经完美支持 [[link]] 语法
 * 2. 避免重复解析导致的性能损失
 * 3. 利用 Obsidian 原生 API 的稳定性和持续维护
 * 4. setupInternalLinks 为渲染后的链接添加增强的交互功能
 *
 * 此函数为 MarkdownRenderer 渲染的内部链接添加：
 * - 点击：在侧边栏中以只读预览模式打开链接
 * - 悬停+Command：Obsidian 原生预览
 * - 悬停（无按键）：自定义章节预览（只显示引用的章节）
 * @param disableHoverPreview - 禁用 hover preview（用于 AI 流式传输期间）
 * @param observers - 用于跟踪和清理 MutationObserver 的数组（可选）
 * @returns 返回 mouseover 事件处理器，用于后续清理
 */
function setupInternalLinks(contentEl: HTMLElement, app: App, disableHoverPreview: boolean = false, observers?: MutationObserver[]): ((e: Event) => void) | null {
	const links = contentEl.querySelectorAll('a.internal-link');

	// 用于自定义预览
	let customPopover: HTMLElement | null = null;
	let showTimer: number | null = null;
	let hideTimer: number | null = null;

	// 持久的 HoverParent，让 Obsidian Page Preview 能正确管理 popover 生命周期
	const hoverParent: HoverParent = {
		hoverPopover: null
	};

	// 清理 popover 的函数
	const cleanupPopover = () => {
		if (customPopover) {
			customPopover.remove();
			customPopover = null;
		}
		if (showTimer) {
			window.clearTimeout(showTimer);
			showTimer = null;
		}
		if (hideTimer) {
			window.clearTimeout(hideTimer);
			hideTimer = null;
		}
	};

	links.forEach(link => {
		const href = link.getAttr('href');
		if (!href) return;

		// 检测链接指向的文件是否存在于 vault 中
		// href 格式可能为: filename#heading 或 filename|displaytext#heading
		// 需要先移除 | 后的显示文本，再移除 # 后的块引用
		let linkPath = href;
		// 移除显示文本（| 后面的部分）
		if (linkPath.includes('|')) {
			linkPath = linkPath.split('|')[0];
		}
		// 移除块引用（# 后面的部分）
		if (linkPath.includes('#')) {
			linkPath = linkPath.split('#')[0];
		}

		const linkedFile = app.metadataCache.getFirstLinkpathDest(linkPath, '');
		if (!linkedFile) {
			// 文件不存在，添加 is-unresolved 类（Obsidian 原生支持的类名）
			link.addClass('is-unresolved');
		}

		// 移除浏览器原生的 title tooltip，避免双重提示
		link.removeAttribute('title');

		// 使用 MutationObserver 监听并持续移除 title（防止 Obsidian 重新添加）
		const observer = new MutationObserver(() => {
			if (link.hasAttribute('title')) {
				link.removeAttribute('title');
			}
		});
		observer.observe(link, { attributes: true, attributeFilter: ['title'] });

		// 将 observer 添加到跟踪数组，以便后续清理
		if (observers) {
			observers.push(observer);
		}

		// 处理点击事件
		link.addEventListener('click', async (e) => {
			e.preventDefault();

			// 检测阅读模式状态
			const readingModeEl = document.querySelector('.deeppdf-reading-mode');
			const isReadingMode = !!readingModeEl;
			// 分页模式检测：有 paginator 设置的 CSS 变量
			const isPaginatedMode = isReadingMode && !!readingModeEl!.querySelector('.markdown-preview-view[style*="--deeppdf-col-width"]');

			// 从 href 中提取文件路径和 block ID
			// href 格式：filename#^blockid 或 filename#heading 或 #^blockid（同文件）
			// 先去掉显示文本（| 后面的部分）
			const hrefClean = href.includes('|') ? href.split('|')[0] : href;
			const hashIdx = hrefClean.indexOf('#');
			const linkFilePath = hashIdx >= 0 ? hrefClean.slice(0, hashIdx) : hrefClean;
			// block ID：# 后面的部分，去掉开头的 ^ 前缀（Obsidian DOM 中 id 属性带 ^）
			const rawFragment = hashIdx >= 0 ? hrefClean.slice(hashIdx + 1) : null;
			// rawFragment 可能是 ^blockid 或 heading-text
			const blockId = rawFragment?.startsWith('^') ? rawFragment.slice(1) : null;
			const headingFragment = rawFragment && !rawFragment.startsWith('^') ? rawFragment : null;

			/**
			 * 在当前活跃的 markdown preview 容器中查找 block 元素并滚动到它。
			 * Obsidian 渲染 block ID 的方式：段落末尾插入 <span id="^xxx"> 或 <a id="^xxx">
			 * 所以选择器需要匹配 id="^xxx"（带 ^）以及 data-block-id="xxx"（不带 ^）。
			 */
			const scrollToBlockInCurrentView = (delayMs = 50): void => {
				if (!blockId) return;
				setTimeout(() => {
					const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
					const container: Element = activeView?.previewMode?.renderer?.containerEl
						|| activeView?.containerEl
						|| document.body;
					// Obsidian 在段落末尾渲染 block ID 为 <span id="^xxx"> 或 <a id="^xxx">
					// 同时也可能有 data-block-id="xxx"（不带 ^）
					const blockSel = [
						`[id="^${CSS.escape(blockId)}"]`,
						`[data-block-id="${CSS.escape(blockId)}"]`,
						`[id="${CSS.escape(blockId)}"]`,
					].join(', ');
					const target = container.querySelector(blockSel);
					if (target) {
						// scrollIntoView 在分页模式下已被 ReadingModeService.patchScrollIntoView 拦截，
						// 会自动计算正确的横向滚动位置
						(target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
						log('[DeepPDF] Scrolled to block:', blockId);
					} else {
						log('[DeepPDF] Block not found in view:', blockId);
					}
				}, delayMs);
			};

			if (isPaginatedMode) {
				// 分页模式：在当前 leaf 内跳转，不新开 tab
				// ReadingModeService.patchScrollIntoView 已拦截 scrollIntoView，
				// 会自动将横向滚动定位到正确的列（页）

				if (!linkFilePath) {
					// 同文件内的 block/heading 跳转（href 形如 #^blockid 或 #heading）
					scrollToBlockInCurrentView(50);
				} else {
					// 跨文件跳转：检查目标文件是否就是当前打开的文件
					const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
					const currentFilePath = activeView?.file?.path || '';
					const targetFile = app.metadataCache.getFirstLinkpathDest(linkFilePath, currentFilePath);

					if (targetFile && targetFile.path === currentFilePath) {
						// 目标就是当前文件，直接跳转 block
						scrollToBlockInCurrentView(50);
					} else if (targetFile) {
						// 跨文件：用 openLinkText 在当前 leaf 打开目标文件
						// openLinkText 支持 #^blockid 语法，Obsidian 会在文件加载后自动跳转
						// 但分页模式下 scrollIntoView 已被 patch，所以跳转会正确横向定位
						await app.workspace.openLinkText(hrefClean, currentFilePath, false);
						// 额外保险：等文件加载后再尝试一次 block 跳转
						if (blockId) {
							scrollToBlockInCurrentView(400);
						}
					} else {
						// 文件不存在，降级处理
						log('[DeepPDF] Target file not found for link:', href);
					}
				}
			} else if (isReadingMode) {
				// 滚动阅读模式：跳转链接，如有 blockId 则滚动到对应位置
				if (blockId) {
					scrollToBlockInCurrentView(50);
				} else if (headingFragment) {
					// heading 跳转：用 openLinkText 处理
					const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
					const currentFilePath = activeView?.file?.path || '';
					app.workspace.openLinkText(hrefClean, currentFilePath, false);
				} else {
					// 普通 wiki 链接，正常打开
					app.workspace.openLinkText(href, '', false);
				}
			} else {
				// 非阅读模式：在当前 tab 打开
				app.workspace.openLinkText(href, '', false);

				// 延迟切换到预览模式
				setTimeout(() => {
					const activeLeaf = app.workspace.activeLeaf;
					if (activeLeaf) {
						activeLeaf.setViewState({
							type: 'markdown',
							state: { mode: 'preview' }
						});
					}
				}, 50);
			}
		});

		// 如果禁用 hover preview（AI 流式传输期间），则跳过 hover 事件设置
		if (disableHoverPreview) {
			return;
		}

		// 处理悬停事件 - 默认使用 Obsidian 原生 hover preview
		link.addEventListener('mouseenter', (event: MouseEvent) => {
			log('[DeepPDF] mouseenter on link:', href);

			// 清理之前的定时器
			if (showTimer) {
				window.clearTimeout(showTimer);
				showTimer = null;
			}
			if (hideTimer) {
				window.clearTimeout(hideTimer);
				hideTimer = null;
			}

			// 清理自定义 popover
			cleanupPopover();

			// 触发 Obsidian 原生 hover preview（支持所有文件类型，包括 Canvas）
			app.workspace.trigger('hover-link', {
				event: event,
				source: 'deeppdf',
				hoverParent: hoverParent,
				targetEl: link,
				linktext: href
			});
		});
	});

	return null;
}

/**
 * 消息基类
 */
export abstract class Message {
	protected el: HTMLElement | null = null;
	protected data: MessageData;
	protected app?: App;
	// 资源清理跟踪
	protected observers: MutationObserver[] = [];
	protected mouseoverHandler: ((e: Event) => void) | null = null;

	constructor(data: MessageData, app?: App) {
		this.data = data;
		this.app = app;
	}

	public getData(): MessageData {
		return this.data;
	}

	/**
	 * 渲染消息容器
	 */
	protected renderContainer(): HTMLElement {
		const container = document.createElement('div');
		container.addClass('deeppdf-message');
		container.addClass(`deeppdf-message-${this.data.role}`);
		container.setAttribute('data-message-id', this.data.id);
		return container;
	}

	/**
	 * 渲染时间戳
	 */
	protected renderTimestamp(): HTMLElement {
		const timeEl = document.createElement('div');
		timeEl.addClass('deeppdf-message-time');
		timeEl.textContent = formatTimestamp(this.data.timestamp);
		return timeEl;
	}

	protected escapeHtml(text: string): string {
		return escapeHtml(text);
	}

	abstract render(): HTMLElement;

	/**
	 * 更新消息内容 (优化版: 避免全量重绘)
	 */
	update(data: Partial<MessageData>): void {
		const oldContent = this.data.content;
		const oldAgentToolCalls = this.data.agentToolCalls;
		const wasStreaming = this.data.isStreaming;

		Object.assign(this.data, data);

		// 检查字段变化
		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;

		if (this.el &&
			data.content !== undefined &&
			data.content !== oldContent &&
			!agentToolCallsChanged &&
			!streamingEnded
		) {
			this.updateContent(data.content);
		} else if (streamingEnded && this.el) {
			// 流式结束，完整渲染
			// 补充渲染操作按钮（流式期间被跳过）
			this.onStreamingEnd();
			const contentEl = this.el.querySelector('.deeppdf-message-content');
			if (contentEl && this.app) {
				// 清理资源
				this.observers.forEach(obs => obs.disconnect());
				this.observers = [];
				if (this.mouseoverHandler) {
					document.removeEventListener('mouseover', this.mouseoverHandler);
					this.mouseoverHandler = null;
				}

				// 移除 loading 状态
				if ((contentEl as HTMLElement).hasClass('deeppdf-message-loading')) {
					(contentEl as HTMLElement).removeClass('deeppdf-message-loading');
				}

				// 使用解析后的内容（处理 HTML 标签）
				const { cleanedContent } = parseAgentContent(this.data.content);

				contentEl.empty();
				const sourcePath = this.data.pdfName || '';
				MarkdownRenderer.render(this.app, cleanedContent, contentEl as HTMLElement, sourcePath, new Component()).then(() => {
					this.mouseoverHandler = setupInternalLinks(contentEl as HTMLElement, this.app!, false, this.observers);
				});
			}
			this.el.removeClass('deeppdf-message-streaming');
		} else {
			// 全量重绘
			const newRender = this.render();
			if (this.el) {
				this.el.replaceWith(newRender);
			}
			this.el = newRender;
		}
	}


	/**
	 * 局部更新内容
	 */
	protected abstract updateContent(content: string): void;

	/**
	 * 流式结束后的钩子，子类可 override 补充渲染
	 */
	protected onStreamingEnd(): void {}

	getElement(): HTMLElement {
		if (!this.el) {
			throw new Error('Message element not initialized. Call render() first.');
		}
		return this.el;
	}
}

/**
 * 用户消息组件
 */
export class UserMessage extends Message {
	constructor(data: MessageData, app?: App) {
		super(data, app);
		this.el = this.render();
	}

	render(): HTMLElement {
		const container = this.renderContainer();
		const wrapper = container.createEl('div', { cls: 'deeppdf-message-wrapper' });
		const bubble = wrapper.createEl('div', { cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-user'] });

		const content = bubble.createEl('div', { cls: 'deeppdf-message-content' });

		// 用户消息支持 Markdown 渲染（如果 app 存在）
		if (this.app) {
			const sourcePath = this.data.pdfName || '';
			MarkdownRenderer.render(this.app, this.data.content, content, sourcePath, new Component());
		} else {
			content.innerHTML = this.escapeHtml(this.data.content);
		}

		bubble.appendChild(this.renderTimestamp());
		return container;
	}

	protected updateContent(content: string): void {
		const contentEl = this.el?.querySelector('.deeppdf-message-content');
		if (contentEl) {
			contentEl.empty();
			if (this.app) {
				const sourcePath = this.data.pdfName || '';
				MarkdownRenderer.render(this.app, content, contentEl as HTMLElement, sourcePath, new Component());
			} else {
				contentEl.innerHTML = this.escapeHtml(content);
			}
		}
	}
}

/**
 * AI 消息组件
 */
export class AIMessage extends Message {
	private onRegenerate?: () => void;
	private onCopy?: () => void;
	private onQuestionClick?: (question: string) => void;
	private onExcerpt?: (content: ExcerptContent, metadata: ExcerptMetadata) => void;
	private onQuote?: (metadata: QuoteMetadata) => void;
	private onDelete?: () => void;

		protected onStreamingEnd(): void {
			if (!this.el) return;
			const bubble = this.el.querySelector(".deeppdf-message-bubble");
			if (bubble) {
				this.renderActions(bubble as HTMLElement);
			}
		}

	// 节流渲染跟踪变量
	private lastRenderedContent: string = '';
	private lastRenderTime: number = 0;
	private lastRenderedLength: number = 0;
	private streamingAnimationFrame: number | null = null;
	// 状态显示跟踪：记录上次实际显示在 DOM 中的状态（用于判断是否需要更新）
	private lastDisplayedStatus: string | undefined = undefined;
	// 文字选中悬浮菜单
	private selectionMenu: SelectionMenu | null = null;
	// 状态文本元素引用
	private statusEl: HTMLElement | null = null;
	// 折叠状态
	private isCollapsed: boolean = false;
	// 信笺图案
	private patternClass: string = '';

	constructor(
		data: MessageData,
		options?: {
			onRegenerate?: () => void;
			onCopy?: () => void;
			onQuestionClick?: (question: string) => void;
			onExcerpt?: (content: ExcerptContent, metadata: ExcerptMetadata) => void;
			onQuote?: (metadata: QuoteMetadata) => void;
			onDelete?: () => void;
			getAllMessages?: () => MessageData[];
			app?: App;
		}
	) {
		super(data, options?.app);
		this.onRegenerate = options?.onRegenerate;
		this.onCopy = options?.onCopy;
		this.onQuestionClick = options?.onQuestionClick;
		this.onExcerpt = options?.onExcerpt;
		this.onQuote = options?.onQuote;
		this.onDelete = options?.onDelete;
		this.getAllMessages = options?.getAllMessages || null;
		// 初始化渲染跟踪变量
		this.lastRenderedContent = data.content;
		this.lastRenderTime = Date.now();
		this.lastRenderedLength = data.content.length;
		this.el = this.render();
	}

	/**
	 * 随机选择背景图案类
	 * 每个 AI 消息都是一封独特的信，给用户带来惊喜和新奇感
	 */
	private getRandomPatternClass(): string {
		const patterns = [
			'deeppdf-pattern-stars',       // 星空点阵 - 创意对话
			'deeppdf-pattern-grid',        // 网格蓝图 - 技术分析
			'deeppdf-pattern-wave',        // 波浪线条 - 故事讲述
			'deeppdf-pattern-honeycomb',   // 六边形蜂窝 - 科学讨论
			'deeppdf-pattern-glow',        // 渐变光晕 - 重要回复
			'deeppdf-pattern-dots-density',// 点阵密度 - 长消息
			'deeppdf-pattern-triangle',    // 三角形镶嵌 - 设计讨论
			'deeppdf-pattern-mixed',       // 混合图案 - 通用型
			'deeppdf-pattern-snow',        // 雪花点阵 - 冬日氛围
			'deeppdf-pattern-music',       // 音乐波浪 - 艺术内容
			'deeppdf-pattern-ink',         // 水墨晕染 - 东方美学
			'deeppdf-pattern-matrix',      // 科技矩阵 - 未来感
		];
		
		const randomIndex = Math.floor(Math.random() * patterns.length);
		const pattern = patterns[randomIndex];
		
		log('[DeepPDF] 🎨 AI 信件图案:', pattern);
		
		return pattern;
	}

	render(): HTMLElement {
		const container = this.renderContainer();
		const wrapper = container.createEl('div', { cls: 'deeppdf-message-wrapper' });

		// 随机选择背景图案（每次 AI 回复都是一封独特的信）
		const patternClass = this.getRandomPatternClass();
		this.patternClass = patternClass;
		const bubble = wrapper.createEl('div', { cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-ai', patternClass] });

		// Agent 消息标识 + 状态显示
		const headerRow = bubble.createEl('div', { cls: 'deeppdf-message-header-row' });

		// 左侧容器：Badge + 状态文本（垂直排列）
		if (this.data.isAgentMessage) {
			const leftContainer = headerRow.createEl('div', { cls: 'deeppdf-message-header-left' });

			// Badge
			const badge = leftContainer.createEl('div', { cls: 'deeppdf-message-agent-badge' });
			badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><path d="M8.5 8.5A2.5 2.5 0 0 0 8 10c0 1.5 1.5 2.5 3 2.5s3-1 3-2.5a2.5 2.5 0 0 0-.5-1.5"></path><path d="M15 15a5 5 0 0 1-5 5"></path></svg>奚童`;

			// 状态文本（Badge 正下方）
			this.statusEl = leftContainer.createEl('div', { cls: 'deeppdf-message-status-text' });
		}

		// 右侧按钮组（非流式时显示）
		if (!this.data.isStreaming) {
			const rightContainer = headerRow.createEl('div', { cls: 'deeppdf-message-header-right' });

			// 折叠按钮
			const collapseBtn = rightContainer.createEl('button', { cls: 'deeppdf-message-collapse-btn' });
			if (this.isCollapsed) {
				collapseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
				collapseBtn.title = "展开";
			} else {
				collapseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
				collapseBtn.title = "折叠";
			}
			collapseBtn.addEventListener('click', () => this.toggleCollapse());
		}

		// Agent 工具调用
		if (this.data.agentToolCalls && this.data.agentToolCalls.length > 0) {
			const toolsContainer = bubble.createEl('div', { cls: 'deeppdf-agent-tools' });

			this.data.agentToolCalls.forEach(toolCall => {
				const toolItem = toolsContainer.createEl('div', { cls: 'deeppdf-agent-tool-call' });

				// 根据状态添加样式类
				if (toolCall.status === 'success') {
					toolItem.addClass('deeppdf-agent-tool-call-success');
				} else if (toolCall.status === 'error') {
					toolItem.addClass('deeppdf-agent-tool-call-error');
				}

				const toolHeader = toolItem.createEl('div', { cls: 'deeppdf-agent-tool-header' });
				toolHeader.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6"></path><path d="M5.64 5.64l4.24 4.24m6.72 6.72l4.24 4.24"></path></svg>调用 <span class="deeppdf-agent-tool-name">${toolCall.name}</span>`;

				if (toolCall.args) {
					const toolArgs = toolItem.createEl('div', { cls: 'deeppdf-agent-tool-args' });
					toolArgs.textContent = toolCall.args;
				}

				if (toolCall.result) {
					const toolResult = toolItem.createEl('div', { cls: 'deeppdf-agent-tool-result' });
					toolResult.textContent = toolCall.result;
				}
			});
		}

		// 消息内容
		const content = bubble.createEl('div', { cls: 'deeppdf-message-content' });

		// 应用折叠状态
		if (this.isCollapsed) {
			content.addClass('deeppdf-message-collapsed');
		}

		// 如果正在流式传输且内容为空，显示加载动画
		if (this.data.isStreaming && (!this.data.content || this.data.content.trim().length === 0)) {
			content.addClass('deeppdf-message-loading');
			content.innerHTML = `<div class="deeppdf-loading-dots"><span></span><span></span><span></span></div>`;
		} else {
			// 使用 Markdown 渲染（先清理 <thought> 标签）
			if (this.app) {
				const { cleanedContent } = parseAgentContent(this.data.content);
				// 使用当前 PDF 文件路径作为 sourcePath，以便正确解析 wikilink
				const sourcePath = this.data.pdfName || '';
				MarkdownRenderer.render(this.app, cleanedContent, content, sourcePath, new Component()).then(() => {
					// 设置内部链接的点击事件和 hover preview
					// 如果正在流式传输，禁用 hover preview
					this.mouseoverHandler = setupInternalLinks(content, this.app!, this.data.isStreaming, this.observers);
				});
			} else {
				const { cleanedContent } = parseAgentContent(this.data.content);
				content.innerHTML = this.escapeHtml(cleanedContent);
			}
		}

		bubble.appendChild(this.renderTimestamp());

		// 渲染操作按钮
		this.renderActions(bubble);

		// 如果正在流式传输，添加光标效果 (由 CSS 处理 .deeppdf-message-streaming)
		if (this.data.isStreaming) {
		 container.addClass('deeppdf-message-streaming');
        } else {
            container.removeClass('deeppdf-message-streaming');
        }

		// 设置文字选中监听（仅对非流式消息）
		if (!this.data.isStreaming) {
			this.setupSelectionListener(content);
		}

		return container;
	}

	update(data: Partial<MessageData>): void {
		const oldContent = this.data.content;
		const oldAgentToolCalls = this.data.agentToolCalls;
		const wasStreaming = this.data.isStreaming;

		Object.assign(this.data, data);

		// 检查哪些字段发生了变化（优化：使用浅比较而非 JSON.stringify）
		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;

		// 【关键修复】状态更新逻辑：比较新状态与上次实际显示的状态，而不是 data 中的旧状态
		// 因为 data.currentStatus 会被持久化存储，导致相同状态不会触发更新
		const newStatus = data.currentStatus !== undefined ? data.currentStatus : (this.data as any).currentStatus;

		// 优先处理状态更新（不受节流限制，立即更新）
		if (this.el && this.statusEl) {
			// 更新状态显示
			if (newStatus) {
				this.statusEl.textContent = newStatus;
				this.statusEl.addClass('visible');
				this.lastDisplayedStatus = newStatus;
			} else if (!newStatus && this.lastDisplayedStatus) {
				// 清空状态
				this.statusEl.textContent = '';
				this.statusEl.removeClass('visible');
				this.lastDisplayedStatus = undefined;
			}
		}

		// 【优化】流式更新期间，只做增量更新，避免全量重绘导致闪烁
		// 只有在流式结束时（streamingEnded）才做完整重绘
		if (this.el && this.data.isStreaming && !streamingEnded) {
			// 流式期间：增量更新内容
			if (data.content !== undefined && data.content !== oldContent) {
				this.updateContent(data.content);
			}
			// 流式期间：增量更新工具调用（如果需要）
			if (agentToolCallsChanged && data.agentToolCalls) {
				this.updateToolCalls(data.agentToolCalls);
			}
			// 流式期间：不处理引用和追问变化，等到流式结束再处理
			return;
		}

		// 非流式期间或流式结束时，使用原有逻辑
		if (this.el &&
			data.content !== undefined &&
			data.content !== oldContent &&
			!agentToolCallsChanged &&
			!streamingEnded
		) {
			this.updateContent(data.content);
		} else if (streamingEnded && this.el) {
			// 流式结束时，进行完整的 Markdown 渲染
			const bubble = this.el.querySelector('.deeppdf-message-bubble');
			const contentEl = this.el.querySelector('.deeppdf-message-content');

			// 结束时隐藏状态
			if (this.statusEl) {
				this.statusEl.innerHTML = '';
				this.statusEl.removeClass('visible');
			}
			this.lastDisplayedStatus = undefined;
			log('[DeepPDF] update() - 流式结束，隐藏状态');

			if (contentEl && this.app) {
				// 清理旧的 observers 和 mouseover handler
				this.observers.forEach(obs => obs.disconnect());
				this.observers = [];
				if (this.mouseoverHandler) {
					document.removeEventListener('mouseover', this.mouseoverHandler);
					this.mouseoverHandler = null;
				}

				// 移除 loading 状态
				if ((contentEl as HTMLElement).hasClass('deeppdf-message-loading')) {
					(contentEl as HTMLElement).removeClass('deeppdf-message-loading');
				}

				// 处理 HTML 标签
				const { cleanedContent } = parseAgentContent(this.data.content);

				contentEl.empty();
				const sourcePath = this.data.pdfName || '';
				// 保存 app 引用用于回调
				const appRef = this.app;
				// 等待 Markdown 渲染完成后再设置链接事件（关键修复）
				MarkdownRenderer.render(this.app, cleanedContent, contentEl as HTMLElement, sourcePath, new Component()).then(() => {
					// 设置内部链接的点击事件和 hover preview
					if (appRef) {
						this.mouseoverHandler = setupInternalLinks(contentEl as HTMLElement, appRef, false, this.observers);
					}
				});
			}
			// 移除流式状态
			this.el.removeClass('deeppdf-message-streaming');

			// 【关键修复】流式结束后设置选中监听器
			this.setupSelectionListener(contentEl as HTMLElement);

			// 【关键修复】流式结束后渲染操作按钮
			if (bubble) {
				this.renderActions(bubble as HTMLElement);
			}
		} else {
			// 全量重绘
			const newRender = this.render();
			if (this.el) {
				this.el.replaceWith(newRender);
			}
			this.el = newRender;
		}
	}

	protected updateContent(content: string): void {
		const contentEl = this.el?.querySelector('.deeppdf-message-content');
		if (!contentEl) return;

		// 【关键】流式更新时，如果内容有实际文本（不是空白/只状态行），自动隐藏状态
		// 这样用户一旦看到 AI 回复内容，状态提示就自动消失
		if (this.data.isStreaming && this.el) {
			const { cleanedContent } = parseAgentContent(content);
			// 如果有实质内容（长度 > 20 且不只是空白字符），隐藏状态
			if (cleanedContent.trim().length > 20) {
				const statusEl = this.el.querySelector('.deeppdf-message-status-text');
				if (statusEl && statusEl.textContent !== '') {
					statusEl.textContent = '';
					statusEl.removeClass('visible');
					this.lastDisplayedStatus = undefined;
					log('[DeepPDF] updateContent() - 检测到实际内容，自动隐藏状态');
				}
			}
			this.streamingUpdateContent(contentEl as HTMLElement, content);
		} else {
			// 非流式更新，完全重绘（异步执行，确保链接事件正确绑定）
			this.fullUpdateContent(contentEl as HTMLElement, content);
		}
	}

	/**
	 * 增量更新工具调用（流式期间避免全量重绘）
	 */
	protected updateToolCalls(toolCalls: AgentToolCall[]): void {
		if (!this.el) return;

		// 查找工具调用容器
		const toolCallsEl = this.el.querySelector('.deeppdf-agent-tool-calls');
		if (!toolCallsEl) {
			// 如果容器不存在，需要创建它（但不触发全量重绘）
			const thoughtsEl = this.el.querySelector('.deeppdf-agent-thoughts');
			if (thoughtsEl && thoughtsEl.parentElement) {
				thoughtsEl.parentElement.createEl('div', { cls: 'deeppdf-agent-tool-calls' });
			}
			return;
		}

		// 清空并重新渲染工具调用
		toolCallsEl.empty();
		for (const call of toolCalls) {
			const callEl = toolCallsEl.createEl('div', { cls: 'deeppdf-agent-tool-call' });
			callEl.createEl('div', { cls: 'deeppdf-agent-tool-name', text: call.name });
			callEl.createEl('div', { cls: 'deeppdf-agent-tool-status', text: call.status });
		}
	}

	/**
	 * 流式更新 - 实时渲染 Markdown，但将链接显示为文本样式
	 *
	 * 优化策略：
	 * 1. 【Markdown 渲染】流式时正常渲染 Markdown 格式
	 * 2. 【链接文本化】将生成的链接用 CSS 禁用交互效果
	 * 3. 【节流更新】减少渲染频率，避免频繁的 DOM 操作
	 */
	private streamingUpdateContent(contentEl: HTMLElement, newContent: string): void {
		// 取消之前的动画帧
		if (this.streamingAnimationFrame !== null) {
			cancelAnimationFrame(this.streamingAnimationFrame);
		}

		this.streamingAnimationFrame = requestAnimationFrame(() => {
			const now = Date.now();

				// 解析内容（状态由 LangGraph onProgress 驱动，不从此处提取）
				const { cleanedContent } = parseAgentContent(newContent);

				const contentLen = cleanedContent.length;
				const contentGrowth = contentLen - this.lastRenderedLength;
				const timePassed = now - this.lastRenderTime;

				const normalizedNew = cleanedContent.trim();
				const normalizedOld = this.lastRenderedContent.trim();
				const contentChanged = normalizedNew !== normalizedOld;

				let throttleThreshold = 100;
				if (contentLen > 1500) throttleThreshold = 400;
				else if (contentLen > 500) throttleThreshold = 200;

				const shouldRender = contentChanged && (contentGrowth > 50 || timePassed > throttleThreshold);

			if (shouldRender && this.app) {
				// 移除 loading 状态（首次渲染实际内容时）
				if (contentEl.hasClass('deeppdf-message-loading')) {
					contentEl.removeClass('deeppdf-message-loading');
				}

				// 【拟人化 UI 支持】检测是否是拟人化 UI 的 HTML 内容
				// 拟人化 UI 包含特定的 class 标识，可以直接渲染 HTML
				const isHumanizedUI = newContent.includes('deepreader-agent-humanized');

				if (isHumanizedUI) {
					// 直接渲染 HTML（拟人化 UI）
					contentEl.innerHTML = cleanedContent;
					// 更新跟踪变量
					this.lastRenderedContent = cleanedContent;
					this.lastRenderTime = Date.now();
					this.lastRenderedLength = contentLen;
				} else {
					// 渲染 Markdown（包括 wiki 链接）
					const tempContainer = document.createElement('div');
					const sourcePath = this.data.pdfName || '';

					MarkdownRenderer.render(this.app, cleanedContent, tempContainer, sourcePath, new Component()).then(() => {
						if (!this.el) return;

						// 渲染 Markdown 内容
						contentEl.innerHTML = tempContainer.innerHTML;

						// 【关键优化】流式时禁用内部链接的交互效果，避免闪烁
						// 通过 CSS 让链接看起来像普通文本，但保留视觉样式
						const links = contentEl.querySelectorAll('a');
						links.forEach(link => {
							const href = link.getAttribute('href');
							// 只处理内部链接（wiki 链接）
							if (href && (href.includes('#^page-') || href.startsWith('#'))) {
								(link as HTMLElement).style.pointerEvents = 'none';
								(link as HTMLElement).style.cursor = 'text';
								// 保留颜色但移除下划线，让它在流式时不显得"可点击"
								(link as HTMLElement).style.textDecoration = 'none';
							}
						});

						// 更新跟踪变量
						this.lastRenderedContent = cleanedContent;
						this.lastRenderTime = Date.now();
						this.lastRenderedLength = contentLen;
					});
				}
			}

			this.streamingAnimationFrame = null;
		});
	}

	/**
	 * 完全更新内容
	 */
	private async fullUpdateContent(contentEl: HTMLElement, content: string): Promise<void> {
		// 清理旧的 observers 和 mouseover handler
		this.observers.forEach(obs => obs.disconnect());
		this.observers = [];
		if (this.mouseoverHandler) {
			document.removeEventListener('mouseover', this.mouseoverHandler);
			this.mouseoverHandler = null;
		}

		contentEl.empty();

		const { cleanedContent } = parseAgentContent(content);

		// 【拟人化 UI 支持】检测是否是拟人化 UI 的 HTML 内容
		const isHumanizedUI = content.includes('deepreader-agent-humanized');

		if (isHumanizedUI) {
			// 直接渲染 HTML（拟人化 UI）
			contentEl.innerHTML = cleanedContent;
		} else if (this.app) {
			const sourcePath = this.data.pdfName || '';
			// 等待 Markdown 渲染完成后再设置链接事件
			await MarkdownRenderer.render(this.app, cleanedContent, contentEl, sourcePath, new Component());
			// 设置内部链接的点击事件和 hover preview
			this.mouseoverHandler = setupInternalLinks(contentEl, this.app, this.data.isStreaming, this.observers);
		} else {
			contentEl.innerHTML = this.escapeHtml(cleanedContent);
		}
	}

	private renderActions(container: HTMLElement) {
		// 流式传输中不渲染操作按钮（严格检查 true）
		if (this.data.isStreaming === true) {
			return;
		}

		// 先移除已有的操作按钮区域（避免重复）
		const existingActions = container.querySelector('.deeppdf-message-actions');
		if (existingActions) {
			existingActions.remove();
		}

		const hasActions = !!(this.onRegenerate || this.onCopy || this.onExcerpt || this.onDelete);
		// AI 消息始终显示操作按钮区域（包含跳转到顶部按钮）
		const isAssistant = this.data.role === 'assistant';
		if (hasActions || isAssistant) {
			const actions = container.createEl('div', { cls: 'deeppdf-message-actions' });

			// AI 消息：左下角全屏按钮
			if (isAssistant) {
				const fullscreenBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				fullscreenBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
				fullscreenBtn.title = "全屏展示";
				fullscreenBtn.addEventListener('click', () => this.openFullscreen());
			}

			// AI 消息：添加"跳转到顶部"按钮
			if (isAssistant) {
				const scrollToTopBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Arrow Up
				scrollToTopBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;
				scrollToTopBtn.title = "跳转到回复开头";
				scrollToTopBtn.addEventListener('click', () => this.scrollToMessageTop());
			}

			if (this.onRegenerate) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Refresh CW
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
				btn.title = "Regenerate";
				btn.addEventListener('click', () => this.onRegenerate?.());
			}
			if (this.onCopy) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Clipboard
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
				btn.title = "Copy";
				btn.addEventListener('click', () => this.onCopy?.());
			}
			if (this.onExcerpt) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Bookmark/Save
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
				btn.title = "Save as Excerpt";
				btn.addEventListener('click', () => this.handleExcerpt());
			}
			// 删除按钮（hover 时显示）
			if (this.onDelete) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn deeppdf-message-delete-btn' });
				// Icon: Trash
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
				btn.title = "删除此对话";
				btn.addEventListener('click', () => this.onDelete?.());
			}
		}
	}

	/**
	 * 滚动到消息顶部
	 */
	private scrollToMessageTop(): void {
		if (!this.el) return;

		// 找到消息容器（可滚动的父元素）
		const messagesContainer = this.el.closest('.deeppdf-messages-container');
		if (messagesContainer) {
			// 计算消息元素相对于容器的位置
			const containerRect = messagesContainer.getBoundingClientRect();
			const messageRect = this.el.getBoundingClientRect();
			const offset = messageRect.top - containerRect.top + messagesContainer.scrollTop;

			// 平滑滚动到消息顶部
			messagesContainer.scrollTo({
				top: offset - 10, // 留 10px 的边距
				behavior: 'smooth'
			});
		}
	}

	/**
	 * 切换折叠状态
	 */
	private toggleCollapse(): void {
		this.isCollapsed = !this.isCollapsed;

		if (!this.el) return;

		// 获取内容元素
		const contentEl = this.el.querySelector('.deeppdf-message-content');
		if (contentEl) {
			if (this.isCollapsed) {
				contentEl.addClass('deeppdf-message-collapsed');
			} else {
				contentEl.removeClass('deeppdf-message-collapsed');
			}
		}

		// 更新头部折叠按钮图标和提示
		const collapseBtn = this.el.querySelector('.deeppdf-message-collapse-btn');
		if (collapseBtn) {
			if (this.isCollapsed) {
				// 展开图标（向下箭头）
				collapseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
				collapseBtn.setAttribute('title', "展开");
			} else {
				// 折叠图标（向上箭头）
				collapseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
				collapseBtn.setAttribute('title', "折叠");
			}
		}

		log(`[DeepPDF] Message collapsed: ${this.isCollapsed}`);
	}

	// ─── 全屏展示 ──────────────────────────────────────────────────────

	private fullscreenOverlay: HTMLElement | null = null;
	private fullscreenPage = 0;
	private fullscreenPages: HTMLElement[][] = [];

		private openFullscreen(): void {
		if (this.fullscreenOverlay) return;
		this.fullscreenPage = 0;
		this.fullscreenPages = [];

		// ── 翻信数据准备 ──
		const allMsgs = this.getAllMessages?.() || [];
		const aiMessages = allMsgs.filter(m => m.role === 'assistant' && !m.isStreaming);
		let currentLetterIdx = aiMessages.findIndex(m => m.id === this.data.id);
		if (currentLetterIdx === -1) currentLetterIdx = 0;

		// 从 DOM 读取每个 AI 消息的图案类
		const getPatternForMessage = (msgId: string): string => {
			const bubble = document.querySelector(`[data-message-id="${msgId}"] .deeppdf-message-bubble`);
			if (!bubble) return '';
			const p = Array.from(bubble.classList).find(c => c.startsWith('deeppdf-pattern-'));
			return p || '';
		};

		// ── 创建覆盖层 ──
		const overlay = document.body.createEl('div', { cls: 'deeppdf-fullscreen-overlay' });
		let currentPattern = getPatternForMessage(aiMessages[currentLetterIdx]?.id || this.data.id) || this.patternClass;
		const panel = overlay.createEl('div', { cls: ['deeppdf-fullscreen-panel', currentPattern] });

		// ── 工具栏 ──
		const toolbar = panel.createEl('div', { cls: 'deeppdf-fullscreen-toolbar' });
		const toolbarLeft = toolbar.createEl('div', { cls: 'deeppdf-fullscreen-toolbar-left' });
		toolbarLeft.createEl('span', { cls: 'deeppdf-fullscreen-title', text: '奚童来信' });
		const questionEl = toolbarLeft.createEl('span', { cls: 'deeppdf-fullscreen-question', text: aiMessages[currentLetterIdx]?.question || this.data.question || '' });

		const toolbarRight = toolbar.createEl('div', { cls: 'deeppdf-fullscreen-toolbar-right' });
		const pageInfo = toolbarRight.createEl('span', { cls: 'deeppdf-fullscreen-page-info' });
		const prevBtn = toolbarRight.createEl('button', { cls: 'deeppdf-fullscreen-nav-btn' });
		prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
		prevBtn.title = "上一页";
		prevBtn.style.opacity = '0.3';
		const nextBtn = toolbarRight.createEl('button', { cls: 'deeppdf-fullscreen-nav-btn' });
		nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
		nextBtn.title = "下一页";
		const closeBtn = toolbarRight.createEl('button', { cls: 'deeppdf-fullscreen-close-btn' });
		closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
		closeBtn.title = "关闭";

		// ── 侧边浮动翻信箭头 ──
		const letterArrowSvg = (direction: 'left' | 'right') =>
			`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${
				direction === 'left'
					? '<path d="m15 18-6-6 6-6"/><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>'
					: '<path d="m9 18 6-6-6-6"/><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>'
			}</svg>`;

		const prevLetterBtn = panel.createEl('button', { cls: 'deeppdf-fullscreen-letter-nav deeppdf-fullscreen-letter-prev' });
		prevLetterBtn.innerHTML = letterArrowSvg('left');
		prevLetterBtn.title = "上一封";
		if (currentLetterIdx <= 0) prevLetterBtn.style.display = 'none';

		const nextLetterBtn = panel.createEl('button', { cls: 'deeppdf-fullscreen-letter-nav deeppdf-fullscreen-letter-next' });
		nextLetterBtn.innerHTML = letterArrowSvg('right');
		nextLetterBtn.title = "下一封";
		if (currentLetterIdx >= aiMessages.length - 1) nextLetterBtn.style.display = 'none';

		// ── 内容区域 ──
		const contentArea = panel.createEl('div', { cls: ['deeppdf-fullscreen-content-area', currentPattern] });

		// ── 分页 + 渲染闭包（支持翻信时重新调用） ──
		let currentPages: HTMLElement[][] = [];

		const paginateContent = (rawContent: string, sourcePath: string, onDone?: () => void) => {
			const tempDiv = contentArea.createEl('div', { cls: ['deeppdf-fullscreen-content-area'] });
			tempDiv.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;';

			const doPaginate = () => {
				const children = Array.from(tempDiv.children) as HTMLElement[];
				if (children.length === 0) { tempDiv.remove(); currentPages = []; onDone?.(); return; }

				requestAnimationFrame(() => {
					tempDiv.remove();
					const pages: HTMLElement[][] = [];
					let remaining = [...children];

					while (remaining.length > 0) {
						contentArea.empty();
						for (const el of remaining) contentArea.appendChild(el);

						if (contentArea.scrollWidth <= contentArea.clientWidth) {
							pages.push([...remaining]);
							remaining = [];
							break;
						}
						while (contentArea.scrollWidth > contentArea.clientWidth && contentArea.children.length > 1) {
							const last = contentArea.children[contentArea.children.length - 1] as HTMLElement;
							contentArea.removeChild(last);
						}
						const pageElems = Array.from(contentArea.children) as HTMLElement[];
						remaining = remaining.slice(pageElems.length);
						pages.push(pageElems);
					}

					currentPages = pages;
					this.fullscreenPages = pages as any;
					this.fullscreenPage = 0;
					renderPage(0);
					onDone?.();
				});
			};

			if (this.app) {
				MarkdownRenderer.render(this.app, rawContent, tempDiv, sourcePath, new Component()).then(() => doPaginate());
			} else {
				tempDiv.innerHTML = this.escapeHtml(rawContent);
				doPaginate();
			}
		};

		const renderPage = (idx: number) => {
			// 翻页 fade 动画
			contentArea.addClass('deeppdf-page-fading');
			setTimeout(() => {
				contentArea.empty();
				const pg = currentPages[idx];
				if (pg) {
					for (const el of pg) contentArea.appendChild(el);
					setupInternalLinks(contentArea, this.app!, false, this.observers);
				}
				pageInfo.textContent = currentPages.length > 1 ? `${idx + 1} / ${currentPages.length}` : '';
				prevBtn.style.opacity = idx > 0 ? '1' : '0.3';
				nextBtn.style.opacity = idx < currentPages.length - 1 ? '1' : '0.3';
				prevBtn.style.pointerEvents = idx > 0 ? 'auto' : 'none';
				nextBtn.style.pointerEvents = idx < currentPages.length - 1 ? 'auto' : 'none';
				contentArea.removeClass('deeppdf-page-fading');
			}, 150);
		};

		// ── 初始渲染 ──
		const initialMsg = aiMessages[currentLetterIdx];
		const { cleanedContent: initialContent } = parseAgentContent(initialMsg?.content || this.data.content);
		paginateContent(initialContent, initialMsg?.pdfName || this.data.pdfName || '');

		// ── 翻页按钮 ──
		prevBtn.addEventListener('click', () => {
			if (this.fullscreenPage > 0) { this.fullscreenPage--; renderPage(this.fullscreenPage); }
		});
		nextBtn.addEventListener('click', () => {
			if (this.fullscreenPage < currentPages.length - 1) { this.fullscreenPage++; renderPage(this.fullscreenPage); }
		});

		// ── 翻信按钮 ──
		const navigateToLetter = (targetIdx: number) => {
			if (targetIdx < 0 || targetIdx >= aiMessages.length || targetIdx === currentLetterIdx) return;
			if (!this.app) return;

			const direction = targetIdx > currentLetterIdx ? 'left' : 'right';
			contentArea.addClass(`deeppdf-flip-${direction}-out`);

			setTimeout(() => {
				currentLetterIdx = targetIdx;
				const target = aiMessages[currentLetterIdx];
				currentPattern = getPatternForMessage(target.id);

				// 更新工具栏
				questionEl.textContent = target.question || '';

				// 更新面板和内容区图案
				const panelClasses = ['deeppdf-fullscreen-panel'];
				if (currentPattern) panelClasses.push(currentPattern);
				panel.className = panelClasses.join(' ');
				const contentClasses = ['deeppdf-fullscreen-content-area'];
				if (currentPattern) contentClasses.push(currentPattern);
				contentArea.className = contentClasses.join(' ');

				// 更新箭头可见性
				prevLetterBtn.style.display = currentLetterIdx > 0 ? '' : 'none';
				nextLetterBtn.style.display = currentLetterIdx < aiMessages.length - 1 ? '' : 'none';

				// 重新渲染内容
				const { cleanedContent } = parseAgentContent(target.content);
				contentArea.removeClass(`deeppdf-flip-${direction}-out`);
				paginateContent(cleanedContent, target.pdfName || '', () => {
					contentArea.addClass(`deeppdf-flip-${direction}-in`);
					setTimeout(() => contentArea.removeClass(`deeppdf-flip-${direction}-in`), 300);
				});
			}, 200);
		};
		prevLetterBtn.addEventListener('click', () => navigateToLetter(currentLetterIdx - 1));
		nextLetterBtn.addEventListener('click', () => navigateToLetter(currentLetterIdx + 1));

		// ── 事件 ──
		const close = () => this.closeFullscreen();
		closeBtn.addEventListener('click', close);
		overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
		panel.addEventListener('mousedown', (e) => e.stopPropagation());
		panel.addEventListener('click', (e) => e.stopPropagation());

		this.fullscreenKeyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
			else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && (e.ctrlKey || e.metaKey)) {
				e.preventDefault(); e.stopImmediatePropagation(); nextLetterBtn.click();
			}
			else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && (e.ctrlKey || e.metaKey)) {
				e.preventDefault(); e.stopImmediatePropagation(); prevLetterBtn.click();
			}
			else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
				e.preventDefault(); e.stopImmediatePropagation(); nextBtn.click();
			}
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
				e.preventDefault(); e.stopImmediatePropagation(); prevBtn.click();
			}
		};
		document.addEventListener('keydown', this.fullscreenKeyHandler, true);

		this.fullscreenOverlay = overlay;
		requestAnimationFrame(() => overlay.addClass('deeppdf-fullscreen-open'));

		// 墨迹拖尾效果
		this.setupInkTrail(overlay);
	}

	private closeFullscreen(): void {
		if (!this.fullscreenOverlay) return;
		// 移除全屏键盘处理器（修复箭头键被永久拦截的 bug）
		if (this.fullscreenKeyHandler) {
			document.removeEventListener('keydown', this.fullscreenKeyHandler, true);
			this.fullscreenKeyHandler = null;
		}
		this.fullscreenOverlay.removeClass('deeppdf-fullscreen-open');
		const overlay = this.fullscreenOverlay;
		this.fullscreenOverlay = null;
		setTimeout(() => overlay.remove(), 300);
	}

	private getAllMessages: (() => MessageData[]) | null = null;
	private fullscreenKeyHandler: ((e: KeyboardEvent) => void) | null = null;
	private inkTrailCanvas: HTMLCanvasElement | null = null;
	private inkTrailCtx: CanvasRenderingContext2D | null = null;
	private inkTrailRAF: number = 0;
	private inkPoints: { x: number; y: number; t: number; speed: number }[] = [];

	private setupInkTrail(overlay: HTMLElement): void {
		const panel = overlay.querySelector('.deeppdf-fullscreen-panel') as HTMLElement;
		const canvas = document.createElement('canvas');
		canvas.className = 'deeppdf-ink-trail-canvas';
		panel.appendChild(canvas);
		this.inkTrailCanvas = canvas;
		this.inkTrailCtx = canvas.getContext('2d');

		const resize = () => {
			canvas.width = panel.offsetWidth;
			canvas.height = panel.offsetHeight;
		};
		resize();
		const resizeObs = new ResizeObserver(resize);
		resizeObs.observe(panel);

		let lastX = 0, lastY = 0, lastTime = 0;

		const onMove = (e: MouseEvent) => {
			const now = performance.now();
			const dt = now - lastTime;
			if (dt < 8) return;
			const dx = e.clientX - lastX;
			const dy = e.clientY - lastY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const speed = dt > 0 ? dist / dt : 0;

			if (dist > 2) {
				const rect = panel.getBoundingClientRect();
				this.inkPoints.push({
					x: e.clientX - rect.left,
					y: e.clientY - rect.top,
					t: now,
					speed,
				});
			}
			lastX = e.clientX;
			lastY = e.clientY;
			lastTime = now;
		};

		const draw = () => {
			const ctx = this.inkTrailCtx;
			if (!ctx || !this.inkTrailCanvas) return;
			const now = performance.now();
			const FADE_MS = 1200;

			ctx.clearRect(0, 0, this.inkTrailCanvas.width, this.inkTrailCanvas.height);

			// 过滤已消失的点
			this.inkPoints = this.inkPoints.filter(p => now - p.t < FADE_MS);

			if (this.inkPoints.length < 2) {
				this.inkTrailRAF = requestAnimationFrame(draw);
				return;
			}

			// 绘制墨迹
			for (let i = 1; i < this.inkPoints.length; i++) {
				const prev = this.inkPoints[i - 1];
				const curr = this.inkPoints[i];
				const age = now - curr.t;
				const alpha = Math.max(0, 1 - age / FADE_MS);

				// 速度越快越细，越慢越粗（模拟毛笔按压）
				const baseWidth = 4.5;
				const speedFactor = Math.max(0.15, 1 - curr.speed * 0.8);
				const width = baseWidth * speedFactor * (0.3 + alpha * 0.7);

				ctx.beginPath();
				ctx.moveTo(prev.x, prev.y);
				ctx.lineTo(curr.x, curr.y);
				ctx.strokeStyle = `rgba(178, 34, 34, ${alpha * 0.6})`;
				ctx.lineWidth = width;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				ctx.stroke();

				// 墨迹晕染
				if (alpha > 0.3) {
					ctx.beginPath();
					ctx.arc(curr.x, curr.y, width * 0.8, 0, Math.PI * 2);
					ctx.fillStyle = `rgba(178, 34, 34, ${alpha * 0.12})`;
					ctx.fill();
				}
			}

			this.inkTrailRAF = requestAnimationFrame(draw);
		};

		panel.addEventListener('mousemove', onMove);
		this.inkTrailRAF = requestAnimationFrame(draw);

		// 关闭时清理：包装原 closeFullscreen
		const origClose = this.closeFullscreen.bind(this);
		this.closeFullscreen = () => {
			panel.removeEventListener('mousemove', onMove);
			resizeObs.disconnect();
			cancelAnimationFrame(this.inkTrailRAF);
			this.inkPoints = [];
			this.inkTrailCanvas = null;
			this.inkTrailCtx = null;
			origClose();
		};
	}

	/**
	 * 处理摘录保存
	 */
	private handleExcerpt(): void {
		if (!this.onExcerpt) return;

		log(`[DeepPDF] handleExcerpt - pdfName: ${this.data.pdfName}`);

		const content: ExcerptContent = {
			text: this.data.content,
			rawMarkdown: this.data.content
		};

		const metadata: ExcerptMetadata = {
			sourcePdf: this.data.pdfName || 'Unknown',
			page: this.data.page,
			question: this.data.question,
			createdAt: new Date().toISOString(),
			conversationId: this.data.conversationId,
			messageId: this.data.id
		};

		this.onExcerpt(content, metadata);
	}

	/**
	 * 设置文字选中监听
	 */
	private setupSelectionListener(contentEl: HTMLElement): void {
		log(`[DeepPDF] setupSelectionListener - pdfName: ${this.data.pdfName}`);
		contentEl.addEventListener('mouseup', (e: MouseEvent) => {
			const selection = window.getSelection();
			if (!selection) return;

			const selectedText = selection.toString().trim();
			if (selectedText.length < 10) {
				// 选中文本太短，不显示菜单
				this.selectionMenu?.hide();
				return;
			}

			// 检查选区是否在当前元素内
			const range = selection.getRangeAt(0);
			if (!contentEl.contains(range.commonAncestorContainer)) {
				this.selectionMenu?.hide();
				return;
			}

			// 阅读模式下不显示摘录菜单（由 SelectionToolbar 处理）
			const isReadingMode = document.body.classList.contains('deeppdf-reading-mode');
			if (isReadingMode) {
				return;
			}

			// 创建或更新选中菜单
			if (!this.selectionMenu) {
				this.selectionMenu = new SelectionMenu({
					selectedText,
					sourcePdf: this.data.pdfName,
					page: this.data.page,
					question: this.data.question,
					conversationId: this.data.conversationId,
					messageId: this.data.id,
					app: this.app!,
					onQuote: (metadata: QuoteMetadata) => {
						if (this.onQuote) {
							this.onQuote(metadata);
						}
					}
				});
			} else {
				// 更新选项
				(this.selectionMenu as any).options = {
					selectedText,
					sourcePdf: this.data.pdfName,
					page: this.data.page,
					question: this.data.question,
					conversationId: this.data.conversationId,
					messageId: this.data.id,
					app: this.app!,
					onQuote: (metadata: QuoteMetadata) => {
						if (this.onQuote) {
							this.onQuote(metadata);
						}
					}
				};
			}

			// 显示菜单（在鼠标位置附近）
			const menuX = e.clientX + 10;
			const menuY = e.clientY + 10;
			this.selectionMenu.show(menuX, menuY);
		});
	}

	public destroy(): void {
		// 取消流式动画帧
		if (this.streamingAnimationFrame !== null) {
			cancelAnimationFrame(this.streamingAnimationFrame);
			this.streamingAnimationFrame = null;
		}

		// 断开所有 MutationObserver
		this.observers.forEach(observer => {
			observer.disconnect();
		});
		this.observers = [];

		// 移除全局 mouseover 监听器
		if (this.mouseoverHandler) {
			document.removeEventListener('mouseover', this.mouseoverHandler);
			this.mouseoverHandler = null;
		}

		// 清理选中菜单
		if (this.selectionMenu) {
			this.selectionMenu.hide();
			this.selectionMenu = null;
		}
	}
}

/**
 * 消息工厂函数
 */
export function createMessage(
	data: MessageData,
	options?: {
		onRegenerate?: () => void;
		onCopy?: () => void;
		onQuestionClick?: (question: string) => void;
		onExcerpt?: (content: ExcerptContent, metadata: ExcerptMetadata) => void;
		onQuote?: (metadata: QuoteMetadata) => void;
		onDelete?: () => void;
		getAllMessages?: () => MessageData[];
		app?: App;
	}
): Message {
	if (data.role === 'user') {
		return new UserMessage(data, options?.app);
	} else {
		return new AIMessage(data, options);
	}
}
