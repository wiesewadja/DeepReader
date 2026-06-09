import type { MessageData } from './types.js';
import type { TTSReadingController } from './tts-reading-controller.js';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';
import { Icons } from '../../utils/icons.js';

/**
 * 消息操作按钮渲染器
 * 管理 AI 消息的操作按钮行（TTS、全屏、跳转、重新生成、复制、摘录、删除）
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

export class MessageActionsRenderer {
	private host: MessageActionsHost;

	constructor(host: MessageActionsHost) {
		this.host = host;
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

		const hasActions = !!(this.host.onRegenerate || this.host.onCopy || this.host.onExcerpt || this.host.onDelete);
		const isAssistant = this.host.data.role === 'assistant';
		if (hasActions || isAssistant) {
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

			// 全屏按钮
			if (isAssistant) {
				const fullscreenBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				fullscreenBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
				fullscreenBtn.title = "全屏展示";
				fullscreenBtn.addEventListener('click', () => this.host.openFullscreen());
			}

			// 跳转到顶部按钮
			if (isAssistant) {
				const scrollToTopBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				scrollToTopBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;
				scrollToTopBtn.title = "跳转到回复开头";
				scrollToTopBtn.addEventListener('click', () => this.host.scrollToMessageTop());
			}

			if (this.host.onRegenerate) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
				btn.title = "Regenerate";
				btn.addEventListener('click', () => this.host.onRegenerate?.());
			}
			if (this.host.onCopy) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
				btn.title = "Copy";
				btn.addEventListener('click', () => this.host.onCopy?.());
			}
			if (this.host.onExcerpt) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
				btn.title = "Save as Excerpt";
				btn.addEventListener('click', () => this.host.onExcerpt?.());
			}
			if (this.host.onDelete) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn deeppdf-message-delete-btn' });
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
				btn.title = "删除此对话";
				btn.addEventListener('click', () => this.host.onDelete?.());
			}
		}
	}
}
