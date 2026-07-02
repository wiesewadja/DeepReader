import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookDomain } from "@/views/sidebar/domains/book-domain";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap } from "@/views/sidebar/events";
import type { BookManager } from "@/views/sidebar/book-manager";
import type { IndexListItem, Booklist } from "@/types/index";

function createMockBookManager(overrides: Partial<BookManager> = {}): BookManager {
	const state = {
		currentIndexId: null as string | null,
		currentPdfName: null as string | null,
		currentBookCoverUrl: null as string | null,
		currentBookAuthor: null as string | null,
		currentDocDescription: null as string | null,
		indexes: [] as IndexListItem[],
		currentBooklist: null as Booklist | null,
	};

	return {
		currentIndexId: state.currentIndexId,
		currentPdfName: state.currentPdfName,
		currentBookCoverUrl: state.currentBookCoverUrl,
		currentBookAuthor: state.currentBookAuthor,
		currentDocDescription: state.currentDocDescription,
		indexes: state.indexes,
		currentBooklist: state.currentBooklist,
		currentBooklistBookIds: state.currentBooklist?.bookIds ?? null,

		getDisplayName: vi.fn((pdfName: string) => pdfName.split("_")[0].split("-")[0]),
		openLibrary: vi.fn(async () => {}),
		buildBookshelfSummary: vi.fn(() => "mock summary"),
		getCurrentBookInfo: vi.fn(() => ({
			title: state.currentPdfName,
			page_count: 0,
			docDescription: state.currentDocDescription,
		})),
		loadIndexes: vi.fn(async () => {}),
		selectIndex: vi.fn(async (indexId: string) => {
			state.currentIndexId = indexId;
			state.currentPdfName = `Book ${indexId}`;
			state.currentBookAuthor = "Author";
		}),
		selectBookByName: vi.fn(async () => {}),
		findBookDirectoryByIndexId: vi.fn(async () => null),
		checkBookChaptersExist: vi.fn(async () => false),
		handleDeleteIndex: vi.fn(async () => {
			state.currentIndexId = null;
			state.currentPdfName = null;
		}),
		selectBooklist: vi.fn(async () => {}),
		restoreBooklist: vi.fn(() => {}),
		clearBooklist: vi.fn(() => {
			state.currentBooklist = null;
		}),
		renameBooklist: vi.fn(() => {}),

		...overrides,
	} as unknown as BookManager;
}

describe("BookDomain", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let changeHandler: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEventMap>();
		changeHandler = vi.fn();
		eventBus.on("book:changed", changeHandler);
	});

	it("proxies state accessors to BookManager", () => {
		const bookManager = createMockBookManager({
			currentIndexId: "book-1",
			currentPdfName: "Book One",
		});
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		expect(domain.currentIndexId).toBe("book-1");
		expect(domain.currentPdfName).toBe("Book One");
	});

	it("emits book:changed after loadIndexes", async () => {
		const bookManager = createMockBookManager();
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		await domain.loadIndexes();

		expect(bookManager.loadIndexes).toHaveBeenCalled();
		expect(changeHandler).toHaveBeenCalledTimes(1);
	});

	it("emits book:changed after selectIndex", async () => {
		const bookManager = createMockBookManager();
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		await domain.selectIndex("book-1");

		expect(bookManager.selectIndex).toHaveBeenCalledWith("book-1");
		expect(changeHandler).toHaveBeenCalledTimes(1);
	});

	it("emits book:changed after deleteIndex", async () => {
		const bookManager = createMockBookManager();
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		await domain.deleteIndex("book-1");

		expect(bookManager.handleDeleteIndex).toHaveBeenCalledWith("book-1");
		expect(changeHandler).toHaveBeenCalledTimes(1);
	});

	it("emits book:changed after selectBooklist", async () => {
		const bookManager = createMockBookManager();
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});
		const booklist: Booklist = { id: "list-1", name: "List", bookIds: ["book-1"] };

		await domain.selectBooklist(booklist);

		expect(bookManager.selectBooklist).toHaveBeenCalledWith(booklist);
		expect(changeHandler).toHaveBeenCalledTimes(1);
	});

	it("emits book:changed after clearBooklist", () => {
		const bookManager = createMockBookManager();
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		domain.clearBooklist();

		expect(bookManager.clearBooklist).toHaveBeenCalled();
		expect(changeHandler).toHaveBeenCalledTimes(1);
	});

	it("proxies getBookshelfSummary to BookManager", () => {
		const bookManager = createMockBookManager();
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		expect(domain.getBookshelfSummary()).toBe("mock summary");
		expect(bookManager.buildBookshelfSummary).toHaveBeenCalled();
	});

	it("proxies getCurrentBookInfo to BookManager", () => {
		const bookManager = createMockBookManager();
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		domain.getCurrentBookInfo();

		expect(bookManager.getCurrentBookInfo).toHaveBeenCalled();
	});

	it("returns current book context from BookManager state", () => {
		const bookManager = createMockBookManager({
			currentIndexId: "book-1",
			currentPdfName: "Book One",
			currentBookAuthor: "Author One",
		});
		const domain = new BookDomain({
			app: {} as any,
			plugin: {} as any,
			eventBus,
			bookManager,
		});

		const context = domain.getCurrentBookContext();

		expect(context.indexId).toBe("book-1");
		expect(context.pdfName).toBe("Book One");
		expect(context.bookAuthor).toBe("Author One");
	});
});
