import { vi, describe, it, expect, beforeEach } from "vitest";
import { cleanTocTitles } from "@/pageindex/core/toc-cleaner";
import { chatGPTWithUsage } from "@/pageindex/llm/client";
import type { TreeNode } from "@/pageindex/core/types";

vi.mock("@/pageindex/llm/client", () => {
  return {
    chatGPTWithUsage: vi.fn(),
  };
});

describe("TOC Cleaner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip cleaning if the TOC is healthy (not broken)", async () => {
    const structure: TreeNode[] = [
      { title: "Chapter 1", nodeId: "0001", text: "Text of chapter 1" },
      { title: "Chapter 2", nodeId: "0002", text: "Text of chapter 2" },
      { title: "Chapter 3", nodeId: "0003", text: "Text of chapter 3" },
    ];

    const { structure: cleanedStructure, result } = await cleanTocTitles(structure, {
      bookTitle: "Test Book",
      model: "test-model",
    });

    expect(chatGPTWithUsage).not.toHaveBeenCalled();
    expect(result.quality).toBe("good");
    expect(result.cleanedCount).toBe(0);
    expect(cleanedStructure[0].title).toBe("Chapter 1");
  });

  it("should clean broken layer using LLM if duplicate ratio is high", async () => {
    const structure: TreeNode[] = [
      { title: "Intro", nodeId: "0001", text: "In this introduction we learn chemistry..." },
      { title: "Intro", nodeId: "0002", text: "Here we discuss organic reactions..." },
      { title: "Intro", nodeId: "0003", text: "Finally we conclude our chemical study..." },
    ];

    vi.mocked(chatGPTWithUsage).mockResolvedValue({
      content: JSON.stringify([
        { nodeId: "0001", inferred_title: "Chapter 1: Basics", confidence: 0.9 },
        { nodeId: "0002", inferred_title: "Chapter 2: Organic Chemistry", confidence: 0.8 },
        { nodeId: "0003", inferred_title: "Chapter 3: Conclusion", confidence: 0.9 },
      ]),
      finishReason: "finished",
    });

    const { structure: cleanedStructure, result } = await cleanTocTitles(structure, {
      bookTitle: "Chemistry Book",
      model: "test-model",
    });

    expect(chatGPTWithUsage).toHaveBeenCalledTimes(1);
    expect(result.quality).toBe("good");
    expect(result.cleanedCount).toBe(3);
    expect(cleanedStructure[0].title).toBe("Chapter 1: Basics");
    expect(cleanedStructure[1].title).toBe("Chapter 2: Organic Chemistry");
    expect(cleanedStructure[2].title).toBe("Chapter 3: Conclusion");
  });

  it("should keep original title if LLM confidence is below 0.7", async () => {
    const structure: TreeNode[] = [
      { title: "Intro", nodeId: "0001", text: "In this introduction we learn chemistry..." },
      { title: "Intro", nodeId: "0002", text: "Here we discuss organic reactions..." },
      { title: "Intro", nodeId: "0003", text: "Finally we conclude our chemical study..." },
    ];

    vi.mocked(chatGPTWithUsage).mockResolvedValue({
      content: JSON.stringify([
        { nodeId: "0001", inferred_title: "Chapter 1: Low Confidence Title", confidence: 0.5 },
        { nodeId: "0002", inferred_title: "Chapter 2: Good Title", confidence: 0.85 },
        { nodeId: "0003", inferred_title: "Chapter 3: Good Conclusion", confidence: 0.9 },
      ]),
      finishReason: "finished",
    });

    const { structure: cleanedStructure, result } = await cleanTocTitles(structure, {
      bookTitle: "Chemistry Book",
      model: "test-model",
    });

    expect(result.quality).toBe("degraded");
    expect(result.cleanedCount).toBe(2);
    expect(result.preservedCount).toBe(1);
    expect(cleanedStructure[0].title).toBe("Intro"); // preserved
    expect(cleanedStructure[1].title).toBe("Chapter 2: Good Title"); // cleaned
  });

  it("should fail gracefully and set quality to degraded if LLM throws an error", async () => {
    const structure: TreeNode[] = [
      { title: "Intro", nodeId: "0001", text: "Chemistry is the study of matter..." },
      { title: "Intro", nodeId: "0002", text: "Organic reactions involve carbon..." },
      { title: "Intro", nodeId: "0003", text: "We summarize all findings..." },
    ];

    vi.mocked(chatGPTWithUsage).mockRejectedValue(new Error("API Timeout"));

    const { structure: cleanedStructure, result } = await cleanTocTitles(structure, {
      bookTitle: "Chemistry Book",
      model: "test-model",
    });

    expect(result.quality).toBe("degraded");
    expect(result.preservedCount).toBe(3);
    expect(cleanedStructure[0].title).toBe("Intro"); // unchanged
  });

  it("should run batch subtitle extraction when entire layer is book name placeholders", async () => {
    const structure: TreeNode[] = [
      { title: "Chemistry Book", nodeId: "0001", text: "First chapter opens with the history of atomic theory..." },
      { title: "Chemistry Book", nodeId: "0002", text: "Second chapter goes deep into the periodic table of elements..." },
    ];

    vi.mocked(chatGPTWithUsage).mockResolvedValue({
      content: JSON.stringify([
        { nodeId: "0001", subtitle: "Atomic Theory" },
        { nodeId: "0002", subtitle: "Periodic Table" },
      ]),
      finishReason: "finished",
    });

    const { structure: cleanedStructure, result } = await cleanTocTitles(structure, {
      bookTitle: "Chemistry Book",
      model: "test-model",
    });

    expect(chatGPTWithUsage).toHaveBeenCalledTimes(1);
    expect(result.quality).toBe("poor");
    expect(result.fallbackCount).toBe(2);
    expect(cleanedStructure[0].title).toBe("Chapter 1: Atomic Theory");
    expect(cleanedStructure[1].title).toBe("Chapter 2: Periodic Table");
  });
});
