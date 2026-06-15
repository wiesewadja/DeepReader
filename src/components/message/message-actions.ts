import type { MessageData } from './types.js';
import type { TTSReadingController } from './tts-reading-controller.js';
import { Icons } from '../../utils/icons.js';

/**
 * 消息操作按钮渲染器
 * 管理 AI 消息的操作按钮行：默认展示「朗读」「摘录」，其余操作收入「更多」下拉菜单
 */

export interface MessageActionsHost {
	get data(): MessageData;
	onRegenerate?(): void;
	onCopy?(): void;
	onExcerpt?(): void;
	onDelete?(): void;
	onTTS?(messageId: string, content: string): void;
	openFullscreen(): void;
	scrollToMessageTop(): void;
	ttsReadingCtrl: TTSReadingController;
}

type ActionItem = {
	id: string;
	title: string;
	icon: string;
	visible: boolean;
	onClick: () => void;
	variant?: 'danger';
};

export class MessageActionsRenderer {
	private host: MessageActionsHost;
	private moreDropdown: HTMLElement | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

	constructor(host: MessageActionsHost) {
		this.host = host;
	}

	/** 销毁渲染器：移除「更多」菜单的 document click 监听器，防止泄漏 */
	destroy(): void {
		this.cleanupDropdown();
	}

	/** 渲染操作按钮行 */
	render(container: HTMLElement): void {
		if (this.host.data.isStreaming === true) {
			return;
		}

		const existingActions = container.querySelector('.deeppdf-message-actions');
		if (existingActions) {
			existingActions.remove();
		}
		this.cleanupDropdown();

		const isAssistant = this.host.data.role === 'assistant';
		const hasExtraActions = isAssistant || this.host.onRegenerate || this.host.onCopy || this.host.onDelete;
		if (!hasExtraActions && !this.host.onExcerpt) {
			return;
		}

		const actions = container.createEl('div', { cls: 'deeppdf-message-actions' });

		// TTS 朗读按钮
		if (isAssistant) {
			const ttsBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
			ttsBtn.innerHTML = Icons.volume2;
			ttsBtn.title = '朗读';
			ttsBtn.addEventListener('click', () => {
				this.host.onTTS?.(this.host.data.id, this.host.data.content);
			});
			this.host.ttsReadingCtrl.setTtsBtn(ttsBtn);
		}

		// 摘录按钮
		if (this.host.onExcerpt) {
			const excerptBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
			excerptBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
			excerptBtn.title = 'Save as Excerpt';
			excerptBtn.addEventListener('click', () => this.host.onExcerpt?.());
		}

		// 更多菜单：全屏、跳转、重新生成、复制、删除
		const extraItems = this.buildExtraItems(isAssistant);
		if (extraItems.length > 0) {
			const moreWrapper = actions.createEl('div', { cls: 'deeppdf-message-more-actions' });
			const moreBtn = moreWrapper.createEl('button', { cls: 'deeppdf-message-action-btn deeppdf-message-more-btn' });
			moreBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;
			moreBtn.title = '更多操作';

			this.moreDropdown = moreWrapper.createEl('div', { cls: 'deeppdf-message-more-dropdown' });
			for (const item of extraItems) {
				const itemBtn = this.moreDropdown.createEl('button', {
					cls: ['deeppdf-message-more-item', item.variant === 'danger' ? 'deeppdf-message-more-item-danger' : ''].filter(Boolean),
				});
				// 仅渲染图标，文字通过 title tooltip 提示（保持操作行紧凑）
				itemBtn.innerHTML = item.icon;
				itemBtn.title = item.title;
				itemBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.hideDropdown();
					item.onClick();
				});
			}

			moreBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggleDropdown();
			});

			this.outsideClickHandler = (e: MouseEvent) => {
				if (!moreWrapper.contains(e.target as Node)) {
					this.hideDropdown();
				}
			};
			document.addEventListener('click', this.outsideClickHandler);
		}
	}

	private buildExtraItems(isAssistant: boolean): ActionItem[] {
		const items: ActionItem[] = [];

		if (isAssistant) {
			items.push({
				id: 'fullscreen',
				title: '全屏展示',
				icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
				visible: true,
				onClick: () => this.host.openFullscreen(),
			});
			items.push({
				id: 'scrollTop',
				title: '跳转到回复开头',
				icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`,
				visible: true,
				onClick: () => this.host.scrollToMessageTop(),
			});
		}

		if (this.host.onRegenerate) {
			items.push({
				id: 'regenerate',
				title: '重新生成',
				icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
				visible: true,
				onClick: () => this.host.onRegenerate?.(),
			});
		}

		if (this.host.onCopy) {
			items.push({
				id: 'copy',
				title: '复制',
				icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
				visible: true,
				onClick: () => this.host.onCopy?.(),
			});
		}

		if (this.host.onDelete) {
			items.push({
				id: 'delete',
				title: '删除此对话',
				icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
				visible: true,
				onClick: () => this.host.onDelete?.(),
				variant: 'danger',
			});
		}

		return items.filter(i => i.visible);
	}

	private toggleDropdown(): void {
		if (!this.moreDropdown) return;
		this.moreDropdown.toggleClass('deeppdf-message-more-dropdown-visible', !this.moreDropdown.hasClass('deeppdf-message-more-dropdown-visible'));
	}

	private hideDropdown(): void {
		this.moreDropdown?.removeClass('deeppdf-message-more-dropdown-visible');
	}

	private cleanupDropdown(): void {
		this.hideDropdown();
		if (this.outsideClickHandler) {
			document.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		this.moreDropdown = null;
	}
}
