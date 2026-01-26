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
	// 策略升级：使用更宽泛的 Emoji 匹配 + 关键词匹配，防止漏网
	// 常见状态关键词
	const statusKeywords = ['正在搜索', '正在分析', '正在综合', '正在查找', '正在阅读', 'Writing', 'Reading', 'Searching'];
	const keywordPattern = statusKeywords.join('|');

	// 匹配模式：
	// 1. Emoji 开头 (包括各种变体，扩展 Surrogate Pairs 范围 D83C-D83E) + 可选文本
	// 2. 关键词开头
	// 限制长度在 100 字符以内，防止匹配整段正文
	// 优化 Emoji 范围：覆盖 U+1F000 - U+1FAFF (D83C-D83E high surrogates)
	const statusLineRegex = new RegExp(`^\\s*(?:[\\*\\-]\\s*)?(?:(?:[\\u2300-\\u27BF]|[\\uD83C-\\uD83E][\\uDC00-\\uDFFF])|(?:${keywordPattern}))\\s*.*$`, 'gm');

	let currentStatus: string | undefined;
	let match;

	// 找到最后一条状态
	while ((match = statusLineRegex.exec(content)) !== null) {
		const line = match[0].trim();
		// 再次确认长度，避免误伤
		if (line.length < 80) {
			// 清理一下 Markdown 符号
			currentStatus = line.replace(/^[\s*\-]*|[\s*]*$/g, '');
		}
	}

	// 从正文中移除所有符合状态行特征的行
	let processedContent = content.replace(statusLineRegex, (match) => {
		return match.length < 80 ? '' : match; // 只移除短行
	});

	// 1. 提取并合并思考过程
	const thoughts: string[] = [];

	// 策略修正：优先匹配【闭合】的 thought 标签，只有在明确闭合时才提取。
	// 防止未闭合标签吞噬整个正文。
	// 如果确实存在未闭合的标签（流式传输最后），我们尽量只在它明显看起来像 thought 时才处理，
	// 但为了安全，这里只匹配闭合标签。未闭合的让它留在正文里或者作为文本显示，总比吞噬正文好。
	const thoughtRegex = /<thought\b[^>]*>([\s\S]*?)<\/thought>/gi;

	processedContent = processedContent.replace(thoughtRegex, (match, thoughtContent) => {
		const trimmed = thoughtContent.trim();
		if (trimmed) {
			thoughts.push(trimmed);
		}
		return ''; // 从原位置移除
	});

	// 补救措施：检查是否有残留的未闭合 thought 标签
	// 如果存在 <thought> 但没有 </thought>，且它在文本末尾附近（流式传输中），我们可以尝试提取
	if (processedContent.includes('<thought')) {
		const unclosedRegex = /<thought\b[^>]*>([\s\S]*)$/i;
		const unclosedMatch = unclosedRegex.exec(processedContent);
		if (unclosedMatch) {
			// 只有当这个未闭合块看起来不像正文（比如没有 Markdown 标题）时才提取？
			// 或者：在流式传输时，无论如何都提取，因为我们想要“实时”看到思考
			// 风险：如果正文真的被包在里面了，那就遭了。
			// 折中：不提取未闭合的。让它原样显示（浏览器可能会把它当作无效标签隐藏，或者作为文本）。
			// 或者：我们可以在这里简单地移除 `<thought>` 标签本身，让内容作为正文显示，
			// 这样至少不会被折叠隐藏。
			processedContent = processedContent.replace(/<thought\b[^>]*>/gi, '\n> *[正在思考...]*\n');
		}
	}

	// 如果提取到了思考内容，统一放在顶部的一个 details 块中
	if (thoughts.length > 0) {
		const combinedThoughts = thoughts.join('\n\n');
		// 确保 combinedThoughts 内部没有未转义的 HTML 标签破坏结构
		// 但我们需要 MarkdownRenderer 渲染它，所以不能 escapeHtml。
		// 原生 Obsidian details 渲染通常是安全的。
		const thoughtHtml = `\n<details class="deeppdf-thought"><summary>思考过程</summary>\n${combinedThoughts}\n</details>\n\n`;
		processedContent = thoughtHtml + processedContent;
	}

	// 2. 移除 invoke 标签
	processedContent = processedContent
		.replace(/<invoke>/gi, '\n')
		.replace(/<\/invoke>/gi, '\n');

	// 3. 提取工具调用
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
			toolCalls.push({
				name: toolName,
				args: args,
				status: args.includes('ERROR') ? 'error' : 'success'
			});
		}
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
		// const oldAgentThoughts = this.data.agentThoughts; // 不再追踪思考变化，因为它们融合在 content 中
		const oldAgentToolCalls = this.data.agentToolCalls;
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
		// agentThoughts 变化现在由 content 变化隐含处理（HTML 渲染）

		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;

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
	 * 流式更新 - 实时显示思考内容和工具调用
	 *
	 * 优化策略:
	 * 1. 【双缓冲渲染】先在离屏 fragment 中渲染 Markdown，完成后再一次性替换 DOM，彻底消除 empty() 导致的白屏闪烁。
	 * 2. 【状态行优先】状态行更新不通过 Markdown 渲染，直接操作 DOM，保证最高实时性。
	 * 3. 【动态节流】随着文本变长，自动增加渲染间隔，防止长文卡死。
	 */
	private streamingUpdateContent(contentEl: HTMLElement, newContent: string): void {
		// 取消之前的动画帧
		if (this.streamingAnimationFrame !== null) {
			cancelAnimationFrame(this.streamingAnimationFrame);
		}

		this.streamingAnimationFrame = requestAnimationFrame(() => {
			const now = Date.now();

			// 1. 优先解析和更新状态（极速）
			const { cleanedContent, currentStatus } = parseAgentContent(newContent);

			// 查找或创建状态行元素（必须在渲染 Markdown 之前处理，否则会被清空）
			let statusEl = this.el?.querySelector('.deeppdf-message-status-text');
			if (!statusEl && this.el) {
				// 如果是第一次出现状态，可能需要插入
				// 但通常它在 render() 初始化时已创建。如果被意外删除了，我们要找回来。
				// 这里假设结构还在。
				const headerRow = this.el.querySelector('.deeppdf-message-header-row');
				if (headerRow) {
					statusEl = headerRow.createEl('div', { cls: 'deeppdf-message-status-text' });
				}
			}

			if (statusEl) {
				if (currentStatus) {
					// 只有当状态真正改变时才操作 DOM
					if (statusEl.textContent !== currentStatus) {
						statusEl.textContent = currentStatus;
						statusEl.addClass('visible');
					}
				} else {
					if (statusEl.textContent !== '') {
						statusEl.textContent = '';
						statusEl.removeClass('visible');
					}
				}
			}

			// 检查内容是否真正变化
			const contentChanged = cleanedContent !== this.lastRenderedContent;
			const contentLen = newContent.length;
			const contentGrowth = contentLen - this.lastRenderedLength;
			const timePassed = now - this.lastRenderTime;

			// 动态节流策略：内容越长，允许的渲染间隔越长，以维持帧率
			// < 1000字: 100ms
			// > 1000字: 300ms
			// > 3000字: 600ms
			let throttleThreshold = 100;
			if (contentLen > 3000) throttleThreshold = 600;
			else if (contentLen > 1000) throttleThreshold = 300;

			// 决定是否需要渲染
			// 1. 内容必须有变化
			// 2. 只有当 增长超过阈值(50字符) OR 时间超过阈值 时才渲染
			const shouldRender = contentChanged && (contentGrowth > 50 || timePassed > throttleThreshold);

			if (shouldRender) {
				// 启用硬件加速
				contentEl.style.transform = 'translateZ(0)';

				if (this.app) {
					// 【双缓冲关键逻辑】
					// 1. 创建临时的不可见容器
					const tempContainer = document.createElement('div');

					// 2. 在离屏容器中进行昂贵的 Markdown 渲染
					MarkdownRenderer.render(this.app, cleanedContent, tempContainer, '', new Component()).then(() => {
						// 3. 渲染完成后（Promise resolves），一次性替换内容
						// 注意：此时可能已经有新的流式内容进来了，所以这里可能有微小的竞态，
						// 但由于我们是基于 RAF 的单线程，且 render 是同步调用的（只是部分插件可能是异步），
						// Obsidian 的 MarkdownRenderer.render 其实大部分是同步的，但返回 Promise。

						// 安全检查：如果在此期间组件被销毁了，不要操作
						if (!this.el) return;

						// 使用 replaceChildren (高性能) 或 innerHTML
						contentEl.innerHTML = tempContainer.innerHTML;

						// 更新跟踪变量
						// 注意：我们只在真正渲染 DOM 后更新这些，这样如果渲染被跳过（节流），下次还会尝试
						this.lastRenderedContent = cleanedContent;
						this.lastRenderTime = Date.now();
						this.lastRenderedLength = contentLen;
					});
				} else {
					// 降级处理
					contentEl.innerHTML = cleanedContent;
					this.lastRenderedContent = cleanedContent;
					this.lastRenderTime = now;
					this.lastRenderedLength = contentLen;
				}
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
