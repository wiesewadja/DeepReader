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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
	private readingAbort: AbortController | null = null;
	private readingAudio: HTMLAudioElement | null = null;
	private readingAudioReject: ((err: Error) => void) | null = null;

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

	/** 停止原文朗读（按钮点击 / 翻页 / 切章 / 关闭阅读模式） */
	stopReading(): void {
		if (this.currentSource !== 'reading') return;

		// 1. 中断 fetch 流
		this.readingAbort?.abort();
		this.readingAbort = null;

		// 2. 中断音频播放
		if (this.readingAudio) {
			this.readingAudio.pause();
			this.readingAudio = null;
		}
		if (this.readingAudioReject) {
			this.readingAudioReject(new Error('STOPPED'));
			this.readingAudioReject = null;
		}

		this.currentSource = 'message';
		this.host.onReadingTTSStateChange?.('idle');
		this.host.clearHighlight?.();
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
			this.stopReading();
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

	// ── 原文朗读 ─────────────────────────────────────────

	/**
	 * 处理原文朗读 - 逐段朗读模式
	 * 将页面文本按段落切分，逐段合成 + 高亮 + 播放。
	 * 读完当前页自动翻页继续朗读，直到用户停止或章节结束。
	 */
	async handleReadingTTS(_text: string): Promise<void> {
		// 如果正在朗读，停止
		if (this.currentSource === 'reading') {
			this.stopReading();
			return;
		}

		// 互斥：如果正在朗读 Agent 回复，先停止
		if (this.currentSource === 'message' && this.ttsService?.getState() !== 'idle') {
			this.ttsService?.stop();
		}

		if (!this.ttsService) {
			this.ttsService = this.initTTSService();
			this.host.setTtsService(this.ttsService);
		}
		if (!this.ttsService) {
			new Notice('请先在设置中配置语音播报（TTS）服务：添加小米 API Key 并启用 tts 角色');
			return;
		}

		this.currentSource = 'reading';
		this.readingAbort = new AbortController();
		this.host.onReadingTTSStateChange?.('tts_loading');

		try {
			await this.readCurrentPage();
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') {
				return;
			}
			serviceLog.error('[TTS] Reading TTS failed:', err);
			new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			if (this.currentSource === 'reading') {
				this.currentSource = 'message';
				this.host.onReadingTTSStateChange?.('idle');
				this.host.clearHighlight?.();
			}
		}
	}

	/**
	 * 朗读当前页（逐段模式）
	 * 按段落切分后逐段合成语音、高亮、播放。
	 * 首段短→秒播，降低首读延时；每段独立高亮，随朗读进度推进。
	 */
	private async readCurrentPage(): Promise<void> {
		if (this.currentSource !== 'reading') return;

		const text = this.host.getCurrentPageText?.() || '';
		const cleanText = preprocessForTTS(text);
		if (!cleanText.trim()) {
			if (this.host.goToNextPage?.()) {
				await sleep(800);
				await this.readCurrentPage();
			} else {
				this.host.clearHighlight?.();
				this.currentSource = 'message';
				this.host.onReadingTTSStateChange?.('idle');
			}
			return;
		}

		// 按段落切分
		const paragraphs = cleanText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
		this.host.onReadingTTSStateChange?.('playing');

		for (let i = 0; i < paragraphs.length; i++) {
			if (this.currentSource !== 'reading') {
				this.host.clearHighlight?.();
				return;
			}

			const paraText = paragraphs[i];
			// DOM textContent 不含换行，搜索时统一规范化空白
			this.host.highlightText?.(paraText.replace(/\s+/g, ' '));

			try {
				const { audioBuffer } = await this.ttsService!.synthesizeRawText(paraText);
				if (this.currentSource !== 'reading') {
					this.host.clearHighlight?.();
					return;
				}

				const blob = new Blob([audioBuffer], { type: 'audio/wav' });
				const blobUrl = URL.createObjectURL(blob);
				const audio = new Audio(blobUrl);

				await this.playAudioSegment(audio, blobUrl);
			} catch (err) {
				if ((err as Error)?.message === 'STOPPED') return;
				serviceLog.warn(`[TTS] Paragraph ${i} TTS failed:`, err);
			}
		}

		// 本页所有段落朗读完毕
		this.host.clearHighlight?.();
		await sleep(1500);
		if (this.currentSource !== 'reading') return;

		if (this.host.goToNextPage?.()) {
			await sleep(800);
			await this.readCurrentPage();
		} else {
			this.currentSource = 'message';
			this.host.onReadingTTSStateChange?.('idle');
		}
	}

	private playAudioSegment(audio: HTMLAudioElement, blobUrl: string): Promise<void> {
		this.readingAudio = audio;
		return new Promise<void>((resolve, reject) => {
			this.readingAudioReject = reject;
			audio.onended = () => {
				this.readingAudio = null;
				this.readingAudioReject = null;
				URL.revokeObjectURL(blobUrl);
				resolve();
			};
			audio.onerror = () => {
				this.readingAudio = null;
				this.readingAudioReject = null;
				URL.revokeObjectURL(blobUrl);
				reject(new Error('Audio play error'));
			};
			audio.play().catch(err => {
				this.readingAudio = null;
				this.readingAudioReject = null;
				reject(err);
			});
		});
	}

	// ── 辅助 ────────────────────────────────────────────

	private findUserQuestion(aiMessageId: string): string | undefined {
		const messages = this.host.messageList?.getMessagesData();
		if (!messages) return undefined;
		const idx = messages.findIndex(m => m.id === aiMessageId);
		if (idx <= 0) return undefined;
		const prev = messages[idx - 1];
		return prev?.role === 'user' ? prev.content : undefined;
	}

	destroy(): void {
		this.stopReading();
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
