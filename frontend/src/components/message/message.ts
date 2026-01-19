/**
 * DeepPDF 消息组件
 * 实现 ChatGPT 风格的聊天消息界面
 */

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
}

/**
 * HTML 转义工具函数
 * 防止 XSS 攻击
 */
function escapeHtml(text: string): string {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) {
		return '刚刚';
	} else if (diffMins < 60) {
		return `${diffMins} 分钟前`;
	} else if (diffMins < 1440) {
		const hours = Math.floor(diffMins / 60);
		return `${hours} 小时前`;
	} else {
		return date.toLocaleDateString('zh-CN', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
}

/**
 * 引用来源组件
 * 显示 PDF 引用信息，支持点击跳转
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

		// 引用头部：文件名和页码
		const header = citationEl.createEl('div', { cls: 'deeppdf-citation-header' });

		const fileInfo = header.createEl('div', { cls: 'deeppdf-citation-file-info' });
		fileInfo.createEl('span', {
			cls: 'deeppdf-citation-icon',
			text: '📄'
		});
		fileInfo.createEl('span', {
			cls: 'deeppdf-citation-filename',
			text: this.escapeHtml(this.citation.pdf_name)
		});

		const pageBadge = header.createEl('span', {
			cls: 'deeppdf-citation-page-badge'
		});
		pageBadge.createEl('span', { text: '第 ' });
		pageBadge.createEl('strong', { text: this.citation.page.toString() });
		pageBadge.createEl('span', { text: ' 页' });

		// 引用内容
		const snippet = citationEl.createEl('div', {
			cls: 'deeppdf-citation-snippet',
			text: this.citation.snippet
		});

		// 跳转按钮（如果有回调）
		if (this.onJump) {
			const jumpBtn = citationEl.createEl('button', {
				cls: 'deeppdf-citation-jump-btn'
			});
			jumpBtn.innerHTML = '🔗 跳转';
			jumpBtn.addEventListener('click', () => {
				this.onJump?.(this.citation);
			});
		}

		return citationEl;
	}

	private escapeHtml(text: string): string {
		return escapeHtml(text);
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

	constructor(data: MessageData) {
		this.data = data;
		// 不在构造函数中调用 render()，让子类在设置完属性后自行调用
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

	/**
	 * 转义 HTML
	 */
	protected escapeHtml(text: string): string {
		return escapeHtml(text);
	}

	/**
	 * 子类实现具体的渲染逻辑
	 */
	abstract render(): HTMLElement;

	/**
	 * 更新消息内容
	 */
	update(data: Partial<MessageData>): void {
		Object.assign(this.data, data);
		const newRender = this.render();
		if (this.el) {
			this.el.replaceWith(newRender);
		}
		this.el = newRender;
	}

	/**
	 * 获取消息元素
	 */
	getElement(): HTMLElement {
		if (!this.el) {
			throw new Error('Message element not initialized. Call render() first.');
		}
		return this.el;
	}

	/**
	 * 获取消息数据
	 */
	getData(): MessageData {
		return { ...this.data };
	}
}

/**
 * 用户消息组件
 * 右对齐，浅色背景
 */
export class UserMessage extends Message {
	constructor(data: MessageData) {
		super(data);
		this.el = this.render();
	}

	render(): HTMLElement {
		const container = this.renderContainer();

		// 消息内容包装器（右对齐）
		const wrapper = container.createEl('div', {
			cls: 'deeppdf-message-wrapper'
		});

		// 消息气泡
		const bubble = wrapper.createEl('div', {
			cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-user']
		});

		// 消息内容
		const content = bubble.createEl('div', {
			cls: 'deeppdf-message-content'
		});
		content.innerHTML = this.escapeHtml(this.data.content);

		// 时间戳
		bubble.appendChild(this.renderTimestamp());

		return container;
	}
}

/**
 * AI 消息组件
 * 左对齐，深色背景，带操作按钮
 */
export class AIMessage extends Message {
	private onRegenerate?: () => void;
	private onCopy?: () => void;
	private onCopyWithCitation?: () => void;

	constructor(
		data: MessageData,
		options?: {
			onRegenerate?: () => void;
			onCopy?: () => void;
			onCopyWithCitation?: () => void;
		}
	) {
		super(data);
		this.onRegenerate = options?.onRegenerate;
		this.onCopy = options?.onCopy;
		this.onCopyWithCitation = options?.onCopyWithCitation;
		this.el = this.render();
	}

	render(): HTMLElement {
		const container = this.renderContainer();

		// 消息内容包装器（左对齐）
		const wrapper = container.createEl('div', {
			cls: 'deeppdf-message-wrapper'
		});

		// AI 图标
		const avatar = wrapper.createEl('div', {
			cls: 'deeppdf-message-avatar'
		});
		avatar.innerHTML = '🤖';

		// 消息气泡
		const bubble = wrapper.createEl('div', {
			cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-ai']
		});

		// 消息内容
		const content = bubble.createEl('div', {
			cls: 'deeppdf-message-content'
		});
		content.innerHTML = this.escapeHtml(this.data.content);

		// 时间戳
		bubble.appendChild(this.renderTimestamp());

		// 操作按钮（只有当有回调时才创建）
		const hasActions = !!(this.onRegenerate || this.onCopy || (this.onCopyWithCitation && this.data.citations && this.data.citations.length > 0));
		if (hasActions) {
			const actions = bubble.createEl('div', {
				cls: 'deeppdf-message-actions'
			});

			if (this.onRegenerate) {
				const regenerateBtn = actions.createEl('button', {
					cls: 'deeppdf-message-action-btn'
				});
				regenerateBtn.innerHTML = '🔄 重新生成';
				regenerateBtn.addEventListener('click', () => {
					this.onRegenerate?.();
				});
			}

			if (this.onCopy) {
				const copyBtn = actions.createEl('button', {
					cls: 'deeppdf-message-action-btn'
				});
				copyBtn.innerHTML = '📋 复制';
				copyBtn.addEventListener('click', () => {
					this.onCopy?.();
				});
			}

			if (this.onCopyWithCitation && this.data.citations && this.data.citations.length > 0) {
				const copyWithCitationBtn = actions.createEl('button', {
					cls: 'deeppdf-message-action-btn'
				});
				copyWithCitationBtn.innerHTML = '📋 复制+引用';
				copyWithCitationBtn.addEventListener('click', () => {
					this.onCopyWithCitation?.();
				});
			}
		}

		// 引用来源
		if (this.data.citations && this.data.citations.length > 0) {
			const citationsContainer = bubble.createEl('div', {
				cls: 'deeppdf-message-citations'
			});

			this.data.citations.forEach(citation => {
				const citationEl = new Citation(citation);
				citationsContainer.appendChild(citationEl.getElement());
			});
		}

		return container;
	}
}

/**
 * 消息工厂函数
 * 根据消息角色创建相应的消息组件
 */
export function createMessage(
	data: MessageData,
	options?: {
		onRegenerate?: () => void;
		onCopy?: () => void;
		onCopyWithCitation?: () => void;
	}
): Message {
	if (data.role === 'user') {
		return new UserMessage(data);
	} else {
		return new AIMessage(data, options);
	}
}
