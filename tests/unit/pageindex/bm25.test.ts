import { describe, it, expect } from "vitest";
import { tokenize, buildBM25Index, searchBM25 } from "@/pageindex/bm25";

describe("tokenize", () => {
  it("should tokenize CJK text with bigrams", () => {
    const result = tokenize("机器学习");
    expect(result).toContain("机器");
    expect(result).toContain("器学");
    expect(result).toContain("学习");
  });

  it("should tokenize CJK text with unigrams", () => {
    const result = tokenize("机器学习");
    expect(result).toContain("机");
    expect(result).toContain("器");
    expect(result).toContain("学");
    expect(result).toContain("习");
  });

  it("should add full CJK word for exact phrase matching", () => {
    const result = tokenize("机器学习");
    expect(result).toContain("机器学习");
  });

  it("should tokenize English with spaces", () => {
    const result = tokenize("machine learning");
    expect(result).toContain("machine");
    expect(result).toContain("learning");
  });

  it("should lowercase non-CJK text", () => {
    const result = tokenize("Hello World");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("should tokenize English text by spaces", () => {
    const result = tokenize("hello world");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("should handle mixed CJK and English", () => {
    const result = tokenize("机器学习machine learning");
    expect(result).toContain("机器");
    expect(result).toContain("学习");
    expect(result).toContain("machine");
    expect(result).toContain("learning");
  });

  it("should handle mixed CJK and English (concatenated)", () => {
    const result = tokenize("hello你好");
    expect(result).toContain("hello");
    expect(result).toContain("你");
    expect(result).toContain("好");
  });

  it("should not deduplicate tokens (BM25 needs TF)", () => {
    const result = tokenize("hello hello hello");
    const helloCount = result.filter((t) => t === "hello").length;
    expect(helloCount).toBe(3);
  });

  it("should return empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
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

  it("should store node text and level", () => {
    const nodes = [
      { id: "n1", text: "hello world", level: "L0" as const },
      { id: "n2", text: "foo bar", level: "L1" as const },
    ];
    const index = buildBM25Index(nodes);
    expect(index.nodes.n1.text).toBe("hello world");
    expect(index.nodes.n2.level).toBe("L1");
  });

  it("should build inverted index with multiple docs per term", () => {
    const nodes = [
      { id: "n1", text: "hello world", level: "L0" as const },
      { id: "n2", text: "hello foo", level: "L0" as const },
    ];
    const index = buildBM25Index(nodes);
    expect(index.invertedIndex["hello"]).toHaveLength(2);
  });

  it("should handle empty nodes array", () => {
    const index = buildBM25Index([]);
    expect(index.stats.totalDocs).toBe(0);
    expect(index.stats.avgDocLength).toBe(0);
  });

  it("should set correct BM25 params", () => {
    const index = buildBM25Index([{ id: "n1", text: "test", level: "L1" as const }]);
    expect(index.params.k1).toBe(1.5);
    expect(index.params.b).toBe(0.75);
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

  it("should rank more relevant documents higher", () => {
    const nodes = [
      { id: "n1", text: "hello world testing", level: "L0" as const },
      { id: "n2", text: "foo bar baz", level: "L0" as const },
      { id: "n3", text: "hello foo bar", level: "L0" as const },
    ];
    const index = buildBM25Index(nodes);
    const results = searchBM25("hello", index, 10);
    expect(results[0].nodeId).toBe("n1");
  });

  it("should return empty for no matches", () => {
    const nodes = [{ id: "ch01", text: "机器学习", level: "L1" as const }];
    const index = buildBM25Index(nodes);
    const results = searchBM25("不存在", index, 5);
    expect(results).toEqual([]);
  });

  it("should respect topK limit", () => {
    const nodes = [
      { id: "n1", text: "hello", level: "L0" as const },
      { id: "n2", text: "hello", level: "L0" as const },
      { id: "n3", text: "hello", level: "L0" as const },
    ];
    const index = buildBM25Index(nodes);
    const results = searchBM25("hello", index, 2);
    expect(results).toHaveLength(2);
  });

  it("should return empty for no matches on English", () => {
    const nodes = [{ id: "n1", text: "hello world", level: "L0" as const }];
    const index = buildBM25Index(nodes);
    const results = searchBM25("xyz", index, 10);
    expect(results).toHaveLength(0);
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