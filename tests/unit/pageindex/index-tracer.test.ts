import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import { IndexTracer } from "@/pageindex/index-tracer";
import type { TraceConfig } from "@/pageindex/index-tracer";

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../paths.js", () => ({
	getPageindexRoot: vi.fn().mockReturnValue("/vault/.obsidian/plugins/deepreader/pageindex"),
}));

const mockConfig: TraceConfig = {
	pageindexModel: "test-model",
	embeddingProvider: "test-provider",
	embeddingModel: "test-embed",
	mineruUsed: false,
};

/** 刷新 microtask 队列，让 fire-and-forget 的 fs.writeFile 落地 */
async function flush(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
}

async function getLastWrittenTrace(): Promise<any> {
	await flush();
	const calls = vi.mocked(fs.writeFile).mock.calls;
	const last = calls[calls.length - 1];
	return JSON.parse(last[1] as string);
}

describe("IndexTracer", () => {
	let tracer: IndexTracer;

	beforeEach(() => {
		vi.clearAllMocks();
		tracer = new IndexTracer(
			"book123",
			"测试书籍",
			"/vault/test.pdf",
			"pdf",
			mockConfig,
			"/vault",
			"测试书籍",
		);
	});

	it("should simulate a complete lifecycle: startPhase → endPhase → finalize", async () => {
		tracer.startPhase("validate");
		tracer.endPhase({ fileSizeBytes: 1024 });

		tracer.startPhase("parse_document");
		tracer.recordLlmCall({
			purpose: "generate_toc",
			model: "test-model",
			inputTokens: 12000,
			outputTokens: 800,
			durationMs: 3200,
		});
		tracer.recordLlmCall({
			purpose: "verify_page",
			model: "test-model",
			inputTokens: 5000,
			outputTokens: 200,
			durationMs: 1500,
		});
		tracer.endPhase({ chaptersCount: 21, totalNodes: 45, totalTokens: 85000 });

		tracer.startPhase("export_markdown");
		tracer.endPhase({ filesExported: 23, totalMdBytes: 180000 });

		tracer.finalize(true);

		const trace = await getLastWrittenTrace();

		expect(trace.bookId).toBe("book123");
		expect(trace.title).toBe("测试书籍");
		expect(trace.fileType).toBe("pdf");
		expect(trace.success).toBe(true);
		expect(trace.config.pageindexModel).toBe("test-model");

		expect(trace.phases).toHaveLength(3);
		expect(trace.phases[0].name).toBe("validate");
		expect(trace.phases[0].success).toBe(true);
		expect(trace.phases[0].stats.fileSizeBytes).toBe(1024);

		expect(trace.phases[1].name).toBe("parse_document");
		expect(trace.phases[1].stats.chaptersCount).toBe(21);
		expect(trace.phases[1].llmCalls).toHaveLength(2);
		expect(trace.phases[1].llmCalls[0].purpose).toBe("generate_toc");
		expect(trace.phases[1].llmCalls[0].phase).toBe("parse_document");

		expect(trace.llmSummary.totalCalls).toBe(2);
		expect(trace.llmSummary.totalInputTokens).toBe(17000);
		expect(trace.llmSummary.totalOutputTokens).toBe(1000);
		expect(trace.llmSummary.totalDurationMs).toBe(4700);
		expect(trace.llmSummary.byModel["test-model"]).toEqual({
			calls: 2,
			inputTokens: 17000,
			outputTokens: 1000,
		});
	});

	it("should handle failPhase", async () => {
		tracer.startPhase("validate");
		tracer.failPhase("文件格式错误");

		tracer.finalize(false, "索引失败");

		const trace = await getLastWrittenTrace();

		expect(trace.success).toBe(false);
		expect(trace.error).toBe("索引失败");
		expect(trace.phases[0].success).toBe(false);
		expect(trace.phases[0].error).toBe("文件格式错误");
	});

	it("should record path decisions", async () => {
		tracer.startPhase("parse_document");
		tracer.recordPathDecision({
			phase: "parse_document",
			decision: "outline_fast_path",
			reason: "outline has 12 entries, covers 78% of pages",
		});
		tracer.endPhase();

		tracer.finalize(true);

		const trace = await getLastWrittenTrace();

		expect(trace.pathDecisions).toHaveLength(1);
		expect(trace.pathDecisions[0].decision).toBe("outline_fast_path");
		expect(trace.pathDecisions[0].degradedFrom).toBeUndefined();
	});

	it("should handle degradation with degradedFrom", async () => {
		tracer.startPhase("verify_toc");
		tracer.recordPathDecision({
			phase: "verify_toc",
			decision: "degrade_retry",
			reason: "accuracy 42% < 60% threshold",
			degradedFrom: "toc_with_pages",
		});
		tracer.endPhase();

		tracer.finalize(true);

		const trace = await getLastWrittenTrace();

		expect(trace.pathDecisions[0].degradedFrom).toBe("toc_with_pages");
	});

	it("should aggregate byModel correctly for multiple models", async () => {
		tracer.startPhase("parse_document");
		tracer.recordLlmCall({
			purpose: "generate_toc",
			model: "model-a",
			inputTokens: 100,
			outputTokens: 50,
			durationMs: 1000,
		});
		tracer.recordLlmCall({
			purpose: "generate_summary",
			model: "model-b",
			inputTokens: 200,
			outputTokens: 80,
			durationMs: 2000,
		});
		tracer.recordLlmCall({
			purpose: "generate_description",
			model: "model-a",
			inputTokens: 300,
			outputTokens: 30,
			durationMs: 500,
		});
		tracer.endPhase();

		tracer.finalize(true);

		const trace = await getLastWrittenTrace();

		expect(trace.llmSummary.totalCalls).toBe(3);
		expect(trace.llmSummary.byModel["model-a"]).toEqual({
			calls: 2,
			inputTokens: 400,
			outputTokens: 80,
		});
		expect(trace.llmSummary.byModel["model-b"]).toEqual({
			calls: 1,
			inputTokens: 200,
			outputTokens: 80,
		});
	});

	it("save() should not throw on fs failure", async () => {
		vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));

		tracer.startPhase("validate");
		tracer.endPhase();
		tracer.save();

		await flush();
	});
});
