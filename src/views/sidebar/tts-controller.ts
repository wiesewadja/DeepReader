/**
 * TTS 语音播报控制器
 *
 * 管理 TTS 服务初始化和播放控制。
 * 支持两种来源：Agent 回复朗读（message）和原文朗读（reading）。
 */

import { Notice } from 'obsidian';
import { MemoryStore } from '../../agent/memory/store.js';
import type { DeepReaderPluginInterface } from '../../agent/tools/context/vault.js';
import { resolveRoleConfig } from '../../config/providers.js';
import { TTSService } from '../../services/tts/tts-service.js';
import type { TTSPlayState } from '../../services/tts/tts-service.js';
import { preprocessForTTS } from '../../services/tts/tts-text-preprocessor.js';
import { serviceLog } from '../../utils/logger.js';

/** 原文朗读的特殊 messageId 前缀 */
const READING_MSG_PREFIX = 'reading:';

export type TTSSource = 'message' | 'reading';

export interface TTSControllerHost {
	get app(): import('obsidian').App;
	get plugin(): DeepReaderPluginInterface;
	get messageList(): import('../../components/message-list/message-list.js').MessageList | null;
	getDisplayName(name: string): string;
	getCurrentPdfName(): string | null;
	getCurrentBookAuthor(): string | null;
	getCurrentIndexId(): string | null;
	setTtsService(service: TTSService | null): void;
	onReadingTTSStateChange?: (state: TTSPlayState) => void;
	highlightText?: (text: string) => void;
	clearHighlight?: () => void;
	getCurrentPageText?: () => string;
	goToNextPage?: () => boolean;
}

export class TTSController {
	private host: TTSControllerHost;
	private ttsService: TTSService | null = null;
	private currentSource: TTSSource = 'message';

	constructor(host: TTSControllerHost) {
		this.host = host;
	}

	getTtsService(): TTSService | null {
		return this.ttsService;
	}

	/** 获取当前朗读来源 */
	getCurrentSource(): TTSSource {
		return this.currentSource;
	}

	/** 停止原文朗读 */
	stopReading(): void {
		if (this.currentSource === 'reading' && this.ttsService) {
			this.ttsService.stop();
		}
	}

	private initTTSService(): TTSService | null {
		const settings = this.host.plugin.settings;
		const ttsConfig = resolveRoleConfig('tts', settings);
		console.log('[TTS-DEBUG] initTTSService: ttsConfig =', ttsConfig ? { provider: ttsConfig.provider, hasApiKey: !!ttsConfig.apiKey } : 'null');
		if (!ttsConfig) return null;

		const fastConfig = resolveRoleConfig('router', settings);
		console.log('[TTS-DEBUG] initTTSService: fastConfig =', fastConfig ? { provider: fastConfig.provider, hasApiKey: !!fastConfig.apiKey } : 'null');
		if (!fastConfig) return null;

		console.log('[TTS-DEBUG] initTTSService: creating TTSService with', { ttsProvider: ttsConfig.provider, ttsModel: ttsConfig.model });
		return new TTSService({
			ttsApiKey: ttsConfig.apiKey,
			ttsBaseUrl: ttsConfig.baseUrl,
			ttsModel: ttsConfig.model,
			ttsProvider: ttsConfig.provider,
			llmApiKey: fastConfig.apiKey,
			llmBaseUrl: fastConfig.baseUrl,
			llmModel: fastConfig.model,
			app: this.host.app,
			pluginId: this.host.plugin.manifest.id,
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

		// 互斥：如果正在朗读原文，先停止
		if (this.currentSource === 'reading') {
			this.ttsService.stop();
		}
		this.currentSource = 'message';

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

	/**
	 * 处理原文朗读 - 循环朗读模式
	 * 读完当前页自动翻页继续朗读，直到用户停止或章节结束
	 */
	async handleReadingTTS(text: string): Promise<void> {
		if (!this.ttsService) {
			this.ttsService = this.initTTSService();
			this.host.setTtsService(this.ttsService);
		}
		if (!this.ttsService) {
			new Notice('请先在设置中配置语音播报（TTS）服务：添加小米 API Key 并启用 tts 角色');
			return;
		}

		const cleanText = preprocessForTTS(text);
		if (!cleanText.trim()) {
			new Notice('当前页面没有可朗读的文本');
			return;
		}

		// 互斥：如果正在朗读 Agent 回复，先停止
		if (this.currentSource === 'message') {
			this.ttsService.stop();
		}

		// 同一原文正在朗读 → 停止
		if (this.currentSource === 'reading' && this.ttsService.getState() !== 'idle') {
			this.ttsService.stop();
			this.currentSource = 'message';
			this.host.onReadingTTSStateChange?.('idle');
			return;
		}

		this.currentSource = 'reading';
		this.host.onReadingTTSStateChange?.('tts_loading');

		try {
			await this.readCurrentPage();
		} catch (err) {
			this.host.clearHighlight?.();
			serviceLog.error('[TTS] Reading TTS failed:', err);
			new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
			this.currentSource = 'message';
			this.host.onReadingTTSStateChange?.('idle');
		}
	}

	/**
	 * 朗读当前页，完成后自动翻页继续
	 */
	private async readCurrentPage(): Promise<void> {
		if (this.currentSource !== 'reading') return;

		// 获取当前页文本
		const text = this.host.getCurrentPageText?.() || '';
		const cleanText = preprocessForTTS(text);
		if (!cleanText.trim()) {
			// 当前页没有文本，尝试翻页
			if (this.host.goToNextPage?.()) {
				await new Promise(r => setTimeout(r, 500)); // 等待翻页动画
				await this.readCurrentPage();
			} else {
				// 章节结束
				this.host.clearHighlight?.();
				this.currentSource = 'message';
				this.host.onReadingTTSStateChange?.('idle');
			}
			return;
		}

		// 截取前 150 字符朗读
		const previewText = cleanText.slice(0, 150);

		// 高亮朗读文本
		this.host.highlightText?.(previewText);

		// 合成语音
		const { audioBuffer } = await this.ttsService!.synthesizeRawText(previewText);

		if (this.currentSource !== 'reading') {
			this.host.clearHighlight?.();
			return;
		}

		// 播放音频
		const blob = new Blob([audioBuffer], { type: 'audio/wav' });
		const blobUrl = URL.createObjectURL(blob);
		const audio = new Audio(blobUrl);

		this.host.onReadingTTSStateChange?.('playing');

		await new Promise<void>((resolve, reject) => {
			audio.onended = () => {
				URL.revokeObjectURL(blobUrl);
				resolve();
			};
			audio.onerror = () => {
				URL.revokeObjectURL(blobUrl);
				reject(new Error('Audio play error'));
			};
			audio.play().catch(reject);
		});

		// 播放完毕，翻页继续
		if (this.currentSource === 'reading') {
			this.host.clearHighlight?.();
			if (this.host.goToNextPage?.()) {
				await new Promise(r => setTimeout(r, 300)); // 等待翻页动画
				await this.readCurrentPage();
			} else {
				// 章节结束
				this.currentSource = 'message';
				this.host.onReadingTTSStateChange?.('idle');
			}
		}
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
