import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import {
  SearchTracer,
  NoopSearchTracer,
  createSearchTracer,
  isSearchTracer,
} from "@/pageindex/search-tracer";

const TEST_DIR = "/tmp/deepreader-search-tracer-test";

const defaultConfig = {
  recallK: 30,
  topK: 5,
  hasEmbedding: true,
  hasReranker: false,
  hasScope: false,
};

/** 刷新 microtask 队列，让 fire-and-forget 的 fs 写入落地 */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe("SearchTracer", () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("records stages and computes durations", async () => {
    const tracer = new SearchTracer("test query", "book123", defaultConfig, TEST_DIR);

    tracer.startStage("recall_config");
    await new Promise((resolve) => setTimeout(resolve, 5));
    tracer.endStage("success", { recallK: 30 });

    tracer.finalize(true);

    const trace = tracer.getTrace();
    expect(trace.query).toBe("test query");
    expect(trace.bookId).toBe("book123");
    expect(trace.success).toBe(true);
    expect(trace.stages).toHaveLength(1);
    expect(trace.stages[0].name).toBe("recall_config");
    expect(trace.stages[0].status).toBe("success");
    expect(trace.stages[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("records interrupted stage on finalize", () => {
    const tracer = new SearchTracer("test query", "book123", defaultConfig, TEST_DIR);

    tracer.startStage("parallel_recall");
    tracer.finalize(true);

    const trace = tracer.getTrace();
    expect(trace.stages).toHaveLength(1);
    expect(trace.stages[0].status).toBe("failure");
    expect(trace.stages[0].details).toEqual({ reason: "interrupted" });
  });

  it("records signals and score stats", () => {
    const tracer = new SearchTracer("test query", "book123", defaultConfig, TEST_DIR);

    tracer.recordSignals({ bm25Recalled: 10, vectorRecalled: 8 });
    tracer.recordScoreStats("bm25", [0.1, 0.5, 0.9]);
    tracer.recordScoreStats("vector", []);
    tracer.finalize(true);

    const trace = tracer.getTrace();
    expect(trace.signals.bm25Recalled).toBe(10);
    expect(trace.signals.vectorRecalled).toBe(8);
    expect(trace.scoreStats?.bm25).toEqual({
      min: 0.1,
      max: 0.9,
      mean: 0.5,
      count: 3,
    });
    expect(trace.scoreStats?.vector).toBeUndefined();
  });

  it("records weights and top results", () => {
    const tracer = new SearchTracer("test query", "book123", defaultConfig, TEST_DIR);

    tracer.recordWeights({ vector: 0.7, bm25: 0.3, proposition: 0 });
    tracer.recordTopResults([
      {
        nodeId: "n1",
        title: "Chapter 1",
        fusedScore: 0.9,
        bm25Score: 0.8,
        vectorScore: 0.85,
        propositionScore: 0,
        levelWeight: 0.9,
      },
    ]);
    tracer.finalize(true);

    const trace = tracer.getTrace();
    expect(trace.weights).toEqual({ vector: 0.7, bm25: 0.3, proposition: 0 });
    expect(trace.topResults).toHaveLength(1);
    expect(trace.topResults[0].nodeId).toBe("n1");
  });

  it("updates config via updateConfig", () => {
    const tracer = new SearchTracer("test query", "book123", defaultConfig, TEST_DIR);
    tracer.updateConfig({ recallK: 50 });
    tracer.finalize(true);

    const trace = tracer.getTrace();
    expect(trace.config.recallK).toBe(50);
  });

  it("writes trace file to disk", async () => {
    const tracer = new SearchTracer("test query", "book123", defaultConfig, TEST_DIR);
    tracer.finalize(true);
    await flush();

    const traceDir = path.join(TEST_DIR, ".obsidian", "plugins", "deepreader", "pageindex", "search-traces");
    const entries = await fs.readdir(traceDir);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const content = await fs.readFile(path.join(traceDir, entries[0]), "utf-8");
    const trace = JSON.parse(content);
    expect(trace.query).toBe("test query");
    expect(trace.bookId).toBe("book123");
    expect(trace.success).toBe(true);
  });

  it("ignores duplicate finalize", () => {
    const tracer = new SearchTracer('q', 'b', defaultConfig, TEST_DIR);
    tracer.finalize(true);
    tracer.finalize(true); // 第二次应被忽略
    expect(tracer.getTrace().success).toBe(true);
  });

  it("silently ignores endStage without startStage", () => {
    const tracer = new SearchTracer('q', 'b', defaultConfig, TEST_DIR);
    tracer.endStage('success'); // 不应抛异常
    tracer.finalize(true);
    expect(tracer.getTrace().stages).toHaveLength(0);
  });

  it("returns partial trace before finalize", () => {
    const tracer = new SearchTracer('q', 'b', defaultConfig, TEST_DIR);
    const trace = tracer.getTrace();
    expect(trace.success).toBe(false);
    expect(trace.completedAt).toBeUndefined();
  });

  it("auto-closes open stage on finalize", () => {
    const tracer = new SearchTracer('q', 'b', defaultConfig, TEST_DIR);
    tracer.startStage('s1');
    tracer.finalize(true);
    const trace = tracer.getTrace();
    expect(trace.stages).toHaveLength(1);
    expect(trace.stages[0].status).toBe('failure');
    expect(trace.stages[0].details).toEqual({ reason: 'interrupted' });
  });

  it("does not set bm25 entry for empty arrays", () => {
    const tracer = new SearchTracer('q', 'b', defaultConfig, TEST_DIR);
    tracer.recordScoreStats('bm25', []);
    tracer.finalize(true);
    expect(tracer.getTrace().scoreStats?.bm25).toBeUndefined();
  });

  it("computes stats for single element", () => {
    const tracer = new SearchTracer('q', 'b', defaultConfig, TEST_DIR);
    tracer.recordScoreStats('bm25', [0.5]);
    tracer.finalize(true);
    expect(tracer.getTrace().scoreStats?.bm25).toEqual({
      min: 0.5, max: 0.5, mean: 0.5, count: 1
    });
  });
});

describe("NoopSearchTracer", () => {
  it("does nothing", () => {
    const tracer = new NoopSearchTracer();
    tracer.startStage("stage");
    tracer.recordSignals({ bm25Recalled: 1 });
    tracer.recordScoreStats("bm25", [1, 2, 3]);
    tracer.recordWeights({ vector: 0.5, bm25: 0.5, proposition: 0 });
    tracer.recordTopResults([]);
    tracer.updateConfig({ recallK: 99 });
    tracer.finalize(true);
    expect(isSearchTracer(tracer)).toBe(false);
    expect(() => tracer.getTrace()).toThrow();
  });
});

describe("createSearchTracer", () => {
  it("returns SearchTracer when SEARCH_TRACE_ENABLED is true", () => {
    const tracer = createSearchTracer("q", "book", defaultConfig, TEST_DIR);
    expect(isSearchTracer(tracer)).toBe(true);
  });
});
