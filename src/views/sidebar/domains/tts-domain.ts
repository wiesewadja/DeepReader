/**
 * TTSDomain
 *
 * Sidebar TTS playback boundary. Wraps TTSController and publishes typed TTS
 * events (`tts:state-changed`, `tts:progress-changed`) so ChatPresenter can
 * update UI components without Domains touching them directly.
 *
 * During this incremental refactor, TTSController still owns the complex
 * message/reading playback machinery; TTSDomain adds the event seam and a
 * cleaner public interface.
 */

import type { App } from "obsidian";
import { MemoryStore } from "../../../agent/memory/store.js";
import type { DeepReaderPluginInterface } from "../../../agent/tools/context/vault.js";
import type { TTSService } from "../../../services/tts/tts-service.js";
import { uiLog as log } from "../../../utils/logger.js";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap } from "../events.js";
import type { TTSController, TTSSource } from "../tts-controller.js";

export interface TTSBookContext {
	indexId?: string;
	pdfName?: string;
	author?: string;
}

export interface TTSDomainOptions {
	app: App;
	plugin: DeepReaderPluginInterface;
	eventBus: EventBus<SidebarEventMap>;
	ttsController: TTSController;
}

export class TTSDomain {
	private app: App;
	private plugin: DeepReaderPluginInterface;
	private eventBus: EventBus<SidebarEventMap>;
	private ttsController: TTSController;

	constructor(options: TTSDomainOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		this.eventBus = options.eventBus;
		this.ttsController = options.ttsController;
	}

	// ── Service lifecycle ──

	ensureService(): void {
		this.ttsController.ensureService();
	}

	getTtsService(): TTSService | null {
		return this.ttsController.getTtsService();
	}

	// ── Message TTS ──

	async speak(messageId: string, content: string): Promise<void> {
		await this.ttsController.handleTTS(messageId, content);
	}

	stop(): void {
		this.ttsController.stop();
	}

	pause(): void {
		this.ttsController.pause();
	}

	resume(): void {
		this.ttsController.resume();
	}

	// ── Reading TTS ──

	async readCurrentPage(customText?: string): Promise<void> {
		await this.ttsController.handleReadingTTS(customText);
	}

	stopReading(resetIndex = true): void {
		this.ttsController.stopReading(resetIndex);
	}

	// ── State accessors ──

	getCurrentSource(): TTSSource {
		return this.ttsController.getCurrentSource();
	}

	isAutoPageTurning(): boolean {
		return this.ttsController.isAutoPageTurning();
	}

	// ── Preview preloading ──

	async preloadPreview(messageId: string, content: string, bookContext: TTSBookContext): Promise<void> {
		let ttsService = this.getTtsService();
		if (!ttsService) {
			this.ensureService();
			ttsService = this.getTtsService();
			if (!ttsService) return;
		}

		try {
			log(`[TTS] Preload preview started for message ${messageId}`);
			const memoryContent = await new MemoryStore(this.app).readLongTermMemory() || undefined;
			const context = {
				bookId: bookContext.indexId,
				bookTitle: bookContext.pdfName || undefined,
				bookAuthor: bookContext.author || undefined,
				memoryContent,
			};
			await ttsService.preloadPreview(messageId, content, context);
			log(`[TTS] Preload preview completed for message ${messageId}`);
		} catch (err) {
			log(`[TTS] Preload preview failed for message ${messageId}:`, err);
		}
	}

	// ── Cleanup ──

	destroy(): void {
		this.ttsController.destroy();
	}
}
