/**
 * 书籍索引追踪日志 — 类型定义 + IndexTracer 类
 *
 * 每次 indexBook() 生成一份 JSON 追踪文件，记录耗时、数据量、路径决策、LLM 调用统计。
 * 详见 SPEC.md §3, §6.2
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getPageindexRoot } from "./paths.js";
import { INDEX_TRACE_ENABLED } from "../config/features.js";

/** LLM 调用追踪（SPEC §3.4） */
export interface LlmCallTrace {
	phase: string;             // 所属阶段
	purpose: string;           // "generate_toc" | "verify_page" | "generate_summary" | ...
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	durationMs: number;
	error?: string;
}

/** 阶段记录（SPEC §3.2） */
export interface TracePhase {
	name: string;              // "parse_document" | "export_markdown" | ...
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
	success: boolean;
	error?: string;

	/** 数据量指标 */
	stats?: Record<string, number | string>;

	/** 该阶段内的 LLM 调用 */
	llmCalls: LlmCallTrace[];
}

/** 路径决策（SPEC §3.3） */
export interface PathDecision {
	phase: string;             // 哪个阶段做的决策
	decision: string;          // "outline_fast_path" | "llm_toc" | "ocr_fallback" | ...
	reason: string;            // 人类可读的决策原因
	degradedFrom?: string;     // 降级前的路径
}

/** 配置快照，传入 IndexTracer 构造函数 */
export interface TraceConfig {
	pageindexModel: string;
	embeddingProvider?: string;
	embeddingModel?: string;
	mineruUsed: boolean;
}

/** 顶层追踪记录（SPEC §3.1） */
export interface IndexTrace {
	bookId: string;
	title: string;
	filePath: string;
	fileType: "pdf" | "epub";
	startedAt: string;          // ISO 8601
	completedAt?: string;
	totalDurationMs?: number;
	success: boolean;
	error?: string;

	config: {
		pageindexModel: string;
		embeddingProvider?: string;
		embeddingModel?: string;
		mineruUsed: boolean;
	};

	phases: TracePhase[];
	pathDecisions: PathDecision[];

	llmSummary: {
		totalCalls: number;
		totalInputTokens: number;
		totalOutputTokens: number;
		totalDurationMs: number;
		byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
	};
}

/** 索引追踪器（SPEC §6.2） */
export class IndexTracer {
	private trace: IndexTrace;
	private currentPhase: TracePhase | null = null;
	private phaseStartMs: number = 0;
	private vaultPath: string;
	private exportName: string;
	private tracePath: string;

	private traceStartMs: number = 0;

	constructor(
		bookId: string,
		title: string,
		filePath: string,
		fileType: "pdf" | "epub",
		config: TraceConfig,
		vaultPath: string,
		exportName: string,
	) {
		this.vaultPath = vaultPath;
		this.exportName = exportName;
		this.tracePath = path.join(getPageindexRoot(vaultPath), "traces", `${exportName}.json`);
		this.traceStartMs = Date.now();

		this.trace = {
			bookId,
			title,
			filePath,
			fileType,
			startedAt: new Date(this.traceStartMs).toISOString(),
			success: false,
			config: { ...config },
			phases: [],
			pathDecisions: [],
			llmSummary: {
				totalCalls: 0,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalDurationMs: 0,
				byModel: {},
			},
		};
	}

	startPhase(name: string): void {
		this.phaseStartMs = Date.now();
		this.currentPhase = {
			name,
			startedAt: new Date(this.phaseStartMs).toISOString(),
			success: false,
			llmCalls: [],
		};
	}

	endPhase(stats?: Record<string, number | string>): void {
		if (!this.currentPhase) return;
		const endMs = Date.now();
		this.currentPhase.completedAt = new Date(endMs).toISOString();
		this.currentPhase.durationMs = endMs - this.phaseStartMs;
		this.currentPhase.success = true;
		if (stats) this.currentPhase.stats = stats;
		this.trace.phases.push(this.currentPhase);
		this.currentPhase = null;
	}

	failPhase(error: string): void {
		if (!this.currentPhase) return;
		const endMs = Date.now();
		this.currentPhase.completedAt = new Date(endMs).toISOString();
		this.currentPhase.durationMs = endMs - this.phaseStartMs;
		this.currentPhase.success = false;
		this.currentPhase.error = error;
		this.trace.phases.push(this.currentPhase);
		this.currentPhase = null;
	}

	recordLlmCall(call: Omit<LlmCallTrace, "phase">): void {
		if (!this.currentPhase) return;
		this.currentPhase.llmCalls.push({
			...call,
			phase: this.currentPhase.name,
		});
	}

	/** 解析完成后更新标题 */
	setTitle(title: string): void {
		this.trace.title = title;
	}

	recordPathDecision(decision: PathDecision): void {
		this.trace.pathDecisions.push(decision);
	}

	/** fire-and-forget 写入 JSON */
	save(): void {
		const dir = path.dirname(this.tracePath);
		const data = JSON.stringify(this.trace, null, 2);
		fs.mkdir(dir, { recursive: true })
			.then(() => fs.writeFile(this.tracePath, data, "utf-8"))
			.catch((e) => { console.error("[IndexTracer] save failed:", e); });
	}

	/** 计算汇总并写入最终文件 */
	finalize(success: boolean, error?: string): void {
		// 关闭未完成的 phase（异常路径兜底）
		if (this.currentPhase) {
			const endMs = Date.now();
			this.currentPhase.completedAt = new Date(endMs).toISOString();
			this.currentPhase.durationMs = endMs - this.phaseStartMs;
			this.currentPhase.success = false;
			this.currentPhase.error = "phase interrupted";
			this.trace.phases.push(this.currentPhase);
			this.currentPhase = null;
		}

		const endMs = Date.now();
		this.trace.completedAt = new Date(endMs).toISOString();
		this.trace.totalDurationMs = endMs - this.traceStartMs;
		this.trace.success = success;
		if (error) this.trace.error = error;

		// 从所有 phases 的 llmCalls 聚合 llmSummary
		const summary = this.trace.llmSummary;
		summary.totalCalls = 0;
		summary.totalInputTokens = 0;
		summary.totalOutputTokens = 0;
		summary.totalDurationMs = 0;
		summary.byModel = {};

		for (const phase of this.trace.phases) {
			for (const call of phase.llmCalls) {
				summary.totalCalls++;
				summary.totalInputTokens += call.inputTokens ?? 0;
				summary.totalOutputTokens += call.outputTokens ?? 0;
				summary.totalDurationMs += call.durationMs;

				if (!summary.byModel[call.model]) {
					summary.byModel[call.model] = { calls: 0, inputTokens: 0, outputTokens: 0 };
				}
				summary.byModel[call.model].calls++;
				summary.byModel[call.model].inputTokens += call.inputTokens ?? 0;
				summary.byModel[call.model].outputTokens += call.outputTokens ?? 0;
			}
		}

		this.save();
	}
}

/** 空操作 tracer，INDEX_TRACE_ENABLED=false 时使用 */
export class NoopIndexTracer {
	startPhase(_name: string): void {}
	endPhase(_stats?: Record<string, number | string>): void {}
	failPhase(_error: string): void {}
	recordLlmCall(_call: Omit<LlmCallTrace, "phase">): void {}
	recordPathDecision(_decision: PathDecision): void {}
	setTitle(_title: string): void {}
	save(): void {}
	finalize(_success: boolean, _error?: string): void {}
}

export type Tracer = IndexTracer | NoopIndexTracer;

/** 根据 INDEX_TRACE_ENABLED 开关创建 tracer 实例 */
export function createTracer(
	bookId: string,
	title: string,
	filePath: string,
	fileType: "pdf" | "epub",
	config: TraceConfig,
	vaultPath: string,
	exportName: string,
): Tracer {
	if (!INDEX_TRACE_ENABLED) return new NoopIndexTracer();
	return new IndexTracer(bookId, title, filePath, fileType, config, vaultPath, exportName);
}
