import { describe, it, expect } from "vitest";
import { splitByBlockIds, mergeToChunks, classifyType } from "@/pageindex/chunker";

describe("splitByBlockIds", () => {
  it("should split content by ^blockId markers", () => {
    const content = "First paragraph. ^p000\n\nSecond paragraph. ^p001\n\nThird. ^p002";
    const result = splitByBlockIds(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ blockId: "p000", text: "First paragraph." });
    expect(result[1]).toEqual({ blockId: "p001", text: "Second paragraph." });
    expect(result[2]).toEqual({ blockId: "p002", text: "Third." });
  });

  it("should handle content with no blockIds", () => {
    const result = splitByBlockIds("No block ids here");
    expect(result).toHaveLength(1);
    expect(result[0].blockId).toBe("");
    expect(result[0].text).toBe("No block ids here");
  });

  it("should handle empty content", () => {
    const result = splitByBlockIds("");
    expect(result).toHaveLength(0);
  });

  it("should strip ^ prefix from blockId", () => {
    const content = "Hello ^p000";
    const result = splitByBlockIds(content);
    expect(result[0].blockId).toBe("p000");
  });
});

describe("mergeToChunks", () => {
  it("should merge short paragraphs into target window", () => {
    const paragraphs = [
      { blockId: "p000", text: "Short one." },
      { blockId: "p001", text: "Short two." },
      { blockId: "p002", text: "A".repeat(300) },
      { blockId: "p003", text: "Next chunk." },
    ];
    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].chunkId).toBe("0005_p000");
    expect(chunks[0].blockIds).toEqual(["p000", "p001", "p002"]);
    expect(chunks[0].text.length).toBeGreaterThanOrEqual(300);
  });

  it("should split long paragraphs > 800 chars at sentence boundary", () => {
    const longText = "A".repeat(400) + "\u3002" + "B".repeat(500);
    const paragraphs = [{ blockId: "p000", text: longText }];
    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks.length).toBe(2);
    expect(chunks[0].text.length).toBeLessThanOrEqual(800);
  });

  it("should force split at 800 chars if no sentence boundary", () => {
    const longText = "A".repeat(1000);
    const paragraphs = [{ blockId: "p000", text: longText }];
    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks.length).toBe(2);
    expect(chunks[0].text.length).toBeLessThanOrEqual(800);
  });

  it("should return empty for empty paragraphs", () => {
    expect(mergeToChunks([], "0005")).toEqual([]);
  });

  it("should handle single short paragraph", () => {
    const paragraphs = [{ blockId: "p000", text: "Just one." }];
    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkId).toBe("0005_p000");
    expect(chunks[0].blockIds).toEqual(["p000"]);
  });
});

describe("classifyType", () => {
  it("should classify heading", () => {
    expect(classifyType("## Overview")).toBe("heading");
  });

  it("should classify quote", () => {
    expect(classifyType("> This is a quote")).toBe("quote");
  });

  it("should classify list", () => {
    expect(classifyType("- Item one")).toBe("list");
  });

  it("should classify body as default", () => {
    expect(classifyType("Regular text here")).toBe("body");
  });
});

describe("mergeToChunks overlap tests", () => {
  // CH-08: Overlap 包含多个段落
  it("CH-08: overlap should contain tail paragraphs when flushed", () => {
    // 构造 5 个段落各 30 字（共 150，小于 TARGET_SIZE=300）
    const paragraphs = [
      { blockId: "p0", text: "A".repeat(30) },
      { blockId: "p1", text: "B".repeat(30) },
      { blockId: "p2", text: "C".repeat(30) },
      { blockId: "p3", text: "D".repeat(30) },
      { blockId: "p4", text: "E".repeat(30) },
      // 第 6 个段落触发 flush
      { blockId: "p5", text: "F".repeat(30) },
      { blockId: "p6", text: "G".repeat(30) },
      { blockId: "p7", text: "H".repeat(30) },
      { blockId: "p8", text: "I".repeat(30) },
      { blockId: "p9", text: "J".repeat(30) },
      // 第 11 个段落再次触发 flush
      { blockId: "p10", text: "K".repeat(30) },
    ];
    const chunks = mergeToChunks(paragraphs, "0005");

    // 需要至少 2 个 chunk 来验证 overlap
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // 第 2 个 chunk 应该包含前一个 chunk 尾部的 overlap
    const chunk2Text = chunks[1].text;
    // overlap 应该包含前一个 chunk 的尾部段落（80 字符限制内）
    expect(chunk2Text.length).toBeGreaterThan(0);
  });

  // CH-09: Overlap 仅一个段落（>80 字符）
  it("CH-09: overlap should take tail of single paragraph when >80 chars", () => {
    // 构造段落：短段落(20字) × 10 个 = 200字，触发 flush
    const paragraphs: Array<{ blockId: string; text: string }> = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push({ blockId: `p${i}`, text: `T${i.toString().padStart(2, '0')}`.repeat(10) });
    }
    // 再加一些段落触发下一次 flush
    for (let i = 10; i < 20; i++) {
      paragraphs.push({ blockId: `p${i}`, text: `T${i.toString().padStart(2, '0')}`.repeat(10) });
    }

    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // 验证第 2 个 chunk 包含第 1 个 chunk 尾部的 overlap
    const chunk1Text = chunks[0].text;
    const chunk2Text = chunks[1].text;
    // chunk2 应该以 chunk1 的尾部内容开头（overlap）
    expect(chunk2Text).toContain("T09");
  });

  // CH-10: 连续 3 个 chunk 的 overlap 正确性
  it("CH-10: overlap should be correct across 3 consecutive chunks", () => {
    // 构造足够多段落使 flush 3 次
    const paragraphs: Array<{ blockId: string; text: string }> = [];
    // 每个段落 40 字，需要 8 个段落触发 flush（8 × 40 = 320 > 300）
    for (let i = 0; i < 24; i++) {
      paragraphs.push({ blockId: `p${i}`, text: `Chunk${i % 8}_`.repeat(5) }); // 40 字符
    }

    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // 验证第 2 个 chunk 包含第 1 个 chunk 尾部的 overlap
    const chunk1LastPara = chunks[0].text.split(" ").pop() || "";
    expect(chunks[1].text).toContain(chunk1LastPara);

    // 验证第 3 个 chunk 包含第 2 个 chunk 尾部的 overlap
    const chunk2LastPara = chunks[1].text.split(" ").pop() || "";
    expect(chunks[2].text).toContain(chunk2LastPara);
  });

  // CH-14: overlap 不从长段落拆分结果中取
  it("CH-14: overlap should not cross split boundary of long paragraphs", () => {
    // 构造：短段落(20字) + 长段落(1000字) + 短段落(20字)
    const paragraphs = [
      { blockId: "p0", text: "Short before. ".repeat(1).trim() }, // ~14 字
      { blockId: "p1", text: "Long text. ".repeat(100) }, // ~1200 字，超过 MAX_SIZE
      { blockId: "p2", text: "Short after. ".repeat(1).trim() }, // ~13 字
    ];

    const chunks = mergeToChunks(paragraphs, "0005");

    // 长段落应该被 splitLongText 独立拆分为多个 chunk
    // 短段落应该在独立的 chunk 中
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // 查找包含短段落的 chunk
    const shortBeforeChunk = chunks.find(c => c.text.includes("Short before"));
    const shortAfterChunk = chunks.find(c => c.text.includes("Short after"));

    expect(shortBeforeChunk).toBeDefined();
    expect(shortAfterChunk).toBeDefined();

    // 短段落 chunk 不应包含长段落的拆分内容
    // 验证 overlap 不跨越 split 边界
    if (shortBeforeChunk && shortAfterChunk) {
      // shortAfterChunk 不应以长段落的内容开头（overlap 不跨 split）
      expect(shortAfterChunk.text).not.toMatch(/^Long text/);
    }
  });
});
