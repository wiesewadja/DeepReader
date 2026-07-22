import { describe, it, expect, vi, beforeEach } from "vitest";
import { TTSDomain } from "@/views/sidebar/domains/tts-domain";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap } from "@/views/sidebar/events";
import { PCMStreamPlayer } from "@/services/tts/pcm-stream-player";
import { TTSClient } from "@/services/tts/tts-client";

// Mock providers and resolveRoleConfig
vi.mock("@/config/providers", () => {
	return {
		resolveRoleConfig: vi.fn(() => ({ apiKey: "key", baseUrl: "url", model: "model", provider: "provider" })),
	};
});

vi.mock("@/services/tts/pcm-stream-player", () => {
	return {
		PCMStreamPlayer: vi.fn().mockImplementation(() => {
			return {
				enqueue: vi.fn(),
				stop: vi.fn(),
				pause: vi.fn(),
				resume: vi.fn(),
				seal: vi.fn(),
				waitForEnd: vi.fn(async () => {}),
				endTime: 0,
				currentTime: 0,
			};
		}),
	};
});

vi.mock("@/services/tts/tts-client", () => {
	const mockClient = {
		synthesizeStream: vi.fn().mockImplementation(async function* () {
			yield new ArrayBuffer(8);
		}),
		synthesize: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
	};
	return {
		TTSClient: vi.fn().mockImplementation(() => mockClient),
		createTTSClient: vi.fn().mockImplementation(() => mockClient),
	};
});

describe("TTSDomain", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let app: any;
	let plugin: any;
	let stateHandler: any;
	let clearHighlight: any;
	let getPageParagraphs: any;
	let goToNextPage: any;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEventMap>();
		stateHandler = vi.fn();
		eventBus.on("tts:state-changed", stateHandler);

		app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
			},
		};

		plugin = {
			manifest: { id: "deepreader-dev" },
			settings: {
				tts: { apiKey: "key", baseUrl: "url", model: "model" },
				router: { apiKey: "key", baseUrl: "url", model: "model" },
			},
			readingModeService: {
				setXitongReading: vi.fn(),
			},
		};

		clearHighlight = vi.fn();
		getPageParagraphs = vi.fn(() => []);
		goToNextPage = vi.fn(() => false);
	});

	function createDomain(): TTSDomain {
		return new TTSDomain({
			app,
			plugin,
			eventBus,
			getPageParagraphs,
			getCurrentPage: () => 1,
			isDualPageMode: () => false,
			clearHighlight,
			goToNextPage,
		});
	}

	it("manages current playback source and handles lifecycle calls", () => {
		const domain = createDomain();
		expect(domain.getCurrentSource()).toBe("message");
		expect(domain.isAutoPageTurning()).toBe(false);

		domain.stop();
		domain.stopReading();
	});

	it("initializes TTS service and handles speak trigger state changes", async () => {
		const domain = createDomain();
		domain.ensureService();
		expect(domain.getTtsService()).not.toBeNull();

		await domain.speak("msg-1", "hello");
		expect(stateHandler).toHaveBeenCalledWith(
			expect.objectContaining({ source: "message", messageId: "msg-1" }),
		);
	});

	it("readCurrentPage transitions through loading/playing/idle and uses the PCM player", async () => {
		const domain = createDomain();

		await domain.readCurrentPage("hello world");

		expect(domain.getCurrentSource()).toBe("message");
		expect(stateHandler).toHaveBeenCalledWith(
			expect.objectContaining({ source: "reading", state: "tts_loading" }),
		);
		expect(stateHandler).toHaveBeenCalledWith(
			expect.objectContaining({ source: "reading", state: "playing" }),
		);
		expect(stateHandler).toHaveBeenLastCalledWith(
			expect.objectContaining({ source: "reading", state: "idle" }),
		);

		const player = vi.mocked(PCMStreamPlayer).mock.results[0].value;
		expect(player.enqueue).toHaveBeenCalled();
		expect(player.stop).toHaveBeenCalled();
	});

	it("stopReading aborts an active reading stream and resets state", async () => {
		const { createTTSClient } = await import("@/services/tts/tts-client");

		vi.mocked(createTTSClient).mockImplementation(() => ({
			synthesizeStream: vi.fn((_text: string, _opts: unknown, signal?: AbortSignal) => {
				return (async function* () {
					yield new ArrayBuffer(8);
					// Keep the stream alive until explicitly aborted.
					while (!signal?.aborted) {
						await new Promise((r) => setTimeout(r, 5));
					}
				})();
			}),
			synthesize: vi.fn(),
		}));

		const domain = createDomain();
		const readPromise = domain.readCurrentPage("hello world");

		// Allow the async generator to start before stopping.
		await new Promise((r) => setTimeout(r, 10));
		expect(domain.getCurrentSource()).toBe("reading");

		domain.stopReading();
		await readPromise;

		expect(domain.getCurrentSource()).toBe("message");
		expect(clearHighlight).toHaveBeenCalled();
		expect(stateHandler).toHaveBeenLastCalledWith(
			expect.objectContaining({ source: "reading", state: "idle" }),
		);

		const player = vi.mocked(PCMStreamPlayer).mock.results[0].value;
		expect(player.stop).toHaveBeenCalled();
	});
});
