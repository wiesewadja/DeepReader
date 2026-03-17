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
 * 对话组数据（问题 + 回答）
 */
interface ConversationGroup {
	/** 用户消息 ID */
	userId: string;
	/** 用户块位置 */
	userTop: number;
	/** 用户块高度 */
	userHeight: number;
	/** 整个组的位置（从用户块到下一个用户块之前） */
	groupTop: number;
	/** 整个组的高度 */
	groupHeight: number;
	/** tooltip 内容 */
	tooltipContent: string;
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
	private groups: ConversationGroup[] = [];
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
		this.calculateGroups();
		this.renderBlocks();
		this.updateViewportPosition();
	}

	/**
	 * 计算对话组位置
	 */
	private calculateGroups(): void {
		if (!this.trackEl) return;

		const minimapHeight = this.trackEl.clientHeight;
		const containerScrollHeight = this.props.containerEl.scrollHeight;

		if (containerScrollHeight === 0 || minimapHeight === 0) return;

		this.groups = [];

		// 找出所有用户消息的索引
		const userIndices: number[] = [];
		this.messages.forEach((msg, idx) => {
			if (msg.role === 'user') {
				userIndices.push(idx);
			}
		});

		// 为每个用户消息创建对话组
		for (let i = 0; i < userIndices.length; i++) {
			const userIdx = userIndices[i];
			const userMsg = this.messages[userIdx];
			const nextUserIdx = userIndices[i + 1];

			// 获取用户消息元素
			const userEl = this.props.containerEl.querySelector(
				`[data-message-id="${userMsg.id}"]`
			) as HTMLElement;

			if (!userEl) continue;

			const userTop = userEl.offsetTop;
			const userHeight = userEl.offsetHeight;

			// 计算组的结束位置（下一个用户消息之前，或者到末尾）
			let groupEndTop = containerScrollHeight;
			if (nextUserIdx !== undefined) {
				const nextUserMsg = this.messages[nextUserIdx];
				const nextUserEl = this.props.containerEl.querySelector(
					`[data-message-id="${nextUserMsg.id}"]`
				) as HTMLElement;
				if (nextUserEl) {
					groupEndTop = nextUserEl.offsetTop;
				}
			}

			const groupHeight = groupEndTop - userTop;

			// 按比例计算位置
			const userTopPercent = userTop / containerScrollHeight;
			const groupTopPercent = userTop / containerScrollHeight;
			const groupHeightPercent = groupHeight / containerScrollHeight;
			const userHeightPercent = userHeight / containerScrollHeight;

			this.groups.push({
				userId: userMsg.id,
				userTop: userTopPercent * minimapHeight,
				userHeight: Math.max(userHeightPercent * minimapHeight, USER_BLOCK_HEIGHT),
				groupTop: groupTopPercent * minimapHeight,
				groupHeight: Math.max(groupHeightPercent * minimapHeight, USER_BLOCK_HEIGHT),
				tooltipContent: this.truncateText(userMsg.content, 50),
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

		for (const group of this.groups) {
			// 1. 创建整个对话组的交互层（透明，覆盖问题+回答）
			const groupHitArea = this.trackEl.createEl('div', {
				cls: 'deeppdf-minimap-group-hitarea',
				attr: {
					'data-message-id': group.userId,
				},
			});
			groupHitArea.style.top = `${group.groupTop}px`;
			groupHitArea.style.height = `${group.groupHeight}px`;

			// 绑定 tooltip 事件到整个组
			groupHitArea.addEventListener('mouseenter', (e) => {
				this.showTooltip(group.tooltipContent, e);
			});
			groupHitArea.addEventListener('mousemove', (e) => {
				this.updateTooltipPosition(e);
			});
			groupHitArea.addEventListener('mouseleave', () => {
				this.hideTooltip();
			});

			// 点击跳转
			groupHitArea.addEventListener('click', (e) => {
				e.stopPropagation();
				this.hideTooltip();
				this.props.onMessageClick(group.userId);
			});

			// 2. 渲染用户块（高亮显示）
			const userBlock = this.trackEl.createEl('div', {
				cls: 'deeppdf-minimap-block deeppdf-minimap-block-user',
				attr: {
					'data-message-id': group.userId,
					role: 'button',
					tabindex: '0',
					'aria-label': `跳转到：${group.tooltipContent}`,
				},
			});
			userBlock.style.top = `${group.userTop}px`;
			userBlock.style.height = `${group.userHeight}px`;

			// 键盘支持
			userBlock.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					this.hideTooltip();
					this.props.onMessageClick(group.userId);
				}
			});

			// 3. 渲染 AI 块（如果有）
			// AI 块的位置是从用户块下方到组结束
			const aiBlockTop = group.userTop + group.userHeight;
			const aiBlockHeight = group.groupHeight - group.userHeight;

			if (aiBlockHeight > 2) {
				const aiBlock = this.trackEl.createEl('div', {
					cls: 'deeppdf-minimap-block deeppdf-minimap-block-assistant',
				});
				aiBlock.style.top = `${aiBlockTop}px`;
				aiBlock.style.height = `${aiBlockHeight}px`;
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
		if (this.scrollHandler) {
			this.props.containerEl.removeEventListener('scroll', this.scrollHandler);
		}
		if (this.tooltipEl && this.tooltipEl.parentNode) {
			this.tooltipEl.parentNode.removeChild(this.tooltipEl);
		}
		super.destroy();
	}
}
