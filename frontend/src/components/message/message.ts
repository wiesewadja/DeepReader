/**
 * DeepPDF 消息组件
 * 实现 ChatGPT 风格的聊天消息界面，支持 Markdown 渲染和流式更新
 */

import { App, MarkdownRenderer, Component, HoverParent, HoverPopover } from 'obsidian';
import { FollowUpQuestions } from '../follow-up-questions/follow-up-questions.js';

/**
 * 消息角色类型
 */
export type MessageRole = 'user' | 'assistant';

/**
 * 引用来源数据结构
 */
export interface CitationData {
	/** PDF 文件名 */
	pdf_name: string;
	/** 页码 */
	page: number;
	/** 引用文本片段 */
	snippet: string;
	/** 可选：PDF 文件路径 */
	file_path?: string;
	/** 可选：Markdown 文件路径 (相对于 vault) */
	markdown_path?: string;
	/** 相关性得分 */
	score?: number;
	/** 可选：标题 */
	title?: string;
	/** 可选：Obsidian 链接 (从 Agent 返回) */
	obsidian_link?: string;
	/** 可选：块引用锚点 */
	anchor?: string;
}

/**
 * 追问问题数据结构
 */
export interface FollowUpQuestion {
	/** 问题内容 */
	question: string;
	/** 问题索引（用于点击事件） */
	index: number;
}

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
 * 解析追问问题列表
 * 从 AI 回答中提取 <<<QUESTIONS>>> 标记包裹的问题
 * 返回 { content: 清理后的内容, questions: 问题列表 }
 */
export function parseFollowUpQuestions(content: string): {
	content: string;
	questions: FollowUpQuestion[];
} {
	const questions: FollowUpQuestion[] = [];
	let cleanedContent = content;

	// 匹配 <<<QUESTIONS>>>...</QUESTIONS>>> 标记
	const questionRegex = /<<<QUESTIONS>>>([\s\S]*?)<\/QUESTIONS>>>/;
	const match = content.match(questionRegex);

	if (match) {
		// 提取问题部分
		const questionsText = match[1];
		// 按行分割，提取以 "- " 开头的问题
		const lines = questionsText.split('\n');
		lines.forEach((line, index) => {
			const trimmed = line.trim();
			if (trimmed.startsWith('- ')) {
				questions.push({
					question: trimmed.slice(2).trim(),
					index: index
				});
			}
		});

		// 移除追问标记部分
		cleanedContent = content.replace(questionRegex, '').trim();
	}

	return { content: cleanedContent, questions };
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
	currentStatus?: string;
} {
	// 0. 提取并移除状态行
	// 后端发送的状态行格式示例：
	// - 💭 *正在分析您的问题...*
	// - 🔍 *正在查看文档目录...*
	// - 🔎 *正在搜索相关内容...*
	// - 📖 *正在读取指定页面...*
	//
	// 策略：匹配以 Emoji 开头，后面可能有 Markdown 斜体标记 (*...*) 的短行
	const statusKeywords = ['搜索中', '分析中', '整理中', '查看中', '阅读中', '查目录'];
	const keywordPattern = statusKeywords.join('|');

	// 匹配模式：
	// 1. Emoji 开头 (包括各种变体) + 可选的 Markdown 斜体/粗体 + 状态关键词
	// 覆盖 U+2300-U+27BF (杂项符号) 和 U+1F000-U+1FAFF (表情符号)
	// 修复: Emoji 的 high surrogate 范围应该是 D83C-D83E (不是只到 D83E)
	// 💭 = U+1F4AD = \uD83D\uDCAD (D83D 在范围内)
	const statusLineRegex = new RegExp(
		`^\\s*(?:[\\u2300-\\u27BF]|[\\uD83C-\\uD83E][\\uDC00-\\uDFFF])\\s*\\*?(?:${keywordPattern})[^\\n]*\\*?\\s*$`,
		'gm'
	);

	let currentStatus: string | undefined;
	let match;

	// 找到最后一条状态
	while ((match = statusLineRegex.exec(content)) !== null) {
		const line = match[0].trim();
		// 清理 Markdown 符号，只保留纯文本状态
		currentStatus = line.replace(/^\s*|\*+|\s*$/g, '').trim();
		console.log('[DeepPDF] 检测到状态行:', currentStatus);
	}

	// 从正文中移除所有状态行
	let processedContent = content.replace(statusLineRegex, '');

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

	// 3. 移除 tool_call 标签及其内容
	processedContent = processedContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
	processedContent = processedContent.replace(/<tool_call>[\s\S]*$/i, ''); // 未闭合的

	// 4. 移除中间说明文字（LLM 在调用工具前后的冗余说明）
	// 这些文字通常以特定模式开头，不应该显示给用户
	const intermediatePatterns = [
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
	];

	for (const pattern of intermediatePatterns) {
		processedContent = processedContent.replace(pattern, '');
	}

	// 5. 提取工具调用
	const toolCalls: AgentToolCall[] = [];
	const validToolNames = ['inspect_toc', 'read_page', 'hybrid_search'];
	const toolCallRegex = new RegExp(`(${validToolNames.join('|')})\\s*\\(([^)]*)\\)`, 'gi');
	let toolMatch;
	const seenToolCalls = new Set<string>();

	while ((toolMatch = toolCallRegex.exec(content)) !== null) {
		const toolName = toolMatch[1].toLowerCase();
		const args = toolMatch[2];
		const callKey = `${toolName}:${args}`;
		if (!seenToolCalls.has(callKey)) {
			seenToolCalls.add(callKey);
			// 判断状态：如果此时 args 不完整（流式传输中），或者还没有对应的结果输出，则认为是 pending
			// 简单的判断：如果 args 里包含 ERROR 则是 error，否则默认 success
			// 在流式传输中，我们往往只能看到调用开始，很难知道结束，除非有特定的 XML 标记闭合
			// 假设只要出现了 tool call 文本，就是正在调用
			toolCalls.push({
				name: toolName,
				args: args,
				status: args.includes('ERROR') ? 'error' : 'success'
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
		currentStatus
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
	/** 可选：引用来源（仅 AI 消息） */
	citations?: CitationData[];
	/** 可选：是否正在生成 */
	isStreaming?: boolean;
	/** 可选：追问问题列表（仅 AI 消息） */
	followUpQuestions?: FollowUpQuestion[];
	/** 可选：是否为 Agent 消息 */
	isAgentMessage?: boolean;
	/** 可选：Agent 思考过程 */
	agentThoughts?: AgentThought[];
	/** 可选：Agent 工具调用列表 */
	agentToolCalls?: AgentToolCall[];
	/** 可选：当前状态文本（如"正在搜索..."） */
	currentStatus?: string;
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
		console.log('[extractSectionByBlockRef] Found block ref at index:', blockIndex);
		console.log('[extractSectionByBlockRef] Extracted lines:', sectionLines.length);
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

	// 用于 Command 键的原生预览
	const hoverParentContainer: HoverParent = {
		hoverPopover: null
	};

	// 用于自定义预览
	let customPopover: HTMLElement | null = null;
	let showTimer: number | null = null;
	let hideTimer: number | null = null;

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
		});

		// 如果禁用 hover preview（AI 流式传输期间），则跳过 hover 事件设置
		if (disableHoverPreview) {
			return;
		}

		// 处理悬停事件
		link.addEventListener('mouseenter', (event: MouseEvent) => {
			console.log('[DeepPDF] mouseenter on link:', href);

			// 清理之前的定时器
			if (showTimer) {
				window.clearTimeout(showTimer);
				showTimer = null;
			}
			if (hideTimer) {
				window.clearTimeout(hideTimer);
				hideTimer = null;
			}

			// 如果按住了 Command/Ctrl 键，使用原生预览
			if (event.metaKey || event.ctrlKey) {
				console.log('[DeepPDF] Command key pressed, using native preview');
				cleanupPopover();
				// 触发 Obsidian 原生 hover preview
				app.workspace.trigger('hover-link', {
					event: event,
					source: 'deeppdf',
					hoverParent: hoverParentContainer,
					targetEl: link,
					linktext: href
				});
				return;
			}

			console.log('[DeepPDF] No Command key, showing custom preview in 200ms');

			// 否则显示自定义章节预览
			showTimer = window.setTimeout(() => {
				// 提取纯文件名（去掉块引用部分）
				const pureFileName = href.split('#')[0];
				console.log('[DeepPDF] Pure file name:', pureFileName);

				// 提取块引用 ID（如果有）
				const blockRefMatch = href.match(/#\^([a-z0-9-]+)/);
				const blockRef = blockRefMatch ? blockRefMatch[1] : null;
				console.log('[DeepPDF] Block reference:', blockRef);

				// 获取链接目标文件
				const linkPath = app.metadataCache.getFirstLinkpathDest(pureFileName, '');
				if (!linkPath) {
					console.log('[DeepPDF] Link path not found for:', pureFileName);
					return;
				}

				console.log('[DeepPDF] Reading file:', linkPath.path);

				// 移除之前的 popover
				cleanupPopover();

				// 读取文件内容
				app.vault.read(linkPath).then((content: string) => {
					console.log('[DeepPDF] File content loaded, length:', content.length);
					console.log('[DeepPDF] First 500 chars:', content.substring(0, 500));

					// 提取特定章节内容（如果有块引用）
					let contentToRender = content;
					if (blockRef) {
						const sectionContent = extractSectionByBlockRef(content, blockRef);
						if (sectionContent) {
							contentToRender = sectionContent;
							console.log('[DeepPDF] Section content extracted, length:', sectionContent.length);
							console.log('[DeepPDF] Section preview:', sectionContent.substring(0, 200));
						} else {
							console.log('[DeepPDF] Block reference not found, showing full content');
						}
					}

					// 创建 popover 容器
					const popover = document.createElement('div');
					popover.addClass('deeppdf-hover-preview');

					// 创建内容区域
					const popoverContent = popover.createEl('div', {
						cls: 'deeppdf-hover-preview-content'
					});

					// 使用 Markdown 渲染内容
					MarkdownRenderer.render(app, contentToRender, popoverContent, linkPath.path, new Component());

					// 渲染后移除 popover 内部所有链接的 title 属性，避免原生 tooltip
					popoverContent.querySelectorAll('a').forEach((renderedLink: Element) => {
						(renderedLink as HTMLElement).removeAttribute('title');
					});

					// 先添加到 DOM（隐藏状态）
					popover.style.visibility = 'hidden';
					popover.style.position = 'fixed';
					popover.style.left = '0';
					popover.style.top = '0';
					document.body.appendChild(popover);

					console.log('[DeepPDF] Popover added to DOM');

					// 计算位置
					const linkRect = link.getBoundingClientRect();
					const popoverRect = popover.getBoundingClientRect();

					console.log('[DeepPDF] linkRect:', linkRect, 'popoverRect:', popoverRect);

					let top = linkRect.bottom + 8;
					let left = linkRect.left;

					// 确保不超出视口
					if (left + popoverRect.width > window.innerWidth - 16) {
						left = Math.max(16, window.innerWidth - popoverRect.width - 16);
					}

					// 如果下方空间不足，显示在上方
					if (top + popoverRect.height > window.innerHeight - 16) {
						top = linkRect.top - popoverRect.height - 8;
						if (top < 16) top = 16;
					}

					// 设置最终位置并显示
					popover.style.left = `${left}px`;
					popover.style.top = `${top}px`;
					popover.style.visibility = 'visible';
					popover.style.zIndex = '10000';

					console.log('[DeepPDF] Popover positioned at:', top, left);

					customPopover = popover;
				}).catch((err) => {
					console.error('[DeepPDF] Failed to read file for hover preview:', err);
				});
			}, 200); // 200ms 延迟
		});

		// 处理鼠标离开
		link.addEventListener('mouseleave', () => {
			// 清除显示定时器
			if (showTimer) {
				window.clearTimeout(showTimer);
				showTimer = null;
			}

			// 延迟隐藏自定义预览
			hideTimer = window.setTimeout(() => {
				cleanupPopover();
			}, 300);
		});
	});

	// 全局 mouseover 处理 - 允许用户移动到自定义 popover 上
	const mouseoverHandler = (e: Event) => {
		const target = e.target as HTMLElement;

		// 如果鼠标在自定义 popover 上，取消隐藏
		if (target.closest('.deeppdf-hover-preview')) {
			if (hideTimer) {
				window.clearTimeout(hideTimer);
				hideTimer = null;
			}
			return;
		}

		// 如果鼠标离开 popover 且不在链接上，延迟隐藏
		if (customPopover && !target.closest('.deeppdf-hover-preview') && !target.closest('a.internal-link')) {
			if (hideTimer) {
				window.clearTimeout(hideTimer);
			}
			hideTimer = window.setTimeout(() => {
				cleanupPopover();
			}, 300);
		}
	};

	document.addEventListener('mouseover', mouseoverHandler);

	// 返回 mouseover 处理器，用于后续清理
	return mouseoverHandler;
}

/**
 * 引用来源组件
 */
export class Citation {
	private el: HTMLElement;
	private citation: CitationData;
	private onJump?: (citation: CitationData) => void;

	constructor(citation: CitationData, onJump?: (citation: CitationData) => void) {
		this.citation = citation;
		this.onJump = onJump;
		this.el = this.render();
	}

	private render(): HTMLElement {
		const citationEl = document.createElement('div');
		citationEl.addClass('deeppdf-citation');

		// 上半部分：Icon + Filename + Page Badge
		const header = citationEl.createEl('div', { cls: 'deeppdf-citation-header' });

		// Icon
		const iconWrapper = header.createEl('div', { cls: 'deeppdf-citation-icon' });
		// Simple document icon
		iconWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;

		const fileInfo = header.createEl('div', { cls: 'deeppdf-citation-file-info' });
		fileInfo.createEl('span', {
			cls: 'deeppdf-citation-filename',
			text: this.citation.pdf_name
		});

		// Meta info (Page)
		const meta = fileInfo.createEl('div', { cls: 'deeppdf-citation-meta' });
		const pageBadge = meta.createEl('span', {
			cls: 'deeppdf-citation-page-badge',
			text: `Page ${this.citation.page}`
		});

		// 跳转逻辑绑定整个卡片
		if (this.onJump) {
			citationEl.addEventListener('click', () => {
				this.onJump?.(this.citation);
			});
		}

		return citationEl;
	}

	getElement(): HTMLElement {
		return this.el;
	}
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
		const oldCitations = this.data.citations;
		const oldFollowUpQuestions = this.data.followUpQuestions;
		const oldAgentToolCalls = this.data.agentToolCalls;
		const wasStreaming = this.data.isStreaming;

		Object.assign(this.data, data);

		// 检查字段变化
		const citationsChanged = data.citations !== undefined && (
			data.citations !== oldCitations &&
			(data.citations?.length !== oldCitations?.length || data.citations?.[0] !== oldCitations?.[0])
		);
		const followUpChanged = data.followUpQuestions !== undefined && (
			data.followUpQuestions !== oldFollowUpQuestions &&
			(data.followUpQuestions?.length !== oldFollowUpQuestions?.length || data.followUpQuestions?.[0] !== oldFollowUpQuestions?.[0])
		);
		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;

		if (this.el &&
			data.content !== undefined &&
			data.content !== oldContent &&
			!citationsChanged &&
			!followUpChanged &&
			!agentToolCallsChanged &&
			!streamingEnded
		) {
			this.updateContent(data.content);
		} else if (streamingEnded && this.el) {
			// 流式结束，完整渲染
			const contentEl = this.el.querySelector('.deeppdf-message-content');
			if (contentEl && this.app) {
				// 清理资源
				this.observers.forEach(obs => obs.disconnect());
				this.observers = [];
				if (this.mouseoverHandler) {
					document.removeEventListener('mouseover', this.mouseoverHandler);
					this.mouseoverHandler = null;
				}

				// 使用解析后的内容（处理 HTML 标签）
				const { cleanedContent } = parseAgentContent(this.data.content);

				contentEl.empty();
				MarkdownRenderer.render(this.app, cleanedContent, contentEl as HTMLElement, '', new Component());
				this.mouseoverHandler = setupInternalLinks(contentEl as HTMLElement, this.app, false, this.observers);
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
			MarkdownRenderer.render(this.app, this.data.content, content, '', new Component());
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
				MarkdownRenderer.render(this.app, content, contentEl as HTMLElement, '', new Component());
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
	private onCopyWithCitation?: () => void;
	private onQuestionClick?: (question: string) => void;
	private onCitationJump?: (citation: CitationData) => void;
	// 节流渲染跟踪变量
	private lastRenderedContent: string = '';
	private lastRenderTime: number = 0;
	private lastRenderedLength: number = 0;
	private streamingAnimationFrame: number | null = null;

	constructor(
		data: MessageData,
		options?: {
			onRegenerate?: () => void;
			onCopy?: () => void;
			onCopyWithCitation?: () => void;
			onQuestionClick?: (question: string) => void;
			onCitationJump?: (citation: CitationData) => void;
			app?: App;
		}
	) {
		super(data, options?.app);
		this.onRegenerate = options?.onRegenerate;
		this.onCopy = options?.onCopy;
		this.onCopyWithCitation = options?.onCopyWithCitation;
		this.onQuestionClick = options?.onQuestionClick;
		this.onCitationJump = options?.onCitationJump;
		// 初始化渲染跟踪变量
		this.lastRenderedContent = data.content;
		this.lastRenderTime = Date.now();
		this.lastRenderedLength = data.content.length;
		this.el = this.render();
	}

	render(): HTMLElement {
		const container = this.renderContainer();
		const wrapper = container.createEl('div', { cls: 'deeppdf-message-wrapper' });

		const bubble = wrapper.createEl('div', { cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-ai'] });

		// Agent 消息标识 + 状态显示
		const headerRow = bubble.createEl('div', { cls: 'deeppdf-message-header-row' });

		// 左侧 Badge
		if (this.data.isAgentMessage) {
			const badge = headerRow.createEl('div', { cls: 'deeppdf-message-agent-badge' });
			badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><path d="M8.5 8.5A2.5 2.5 0 0 0 8 10c0 1.5 1.5 2.5 3 2.5s3-1 3-2.5a2.5 2.5 0 0 0-.5-1.5"></path><path d="M15 15a5 5 0 0 1-5 5"></path></svg>AI Agent`;
		}

		// 右侧状态文本 (默认隐藏，有状态时显示)
		const statusEl = headerRow.createEl('div', { cls: 'deeppdf-message-status-text' });
		// 初始化时如果内容里有状态，也可以解析出来显示（但这通常是静态 HTML 渲染）
		// 对于静态历史消息，通常不显示中间状态，只显示最终结果。
		// 所以这里留空，只在流式更新时填充。

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

		// 使用 Markdown 渲染（先清理 <thought> 标签）
		if (this.app) {
			const { cleanedContent } = parseAgentContent(this.data.content);
			MarkdownRenderer.render(this.app, cleanedContent, content, '', new Component());
			// 设置内部链接的点击事件和 hover preview
			// 如果正在流式传输，禁用 hover preview
			this.mouseoverHandler = setupInternalLinks(content, this.app, this.data.isStreaming, this.observers);
		} else {
			const { cleanedContent } = parseAgentContent(this.data.content);
			content.innerHTML = this.escapeHtml(cleanedContent);
		}

		bubble.appendChild(this.renderTimestamp());

		// 渲染操作按钮和引用
		this.renderActions(bubble);
		this.renderCitations(bubble);

		// 渲染追问问题卡片（在 wrapper 中，bubble 之后）
		if (this.data.followUpQuestions && this.data.followUpQuestions.length > 0) {
			const followUpComponent = new FollowUpQuestions({
				questions: this.data.followUpQuestions,
				onQuestionClick: this.onQuestionClick
			});
			wrapper.appendChild(followUpComponent.getElement());
		}

		// 如果正在流式传输，添加光标效果 (由 CSS 处理 .deeppdf-message-streaming)
		if (this.data.isStreaming) {
			container.addClass('deeppdf-message-streaming');
		} else {
			container.removeClass('deeppdf-message-streaming');
		}

		return container;
	}

	update(data: Partial<MessageData>): void {
		const oldContent = this.data.content;
		const oldCitations = this.data.citations;
		const oldFollowUpQuestions = this.data.followUpQuestions;
		const oldAgentToolCalls = this.data.agentToolCalls;
		const oldCurrentStatus = (this.data as any).currentStatus;
		const wasStreaming = this.data.isStreaming;

		Object.assign(this.data, data);

		// 检查哪些字段发生了变化（优化：使用浅比较而非 JSON.stringify）
		const citationsChanged = data.citations !== undefined && (
			data.citations !== oldCitations &&
			(data.citations?.length !== oldCitations?.length || data.citations?.[0] !== oldCitations?.[0])
		);
		const followUpChanged = data.followUpQuestions !== undefined && (
			data.followUpQuestions !== oldFollowUpQuestions &&
			(data.followUpQuestions?.length !== oldFollowUpQuestions?.length || data.followUpQuestions?.[0] !== oldFollowUpQuestions?.[0])
		);

		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;
		const currentStatusChanged = data.currentStatus !== undefined && data.currentStatus !== oldCurrentStatus;

		// 调试：输出关键变量
		console.log('[DeepPDF] update() 调用:', {
			hasEl: !!this.el,
			dataCurrentStatus: data.currentStatus,
			oldCurrentStatus: oldCurrentStatus,
			currentStatusChanged: currentStatusChanged
		});

		// 优先处理状态更新（不受节流限制，立即更新）
		if (currentStatusChanged && this.el) {
			console.log('[DeepPDF] update() - 状态变化:', oldCurrentStatus, '->', data.currentStatus);
			let statusEl = this.el.querySelector('.deeppdf-message-status-text');
			if (!statusEl) {
				const headerRow = this.el.querySelector('.deeppdf-message-header-row');
				if (headerRow) {
					statusEl = headerRow.createEl('div', { cls: 'deeppdf-message-status-text' });
					console.log('[DeepPDF] update() - 创建状态元素');
				}
			}

			if (statusEl) {
				const newStatus = this.data.currentStatus;
				console.log('[DeepPDF] update() - 设置状态:', newStatus);
				if (newStatus) {
					if (statusEl.textContent !== newStatus) {
						statusEl.textContent = newStatus;
						statusEl.addClass('visible');
					}
				} else {
					if (statusEl.textContent !== '') {
						statusEl.textContent = '';
						statusEl.removeClass('visible');
					}
				}
			}
		}

		// 如果只是内容变了，且DOM已存在，尝试局部更新
		if (this.el &&
			data.content !== undefined &&
			data.content !== oldContent &&
			!citationsChanged &&
			!followUpChanged &&
			!agentToolCallsChanged &&
			!streamingEnded
		) {
			this.updateContent(data.content);
		} else if (streamingEnded && this.el) {
			// 流式结束时，进行完整的 Markdown 渲染
			const contentEl = this.el.querySelector('.deeppdf-message-content');
			const statusEl = this.el.querySelector('.deeppdf-message-status-text');

			// 结束时隐藏状态
			if (statusEl) statusEl.textContent = '';

			if (contentEl && this.app) {
				// 清理旧的 observers 和 mouseover handler
				this.observers.forEach(obs => obs.disconnect());
				this.observers = [];
				if (this.mouseoverHandler) {
					document.removeEventListener('mouseover', this.mouseoverHandler);
					this.mouseoverHandler = null;
				}

				// 处理 HTML 标签
				const { cleanedContent } = parseAgentContent(this.data.content);

				contentEl.empty();
				MarkdownRenderer.render(this.app, cleanedContent, contentEl as HTMLElement, '', new Component());
				// 设置内部链接的点击事件和 hover preview
				this.mouseoverHandler = setupInternalLinks(contentEl as HTMLElement, this.app, false, this.observers);
			}
			// 移除流式状态
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

	protected updateContent(content: string): void {
		const contentEl = this.el?.querySelector('.deeppdf-message-content');
		if (!contentEl) return;

		// 如果正在流式更新，使用追加模式而非完全重绘
		if (this.data.isStreaming) {
			this.streamingUpdateContent(contentEl as HTMLElement, content);
		} else {
			// 非流式更新，完全重绘
			this.fullUpdateContent(contentEl as HTMLElement, content);
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

			// 1. 解析内容
			const { cleanedContent, currentStatus } = parseAgentContent(newContent);

			// 检查内容是否真正变化
			const contentLen = cleanedContent.length;
			const contentGrowth = contentLen - this.lastRenderedLength;
			const timePassed = now - this.lastRenderTime;

			// 检查内容是否实质性变化（忽略尾部空格差异）
			const normalizedNew = cleanedContent.trim();
			const normalizedOld = this.lastRenderedContent.trim();
			const contentChanged = normalizedNew !== normalizedOld;

			// 动态节流策略
			let throttleThreshold = 100;
			if (contentLen > 1500) throttleThreshold = 400;
			else if (contentLen > 500) throttleThreshold = 200;

			// 决定是否需要渲染
			const shouldRender = contentChanged && (contentGrowth > 50 || timePassed > throttleThreshold);

			if (shouldRender && this.app) {
				// 渲染 Markdown（包括 wiki 链接）
				const tempContainer = document.createElement('div');

				MarkdownRenderer.render(this.app, cleanedContent, tempContainer, '', new Component()).then(() => {
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

					// 【新增】更新状态显示（不受节流限制）
					if (this.el) {
						const headerRow = this.el.querySelector('.deeppdf-message-header-row');
						if (headerRow) {
							let statusEl = headerRow.querySelector('.deeppdf-message-status-text');
							if (!statusEl) {
								statusEl = headerRow.createEl('div', { cls: 'deeppdf-message-status-text' });
							}
							if (statusEl) {
								if (currentStatus && statusEl.textContent !== currentStatus) {
									statusEl.textContent = currentStatus;
									statusEl.addClass('visible');
								} else if (!currentStatus && statusEl.textContent !== '') {
									statusEl.textContent = '';
									statusEl.removeClass('visible');
								}
							}
						}
					}

					// 更新跟踪变量
					this.lastRenderedContent = cleanedContent;
					this.lastRenderTime = Date.now();
					this.lastRenderedLength = contentLen;
				});
			}

			this.streamingAnimationFrame = null;
		});
	}

	/**
	 * 完全更新内容
	 */
	private fullUpdateContent(contentEl: HTMLElement, content: string): void {
		// 清理旧的 observers 和 mouseover handler
		this.observers.forEach(obs => obs.disconnect());
		this.observers = [];
		if (this.mouseoverHandler) {
			document.removeEventListener('mouseover', this.mouseoverHandler);
			this.mouseoverHandler = null;
		}

		contentEl.empty();

		const { cleanedContent } = parseAgentContent(content);

		if (this.app) {
			MarkdownRenderer.render(this.app, cleanedContent, contentEl, '', new Component());
			// 设置内部链接的点击事件和 hover preview
			this.mouseoverHandler = setupInternalLinks(contentEl, this.app, this.data.isStreaming, this.observers);
		} else {
			contentEl.innerHTML = this.escapeHtml(cleanedContent);
		}
	}

	private renderActions(container: HTMLElement) {
		const hasActions = !!(this.onRegenerate || this.onCopy || (this.onCopyWithCitation && this.data.citations && this.data.citations.length > 0));
		if (hasActions) {
			const actions = container.createEl('div', { cls: 'deeppdf-message-actions' });
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
			if (this.onCopyWithCitation && this.data.citations?.length) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Copy with headers/list
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`;
				btn.title = "Copy with Citations";
				btn.addEventListener('click', () => this.onCopyWithCitation?.());
			}
		}
	}

	private renderCitations(container: HTMLElement) {
		console.log('[renderCitations] citations数据:', this.data.citations);
		if (this.data.citations && this.data.citations.length > 0) {
			const citationsContainer = container.createEl('div', { cls: 'deeppdf-message-citations' });
			this.data.citations.forEach(citation => {
				const citationEl = new Citation(citation, this.onCitationJump);
				citationsContainer.appendChild(citationEl.getElement());
			});
		}
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
		onCopyWithCitation?: () => void;
		onQuestionClick?: (question: string) => void;
		onCitationJump?: (citation: CitationData) => void;
		app?: App;
	}
): Message {
	if (data.role === 'user') {
		return new UserMessage(data, options?.app);
	} else {
		return new AIMessage(data, options);
	}
}
