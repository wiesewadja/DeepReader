import { describe, it, expect, vi, beforeEach } from "vitest";
import { TTSDomain } from "@/views/sidebar/domains/tts-domain";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap } from "@/views/sidebar/events";

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
	return {
		TTSClient: vi.fn().mockImplementation(() => {
			return {
				synthesizeStream: vi.fn().mockImplementation(function* () {
					yield new ArrayBuffer(8);
				}),
			};
		}),
	};
});

describe("TTSDomain", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let app: any;
	let plugin: any;
	let stateHandler: any;

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
		};
	});

	function createDomain(): TTSDomain {
		return new TTSDomain({
			app,
			plugin,
			eventBus,
			getDisplayName: (name) => name,
			getCurrentPdfName: () => "test.pdf",
			getCurrentBookAuthor: () => "author",
			getCurrentIndexId: () => "book-1",
			setTtsService: vi.fn(),
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
});
