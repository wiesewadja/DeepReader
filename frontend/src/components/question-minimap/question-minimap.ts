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
export interface MinimapBlock {
	id: string;
	role: 'user' | 'assistant';
	/** 块在 minimap 中的 Y 位置（像素） */
	top: number;
	/** 块的高度 */
	height: number;
	/** tooltip 内容（仅用户消息） */
	tooltipContent?: string;
}

// 常量定义
const USER_BLOCK_HEIGHT = 12;
const AI_BLOCK_HEIGHT = 6;

/**
 * Question Minimap 组件
 * 在消息列表左侧显示对话导航 minimap
 */
export class QuestionMinimap extends Component {
	private props: QuestionMinimapProps;
	private messages: MessageData[] = [];
	private blocks: MinimapBlock[] = [];
	private trackEl: HTMLElement | null = null;
	private viewportEl: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;

	constructor(props: QuestionMinimapProps) {
		super();
		this.props = props;
		this.el = this.render();
	}

	/**
	 * 渲染组件
	 */
	render(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'deeppdf-question-minimap';
		container.setAttribute('aria-label', '对话导航');

		// 标记轨道
		this.trackEl = container.createEl('div', {
			cls: 'deeppdf-minimap-track'
		});

		// 视口指示器
		this.viewportEl = container.createEl('div', {
			cls: 'deeppdf-minimap-viewport'
		});

		// Tooltip
		this.tooltipEl = document.body.createEl('div', {
			cls: 'deeppdf-minimap-tooltip deeppdf-minimap-tooltip-hidden'
		});

		// 绑定事件
		this.bindEvents();

		return container;
	}

	/**
	 * 绑定事件
	 */
	private bindEvents(): void {
		// 滚动同步 - 始终更新视口位置
		this.scrollHandler = () => {
			this.updateViewportPosition();
		};
		this.props.containerEl.addEventListener('scroll', this.scrollHandler);

		// 初始更新视口
		requestAnimationFrame(() => {
			this.updateViewportPosition();
		});
	}

	/**
	 * 更新消息数据
	 */
	updateMessages(messages: MessageData[]): void {
		this.messages = messages.filter(m => !m.hidden);
		this.calculateBlocks();
		this.renderBlocks();
		// 更新视口位置
		this.updateViewportPosition();
	}

	/**
	 * 计算块位置
	 */
	private calculateBlocks(): void {
		if (!this.trackEl) return;

		const minimapHeight = this.trackEl.clientHeight;
		const containerScrollHeight = this.props.containerEl.scrollHeight;

		if (containerScrollHeight === 0 || minimapHeight === 0) return;

		this.blocks = [];

		for (const msg of this.messages) {
			const msgEl = this.props.containerEl.querySelector(
				`[data-message-id="${msg.id}"]`
			) as HTMLElement;

			if (!msgEl) continue;

			const msgTop = msgEl.offsetTop;
			const msgHeight = msgEl.offsetHeight;

			// 按比例计算位置
			const topPercent = msgTop / containerScrollHeight;
			const heightPercent = msgHeight / containerScrollHeight;

			const top = topPercent * minimapHeight;
			const height = Math.max(
				heightPercent * minimapHeight,
				msg.role === 'user' ? USER_BLOCK_HEIGHT : AI_BLOCK_HEIGHT
			);

			this.blocks.push({
				id: msg.id,
				role: msg.role,
				top,
				height,
				tooltipContent:
					msg.role === 'user' ? this.truncateText(msg.content, 50) : undefined,
			});
		}
	}

	/**
	 * 渲染块
	 */
	private renderBlocks(): void {
		if (!this.trackEl) return;

		// 清空现有块
		this.trackEl.empty();

		for (const block of this.blocks) {
			const blockEl = this.trackEl.createEl('div', {
				cls: `deeppdf-minimap-block deeppdf-minimap-block-${block.role}`,
				attr: {
					'data-message-id': block.id,
				},
			});

			// 设置位置和高度
			blockEl.style.top = `${block.top}px`;
			blockEl.style.height = `${block.height}px`;

			// 用户块可交互
			if (block.role === 'user') {
				blockEl.setAttribute('role', 'button');
				blockEl.setAttribute('tabindex', '0');
				blockEl.setAttribute(
					'aria-label',
					`跳转到：${block.tooltipContent}`
				);

				// hover 显示 tooltip
				blockEl.addEventListener('mouseenter', (e) => {
					this.showTooltip(block.tooltipContent || '', e);
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
					this.props.onMessageClick(block.id);
				});

				// 键盘支持
				blockEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						this.hideTooltip();
						this.props.onMessageClick(block.id);
					}
				});
			}
		}
	}

	/**
	 * 更新视口位置
	 */
	private updateViewportPosition(): void {
		if (!this.viewportEl || !this.trackEl) return;

		const container = this.props.containerEl;
		const viewportHeight = container.clientHeight;
		const scrollHeight = container.scrollHeight;
		const scrollTop = container.scrollTop;

		if (scrollHeight === 0) return;

		const minimapHeight = this.trackEl.clientHeight;
		const viewportPercent = viewportHeight / scrollHeight;
		const scrollTopPercent = scrollTop / scrollHeight;

		const top = scrollTopPercent * minimapHeight;
		const height = Math.max(viewportPercent * minimapHeight, 10);

		this.viewportEl.style.top = `${top}px`;
		this.viewportEl.style.height = `${height}px`;
	}

	/**
	 * 显示 tooltip
	 */
	private showTooltip(content: string, event: MouseEvent): void {
		if (!this.tooltipEl) return;

		this.tooltipEl.textContent = content;
		this.tooltipEl.removeClass('deeppdf-minimap-tooltip-hidden');
		this.updateTooltipPosition(event);
	}

	/**
	 * 更新 tooltip 位置
	 */
	private updateTooltipPosition(event: MouseEvent): void {
		if (!this.tooltipEl) return;

		// 获取 minimap 的位置
		const minimapRect = this.el?.getBoundingClientRect();
		if (!minimapRect) return;

		// tooltip 显示在 minimap 右侧
		const x = minimapRect.right + 10;
		const y = event.clientY;

		this.tooltipEl.style.left = `${x}px`;
		this.tooltipEl.style.top = `${y}px`;
	}

	/**
	 * 隐藏 tooltip
	 */
	private hideTooltip(): void {
		if (!this.tooltipEl) return;
		this.tooltipEl.addClass('deeppdf-minimap-tooltip-hidden');
	}

	/**
	 * 截断文本
	 */
	private truncateText(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength) + '...';
	}

	/**
	 * 销毁组件
	 */
	override destroy(): void {
		// 移除滚动监听
		if (this.scrollHandler) {
			this.props.containerEl.removeEventListener('scroll', this.scrollHandler);
		}
		// 移除 tooltip
		if (this.tooltipEl && this.tooltipEl.parentNode) {
			this.tooltipEl.parentNode.removeChild(this.tooltipEl);
		}
		super.destroy();
	}
}
