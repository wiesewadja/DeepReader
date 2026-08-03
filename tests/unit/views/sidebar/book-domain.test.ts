import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookDomain } from "@/views/sidebar/domains/book-domain";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap } from "@/views/sidebar/events";

vi.mock("@/utils/mobile-fs", () => {
	return {
		vaultRead: vi.fn(async () => "{}"),
		vaultExists: vi.fn(async () => true),
		vaultList: vi.fn(async () => ({ folders: ["path/to/book-1"], files: [] })),
		vaultRemove: vi.fn(async () => {}),
		vaultRmdir: vi.fn(async () => {}),
		getVaultPath: vi.fn(() => ""),
	};
});

describe("BookDomain", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let app: any;
	let plugin: any;
	let changeHandler: any;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEventMap>();
		changeHandler = vi.fn();
		eventBus.on("book:changed", changeHandler);

		app = {
			workspace: {
				getActiveFile: vi.fn(() => null),
				getLeavesOfType: vi.fn(() => []),
				getLeaf: vi.fn(() => ({
					setViewState: vi.fn(async () => {}),
				})),
			},
			metadataCache: {
				getFileCache: vi.fn(() => null),
			},
			vault: {
				getMarkdownFiles: vi.fn(() => []),
				getAbstractFileByPath: vi.fn(() => null),
				adapter: {
					stat: vi.fn(async () => ({ mtime: Date.now() })),
					exists: vi.fn(async () => false),
				},
				getResourcePath: vi.fn(() => "mock-cover.png"),
			},
		};

		plugin = {
			settings: {
				lastSelectedIndexId: undefined,
				lastCrossBookMode: false,
				booklistHistory: [],
			},
			saveSettings: vi.fn(async () => {}),
		};
	});

	function createDomain() {
		return new BookDomain({
			app,
			plugin,
			eventBus,
		});
	}

	it("manages properties and selectIndex operations", async () => {
		const domain = createDomain();
		
		// Setup loadIndexes mock response
		const { vaultRead } = await import("@/utils/mobile-fs");
		vi.mocked(vaultRead).mockResolvedValue(
			JSON.stringify({
				bookId: "book-1",
				title: "Test Book",
				author: "Test Author",
				status: "ready",
			}),
		);

		await domain.loadIndexes();
		expect(domain.indexes.length).toBeGreaterThan(0);
		expect(domain.indexes[0].id).toBe("book-1");

		await domain.selectIndex("book-1");
		expect(domain.currentIndexId).toBe("book-1");
		expect(domain.currentPdfName).toBe("Test Book");
		expect(domain.currentBookAuthor).toBe("Test Author");
		expect(changeHandler).toHaveBeenCalled();
	});

	it("selectIndex emits book:changed with clearChat", async () => {
		const { vaultRead } = await import("@/utils/mobile-fs");
		vi.mocked(vaultRead).mockResolvedValue(
			JSON.stringify({
				bookId: "book-1",
				title: "Test Book",
				author: "Test Author",
				status: "ready",
			}),
		);

		const domain = createDomain();
		await domain.loadIndexes();
		await domain.selectIndex("book-1");

		const lastCall = changeHandler.mock.calls[changeHandler.mock.calls.length - 1][0];
		expect(lastCall.clearChat).toBe(true);
		expect(lastCall.indexId).toBe("book-1");
	});

	it("manages thematic reading booklist select and clear", async () => {
		const domain = createDomain();
		
		const booklist = {
			id: "bl-1",
			name: "My Thematic List",
			bookIds: ["book-1", "book-2"],
			bookNames: ["Book One", "Book Two"],
		};

		await domain.selectBooklist(booklist);
		expect(domain.currentBooklist?.id).toBe("bl-1");
		expect(domain.currentIndexId).toBeNull();

		domain.clearBooklist();
		expect(domain.currentBooklist).toBeNull();
		expect(changeHandler).toHaveBeenCalled();
	});
});
