import { App, Notice, TFile } from "obsidian";
import type { DeepReaderPluginInterface } from "../../../agent/tools/context/vault.js";
import { resolveRoleConfig } from "../../../config/providers.js";
import { MemoryStore } from "../../../agent/memory/store.js";
import type { TTSContext } from "../../../services/tts/tts-summarizer.js";
import { PCMStreamPlayer } from "../../../services/tts/pcm-stream-player.js";
import { TTSClient } from "../../../services/tts/tts-client.js";
import { TTSService } from "../../../services/tts/tts-service.js";
import type { TTSPlayState } from "../../../services/tts/tts-service.js";
import { preprocessForTTS } from "../../../services/tts/tts-text-preprocessor.js";
import { serviceLog } from "../../../utils/logger.js";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap } from "../events.js";

export type TTSSource = "message" | "reading";

export interface TTSBookContext {
	indexId?: string;
	pdfName?: string;
	author?: string;
}

export interface TTSDomainOptions {
	app: App;
	plugin: DeepReaderPluginInterface;
	eventBus: EventBus<SidebarEventMap>;

	// View/PDF Navigation delegates (since they require reading leaf DOM/scrolling)
	getMessageParagraphs?: (messageId: string) => string[];
	getCurrentPage?: () => number;
	getPageParagraphs?: (pageNumber?: number) => { element: HTMLElement; text: string }[];
	isDualPageMode?: () => boolean;
	highlightElement?: (el: HTMLElement) => void;
	clearHighlight?: () => void;
	goToNextPage?: () => boolean;
}

export class TTSDomain {
	private app: App;
	private plugin: DeepReaderPluginInterface;
	private eventBus: EventBus<SidebarEventMap>;
	private options: TTSDomainOptions;

	private ttsService: TTSService | null = null;
	private readingClient: TTSClient | null = null;
	private currentSource: TTSSource = "message";
	private readingAbort: AbortController | null = null;
	private readingPlayer: PCMStreamPlayer | null = null;
	private isAutoPageTurn = false;
	private lastReadParagraphIndex = 0;
	private pendingPrefetch: {
		pageNumber: number;
		items: { text: string; buffered: ArrayBuffer[]; drained: Promise<void>; failed: boolean }[];
	} | null = null;
	private isPrefetching = false;

	// Streaming message state
	private messageAbort: AbortController | null = null;
	private messagePlayer: PCMStreamPlayer | null = null;
	private messageStreamingId: string | null = null;
	private messageParagraphIndex = 0;
	private messagePaused = false;

	constructor(options: TTSDomainOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		this.eventBus = options.eventBus;
		this.options = options;
	}

	// ── Service lifecycle ──

	ensureService(): void {
		if (!this.ttsService) {
			this.ttsService = this.initTTSService();
		}
	}

	getTtsService(): TTSService | null {
		return this.ttsService;
	}

	// ── Message TTS ──

	async speak(messageId: string, content: string): Promise<void> {
		await this.handleMessageStreamTTS(messageId, content);
	}

	stop(): void {
		this.stopMessageStream();
	}

	pause(): void {
		if (this.currentSource === "message" && this.messageStreamingId && !this.messagePaused) {
			this.toggleMessagePause();
		}
	}

	resume(): void {
		if (this.currentSource === "message" && this.messageStreamingId && this.messagePaused) {
			this.toggleMessagePause();
		}
	}

	// ── Reading TTS ──

	async readCurrentPage(customText?: string): Promise<void> {
		await this.handleReadingTTS(customText);
	}

	stopReading(resetIndex = true): void {
		if (this.currentSource !== "reading") return;

		this.readingAbort?.abort();
		this.readingAbort = null;

		this.readingPlayer?.stop();
		this.readingPlayer = null;

		this.currentSource = "message";
		this.emitReadingTTSState("idle");
		this.options.clearHighlight?.();
		this.pendingPrefetch = null;
		this.isPrefetching = false;

		if (resetIndex) {
			this.lastReadParagraphIndex = 0;
		}
	}

	// ── State accessors ──

	getCurrentSource(): TTSSource {
		return this.currentSource;
	}

	isAutoPageTurning(): boolean {
		return this.isAutoPageTurn;
	}

	// ── Preview preloading ──

	async preloadPreview(messageId: string, content: string, bookContext: TTSBookContext): Promise<void> {
		let ttsService = this.getTtsService();
		if (!ttsService) {
			this.ensureService();
			ttsService = this.getTtsService();
		}
		if (ttsService) {
			try {
				const memoryStore = new MemoryStore(this.app);
				const userProfile = await memoryStore.readLongTermMemory();
				await ttsService.preloadPreview(messageId, content, {
					bookId: bookContext.indexId,
					bookTitle: bookContext.pdfName,
					bookAuthor: bookContext.author,
					memoryContent: userProfile || undefined
				});
			} catch (err) {
				serviceLog.warn("[TTSDomain] preloadPreview failed:", err);
			}
		}
	}

	// ── Internals ──

	private initTTSService(): TTSService | null {
		const settings = this.plugin.settings;
		const ttsConfig = resolveRoleConfig("tts", settings);
		if (!ttsConfig) return null;

		const fastConfig = resolveRoleConfig("router", settings);
		if (!fastConfig) return null;

		return new TTSService({
			ttsApiKey: ttsConfig.apiKey,
			ttsBaseUrl: ttsConfig.baseUrl,
			ttsModel: ttsConfig.model,
			ttsProvider: ttsConfig.provider,
			llmApiKey: fastConfig.apiKey,
			llmBaseUrl: fastConfig.baseUrl,
			llmModel: fastConfig.model,
			app: this.app,
			pluginId: this.plugin.manifest.id,
			onStateChange: (messageId: string | null, state: TTSPlayState) => {
				if (messageId) {
					this.eventBus.emit("tts:state-changed", {
						source: "message",
						messageId,
						state,
					});
				}
			},
			onProgressChange: (messageId: string, progress: number) => {
				this.eventBus.emit("tts:progress-changed", {
					source: "message",
					messageId,
					progress,
				});
			},
		});
	}

	private initReadingClient(): TTSClient | null {
		const settings = this.plugin.settings;
		const ttsConfig = resolveRoleConfig("tts", settings);
		if (!ttsConfig?.apiKey) return null;

		return new TTSClient({
			apiKey: ttsConfig.apiKey,
			baseUrl: ttsConfig.baseUrl,
			model: "mimo-v2.5-tts",
		});
	}

	private async handleMessageStreamTTS(messageId: string, content: string): Promise<void> {
		if (this.currentSource === "message" && this.messageStreamingId === messageId) {
			this.toggleMessagePause();
			return;
		}

		if (this.currentSource === "reading") {
			this.stopReading();
		}

		this.stopMessageStream();

		this.currentSource = "message";
		this.messageStreamingId = messageId;
		this.messageParagraphIndex = 0;
		this.messagePaused = false;

		const settings = this.plugin.settings;
		const ttsConfig = resolveRoleConfig("tts", settings);
		if (!ttsConfig?.apiKey) {
			new Notice("请先在设置中配置语音播报（TTS）服务");
			return;
		}

		const client = new TTSClient({
			apiKey: ttsConfig.apiKey,
			baseUrl: ttsConfig.baseUrl,
			model: "mimo-v2.5-tts",
		});

		const player = new PCMStreamPlayer();
		this.messagePlayer = player;
		this.messageAbort = new AbortController();

		this.emitMessageTTSState(messageId, "tts_loading");

		try {
			let paragraphs = this.options.getMessageParagraphs?.(messageId) ?? [];
			if (paragraphs.length === 0) {
				const cleanText = preprocessForTTS(content).trim();
				if (!cleanText) {
					this.stopMessageStream();
					return;
				}
				paragraphs = cleanText.split(/\n\n+/).filter((p) => p.trim());
			}

			while (
				this.currentSource === "message" &&
				this.messageStreamingId === messageId &&
				this.messageParagraphIndex < paragraphs.length
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

				if (paraIndex === 0) {
					this.emitMessageTTSState(messageId, "playing");
				}

				const paragraphStartTime = player.endTime;
				this.scheduleMessageHighlight(messageId, paraIndex, paragraphStartTime, player);

				const stream = client.synthesizeStream(
					cleanParaText,
					{ voiceProfile: { voice: "冰糖" } },
					this.messageAbort?.signal
				);

				for await (const chunk of stream) {
					if (
						this.currentSource !== "message" ||
						this.messageStreamingId !== messageId ||
						this.messagePaused
					) {
						break;
					}
					player.enqueue(chunk);
				}

				if (this.currentSource !== "message" || this.messageStreamingId !== messageId) {
					break;
				}

				this.messageParagraphIndex++;
			}

			if (
				this.currentSource === "message" &&
				this.messageStreamingId === messageId &&
				!this.messagePaused
			) {
				player.seal();
				await player.waitForEnd();
			}
		} catch (err) {
			if ((err as Error)?.name === "AbortError") return;
			serviceLog.error("[TTSDomain] Message stream TTS failed:", err);
			new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			player.stop();
			this.messagePlayer = null;
			this.messageAbort = null;
			if (this.currentSource === "message" && this.messageStreamingId === messageId) {
				this.eventBus.emit("tts:paragraph-changed", {
					source: "message",
					messageId,
					paragraphIndex: -1,
				});
				this.emitMessageTTSState(messageId, "idle");
				this.messageStreamingId = null;
			}
		}
	}

	private emitMessageTTSState(messageId: string, state: TTSPlayState): void {
		this.eventBus.emit("tts:state-changed", {
			source: "message",
			messageId,
			state,
		});
		this.notifyXitongReading(state);
	}

	private emitReadingTTSState(state: TTSPlayState): void {
		this.eventBus.emit("tts:state-changed", {
			source: "reading",
			state,
		});
		this.notifyXitongReading(state);
	}

	private notifyXitongReading(state: TTSPlayState): void {
		this.plugin.readingModeService?.setXitongReading(state === "playing");
	}

	private async scheduleMessageHighlight(
		messageId: string,
		paraIndex: number,
		startTime: number,
		player: PCMStreamPlayer
	): Promise<void> {
		while (
			this.currentSource === "message" &&
			this.messageStreamingId === messageId &&
			player.currentTime < startTime
		) {
			await sleep(20);
		}
		if (this.currentSource === "message" && this.messageStreamingId === messageId) {
			this.eventBus.emit("tts:paragraph-changed", {
				source: "message",
				messageId,
				paragraphIndex: paraIndex,
			});
		}
	}

	private stopMessageStream(): void {
		this.messageAbort?.abort();
		this.messageAbort = null;
		this.messagePlayer?.stop();
		this.messagePlayer = null;
		this.messageStreamingId = null;
		this.messageParagraphIndex = 0;
		this.messagePaused = false;
		this.currentSource = "message";
	}

	private toggleMessagePause(): void {
		if (this.messagePaused) {
			this.messagePaused = false;
			this.messagePlayer?.resume();
			this.emitMessageTTSState(this.messageStreamingId!, "playing");
		} else {
			this.messagePaused = true;
			this.messagePlayer?.pause();
			this.emitMessageTTSState(this.messageStreamingId!, "paused");
		}
	}

	private async handleReadingTTS(customText?: string): Promise<void> {
		if (this.currentSource === "reading") {
			this.stopReading();
			return;
		}

		if (this.currentSource === "message") {
			this.stopMessageStream();
		}

		this.currentSource = "reading";
		this.readingAbort = new AbortController();
		this.readingClient = this.initReadingClient();
		this.emitReadingTTSState("tts_loading");

		const player = new PCMStreamPlayer();
		this.readingPlayer = player;

		try {
			if (customText) {
				await this.readCustomText(customText, player);
			} else {
				await this.readPageWithPlayer(player);
			}
		} catch (err) {
			if ((err as Error)?.name === "AbortError") return;
			serviceLog.error("[TTSDomain] Reading TTS failed:", err);
			new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			if (this.currentSource === "reading") {
				this.currentSource = "message";
				this.emitReadingTTSState("idle");
				this.options.clearHighlight?.();
			}
			player.stop();
			this.readingPlayer = null;
		}
	}

	private async readCustomText(text: string, player: PCMStreamPlayer): Promise<void> {
		const cleanText = preprocessForTTS(text);
		if (!cleanText.trim()) {
			this.stopReading();
			return;
		}

		if (!this.readingClient) {
			this.stopReading();
			new Notice("朗读失败：TTS 客户端未初始化");
			return;
		}

		this.emitReadingTTSState("playing");

		try {
			const stream = this.readingClient.synthesizeStream(
				cleanText,
				{ voiceProfile: { voice: "冰糖" } },
				this.readingAbort?.signal
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

	private async readPageWithPlayer(player: PCMStreamPlayer): Promise<void> {
		this.isAutoPageTurn = false;
		if (this.currentSource !== "reading") return;

		const paragraphs = this.options.getPageParagraphs?.() || [];
		if (paragraphs.length === 0) {
			this.isAutoPageTurn = true;
			const hasNext = this.options.goToNextPage?.() ?? false;

			if (hasNext) {
				await sleep(800);
				await this.readPageWithPlayer(player);
			} else {
				this.isAutoPageTurn = false;
				this.lastReadParagraphIndex = 0;
				this.stopReading();
				new Notice("朗读完毕");
			}
			return;
		}

		if (!this.readingClient) {
			this.stopReading();
			new Notice("朗读失败：TTS 客户端未初始化");
			return;
		}

		const currentPageNumber = this.options.getCurrentPage?.() ?? 1;
		const isDual = this.options.isDualPageMode?.() ?? false;

		let pagePrefetch = this.pendingPrefetch;
		this.pendingPrefetch = null;
		if (pagePrefetch && pagePrefetch.pageNumber !== currentPageNumber) {
			pagePrefetch = null;
		}
		this.prefetchNextPage(currentPageNumber, isDual);

		this.emitReadingTTSState("playing");

		try {
			const texts: string[] = [];
			for (let i = 0; i < paragraphs.length; i++) {
				const t = preprocessForTTS(paragraphs[i].text).trim();
				texts.push(t);
			}

			const startIdx = this.lastReadParagraphIndex;

			const makeStream = (text: string): AsyncGenerator<ArrayBuffer> =>
				this.readingClient!.synthesizeStream(
					text,
					{ voiceProfile: { voice: "冰糖" } },
					this.readingAbort?.signal
				);

			const prefetchSeg = (text: string) => {
				const seg = { text, buffered: [] as ArrayBuffer[], drained: Promise.resolve(), failed: false };
				const gen = makeStream(text);
				seg.drained = (async () => {
					try {
						for await (const chunk of gen) seg.buffered.push(chunk);
					} catch {
						seg.failed = true;
					}
				})();
				return seg;
			};

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

			let current = getSegment(startIdx);
			let next = startIdx + 1 < texts.length ? prefetchSeg(texts[startIdx + 1]) : null;

			for (let i = startIdx; i < paragraphs.length; i++) {
				if (this.currentSource !== "reading") {
					this.lastReadParagraphIndex = i;
					return;
				}
				this.lastReadParagraphIndex = i;

				if (!this.isPrefetching && player.endTime - player.currentTime < 5000) {
					this.prefetchNextPage(currentPageNumber, isDual);
				}

				const paragraphStartTime = player.endTime;
				this.scheduleHighlight(paragraphs[i].element, paragraphStartTime, player);

				if (current) {
					if ("gen" in current) {
						for await (const chunk of current.gen) player.enqueue(chunk);
					} else {
						await current.drained;
						if (current.failed) {
							for await (const chunk of makeStream(texts[i])) player.enqueue(chunk);
						} else {
							for (const chunk of current.buffered) player.enqueue(chunk);
						}
					}
				}

				current = next;
				next = i + 2 < texts.length ? prefetchSeg(texts[i + 2]) : null;
			}

			const pageEndTime = player.endTime;
			while (this.currentSource === "reading" && player.currentTime < pageEndTime) {
				await sleep(50);
			}
		} catch (err) {
			throw err;
		}

		if (this.currentSource === "reading") {
			this.lastReadParagraphIndex = 0;
			this.options.clearHighlight?.();
			this.isAutoPageTurn = true;
			const hasNext = this.options.goToNextPage?.() ?? false;

			if (hasNext) {
				await sleep(800);
				await this.readPageWithPlayer(player);
			} else {
				this.isAutoPageTurn = false;
				this.stopReading();
				new Notice("朗读完毕");
			}
		}
	}

	private prefetchNextPage(currentPageNumber: number, isDual: boolean): void {
		if (!this.readingClient || !this.options.getPageParagraphs || this.isPrefetching) return;
		this.isPrefetching = true;
		try {
			const nextPageNumber = currentPageNumber + (isDual ? 2 : 1);
			const nextParagraphs = this.options.getPageParagraphs(nextPageNumber) || [];
			if (nextParagraphs.length === 0) return;
			const texts = nextParagraphs
				.map((p) => preprocessForTTS(p.text).trim())
				.filter((t) => t);
			if (texts.length === 0) return;
			const MAX_PREFETCH = 1;
			const items = texts.slice(0, MAX_PREFETCH).map((text) => {
				const seg = { text, buffered: [] as ArrayBuffer[], drained: Promise.resolve(), failed: false };
				const gen = this.readingClient!.synthesizeStream(
					text,
					{ voiceProfile: { voice: "冰糖" } },
					this.readingAbort?.signal
				);
				seg.drained = (async () => {
					try {
						for await (const chunk of gen) seg.buffered.push(chunk);
					} catch {
						seg.failed = true;
					}
				})();
				return seg;
			});
			this.pendingPrefetch = { pageNumber: nextPageNumber, items };
		} finally {
			this.isPrefetching = false;
		}
	}

	private async scheduleHighlight(
		element: HTMLElement,
		startTime: number,
		player: PCMStreamPlayer
	): Promise<void> {
		while (this.currentSource === "reading" && player.currentTime < startTime) {
			await sleep(50);
		}
		if (this.currentSource === "reading") {
			this.options.highlightElement?.(element);
		}
	}

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
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
