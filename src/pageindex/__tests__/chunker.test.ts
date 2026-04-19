import { describe, it, expect } from "vitest";
import { splitByBlockIds, mergeToChunks, classifyType } from "../chunker.js";

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
