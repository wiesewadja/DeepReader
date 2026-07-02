/**
 * TTS 语音播报控制器
 *
 * 管理 TTS 服务初始化和播放控制。
 * 支持两种来源：Agent 回复朗读（message）和原文朗读（reading）。
 *
 * 两条 TTS 路径（共享相同播放架构）：
 * 1. AI 回复朗读 → PCMStreamPlayer + TTSClient.synthesizeStream()（流式 PCM）
 * 2. 原文朗读    → PCMStreamPlayer + TTSClient.synthesizeStream()（流式 PCM）
 */

import { Notice } from 'obsidian';
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
	/** 获取当前页码 */
	getCurrentPage?: () => number;
	/** 获取指定或当前页段落列表（元素 + 文本） */
	getPageParagraphs?: (pageNumber?: number) => { element: HTMLElement; text: string }[];
	/** 是否处于双页阅读模式 */
	isDualPageMode?: () => boolean;
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
	/** 上次朗读的段落索引（供暂停后恢复使用） */
	private lastReadParagraphIndex = 0;
	/** 已预取的下页音频流（进入该页时优先使用） */
	private pendingPrefetch: {
		pageNumber: number;
		items: { text: string; buffered: ArrayBuffer[]; drained: Promise<void>; failed: boolean }[];
	} | null = null;
	/** 是否正在后台预取，防止重复触发 */
	private isPrefetching = false;

	// ── 流式消息朗读状态 ──────────────────────────
	private messageAbort: AbortController | null = null;
	private messagePlayer: PCMStreamPlayer | null = null;
	private messageStreamingId: string | null = null;
	private messageParagraphIndex = 0;
	private messagePaused = false;

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
	stopReading(resetIndex = true): void {
		if (this.currentSource !== 'reading') return;

		// 1. 中断 fetch 流
		this.readingAbort?.abort();
		this.readingAbort = null;

		// 2. 停止 PCM 播放
		this.readingPlayer?.stop();
		this.readingPlayer = null;

		this.currentSource = 'message';
		this.emitReadingTTSState('idle');
		this.host.clearHighlight?.();
		this.pendingPrefetch = null;
		this.isPrefetching = false;

		if (resetIndex) {
			this.lastReadParagraphIndex = 0;
		}
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
					if (msg?.highlightParagraphIndex) {
						msg.highlightParagraphIndex(-1);
					} else if (msg?.highlightTTSProgress) {
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

	// ── 消息朗读入口 ──────────────────────────────────

	/**
	 * 消息朗读统一入口。调用流式播放方法 handleMessageStreamTTS。
	 */
	async handleTTS(messageId: string, content: string): Promise<void> {
		await this.handleMessageStreamTTS(messageId, content);
	}

	// ── 流式消息朗读 ──────────────────────────────────

	/**
	 * 流式播放 AI 回复。逐段流式合成 + PCM 实时播放，
	 * 与原文朗读共用相同的播放架构，保证播报质量一致。
	 */
	async handleMessageStreamTTS(messageId: string, content: string): Promise<void> {
		// 如果正在朗读同一个消息 → toggle pause/resume
		if (this.currentSource === 'message' && this.messageStreamingId === messageId) {
			this.toggleMessagePause();
			return;
		}

		// 互斥：如果正在朗读原文，先停止
		if (this.currentSource === 'reading') {
			this.stopReading();
		}

		// 停止之前的消息流
		this.stopMessageStream();

		this.currentSource = 'message';
		this.messageStreamingId = messageId;
		this.messageParagraphIndex = 0;
		this.messagePaused = false;

		const settings = this.host.plugin.settings;
		const ttsConfig = resolveRoleConfig('tts', settings);
		if (!ttsConfig?.apiKey) {
			new Notice('请先在设置中配置语音播报（TTS）服务');
			return;
		}

		const client = new TTSClient({
			apiKey: ttsConfig.apiKey,
			baseUrl: ttsConfig.baseUrl,
			model: 'mimo-v2.5-tts', // 流式固定预置音色（voicedesign 流式未上线，同 initReadingClient）
		});

		const player = new PCMStreamPlayer();
		this.messagePlayer = player;
		this.messageAbort = new AbortController();

		// 通知 UI 显示 loading 状态
		this.emitMessageTTSState(messageId, 'tts_loading');

		try {
			const msg = this.host.messageList?.getMessage(messageId);
			const messageEl = msg?.getElement();
			const contentEl = messageEl?.querySelector('.deeppdf-message-content') as HTMLElement | null;

			let paragraphs: string[] = [];
			if (contentEl) {
				const allElements = Array.from(contentEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'));
				const leafElements = allElements.filter(el => !allElements.some(other => other !== el && el.contains(other)));
				paragraphs = leafElements.map(el => el.textContent || '');
			}

			if (paragraphs.length === 0) {
				const cleanText = preprocessForTTS(content).trim();
				if (!cleanText) {
					this.stopMessageStream();
					return;
				}
				paragraphs = cleanText.split(/\n\n+/).filter(p => p.trim());
			}

			// 逐段流式合成 + 播放
			while (
				this.currentSource === 'message'
				&& this.messageStreamingId === messageId
				&& this.messageParagraphIndex < paragraphs.length
			) {
				if (this.messagePaused) {
					await sleep(100);
					continue;
				}

				const paraIndex = this.messageParagraphIndex;
				const paraText = paragraphs[paraIndex].trim();
				const cleanParaText = preprocessForTTS(paraText).trim();
				if (!cleanParaText) {
					this.messageParagraphIndex++;
					continue;
				}

				// 通知 UI 进入 playing 状态（仅首次）
				if (paraIndex === 0) {
					this.emitMessageTTSState(messageId, 'playing');
				}

				// 本段音频计划开始时间 = 当前已排队音频末尾（与 readCurrentPage 完全一致）
				const paragraphStartTime = player.endTime;
				// enqueue 前调度：等实际播放到本段开始时再高亮（与朗读同步）
				this.scheduleMessageHighlight(messageId, paraIndex, paragraphStartTime, player);

				// 流式合成
				const stream = client.synthesizeStream(
					cleanParaText,
					{ voiceProfile: { voice: '冰糖' } },
					this.messageAbort?.signal,
				);

				for await (const chunk of stream) {
					if (
						this.currentSource !== 'message'
						|| this.messageStreamingId !== messageId
						|| this.messagePaused
					) {
						break;
					}
					player.enqueue(chunk);
				}

				if (
					this.currentSource !== 'message'
					|| this.messageStreamingId !== messageId
				) {
					break;
				}

				this.messageParagraphIndex++;
			}

			// 所有段播放完毕
			if (
				this.currentSource === 'message'
				&& this.messageStreamingId === messageId
				&& !this.messagePaused
			) {
				player.seal();
				await player.waitForEnd();
			}
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
			serviceLog.error('[TTS] Message stream TTS failed:', err);
			new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			player.stop();
			this.messagePlayer = null;
			this.messageAbort = null;
			if (
				this.currentSource === 'message'
				&& this.messageStreamingId === messageId
			) {
				const msg = this.host.messageList?.getMessage(messageId);
				msg?.highlightParagraphIndex?.(-1);
				this.emitMessageTTSState(messageId, 'idle');
				this.messageStreamingId = null;
			}
		}
	}

	/** 通知消息朗读状态：更新 messageList UI + 联动悬浮球朗读动效 */
	private emitMessageTTSState(messageId: string, state: TTSPlayState): void {
		this.host.messageList?.updateTTSState(messageId, state);
		this.notifyXitongReading(state);
	}

	/** 通知原文朗读状态：转发 host 回调 + 联动悬浮球朗读动效 */
	private emitReadingTTSState(state: TTSPlayState): void {
		this.host.onReadingTTSStateChange?.(state);
		this.notifyXitongReading(state);
	}

	/** 悬浮球朗读动效：仅 playing 时点亮，其余状态关闭 */
	private notifyXitongReading(state: TTSPlayState): void {
		this.host.plugin.readingModeService?.setXitongReading(state === 'playing');
	}

	/** 等音频播放到指定时间再触发段落高亮（基于 player.currentTime，与朗读同步，参考 scheduleHighlight） */
	private async scheduleMessageHighlight(
		messageId: string,
		paraIndex: number,
		startTime: number,
		player: PCMStreamPlayer
	): Promise<void> {
		while (
			this.currentSource === 'message'
			&& this.messageStreamingId === messageId
			&& player.currentTime < startTime
		) {
			await sleep(20);
		}
		if (this.currentSource === 'message' && this.messageStreamingId === messageId) {
			const msg = this.host.messageList?.getMessage(messageId);
			msg?.highlightParagraphIndex?.(paraIndex);
		}
	}

	/** 停止消息流式朗读（完全停止，重置所有状态） */
	private stopMessageStream(): void {
		this.messageAbort?.abort();
		this.messageAbort = null;
		this.messagePlayer?.stop();
		this.messagePlayer = null;
		this.messageStreamingId = null;
		this.messageParagraphIndex = 0;
		this.messagePaused = false;
		this.currentSource = 'message';
	}

	/** 暂停 / 恢复消息流式朗读 */
	private toggleMessagePause(): void {
		if (this.messagePaused) {
			// 恢复
			this.messagePaused = false;
			this.messagePlayer?.resume();
			this.emitMessageTTSState(this.messageStreamingId!, 'playing');
		} else {
			// 暂停
			this.messagePaused = true;
			this.messagePlayer?.pause();
			this.emitMessageTTSState(this.messageStreamingId!, 'paused');
		}
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
		if (this.currentSource === 'message') {
			this.stopMessageStream();
		}

		this.currentSource = 'reading';
		this.readingAbort = new AbortController();
		this.readingClient = this.initReadingClient();
		this.emitReadingTTSState('tts_loading');

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
				this.emitReadingTTSState('idle');
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

		this.emitReadingTTSState('playing');

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
		this.isAutoPageTurn = false;
		if (this.currentSource !== 'reading') return;

		const paragraphs = this.host.getPageParagraphs?.() || [];
		if (paragraphs.length === 0) {
			this.isAutoPageTurn = true;
			const hasNext = this.host.goToNextPage?.() ?? false;

			if (hasNext) {
				// 等 nextPage 的 smooth scroll + column rerender 完成（page-paginator 的
				// programmaticScrollTimer 窗口 ~800ms）。空页（如纯图片）跳过时若翻页过快，
				// 前一页未居中就翻下一页，两次翻页动画叠加导致两页各显示一半。
				await sleep(800);
				await this.readCurrentPage(player);
			} else {
				this.isAutoPageTurn = false;
				this.lastReadParagraphIndex = 0;
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

		const currentPageNumber = this.host.getCurrentPage?.() ?? 1;
		const isDual = this.host.isDualPageMode?.() ?? false;

		// 取出为本页准备好的预取缓存，并立刻启动下一页的后台预取
		let pagePrefetch = this.pendingPrefetch;
		this.pendingPrefetch = null;
		if (pagePrefetch && pagePrefetch.pageNumber !== currentPageNumber) {
			pagePrefetch = null;
		}
		this.prefetchNextPage(currentPageNumber, isDual);

		this.emitReadingTTSState('playing');

		try {
			// 预处理所有段落文本（一次遍历，避免多次 preprocessForTTS）
			const texts: string[] = [];
			for (let i = 0; i < paragraphs.length; i++) {
				const t = preprocessForTTS(paragraphs[i].text).trim();
				texts.push(t);
			}

			const startIdx = this.lastReadParagraphIndex;

			// makeStream：懒 generator（流式合成，首 chunk 即播——即时段用，避免等整段卡顿）
			const makeStream = (text: string): AsyncGenerator<ArrayBuffer> =>
				this.readingClient!.synthesizeStream(
					text,
					{ voiceProfile: { voice: '冰糖' } },
					this.readingAbort?.signal,
				);
			// prefetchSeg：后台 for-await 把整段合成到 buffer（下一段/跨页预取用，段间不卡）。
			// failed 标志：gen 抛错时不播残缺 buffer，由消费方流式重试（避免静默播半句）
			const prefetchSeg = (text: string) => {
				const seg = { text, buffered: [] as ArrayBuffer[], drained: Promise.resolve(), failed: false };
				const gen = makeStream(text);
				seg.drained = (async () => {
					try { for await (const chunk of gen) seg.buffered.push(chunk); }
					catch { seg.failed = true; }
				})();
				return seg;
			};
			// 取段：命中翻页预取则复用 Seg，否则返回懒流式 generator（即时段首 chunk 即播）
			type Item = { buffered: ArrayBuffer[]; drained: Promise<void>; failed: boolean } | { gen: AsyncGenerator<ArrayBuffer> };
			const getSegment = (idx: number): Item | null => {
				if (idx < 0 || idx >= texts.length || !texts[idx]) return null;
				if (
					startIdx === 0 &&
					pagePrefetch &&
					pagePrefetch.pageNumber === currentPageNumber &&
					idx < pagePrefetch.items.length &&
					pagePrefetch.items[idx].text === texts[idx]
				) {
					return pagePrefetch.items[idx];
				}
				return { gen: makeStream(texts[idx]) };
			};
			// current：即时段流式（不卡）；next：prefetchSeg 预合成（段间不卡）
			let current = getSegment(startIdx);
			let next = startIdx + 1 < texts.length ? prefetchSeg(texts[startIdx + 1]) : null;

			for (let i = startIdx; i < paragraphs.length; i++) {
				if (this.currentSource !== 'reading') {
					this.lastReadParagraphIndex = i;
					return;
				}
				this.lastReadParagraphIndex = i;

				// 剩余时间不多时，确保下一页预取已启动
				if (!this.isPrefetching && player.endTime - player.currentTime < 5000) {
					this.prefetchNextPage(currentPageNumber, isDual);
				}

				// 1. 记录本段音频的计划开始时间 (当前已调度的 endTime)
				const paragraphStartTime = player.endTime;

				// 2. 异步在后台等待到计划开始时间再触发高亮，不阻塞流式排队
				this.scheduleHighlight(paragraphs[i].element, paragraphStartTime, player);

				// 3. 播放当前段
				if (current) {
					if ('gen' in current) {
						// 即时段：流式合成，首 chunk 即播
						for await (const chunk of current.gen) player.enqueue(chunk);
					} else {
						// 预合成段：等后台合成完成；失败则流式重试（不播残缺 buffer）
						await current.drained;
						if (current.failed) {
							for await (const chunk of makeStream(texts[i])) player.enqueue(chunk);
						} else {
							for (const chunk of current.buffered) player.enqueue(chunk);
						}
					}
				}

				// 下一段已 prefetchSeg 预合成，升为 current；再预取下下段
				current = next;
				next = i + 2 < texts.length ? prefetchSeg(texts[i + 2]) : null;
			}

			// 等待当前页的所有音频段落播放完毕，再触发翻页
			const pageEndTime = player.endTime;
			while (this.currentSource === 'reading' && player.currentTime < pageEndTime) {
				await sleep(50);
			}
		} catch (err) {
			throw err;
		}

		// 所有段朗读完毕，翻页继续
		if (this.currentSource === 'reading') {
			this.lastReadParagraphIndex = 0; // 重置为新页面的第0段
			this.host.clearHighlight?.();
			this.isAutoPageTurn = true;
			const hasNext = this.host.goToNextPage?.() ?? false;

			if (hasNext) {
				// 等 nextPage smooth scroll + column rerender（~800ms 窗口），否则 getPageParagraphs 拿旧页段落
				await sleep(800);
				await this.readCurrentPage(player);
			} else {
				this.isAutoPageTurn = false;
				this.stopReading();
				new Notice('朗读完毕');
			}
		}
	}

	/** 后台预取下一页前 N 段音频流 */
	private prefetchNextPage(currentPageNumber: number, isDual: boolean): void {
		if (!this.readingClient || !this.host.getPageParagraphs || this.isPrefetching) return;
		this.isPrefetching = true;
		try {
			const nextPageNumber = currentPageNumber + (isDual ? 2 : 1);
			const nextParagraphs = this.host.getPageParagraphs(nextPageNumber) || [];
			if (nextParagraphs.length === 0) return;
			const texts = nextParagraphs
				.map(p => preprocessForTTS(p.text).trim())
				.filter(t => t);
			if (texts.length === 0) return;
			// MAX_PREFETCH=1：限并发（current 合成 + next 预取 + 跨页首段预取 ≈ 3 并发），避免 TTS rate limit
			const MAX_PREFETCH = 1;
			const items = texts.slice(0, MAX_PREFETCH).map(text => {
				const seg = { text, buffered: [] as ArrayBuffer[], drained: Promise.resolve(), failed: false };
				const gen = this.readingClient!.synthesizeStream(
					text,
					{ voiceProfile: { voice: '冰糖' } },
					this.readingAbort?.signal,
				);
				seg.drained = (async () => {
					try { for await (const chunk of gen) seg.buffered.push(chunk); }
					catch { seg.failed = true; }
				})();
				return seg;
			});
			this.pendingPrefetch = { pageNumber: nextPageNumber, items };
		} finally {
			this.isPrefetching = false;
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

	destroy(): void {
		this.stopMessageStream();
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
