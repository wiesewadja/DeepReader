import { describe, it, expect } from "vitest";
import { formatPropositionResults } from "../proposition-search.js";
import type { PropositionMatch, PropositionCard } from "../book-types.js";

describe("proposition-search", () => {
  describe("formatPropositionResults", () => {
    it("should format empty results", () => {
      expect(formatPropositionResults([])).toBe("");
    });

    it("should format single result", () => {
      const card: PropositionCard = {
        id: "card_1",
        type: "象征",
        answer: "玉带林中挂=林黛玉",
        context: "玉带林中挂",
        tags: ["林黛玉", "玉带", "谐音"],
        sourceNodeId: "chapter_5",
      };

      const result = formatPropositionResults([{ card, score: 0.9 }]);

      expect(result).toContain("【象征】");
      expect(result).toContain("玉带林中挂=林黛玉");
      expect(result).toContain("原文：玉带林中挂");
      expect(result).toContain("林黛玉、玉带、谐音");
    });

    it("should format multiple results with separator", () => {
      const cards: PropositionCard[] = [
        {
          id: "card_1",
          type: "象征",
          answer: "answer1",
          context: "context1",
          tags: ["tag1"],
          sourceNodeId: "node1",
        },
        {
          id: "card_2",
          type: "人物",
          answer: "answer2",
          context: "context2",
          tags: ["tag2"],
          sourceNodeId: "node2",
        },
      ];

      const result = formatPropositionResults(
        cards.map((c, i) => ({ card: c, score: 0.9 - i * 0.1 }))
      );

      expect(result).toContain("---");
      expect(result).toContain("【象征】");
      expect(result).toContain("【人物】");
    });
  });
});