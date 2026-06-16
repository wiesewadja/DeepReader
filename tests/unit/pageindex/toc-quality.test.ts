import { describe, it, expect } from "vitest";
import {
  isTruncated,
  isAbnormallyLong,
  isBookNamePlaceholder,
  flattenStructure,
  assessByLevel,
} from "@/pageindex/core/toc-quality";
import type { TreeNode } from "@/pageindex/core/types";

describe("TOC Quality Helpers", () => {
  describe("isTruncated", () => {
    it("should return true if title ends with ellipsis", () => {
      expect(isTruncated("Chapter 1: Intro...")).toBe(true);
      expect(isTruncated("第一章：引言…")).toBe(true);
    });

    it("should return false if title does not end with ellipsis", () => {
      expect(isTruncated("Chapter 1: Introduction")).toBe(false);
      expect(isTruncated("第一章：引言")).toBe(false);
    });
  });

  describe("isAbnormallyLong", () => {
    it("should return true if Chinese title exceeds 50 characters", () => {
      const longChinese = "这包含中文字符因此会被识别为中文标题，接下来我们将让它的长度超过五十个字以测试其是否会被标记为过长。这包含中文字符因此会被识别为中文标题，接下来我们将让它的长度超过五十个字以测试其是否会被标记为过长。";
      expect(isAbnormallyLong(longChinese)).toBe(true);
    });

    it("should return false if Chinese title is under 50 characters", () => {
      expect(isAbnormallyLong("第一章 这是一个很短的中文标题")).toBe(false);
    });

    it("should return true if English title exceeds 100 characters", () => {
      const longEnglish = "This is a very long English title that definitely exceeds one hundred characters for the purpose of checking the overflow limit rule. This is a very long English title that definitely exceeds one hundred characters for the purpose of checking the overflow limit rule.";
      expect(isAbnormallyLong(longEnglish)).toBe(true);
    });

    it("should return false if English title is under 100 characters", () => {
      expect(isAbnormallyLong("Chapter 1: Normal English Title")).toBe(false);
    });
  });

  describe("isBookNamePlaceholder", () => {
    it("should return true if normalized title matches book title exactly", () => {
      expect(isBookNamePlaceholder("Self-Reliance", "Self-Reliance")).toBe(true);
      expect(isBookNamePlaceholder(" self-reliance ", "Self-Reliance")).toBe(true);
      expect(isBookNamePlaceholder("Self-Reliance!", "Self-Reliance")).toBe(true);
    });

    it("should return false if they do not match exactly", () => {
      expect(isBookNamePlaceholder("Chapter 1: Self-Reliance", "Self-Reliance")).toBe(false);
    });
  });
});

describe("TOC Quality Tree Flattening", () => {
  it("should correctly flatten nested TreeNode structures", () => {
    const structure: TreeNode[] = [
      {
        title: "Part 1",
        nodeId: "0001",
        text: "Part 1 text",
        nodes: [
          {
            title: "Chapter 1",
            nodeId: "0002",
            text: "Chapter 1 text",
            nodes: [
              {
                title: "Section 1.1",
                nodeId: "0003",
                text: "Section 1.1 text",
              },
            ],
          },
        ],
      },
      {
        title: "Part 2",
        nodeId: "0004",
        text: "Part 2 text",
      },
    ];

    const flattened = flattenStructure(structure, "Test Book");

    expect(flattened.length).toBe(4);

    // Verify Part 1
    const p1 = flattened.find((n) => n.nodeId === "0001");
    expect(p1).toBeDefined();
    expect(p1!.level).toBe(0);
    expect(p1!.parentTitle).toBeUndefined();
    expect(p1!.siblingTitles).toContain("Part 2");
    expect(p1!.childTitles).toContain("Chapter 1");
    expect(p1!.path).toEqual([0]);

    // Verify Chapter 1
    const c1 = flattened.find((n) => n.nodeId === "0002");
    expect(c1).toBeDefined();
    expect(c1!.level).toBe(1);
    expect(c1!.parentTitle).toBe("Part 1");
    expect(c1!.childTitles).toContain("Section 1.1");
    expect(c1!.path).toEqual([0, 0]);

    // Verify Section 1.1
    const s1 = flattened.find((n) => n.nodeId === "0003");
    expect(s1).toBeDefined();
    expect(s1!.level).toBe(2);
    expect(s1!.parentTitle).toBe("Chapter 1");
    expect(s1!.path).toEqual([0, 0, 0]);
  });
});

describe("TOC Quality Assessment", () => {
  it("should flag a layer as broken if duplicate ratio exceeds 0.3", () => {
    const structure: TreeNode[] = [
      { title: "Intro", nodeId: "0001" },
      { title: "Intro", nodeId: "0002" },
      { title: "Intro", nodeId: "0003" }, // 3 duplicates out of 6 nodes -> ratio 0.5
      { title: "Chapter 1", nodeId: "0004" },
      { title: "Chapter 2", nodeId: "0005" },
      { title: "Chapter 3", nodeId: "0006" },
    ];

    const flattened = flattenStructure(structure, "Test Book");
    const qualities = assessByLevel(flattened, "Test Book");

    expect(qualities.length).toBe(1);
    expect(qualities[0].level).toBe(0);
    expect(qualities[0].duplicateCount).toBe(3);
    expect(qualities[0].isBroken).toBe(true);
    expect(qualities[0].reason).toBe("duplicates");
  });

  it("should flag a layer as broken if truncation/overflow ratio exceeds 0.3", () => {
    const structure: TreeNode[] = [
      { title: "Chapter 1...", nodeId: "0001" }, // truncated
      { title: "Chapter 2...", nodeId: "0002" }, // truncated
      { title: "Chapter 3", nodeId: "0003" },
      { title: "Chapter 4", nodeId: "0004" },
      { title: "Chapter 5", nodeId: "0005" }, // 2 out of 5 -> ratio 0.4
    ];

    const flattened = flattenStructure(structure, "Test Book");
    const qualities = assessByLevel(flattened, "Test Book");

    expect(qualities[0].truncatedCount).toBe(2);
    expect(qualities[0].isBroken).toBe(true);
    expect(qualities[0].reason).toBe("truncations");
  });

  it("should flag a layer as broken if book name placeholder ratio exceeds 0.3", () => {
    const structure: TreeNode[] = [
      { title: "Test Book", nodeId: "0001" }, // placeholder
      { title: "test book", nodeId: "0002" }, // placeholder
      { title: "Chapter 1", nodeId: "0003" },
      { title: "Chapter 2", nodeId: "0004" },
      { title: "Chapter 3", nodeId: "0005" }, // 2 out of 5 -> ratio 0.4
    ];

    const flattened = flattenStructure(structure, "Test Book");
    const qualities = assessByLevel(flattened, "Test Book");

    expect(qualities[0].bookNamePlaceholderCount).toBe(2);
    expect(qualities[0].isBroken).toBe(true);
    expect(qualities[0].reason).toBe("placeholders");
  });

  it("should not flag a layer as broken if ratios are below 0.3", () => {
    const structure: TreeNode[] = [
      { title: "Chapter 1...", nodeId: "0001" }, // truncated
      { title: "Chapter 2", nodeId: "0002" },
      { title: "Chapter 3", nodeId: "0003" },
      { title: "Chapter 4", nodeId: "0004" },
      { title: "Chapter 5", nodeId: "0005" },
      { title: "Chapter 6", nodeId: "0006" }, // 1 out of 6 -> ratio 0.16
    ];

    const flattened = flattenStructure(structure, "Test Book");
    const qualities = assessByLevel(flattened, "Test Book");

    expect(qualities[0].isBroken).toBe(false);
    expect(qualities[0].reason).toBe("ok");
  });
});
