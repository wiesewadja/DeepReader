import { nodeFs } from "../utils/node-fs.js";
import { nodePath } from "../utils/node-compat.js";
import { vaultWrite, joinPath } from "../utils/mobile-fs.js";
import type { App } from "obsidian";
import { apiLog } from "../utils/logger.js";
import { getPageindexDir } from "./paths.js";
import { SEARCH_TRACE_ENABLED } from "../config/features.js";

export interface SearchTrace {
	query: string;
	bookId: string;
	startedAt: string;
	completedAt?: string;
	totalDurationMs?: number;
	success: boolean;
	error?: string;
	stages: SearchStage[];
	signals: {
		bm25Recalled: number;
		vectorRecalled: number;
		propositionRecalled: number;
		scopeFiltered: number;
		scopeFallback: number;
		scopeTotal: number;
		reranked: number;
	};
	scoreStats?: {
		bm25?: ScoreStats;
		vector?: ScoreStats;
		fused?: ScoreStats;
		reranked?: ScoreStats;
	};
	weights?: {
		vector: number;
		bm25: number;
		proposition: number;
		rerank?: number;
	};
	topResults: Array<{
		nodeId: string;
		title: string;
		fusedScore: number;
		bm25Score: number;
		vectorScore: number;
		propositionScore: number;
		levelWeight: number;
	}>;
	config: {
		recallK: number;
		topK: number;
		hasEmbedding: boolean;
		hasReranker: boolean;
		hasScope: boolean;
	};
}

export interface SearchStage {
	name: string;
	durationMs: number;
	status: "success" | "failure" | "skipped";
	details?: Record<string, unknown>;
}

export interface ScoreStats {
	min: number;
	max: number;
	mean: number;
	count: number;
}

function computeStats(scores: number[]): ScoreStats | undefined {
	if (scores.length === 0) return undefined;
	const min = Math.min(...scores);
	const max = Math.max(...scores);
	const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
	return { min, max, mean, count: scores.length };
}

export class SearchTracer {
	private trace: SearchTrace;
	private currentStage: { name: string; startMs: number } | null = null;
	private stages: SearchStage[] = [];
	private startMs: number;
	private vaultPath?: string;
	private app?: App;
	private bookId: string;
	private finalized = false;

	constructor(
		query: string,
		bookId: string,
		options: SearchTrace["config"],
		vaultPath?: string,
		app?: App,
	) {
		this.bookId = bookId;
		this.vaultPath = vaultPath;
		this.app = app;
		this.startMs = Date.now();
		this.trace = {
			query,
			bookId,
			startedAt: new Date(this.startMs).toISOString(),
			success: false,
			stages: [],
			signals: {
				bm25Recalled: 0,
				vectorRecalled: 0,
				propositionRecalled: 0,
				scopeFiltered: 0,
				scopeFallback: 0,
				scopeTotal: 0,
				reranked: 0,
			},
			topResults: [],
			config: options,
		};
	}

	startStage(name: string): void {
		this.currentStage = { name, startMs: Date.now() };
	}

	endStage(status: "success" | "failure" | "skipped" = "success", details?: Record<string, unknown>): void {
		if (!this.currentStage) return;
		const durationMs = Date.now() - this.currentStage.startMs;
		this.stages.push({
			name: this.currentStage.name,
			durationMs,
			status,
			details,
		});
		this.currentStage = null;
	}

	recordSignals(signals: Partial<SearchTrace["signals"]>): void {
		Object.assign(this.trace.signals, signals);
	}

	recordScoreStats(name: "bm25" | "vector" | "fused" | "reranked", scores: number[]): void {
		if (!this.trace.scoreStats) this.trace.scoreStats = {};
		const stats = computeStats(scores);
		if (stats) this.trace.scoreStats[name] = stats;
	}

	recordWeights(weights: SearchTrace["weights"]): void {
		this.trace.weights = weights;
	}

	recordTopResults(results: SearchTrace["topResults"]): void {
		this.trace.topResults = results;
	}

	updateConfig(updates: Partial<SearchTrace["config"]>): void {
		Object.assign(this.trace.config, updates);
	}

	finalize(success: boolean, error?: string): void {
		if (this.finalized) return;
		this.finalized = true;
		const endMs = Date.now();
		if (this.currentStage) {
			this.endStage("failure", { reason: "interrupted" });
		}
		this.trace.stages = this.stages;
		this.trace.completedAt = new Date(endMs).toISOString();
		this.trace.totalDurationMs = endMs - this.startMs;
		this.trace.success = success;
		if (error) this.trace.error = error;
		this.save();
	}

	getTrace(): SearchTrace {
		return { ...this.trace };
	}

	private save(): void {
		if (!SEARCH_TRACE_ENABLED) return;
		const fileName = `${this.bookId}_${this.startMs}.json`;
		const relDir = `${getPageindexDir()}/search-traces`;
		const content = JSON.stringify(this.trace, null, 2);

		if (this.app) {
			const relPath = joinPath(relDir, fileName);
			vaultWrite(this.app, relPath, content).catch((e) => {
				apiLog.error("[SearchTracer] vaultWrite failed:", e);
			});
		} else if (this.vaultPath) {
			const path = nodePath();
			const dir = path.join(this.vaultPath, relDir);
			nodeFs()
				.mkdir(dir, { recursive: true })
				.then(() => nodeFs().writeFile(path.join(dir, fileName), content, "utf-8"))
				.catch((e) => {
					apiLog.error("[SearchTracer] fs write failed:", e);
				});
		}
	}
}

export class NoopSearchTracer {
	startStage(_name: string): void {}
	endStage(_status?: "success" | "failure" | "skipped", _details?: Record<string, unknown>): void {}
	recordSignals(_signals: Partial<SearchTrace["signals"]>): void {}
	recordScoreStats(_name: "bm25" | "vector" | "fused" | "reranked", _scores: number[]): void {}
	recordWeights(_weights: SearchTrace["weights"]): void {}
	recordTopResults(_results: SearchTrace["topResults"]): void {}
	updateConfig(_updates: Partial<SearchTrace["config"]>): void {}
	finalize(_success: boolean, _error?: string): void {}
	getTrace(): SearchTrace {
		throw new Error("NoopSearchTracer does not store trace");
	}
}

export type SearchTracerType = SearchTracer | NoopSearchTracer;

export function createSearchTracer(
	query: string,
	bookId: string,
	options: SearchTrace["config"],
	vaultPath?: string,
	app?: App,
): SearchTracerType {
	if (!SEARCH_TRACE_ENABLED) return new NoopSearchTracer();
	return new SearchTracer(query, bookId, options, vaultPath, app);
}

export function isSearchTracer(tracer: SearchTracerType): tracer is SearchTracer {
	return tracer instanceof SearchTracer;
}
