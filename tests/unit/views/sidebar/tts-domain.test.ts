import { describe, it, expect, vi, beforeEach } from "vitest";
import { TTSDomain } from "@/views/sidebar/domains/tts-domain";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap, TTSPlayState } from "@/views/sidebar/events";
import type { TTSController } from "@/views/sidebar/tts-controller";

function createMockTTSController(
	overrides: Partial<TTSController> = {},
): TTSController {
	return {
		handleTTS: vi.fn(async () => {}),
		stop: vi.fn(() => {}),
		pause: vi.fn(() => {}),
		resume: vi.fn(() => {}),
		handleReadingTTS: vi.fn(async () => {}),
		stopReading: vi.fn(() => {}),
		ensureService: vi.fn(() => {}),
		getTtsService: vi.fn(() => null),
		getCurrentSource: vi.fn(() => "message"),
		isAutoPageTurning: vi.fn(() => false),
		destroy: vi.fn(() => {}),
		...overrides,
	} as unknown as TTSController;
}

describe("TTSDomain", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let ttsController: TTSController;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEventMap>();
		ttsController = createMockTTSController();
	});

	function createDomain(): TTSDomain {
		return new TTSDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			ttsController,
		});
	}

	it("delegates speak to TTSController", async () => {
		const domain = createDomain();
		await domain.speak("msg-1", "hello");
		expect(ttsController.handleTTS).toHaveBeenCalledWith("msg-1", "hello");
	});

	it("delegates stop to TTSController", () => {
		const domain = createDomain();
		domain.stop();
		expect(ttsController.stop).toHaveBeenCalled();
	});

	it("delegates pause and resume to TTSController", () => {
		const domain = createDomain();
		domain.pause();
		domain.resume();
		expect(ttsController.pause).toHaveBeenCalled();
		expect(ttsController.resume).toHaveBeenCalled();
	});

	it("delegates readCurrentPage to TTSController", async () => {
		const domain = createDomain();
		await domain.readCurrentPage("selection text");
		expect(ttsController.handleReadingTTS).toHaveBeenCalledWith("selection text");
	});

	it("delegates stopReading to TTSController", () => {
		const domain = createDomain();
		domain.stopReading(true);
		expect(ttsController.stopReading).toHaveBeenCalledWith(true);
	});

	it("delegates service accessors to TTSController", () => {
		const domain = createDomain();
		domain.ensureService();
		domain.getTtsService();
		domain.getCurrentSource();
		domain.isAutoPageTurning();
		expect(ttsController.ensureService).toHaveBeenCalled();
		expect(ttsController.getTtsService).toHaveBeenCalled();
		expect(ttsController.getCurrentSource).toHaveBeenCalled();
		expect(ttsController.isAutoPageTurning).toHaveBeenCalled();
	});

	it("delegates destroy to TTSController", () => {
		const domain = createDomain();
		domain.destroy();
		expect(ttsController.destroy).toHaveBeenCalled();
	});

	it("preloads TTS preview through the service", async () => {
		const preloadPreview = vi.fn(async () => {});
		const mockService = { preloadPreview };
		const getTtsService = vi.fn()
			.mockReturnValueOnce(null)
			.mockReturnValue(mockService as any);
		ttsController = createMockTTSController({ getTtsService });
		const domain = new TTSDomain({
			app: {
				vault: {
					adapter: {
						exists: vi.fn(async () => false),
					},
				},
			} as any,
			plugin: {} as any,
			eventBus,
			ttsController,
		});

		await domain.preloadPreview("msg-1", "hello world", {
			indexId: "book-1",
			pdfName: "Book One",
			author: "Author",
		});

		expect(ttsController.ensureService).toHaveBeenCalled();
		expect(preloadPreview).toHaveBeenCalledWith(
			"msg-1",
			"hello world",
			expect.objectContaining({
				bookId: "book-1",
				bookTitle: "Book One",
				bookAuthor: "Author",
			}),
		);
	});
});
