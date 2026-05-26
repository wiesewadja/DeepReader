/**
 * TTS 语音播报控制器
 *
 * 管理 TTS 服务初始化和播放控制。
 */

import { Notice } from 'obsidian';
import { TTSService } from '../../services/tts/tts-service.js';
import type { TTSPlayState } from '../../services/tts/tts-service.js';
import { resolveRoleConfig } from '../../config/providers.js';
import { MemoryStore } from '../../agent/memory/store.js';

export interface TTSControllerHost {
	get app(): import('obsidian').App;
	get plugin(): any;
	get messageList(): import('../../components/message-list/message-list.js').MessageList | null;
	getDisplayName(name: string): string;
	getCurrentPdfName(): string | null;
	getCurrentBookAuthor(): string | null;
	getCurrentIndexId(): string | null;
	setTtsService(service: TTSService | null): void;
}

export class TTSController {
	private host: TTSControllerHost;
	private ttsService: TTSService | null = null;

	constructor(host: TTSControllerHost) {
		this.host = host;
	}

	getTtsService(): TTSService | null {
		return this.ttsService;
	}

	private initTTSService(): TTSService | null {
		const settings = this.host.plugin.settings;
		const ttsConfig = resolveRoleConfig('tts', settings);
		if (!ttsConfig) return null;

		const fastConfig = resolveRoleConfig('router', settings);
		if (!fastConfig) return null;

		return new TTSService({
			ttsApiKey: ttsConfig.apiKey,
			ttsBaseUrl: ttsConfig.baseUrl,
			ttsModel: ttsConfig.model,
			ttsProvider: ttsConfig.provider,
			llmApiKey: fastConfig.apiKey,
			llmBaseUrl: fastConfig.baseUrl,
			llmModel: fastConfig.model,
			app: this.host.app,
			onStateChange: (messageId: string | null, state: TTSPlayState) => {
				if (messageId) {
					this.host.messageList?.updateTTSState(messageId, state);
				}
				if (state === 'idle' && messageId) {
					const msg = this.host.messageList?.getMessage(messageId);
					if (msg?.highlightTTSProgress) {
						msg.highlightTTSProgress(-1);
					}
				}
			},
			onProgressChange: (messageId: string, progress: number) => {
				const msg = this.host.messageList?.getMessage(messageId);
				if (msg?.highlightTTSProgress) {
					msg.highlightTTSProgress(progress);
				}
			},
		});
	}

	async handleTTS(messageId: string, content: string, options?: { rawText?: boolean }): Promise<void> {
		if (!this.ttsService) {
			this.ttsService = this.initTTSService();
			this.host.setTtsService(this.ttsService);
		}
		if (!this.ttsService) {
			new Notice('请先在设置中配置语音播报（TTS）服务：添加小米 API Key 并启用 tts 角色');
			return;
		}

		if (this.ttsService.getCurrentMessageId() === messageId && this.ttsService.getState() !== 'idle') {
			const state = this.ttsService.getState();
			if (state === 'tts_loading' || state === 'summarizing') {
				this.ttsService.stop();
			} else {
				this.ttsService.togglePauseResume();
			}
			return;
		}

		const userQuestion = this.findUserQuestion(messageId);

		await this.ttsService.play(messageId, content, userQuestion, {
			bookId: this.host.getCurrentIndexId() || undefined,
			bookTitle: this.host.getDisplayName(this.host.getCurrentPdfName() || '') || undefined,
			bookAuthor: this.host.getCurrentBookAuthor() || undefined,
			memoryContent: await new MemoryStore(this.host.app).readLongTermMemory() || undefined,
		}, options);
	}

	private findUserQuestion(aiMessageId: string): string | undefined {
		const messages = this.host.messageList?.getMessagesData();
		if (!messages) return undefined;
		const idx = messages.findIndex(m => m.id === aiMessageId);
		if (idx <= 0) return undefined;
		const prev = messages[idx - 1];
		return prev?.role === 'user' ? prev.content : undefined;
	}

	destroy(): void {
		if (this.ttsService) {
			try {
				this.ttsService.destroy();
			} catch {
				// ignore
			}
			this.ttsService = null;
			this.host.setTtsService(null);
		}
	}
}
