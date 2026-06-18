/**
 * TTS 语音播报控制器
 *
 * 管理 TTS 服务初始化和播放控制。
 * 支持两种来源：Agent 回复朗读（message）和原文朗读（reading）。
 *
 * 原文朗读使用 MIMO v2.5 低延迟流式接口（synthesizeStream）
 * + PCMStreamPlayer 实时播放，支持 AbortController 取消。
 */

import { Notice } from 'obsidian';
import { MemoryStore } from '../../agent/memory/store.js';
import type { DeepReaderPluginInterface } from '../../agent/tools/context/vault.js';
import { resolveRoleConfig } from '../../config/providers.js';
import { PCMStreamPlayer } from '../../services/tts/pcm-stream-player.js';
import { TTSClient } from '../../services/tts/tts-client.js';
import { TTSService } from '../../services/tts/tts-service.js';
import type { TTSPlayState } from '../../services/tts/tts-service.js';
import { preprocessForTTS } from '../../services/tts/tts-text-preprocessor.js';
import { serviceLog } from '../../utils/logger.js';

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
	/** 获取当前页的段落列表 */
	getPageParagraphs?: () => { element: HTMLElement; text: string }[];
	/** 高亮第 N 个段落 */
	highlightParagraph?: (index: number) => void;
	/** 清除段落高亮 */
	clearHighlight?: () => void;
	goToNextPage?: () => boolean;
}

export class TTSController {
	private host: TTSControllerHost;
	private ttsService: TTSService | null = null;
	private currentSource: TTSSource = 'message';
	private readingAbort: AbortController | null = null;
	private readingPlayer: PCMStreamPlayer | null = null;

	private readingClient: TTSClient | null = null;

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

		// 2. 停止 PCM 播放
		this.readingPlayer?.stop();
		this.readingPlayer = null;

		this.currentSource = 'message';
		this.host.onReadingTTSStateChange?.('idle');
		this.host.clearHighlight?.();
	}

	/** 初始化原文朗读专用的 TTS 客户端（固定使用 mimo-v2.5-tts 流式） */
	private initReadingClient(): TTSClient | null {
		const settings = this.host.plugin.settings;
		const ttsConfig = resolveRoleConfig('tts', settings);
		if (!ttsConfig?.apiKey) return null;

		return new TTSClient({
			apiKey: ttsConfig.apiKey,
			baseUrl: ttsConfig.baseUrl,
			model: 'mimo-v2.5-tts', // 固定使用预置音色模型，voicedesign 流式未上线
		});
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

	// ── 原文朗读（流式实现） ─────────────────────────────────

	/**
	 * 处理原文朗读 - 循环朗读模式
	 * 使用 MIMO v2.5 流式接口 + PCMStreamPlayer 实时播放。
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
		this.readingClient = this.initReadingClient();
		this.host.onReadingTTSStateChange?.('tts_loading');

		try {
			await this.readCurrentPage();
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') {
				// 用户取消，不做额外处理
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
	 * 朗读当前页，按段落逐段合成 + 高亮
	 * 每段开始前高亮该段，播放完毕后进入下一段，读完所有段后翻页。
	 */
	private async readCurrentPage(): Promise<void> {
		if (this.currentSource !== 'reading') return;

		// 获取当前页段落列表
		const paragraphs = this.host.getPageParagraphs?.() || [];
		if (paragraphs.length === 0) {
			// 无内容，尝试翻页
			if (this.host.goToNextPage?.()) {
				await new Promise(r => setTimeout(r, 500));
				await this.readCurrentPage();
			} else {
				this.stopReading();
				new Notice('朗读完毕');
			}
			return;
		}

		this.host.onReadingTTSStateChange?.('playing');

		// 逐段朗读（固定使用预置音色 冰糖，mimo-v2.5-tts 流式）
		for (let i = 0; i < paragraphs.length; i++) {
			if (this.currentSource !== 'reading') return;

			const cleanText = preprocessForTTS(paragraphs[i].text);
			if (!cleanText.trim()) continue;

			// 高亮当前段
			this.host.highlightParagraph?.(i);

			// 流式合成 + 播放（使用 dedicated reading client，固定 mimo-v2.5-tts）
			const player = new PCMStreamPlayer();
			this.readingPlayer = player;

			if (!this.readingClient) {
				this.stopReading();
				new Notice('朗读失败：TTS 客户端未初始化');
				return;
			}

			try {
				const stream = this.readingClient.synthesizeStream(
					cleanText,
					{ voiceProfile: { voice: '冰糖' } },
					this.readingAbort?.signal,
				);

				for await (const chunk of stream) {
					player.enqueue(chunk);
				}
				player.seal();
				await player.waitForEnd();
			} finally {
				this.readingPlayer = null;
			}
		}

		// 读完所有段，翻页继续
		if (this.currentSource === 'reading') {
			this.host.clearHighlight?.();
			if (this.host.goToNextPage?.()) {
				await new Promise(r => setTimeout(r, 300));
				await this.readCurrentPage();
			} else {
				this.stopReading();
				new Notice('朗读完毕');
			}
		}
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
