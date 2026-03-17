// frontend/src/components/question-minimap/question-minimap.ts
import { Component } from '../component';
import type { MessageData } from '../message/message';

/**
 * Minimap 组件属性
 */
export interface QuestionMinimapProps {
	containerEl: HTMLElement;
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
	tooltipContent?: string;
	userId?: string;
	/** 消息在容器中的实际位置 */
	msgTop: number;
	msgHeight: number;
}

// 常量定义
const USER_BLOCK_HEIGHT = 14;
const AI_BLOCK_HEIGHT = 6;
/** 视口上下扩展比例（1.0 = 上下各扩展 100% 视口高度） */
const VIEWPORT_EXTEND_RATIO = 1.0;

/**
 * Question Minimap 组件
 * 滑动窗口模式：只显示当前视口附近的消息
 */
export class QuestionMinimap extends Component {
	private props: QuestionMinimapProps;
	private messages: MessageData[] = [];
	private allBlocks: MinimapBlock[] = [];
	private trackEl: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private rafId: number | null = null;

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

		this.tooltipEl = document.body.createEl('div', {
			cls: 'deeppdf-minimap-tooltip deeppdf-minimap-tooltip-hidden'
		});

		this.bindEvents();

		return container;
	}

	private bindEvents(): void {
		this.scrollHandler = () => {
			this.scheduleUpdate();
		};
		this.props.containerEl.addEventListener('scroll', this.scrollHandler);

		// 初始渲染
		requestAnimationFrame(() => {
			this.calculateAllBlocks();
			this.renderVisibleBlocks();
		});
	}

	/**
	 * 节流更新
	 */
	private scheduleUpdate(): void {
		if (this.rafId !== null) return;
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null;
			this.renderVisibleBlocks();
		});
	}

	/**
	 * 更新消息数据
	 */
	updateMessages(messages: MessageData[]): void {
		this.messages = messages.filter(m => !m.hidden);
		this.calculateAllBlocks();
		this.renderVisibleBlocks();
	}

	/**
	 * 计算所有消息块的位置信息
	 */
	private calculateAllBlocks(): void {
		this.allBlocks = [];
		let lastUserContent = '';
		let lastUserId = '';

		for (const msg of this.messages) {
			const msgEl = this.props.containerEl.querySelector(
				`[data-message-id="${msg.id}"]`
			) as HTMLElement;

			if (!msgEl) continue;

			const msgTop = msgEl.offsetTop;
			const msgHeight = msgEl.offsetHeight;

			if (msg.role === 'user') {
				lastUserContent = this.truncateText(msg.content, 50);
				lastUserId = msg.id;
				this.allBlocks.push({
					id: msg.id,
					role: msg.role,
					msgTop,
					msgHeight,
					top: 0, // 稍后计算
					height: USER_BLOCK_HEIGHT,
					tooltipContent: lastUserContent,
				});
			} else {
				this.allBlocks.push({
					id: msg.id,
					role: msg.role,
					msgTop,
					msgHeight,
					top: 0,
					height: AI_BLOCK_HEIGHT,
					tooltipContent: lastUserContent,
					userId: lastUserId,
				});
			}
		}
	}

	/**
	 * 渲染当前视口附近的块
	 */
	private renderVisibleBlocks(): void {
		if (!this.trackEl || this.allBlocks.length === 0) return;

		const container = this.props.containerEl;
		const viewportHeight = container.clientHeight;
		const scrollTop = container.scrollTop;

		// 计算可见窗口范围
		const windowTop = Math.max(0, scrollTop - viewportHeight * VIEWPORT_EXTEND_RATIO);
		const windowBottom = scrollTop + viewportHeight + viewportHeight * VIEWPORT_EXTEND_RATIO;

		// 筛选窗口内的块
		const visibleBlocks = this.allBlocks.filter(block => {
			const blockBottom = block.msgTop + block.msgHeight;
			return block.msgTop < windowBottom && blockBottom > windowTop;
		});

		if (visibleBlocks.length === 0) {
			this.trackEl.empty();
			return;
		}

		// 计算窗口范围
		const windowRangeStart = visibleBlocks[0].msgTop;
		const windowRangeEnd = Math.max(
			...visibleBlocks.map(b => b.msgTop + b.msgHeight)
		);
		const windowRange = windowRangeEnd - windowRangeStart;

		if (windowRange === 0) return;

		// 计算每个块在 minimap 中的位置
		const minimapHeight = this.trackEl.clientHeight;

		for (const block of visibleBlocks) {
			const relativeTop = block.msgTop - windowRangeStart;
			block.top = (relativeTop / windowRange) * minimapHeight;

			const relativeHeight = block.msgHeight / windowRange;
			block.height = Math.max(
				relativeHeight * minimapHeight,
				block.role === 'user' ? USER_BLOCK_HEIGHT : AI_BLOCK_HEIGHT
			);
		}

		// 渲染
		this.trackEl.empty();

		for (const block of visibleBlocks) {
			const blockEl = this.trackEl.createEl('div', {
				cls: `deeppdf-minimap-block deeppdf-minimap-block-${block.role}`,
			});

			blockEl.style.top = `${block.top}px`;
			blockEl.style.height = `${block.height}px`;

			// 绑定交互
			this.bindBlockEvents(
				blockEl,
				block.role === 'assistant' ? (block.userId || block.id) : block.id,
				block.tooltipContent || ''
			);
		}
	}

	/**
	 * 绑定块事件
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
		this.tooltipEl.style.left = `${minimapRect.right + 10}px`;
		this.tooltipEl.style.top = `${event.clientY}px`;
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
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
		}
		if (this.scrollHandler) {
			this.props.containerEl.removeEventListener('scroll', this.scrollHandler);
		}
		if (this.tooltipEl && this.tooltipEl.parentNode) {
			this.tooltipEl.parentNode.removeChild(this.tooltipEl);
		}
		super.destroy();
	}
}
