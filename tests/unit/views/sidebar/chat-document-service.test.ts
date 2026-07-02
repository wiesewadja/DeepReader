import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatDocumentService } from "@/views/sidebar/services/chat-document-service";
import { EventBus } from "@/views/sidebar/event-bus";
import { App, TFile } from "obsidian";

type SidebarEvents = {
	"chat:documents-changed": { documents: { path: string; name: string; content: string }[] };
};

function createMockApp(overrides?: {
	files?: { path: string; content: string }[];
	activeFilePath?: string | null;
}): App {
	const filesByPath = new Map(
		(overrides?.files ?? []).map((f) => [f.path, { ...f, file: new TFile(f.path) }]),
	);

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => {
				return filesByPath.get(path)?.file ?? null;
			}),
			read: vi.fn(async (file: TFile) => {
				return filesByPath.get(file.path)?.content ?? "";
			}),
			getMarkdownFiles: vi.fn(() =>
				Array.from(filesByPath.values())
					.filter((f) => f.file.extension === "md")
					.map((f) => f.file),
			),
		},
		workspace: {
			getActiveFile: vi.fn(() =>
				overrides?.activeFilePath ? new TFile(overrides.activeFilePath) : null,
			),
		},
	} as unknown as App;
}

describe("ChatDocumentService", () => {
	let eventBus: EventBus<SidebarEvents>;
	let changeHandler: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEvents>();
		changeHandler = vi.fn();
		eventBus.on("chat:documents-changed", changeHandler);
	});

	it("loads a markdown file by path and publishes a change event", async () => {
		const app = createMockApp({
			files: [{ path: "notes/idea.md", content: "# Idea\nHello" }],
		});
		const service = new ChatDocumentService({ app, eventBus });

		const doc = await service.loadByPath("notes/idea.md", "mention");

		expect(doc).not.toBeNull();
		expect(doc?.path).toBe("notes/idea.md");
		expect(doc?.name).toBe("idea");
		expect(doc?.content).toBe("# Idea\nHello");
		expect(doc?.source).toBe("mention");
		expect(changeHandler).toHaveBeenCalledTimes(1);
		const call = changeHandler.mock.calls[0][0];
		expect(call.documents).toHaveLength(1);
		expect(call.documents[0]).toMatchObject({
			path: "notes/idea.md",
			name: "idea",
			content: "# Idea\nHello",
			source: "mention",
		});
	});

	it("returns null and does not publish when the file does not exist", async () => {
		const app = createMockApp();
		const service = new ChatDocumentService({ app, eventBus });

		const doc = await service.loadByPath("missing.md", "mention");

		expect(doc).toBeNull();
		expect(changeHandler).not.toHaveBeenCalled();
	});

	it("does not reload a document that is already loaded", async () => {
		const app = createMockApp({
			files: [{ path: "notes/idea.md", content: "# Idea" }],
		});
		const service = new ChatDocumentService({ app, eventBus });

		await service.loadByPath("notes/idea.md", "mention");
		changeHandler.mockClear();
		const second = await service.loadByPath("notes/idea.md", "wikilink");

		expect(second?.source).toBe("mention");
		expect(changeHandler).not.toHaveBeenCalled();
	});

	it("loads the currently active markdown file", async () => {
		const app = createMockApp({
			files: [{ path: "notes/idea.md", content: "active" }],
			activeFilePath: "notes/idea.md",
		});
		const service = new ChatDocumentService({ app, eventBus });

		const doc = await service.loadCurrentDocument();

		expect(doc?.path).toBe("notes/idea.md");
		expect(doc?.source).toBe("current");
	});

	it("returns null when the active file is not markdown", async () => {
		const app = createMockApp({
			activeFilePath: "notes/idea.pdf",
		});
		const service = new ChatDocumentService({ app, eventBus });

		const doc = await service.loadCurrentDocument();

		expect(doc).toBeNull();
	});

	it("removes a loaded document and publishes a change event", async () => {
		const app = createMockApp({
			files: [{ path: "notes/idea.md", content: "# Idea" }],
		});
		const service = new ChatDocumentService({ app, eventBus });
		await service.loadByPath("notes/idea.md", "mention");
		changeHandler.mockClear();

		service.removeDocument("notes/idea.md");

		expect(service.hasDocument("notes/idea.md")).toBe(false);
		expect(changeHandler).toHaveBeenCalledWith({ documents: [] });
	});

	it("clears all loaded documents and publishes a change event", async () => {
		const app = createMockApp({
			files: [
				{ path: "notes/a.md", content: "A" },
				{ path: "notes/b.md", content: "B" },
			],
		});
		const service = new ChatDocumentService({ app, eventBus });
		await service.loadByPath("notes/a.md", "mention");
		await service.loadByPath("notes/b.md", "mention");
		changeHandler.mockClear();

		service.clearAll();

		expect(service.getLoadedDocuments().size).toBe(0);
		expect(changeHandler).toHaveBeenCalledWith({ documents: [] });
	});

	it("combines loaded documents into a single context string", async () => {
		const app = createMockApp({
			files: [
				{ path: "notes/a.md", content: "Alpha" },
				{ path: "notes/b.md", content: "Beta" },
			],
		});
		const service = new ChatDocumentService({ app, eventBus });
		await service.loadByPath("notes/a.md", "mention");
		await service.loadByPath("notes/b.md", "mention");

		const context = service.getCombinedContext();

		expect(context).toContain("文档: a");
		expect(context).toContain("Alpha");
		expect(context).toContain("文档: b");
		expect(context).toContain("Beta");
	});

	it("returns an empty string when no documents are loaded", () => {
		const app = createMockApp();
		const service = new ChatDocumentService({ app, eventBus });

		expect(service.getCombinedContext()).toBe("");
	});

	it("returns the total character count of loaded documents", async () => {
		const app = createMockApp({
			files: [
				{ path: "notes/a.md", content: "Alpha" },
				{ path: "notes/b.md", content: "Beta" },
			],
		});
		const service = new ChatDocumentService({ app, eventBus });
		await service.loadByPath("notes/a.md", "mention");
		await service.loadByPath("notes/b.md", "mention");

		expect(service.getTotalCharCount()).toBe(9);
	});
});
