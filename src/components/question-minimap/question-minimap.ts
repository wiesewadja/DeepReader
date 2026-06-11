// frontend/src/components/question-minimap/question-minimap.ts
import { Component } from '../component';
import type { MessageData } from '../message/message';

/**
 * Minimap 组件属性
 */
export interface QuestionMinimapProps {
	/** 消息容器元素（用于计算滚动位置） */
	containerEl: HTMLElement;
	/** 点击回调，返回消息 ID */
	onMessageClick: (messageId: string) => void;
}

/**
 * Minimap 块数据
 */
interface MinimapBlock {
	id: string;
	role: 'user' | 'assistant';
	top: number;
	height: number;
	/** tooltip 内容（用户块为问题内容，AI 块为对应问题内容） */
	tooltipContent?: string;
	/** 对应的用户消息 ID（AI 块用） */
	userId?: string;
}

// 常量定义
const USER_BLOCK_HEIGHT = 16;  // 放大用户块
const AI_BLOCK_HEIGHT = 6;

/**
 * Question Minimap 组件
 */
export class QuestionMinimap extends Component {
	private props: QuestionMinimapProps;
	private messages: MessageData[] = [];
	private blocks: MinimapBlock[] = [];
	private trackEl: HTMLElement | null = null;
	private viewportEl: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private isDragging = false;

	constructor(props: QuestionMinimapProps) {
		super();
		this.props = props;
		this.el = this.render();
	}

	render(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'deeppdf-question-minimap';
		container.setAttribute('aria-label', '对话导航');

		this.trackEl = container.createEl('div', {
			cls: 'deeppdf-minimap-track'
		});

		this.viewportEl = container.createEl('div', {
			cls: 'deeppdf-minimap-viewport'
		});

		this.tooltipEl = document.body.createEl('div', {
			cls: 'deeppdf-minimap-tooltip deeppdf-minimap-tooltip-hidden'
		});

		this.bindEvents();

		return container;
	}

	private bindEvents(): void {
		this.scrollHandler = () => {
			this.updateViewportPosition();
		};
		this.props.containerEl.addEventListener('scroll', this.scrollHandler);

		// 拖动滚动功能
		this.el?.addEventListener('mousedown', (e) => {
			this.isDragging = true;
			this.scrollToPosition(e);
			e.preventDefault();
		});

		document.addEventListener('mousemove', (e) => {
			if (this.isDragging) {
				this.scrollToPosition(e);
			}
		});

		document.addEventListener('mouseup', () => {
			this.isDragging = false;
		});

		requestAnimationFrame(() => {
			this.updateViewportPosition();
		});
	}

	/**
	 * 根据 minimap 位置滚动到对应位置
	 */
	private scrollToPosition(event: MouseEvent): void {
		if (!this.trackEl) return;

		const rect = this.trackEl.getBoundingClientRect();
		const y = event.clientY - rect.top;
		const percent = Math.max(0, Math.min(1, y / rect.height));

		const container = this.props.containerEl;
		const maxScroll = container.scrollHeight - container.clientHeight;
		container.scrollTo({
			top: percent * maxScroll,
			behavior: this.isDragging ? 'auto' : 'smooth'
		});
	}

	updateMessages(messages: MessageData[]): void {
		this.messages = messages.filter(m => !m.hidden);
		this.calculateBlocks();
		this.renderBlocks();
		this.updateViewportPosition();
	}

	private calculateBlocks(): void {
		if (!this.trackEl) return;

		const minimapHeight = this.trackEl.clientHeight;
		const containerScrollHeight = this.props.containerEl.scrollHeight;

		// 即使无法计算位置，也必须清空旧 blocks，避免 minimap 残留旧数据
		this.blocks = [];

		if (containerScrollHeight === 0 || minimapHeight === 0) return;

		this.blocks = [];

		// 记录最近一个用户消息的内容，用于 AI 块的 tooltip
		let lastUserContent = '';
		let lastUserId = '';

		for (const msg of this.messages) {
			const msgEl = this.props.containerEl.querySelector(
				`[data-message-id="${msg.id}"]`
			) as HTMLElement;

			if (!msgEl) continue;

			const msgTop = msgEl.offsetTop;
			const msgHeight = msgEl.offsetHeight;

			const topPercent = msgTop / containerScrollHeight;
			const heightPercent = msgHeight / containerScrollHeight;

			const top = topPercent * minimapHeight;
			const height = Math.max(
				heightPercent * minimapHeight,
				msg.role === 'user' ? USER_BLOCK_HEIGHT : AI_BLOCK_HEIGHT
			);

			if (msg.role === 'user') {
				lastUserContent = this.truncateText(msg.content, 50);
				lastUserId = msg.id;
				this.blocks.push({
					id: msg.id,
					role: msg.role,
					top,
					height,
					tooltipContent: lastUserContent,
				});
			} else {
				// AI 块使用对应问题的内容
				this.blocks.push({
					id: msg.id,
					role: msg.role,
					top,
					height,
					tooltipContent: lastUserContent,
					userId: lastUserId,
				});
			}
		}
	}

	private renderBlocks(): void {
		if (!this.trackEl) return;

		this.trackEl.empty();

		for (const block of this.blocks) {
			const blockEl = this.trackEl.createEl('div', {
				cls: `deeppdf-minimap-block deeppdf-minimap-block-${block.role}`,
				attr: {
					'data-message-id': block.id,
				},
			});

			blockEl.style.top = `${block.top}px`;
			blockEl.style.height = `${block.height}px`;

			// 用户块可交互
			if (block.role === 'user') {
				blockEl.setAttribute('role', 'button');
				blockEl.setAttribute('tabindex', '0');
				blockEl.setAttribute('aria-label', `跳转到：${block.tooltipContent}`);

				this.bindBlockEvents(blockEl, block.id, block.tooltipContent || '');
			}

			// AI 块也添加 tooltip（显示对应问题内容）和点击跳转
			if (block.role === 'assistant' && block.tooltipContent) {
				// 点击跳转到对应的用户问题
				this.bindBlockEvents(blockEl, block.userId || block.id, block.tooltipContent);
			}
		}
	}

	/**
	 * 为块绑定事件
	 */
	private bindBlockEvents(
		blockEl: HTMLElement,
		clickId: string,
		tooltipContent: string
	): void {
		// tooltip
		blockEl.addEventListener('mouseenter', (e) => {
			this.showTooltip(tooltipContent, e);
		});
		blockEl.addEventListener('mousemove', (e) => {
			this.updateTooltipPosition(e);
		});
		blockEl.addEventListener('mouseleave', () => {
			this.hideTooltip();
		});

		// 点击跳转
		blockEl.addEventListener('click', (e) => {
			e.stopPropagation();
			this.hideTooltip();
			this.props.onMessageClick(clickId);
		});
	}

	private updateViewportPosition(): void {
		if (!this.viewportEl || !this.trackEl) return;

		const container = this.props.containerEl;
		const viewportHeight = container.clientHeight;
		const scrollHeight = container.scrollHeight;
		const scrollTop = container.scrollTop;

		if (scrollHeight === 0) return;

		// 内容不需滚动（全部可见）—— 隐藏 viewport 指示器
		// 避免出现"一整条覆盖全高的紫条"
		if (scrollHeight <= viewportHeight) {
			this.viewportEl.style.display = 'none';
			return;
		}
		this.viewportEl.style.display = '';

		const minimapHeight = this.trackEl.clientHeight;
		const viewportPercent = viewportHeight / scrollHeight;
		const scrollTopPercent = scrollTop / scrollHeight;

		const top = scrollTopPercent * minimapHeight;
		const height = Math.max(viewportPercent * minimapHeight, 10);

		this.viewportEl.style.top = `${top}px`;
		this.viewportEl.style.height = `${height}px`;
	}

	private showTooltip(content: string, event: MouseEvent): void {
		if (!this.tooltipEl) return;
		this.tooltipEl.textContent = content;
		this.tooltipEl.removeClass('deeppdf-minimap-tooltip-hidden');
		this.updateTooltipPosition(event);
	}

	private updateTooltipPosition(event: MouseEvent): void {
		if (!this.tooltipEl) return;
		const minimapRect = this.el?.getBoundingClientRect();
		if (!minimapRect) return;
		// tooltip 显示在 minimap 左侧
		const tooltipWidth = this.tooltipEl.offsetWidth || 200;
		const x = minimapRect.left - tooltipWidth - 10;
		const y = event.clientY;
		this.tooltipEl.style.left = `${x}px`;
		this.tooltipEl.style.top = `${y}px`;
	}

	private hideTooltip(): void {
		if (!this.tooltipEl) return;
		this.tooltipEl.addClass('deeppdf-minimap-tooltip-hidden');
	}

	private truncateText(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength) + '...';
	}

	override destroy(): void {
		if (this.scrollHandler) {
			this.props.containerEl.removeEventListener('scroll', this.scrollHandler);
		}
		if (this.tooltipEl && this.tooltipEl.parentNode) {
			this.tooltipEl.parentNode.removeChild(this.tooltipEl);
		}
		super.destroy();
	}
}
