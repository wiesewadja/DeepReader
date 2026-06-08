/**
 * 书籍索引追踪日志 — 追加写入模式
 *
 * 每个事件（phase start/end、llm_call、embed_call、path_decision）即时写入 .log 文件。
 * finalize() 追加 index_end + llm_summary 汇总行，同时写一份兼容的 .json 摘要。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { INDEX_TRACE_ENABLED } from "../config/features.js";
import { apiLog } from "../utils/logger.js";
import { getPageindexRoot } from "./paths.js";

/** LLM 调用追踪（兼容导出） */
export interface LlmCallTrace {
	phase: string;
	purpose: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	durationMs: number;
	error?: string;
}

/** 阶段记录（兼容导出） */
export interface TracePhase {
	name: string;
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
	success: boolean;
	error?: string;
	stats?: Record<string, number | string>;
	llmCalls: LlmCallTrace[];
}

/** 路径决策（兼容导出） */
export interface PathDecision {
	phase: string;
	decision: string;
	reason: string;
	degradedFrom?: string;
}

/** 配置快照 */
export interface TraceConfig {
	pageindexModel: string;
	embeddingProvider?: string;
	embeddingModel?: string;
	mineruUsed: boolean;
}

/** 顶层追踪记录（兼容导出，.json 摘要仍用此结构） */
export interface IndexTrace {
	bookId: string;
	title: string;
	filePath: string;
	fileType: "pdf" | "epub";
	startedAt: string;
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

// ─── 日志行格式 ──────────────────────────────────────────────

function isoNow(): string {
	return new Date().toISOString();
}

function logLine(type: string, data: Record<string, unknown>): string {
	return JSON.stringify({ ts: isoNow(), type, ...data });
}

// ─── IndexTracer ─────────────────────────────────────────────

export class IndexTracer {
	private vaultPath: string;
	private exportName: string;
	private logPath: string;
	private jsonPath: string;
	private traceStartMs: number;
	private currentPhaseName: string | null = null;
	private phaseStartMs: number = 0;
	private dirEnsured: boolean = false;

	// 用于 finalize() 时聚合 .json 摘要
	private phases: TracePhase[] = [];
	private orphanLlmCalls: Array<Omit<LlmCallTrace, "phase"> & { phase: string }> = [];
	private pathDecisions: PathDecision[] = [];
	private bookId: string;
	private title: string;
	private filePath: string;
	private fileType: "pdf" | "epub";
	private config: TraceConfig;

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
		this.bookId = bookId;
		this.title = title;
		this.filePath = filePath;
		this.fileType = fileType;
		this.config = config;
		this.traceStartMs = Date.now();

		const traceDir = path.join(getPageindexRoot(vaultPath), "traces");
		this.logPath = path.join(traceDir, `${exportName}.log`);
		this.jsonPath = path.join(traceDir, `${exportName}.json`);

		// 构造时立即写 index_start 行
		const startLine = logLine("index_start", {
			bookId,
			title,
			filePath,
			fileType,
			config,
		});
		this.append(startLine);
	}

	private append(line: string): void {
		const write = () => fs.appendFile(this.logPath, line + "\n", "utf-8");
		if (this.dirEnsured) {
		write().catch((e) => { apiLog.error("[IndexTracer] append failed:", e); });
		} else {
			const dir = path.dirname(this.logPath);
			fs.mkdir(dir, { recursive: true })
				.then(() => { this.dirEnsured = true; return write(); })
			.catch((e) => { apiLog.error("[IndexTracer] append failed:", e); });
		}
	}

	startPhase(name: string): void {
		this.currentPhaseName = name;
		this.phaseStartMs = Date.now();
		this.append(logLine("phase_start", { phase: name }));

		// 为 .json 摘要预创建 phase 记录
		this.phases.push({
			name,
			startedAt: new Date(this.phaseStartMs).toISOString(),
			success: false,
			llmCalls: [],
		});
	}

	endPhase(stats?: Record<string, number | string>): void {
		if (!this.currentPhaseName) return;
		const endMs = Date.now();
		const durationMs = endMs - this.phaseStartMs;

		this.append(logLine("phase_end", {
			phase: this.currentPhaseName,
			durationMs,
			success: true,
			...(stats ? { stats } : {}),
		}));

		// 更新 .json 摘要中的 phase
		const phase = this.phases[this.phases.length - 1];
		if (phase) {
			phase.completedAt = new Date(endMs).toISOString();
			phase.durationMs = durationMs;
			phase.success = true;
			if (stats) phase.stats = stats;
		}

		this.currentPhaseName = null;
	}

	failPhase(error: string): void {
		if (!this.currentPhaseName) return;
		const endMs = Date.now();
		const durationMs = endMs - this.phaseStartMs;

		this.append(logLine("phase_end", {
			phase: this.currentPhaseName,
			durationMs,
			success: false,
			error,
		}));

		const phase = this.phases[this.phases.length - 1];
		if (phase) {
			phase.completedAt = new Date(endMs).toISOString();
			phase.durationMs = durationMs;
			phase.success = false;
			phase.error = error;
		}

		this.currentPhaseName = null;
	}

	recordLlmCall(call: Omit<LlmCallTrace, "phase">): void {
		const phase = this.currentPhaseName || "unknown";
		this.append(logLine("llm_call", { phase, ...call }));

		// 记入 .json 摘要
		if (this.currentPhaseName) {
			const currentPhase = this.phases[this.phases.length - 1];
			if (currentPhase) {
				currentPhase.llmCalls.push({ ...call, phase });
			}
		} else {
			this.orphanLlmCalls.push({ ...call, phase });
		}
	}

	recordEmbedCall(call: { model: string; durationMs: number; inputTokens?: number; batchSize: number }): void {
		const phase = this.currentPhaseName || "unknown";
		this.append(logLine("embed_call", { phase, ...call }));
	}

	setTitle(title: string): void {
		this.title = title;
	}

	recordPathDecision(decision: PathDecision): void {
		this.pathDecisions.push(decision);
		this.append(logLine("path_decision", { ...decision }));
	}

	save(): void {
		// 追加日志模式不需要显式 save，每次调用都已写入
	}

	finalize(success: boolean, error?: string): void {
		// 关闭未完成的 phase
		if (this.currentPhaseName) {
			this.failPhase("phase interrupted");
		}

		const endMs = Date.now();
		const totalDurationMs = endMs - this.traceStartMs;

		// 追加 index_end 行
		this.append(logLine("index_end", {
			success,
			error,
			totalDurationMs,
		}));

		// 聚合 llm_summary
		const summary = {
			totalCalls: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalDurationMs: 0,
			byModel: {} as Record<string, { calls: number; inputTokens: number; outputTokens: number }>,
		};

		for (const phase of this.phases) {
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

		// 聚合不在任何 phase 内的 llm_call
		for (const call of this.orphanLlmCalls) {
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

		this.append(logLine("llm_summary", { ...summary }));

		// 写兼容 .json 摘要
		const jsonTrace: IndexTrace = {
			bookId: this.bookId,
			title: this.title,
			filePath: this.filePath,
			fileType: this.fileType,
			startedAt: new Date(this.traceStartMs).toISOString(),
			completedAt: new Date(endMs).toISOString(),
			totalDurationMs,
			success,
			error,
			config: this.config,
			phases: this.phases,
			pathDecisions: this.pathDecisions,
			llmSummary: summary,
		};

		const dir = path.dirname(this.jsonPath);
		fs.mkdir(dir, { recursive: true })
			.then(() => fs.writeFile(this.jsonPath, JSON.stringify(jsonTrace, null, 2), "utf-8"))
		.catch((e) => { apiLog.error("[IndexTracer] json write failed:", e); });
	}
}

/** 空操作 tracer，INDEX_TRACE_ENABLED=false 时使用 */
export class NoopIndexTracer {
	startPhase(_name: string): void {}
	endPhase(_stats?: Record<string, number | string>): void {}
	failPhase(_error: string): void {}
	recordLlmCall(_call: Omit<LlmCallTrace, "phase">): void {}
	recordEmbedCall(_call: { model: string; durationMs: number; inputTokens?: number; batchSize: number }): void {}
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
