import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import { IndexTracer } from "@/pageindex/index-tracer";
import type { TraceConfig } from "@/pageindex/index-tracer";

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	appendFile: vi.fn().mockResolvedValue(undefined),
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

/** 刷新 microtask 队列，让 fire-and-forget 的 fs 操作落地 */
async function flush(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
}

/** 获取所有 appendFile 写入的行 */
async function getLogLines(): Promise<any[]> {
	await flush();
	const calls = vi.mocked(fs.appendFile).mock.calls;
	return calls.map((call) => JSON.parse(call[1] as string));
}

/** 获取最后一次 writeFile 的内容（.json 兼容摘要） */
async function getLastJsonTrace(): Promise<any> {
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

	it("should write index_start on construction", async () => {
		const lines = await getLogLines();
		expect(lines[0].type).toBe("index_start");
		expect(lines[0].bookId).toBe("book123");
	});

	it("should simulate a complete lifecycle with log lines", async () => {
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

		const lines = await getLogLines();

		// index_start + 3 phases (start+end each) + 2 llm_calls + index_end + llm_summary
		const llmCallLines = lines.filter((l: any) => l.type === "llm_call");
		expect(llmCallLines).toHaveLength(2);
		expect(llmCallLines[0].purpose).toBe("generate_toc");
		expect(llmCallLines[0].inputTokens).toBe(12000);
		expect(llmCallLines[1].purpose).toBe("verify_page");

		const phaseEndLines = lines.filter((l: any) => l.type === "phase_end");
		expect(phaseEndLines).toHaveLength(3);

		const indexEnd = lines.find((l: any) => l.type === "index_end");
		expect(indexEnd.success).toBe(true);

		const summary = lines.find((l: any) => l.type === "llm_summary");
		expect(summary.totalCalls).toBe(2);
		expect(summary.totalInputTokens).toBe(17000);
		expect(summary.totalOutputTokens).toBe(1000);
		expect(summary.byModel["test-model"]).toEqual({
			calls: 2,
			inputTokens: 17000,
			outputTokens: 1000,
		});
	});

	it("should write .json compatibility summary on finalize", async () => {
		tracer.startPhase("parse_document");
		tracer.recordLlmCall({
			purpose: "generate_toc",
			model: "test-model",
			inputTokens: 12000,
			outputTokens: 800,
			durationMs: 3200,
		});
		tracer.endPhase();

		tracer.finalize(true);

		const trace = await getLastJsonTrace();

		expect(trace.title).toBe("测试书籍");
		expect(trace.success).toBe(true);
		expect(trace.phases).toHaveLength(1);
		expect(trace.phases[0].llmCalls).toHaveLength(1);
		expect(trace.llmSummary.totalCalls).toBe(1);
		expect(trace.llmSummary.totalInputTokens).toBe(12000);
	});

	it("should handle failPhase", async () => {
		tracer.startPhase("validate");
		tracer.failPhase("文件格式错误");

		tracer.finalize(false, "索引失败");

		const lines = await getLogLines();
		const phaseEnd = lines.find((l: any) => l.type === "phase_end");
		expect(phaseEnd.success).toBe(false);
		expect(phaseEnd.error).toBe("文件格式错误");

		const indexEnd = lines.find((l: any) => l.type === "index_end");
		expect(indexEnd.success).toBe(false);
		expect(indexEnd.error).toBe("索引失败");
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

		const lines = await getLogLines();
		const pd = lines.find((l: any) => l.type === "path_decision");
		expect(pd.decision).toBe("outline_fast_path");
		expect(pd.degradedFrom).toBeUndefined();
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

		const trace = await getLastJsonTrace();
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

		const trace = await getLastJsonTrace();

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

	it("should record embed_call lines", async () => {
		tracer.startPhase("vectorize");
		tracer.recordEmbedCall({
			model: "text-embedding-3-small",
			durationMs: 500,
			inputTokens: 3000,
			batchSize: 32,
		});
		tracer.endPhase();

		tracer.finalize(true);

		const lines = await getLogLines();
		const embedLine = lines.find((l: any) => l.type === "embed_call");
		expect(embedLine).toBeDefined();
		expect(embedLine.model).toBe("text-embedding-3-small");
		expect(embedLine.inputTokens).toBe(3000);
		expect(embedLine.batchSize).toBe(32);
	});

	it("should not throw on appendFile failure", async () => {
		vi.mocked(fs.appendFile).mockRejectedValueOnce(new Error("disk full"));

		tracer.startPhase("validate");
		tracer.endPhase();

		await flush();
	});
});
