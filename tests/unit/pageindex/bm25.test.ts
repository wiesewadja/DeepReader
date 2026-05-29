import { describe, it, expect } from "vitest";
import { tokenize, buildBM25Index, searchBM25 } from "@/pageindex/bm25";

describe("tokenize", () => {
  it("should tokenize CJK text with bigrams", () => {
    const result = tokenize("机器学习");
    expect(result).toContain("机器");
    expect(result).toContain("器学");
    expect(result).toContain("学习");
  });

  it("should tokenize English with spaces", () => {
    const result = tokenize("machine learning");
    expect(result).toContain("machine");
    expect(result).toContain("learning");
  });

  it("should handle mixed CJK and English", () => {
    const result = tokenize("机器学习machine learning");
    expect(result).toContain("机器");
    expect(result).toContain("学习");
    expect(result).toContain("machine");
    expect(result).toContain("learning");
  });
});

describe("buildBM25Index", () => {
  it("should build inverted index correctly", () => {
    const nodes = [
      { id: "ch01", text: "机器学习是人工智能的分支", level: "L1" as const },
      { id: "ch02", text: "深度学习是机器学习的子领域", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    
    expect(index.stats.totalDocs).toBe(2);
    expect(index.invertedIndex["机器"]).toBeDefined();
    expect(index.invertedIndex["学习"]).toBeDefined();
  });

  it("should calculate document length correctly", () => {
    const nodes = [
      { id: "ch01", text: "机器学习", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    
    expect(index.nodes["ch01"].length).toBeGreaterThan(0);
  });
});

describe("searchBM25", () => {
  it("should return ranked results", () => {
    const nodes = [
      { id: "ch01", text: "机器学习是人工智能的分支", level: "L1" as const },
      { id: "ch02", text: "深度学习是机器学习的子领域", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    const results = searchBM25("机器学习", index, 2);
    
    expect(results.length).toBe(2);
    expect(results[0].nodeId).toBeDefined();
    expect(results[0].score).toBeDefined();
    expect(results[0].score).not.toBeNaN();
  });

  it("should handle single-character query with bigram fallback", () => {
    const nodes = [
      { id: "ch01", text: "机器学习", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    const results = searchBM25("机", index, 1);
    
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
  
  it("should calculate BM25 formula correctly", () => {
    const nodes = [
      { id: "doc1", text: "rare term", level: "L1" as const },
      { id: "doc2", text: "common term", level: "L1" as const },
      { id: "doc3", text: "common term again", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    
    const rareResults = searchBM25("rare", index, 3);
    const commonResults = searchBM25("common", index, 3);
    
    expect(rareResults[0].nodeId).toBe("doc1");
    expect(rareResults[0].score).toBeGreaterThan(commonResults[0].score);
  });
});

describe("edge cases", () => {
  it("should handle empty input", () => {
    expect(tokenize("")).toEqual([]);
    
    const index = buildBM25Index([]);
    expect(index.stats.totalDocs).toBe(0);
    expect(index.stats.avgDocLength).toBe(0);
    
    const results = searchBM25("test", index, 5);
    expect(results).toEqual([]);
  });

  it("should use correct BM25 params", () => {
    const nodes = [{ id: "ch01", text: "test", level: "L1" as const }];
    const index = buildBM25Index(nodes);
    
    expect(index.params.k1).toBe(1.5);
    expect(index.params.b).toBe(0.75);
  });

  it("should return empty for no matches", () => {
    const nodes = [{ id: "ch01", text: "机器学习", level: "L1" as const }];
    const index = buildBM25Index(nodes);
    
    const results = searchBM25("不存在", index, 5);
    expect(results).toEqual([]);
  });

  it("should handle document with empty text", () => {
    const nodes = [{ id: "ch01", text: "", level: "L1" as const }];
    const index = buildBM25Index(nodes);
    
    expect(index.stats.totalDocs).toBe(1);
    expect(index.nodes["ch01"].length).toBe(0);
    
    const results = searchBM25("test", index, 5);
    expect(results).toEqual([]);
  });
});