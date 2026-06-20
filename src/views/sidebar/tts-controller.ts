/**
 * TTS 语音播报控制器
 *
 * 管理 TTS 服务初始化和播放控制。
 * 支持两种来源：Agent 回复朗读（message）和原文朗读（reading）。
 *
 * 两条 TTS 路径：
 * 1. AI 回复朗读 → TTSService.play() → mimo-v2.5-tts-voicedesign（用户配置）
 * 2. 原文朗读    → 独立 TTSClient  → mimo-v2.5-tts 冰糖，流式实时播放 + 段落级高亮
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
	/** 获取当前页段落列表（元素 + 文本） */
	getPageParagraphs?: () => { element: HTMLElement; text: string }[];
	/** 高亮段落元素 */
	highlightElement?: (el: HTMLElement) => void;
	/** 清除段落高亮 */
	clearHighlight?: () => void;
	goToNextPage?: () => boolean;
}

export class TTSController {
	private host: TTSControllerHost;
	private ttsService: TTSService | null = null;
	private readingClient: TTSClient | null = null;
	private currentSource: TTSSource = 'message';
	private readingAbort: AbortController | null = null;
	private readingPlayer: PCMStreamPlayer | null = null;
	/** 程序化翻页（非用户操作），抑制 onStopReadingTTS 误触发 */
	private isAutoPageTurn = false;

	constructor(host: TTSControllerHost) {
		this.host = host;
	}

	getTtsService(): TTSService | null {
		return this.ttsService;
	}

	/** 确保 TTS 服务已初始化（供预加载使用，在用户点击 button 前提前初始化） */
	ensureService(): void {
		if (!this.ttsService) {
			this.ttsService = this.initTTSService();
			this.host.setTtsService(this.ttsService);
		}
	}

	/** 获取当前朗读来源 */
	getCurrentSource(): TTSSource {
		return this.currentSource;
	}

	/** 是否正在进行程序化翻页（抑制 onStopReadingTTS 误触发） */
	isAutoPageTurning(): boolean {
		return this.isAutoPageTurn;
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

	/** 初始化原文朗读专用的 TTS 客户端（固定 mimo-v2.5-tts 流式） */
	private initReadingClient(): TTSClient | null {
		const settings = this.host.plugin.settings;
		const ttsConfig = resolveRoleConfig('tts', settings);
		if (!ttsConfig?.apiKey) return null;

		return new TTSClient({
			apiKey: ttsConfig.apiKey,
			baseUrl: ttsConfig.baseUrl,
			model: 'mimo-v2.5-tts', // 固定预置音色模型（voicedesign 流式未上线）
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

	// ── 原文朗读（逐段流式） ──────────────────────────────

	/**
	 * 处理原文朗读。逐段获取当前页段落，对每段：
	 *   1. 高亮段落元素（DOM 元素直接命中，无索引错位）
	 *   2. 流式合成语音（mimo-v2.5-tts）
	 *   3. PCM 实时播放
	 * 读完所有段后自动翻页继续。
	 *
	 * @param customText 可选：用户选区文本，非空时朗读此文本而非当前页
	 */
	async handleReadingTTS(customText?: string): Promise<void> {
		// 如果正在朗读，停止
		if (this.currentSource === 'reading') {
			this.stopReading();
			return;
		}

		// 互斥：如果正在朗读 Agent 回复，先停止
		if (this.currentSource === 'message' && this.ttsService?.getState() !== 'idle') {
			this.ttsService?.stop();
		}

		this.currentSource = 'reading';
		this.readingAbort = new AbortController();
		this.readingClient = this.initReadingClient();
		this.host.onReadingTTSStateChange?.('tts_loading');

		const player = new PCMStreamPlayer();
		this.readingPlayer = player;

		try {
			if (customText) {
				// 选区朗读：将自定义文本作为单一段落
				await this.readCustomText(customText, player);
			} else {
				await this.readCurrentPage(player);
			}
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
			serviceLog.error('[TTS] Reading TTS failed:', err);
			new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			if (this.currentSource === 'reading') {
				this.currentSource = 'message';
				this.host.onReadingTTSStateChange?.('idle');
				this.host.clearHighlight?.();
			}
			player.stop();
			this.readingPlayer = null;
		}
	}

	/**
	 * 朗读自定义文本（选区朗读），不分段不翻页
	 */
	private async readCustomText(text: string, player: PCMStreamPlayer): Promise<void> {
		const cleanText = preprocessForTTS(text);
		if (!cleanText.trim()) {
			this.stopReading();
			return;
		}

		if (!this.readingClient) {
			this.stopReading();
			new Notice('朗读失败：TTS 客户端未初始化');
			return;
		}

		this.host.onReadingTTSStateChange?.('playing');

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
		} catch (err) {
			throw err;
		}
	}

	/** 朗读当前页：逐段流式合成入同一个 PCMStreamPlayer，所有段播完后 seal */
	private async readCurrentPage(player: PCMStreamPlayer): Promise<void> {
		if (this.currentSource !== 'reading') return;

		const paragraphs = this.host.getPageParagraphs?.() || [];
		if (paragraphs.length === 0) {
			let hasNext = false;
			this.isAutoPageTurn = true;
			try {
				hasNext = this.host.goToNextPage?.() ?? false;
			} finally {
				this.isAutoPageTurn = false;
			}

			if (hasNext) {
				await sleep(500);
				await this.readCurrentPage(player);
			} else {
				this.stopReading();
				new Notice('朗读完毕');
			}
			return;
		}

		if (!this.readingClient) {
			this.stopReading();
			new Notice('朗读失败：TTS 客户端未初始化');
			return;
		}

		this.host.onReadingTTSStateChange?.('playing');

		try {
			// 预处理所有段落文本（一次遍历，避免多次 preprocessForTTS）
			const texts: string[] = [];
			for (let i = 0; i < paragraphs.length; i++) {
				const t = preprocessForTTS(paragraphs[i].text).trim();
				texts.push(t);
			}

			// 启动第一段的 stream
			let currentStream: AsyncGenerator<ArrayBuffer> | null = texts[0] ? this.readingClient.synthesizeStream(
				texts[0],
				{ voiceProfile: { voice: '冰糖' } },
				this.readingAbort?.signal,
			) : null;

			// 预取第二段的 stream（如果存在）
			let nextStreamPromise: Promise<AsyncGenerator<ArrayBuffer>> | null = null;
			if (texts.length > 1 && texts[1]) {
				nextStreamPromise = Promise.resolve(this.readingClient.synthesizeStream(
					texts[1],
					{ voiceProfile: { voice: '冰糖' } },
					this.readingAbort?.signal,
				));
			}

			for (let i = 0; i < paragraphs.length; i++) {
				if (this.currentSource !== 'reading') return;
				if (!texts[i]) continue;

				// 1. 记录本段音频的计划开始时间 (当前已调度的 endTime)
				const paragraphStartTime = player.endTime;

				// 2. 异步在后台等待到计划开始时间再触发高亮，不阻塞流式排队
				this.scheduleHighlight(paragraphs[i].element, paragraphStartTime, player);

				// 3. 播放当前段的 stream（已预取或即时启动）并完全排入 player
				const stream = currentStream!;
				for await (const chunk of stream) {
					player.enqueue(chunk);
				}

				// 当前段播完，把预取的下一段升为 current
				if (nextStreamPromise) {
					currentStream = await nextStreamPromise;
					nextStreamPromise = null;

					// 预取下下段
					const nextIdx = i + 2;
					if (nextIdx < texts.length && texts[nextIdx]) {
						nextStreamPromise = Promise.resolve(this.readingClient.synthesizeStream(
							texts[nextIdx],
							{ voiceProfile: { voice: '冰糖' } },
							this.readingAbort?.signal,
						));
					}
				} else {
					currentStream = null;
				}
			}

			// 等待当前页的所有音频段落播放完毕，再触发翻页
			const pageEndTime = player.endTime;
			while (this.currentSource === 'reading' && player.currentTime < pageEndTime) {
				await sleep(100);
			}
		} catch (err) {
			throw err;
		}

		// 所有段朗读完毕，翻页继续
		if (this.currentSource === 'reading') {
			this.host.clearHighlight?.();
			let hasNext = false;
			this.isAutoPageTurn = true;
			try {
				hasNext = this.host.goToNextPage?.() ?? false;
			} finally {
				this.isAutoPageTurn = false;
			}

			if (hasNext) {
				await sleep(300);
				await this.readCurrentPage(player);
			} else {
				this.stopReading();
				new Notice('朗读完毕');
			}
		}
	}

	/** 异步高亮任务，等待音频计划播放时间到达后再改变高亮状态 */
	private async scheduleHighlight(
		element: HTMLElement,
		startTime: number,
		player: PCMStreamPlayer
	): Promise<void> {
		while (this.currentSource === 'reading' && player.currentTime < startTime) {
			await sleep(50);
		}
		if (this.currentSource === 'reading') {
			this.host.highlightElement?.(element);
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

function sleep(ms: number): Promise<void> {
	return new Promise(r => setTimeout(r, ms));
}
