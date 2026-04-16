import { describe, it, expect } from "vitest";
import {
  calculateTargetCards,
  buildExtractionPrompt,
  parseCards,
} from "../proposition-indexer.js";

describe("proposition-indexer", () => {
  describe("calculateTargetCards", () => {
    it("should return min cards for short chapters", () => {
      expect(calculateTargetCards(100)).toBe(3);
      expect(calculateTargetCards(300)).toBe(3);
    });

    it("should return proportional cards for medium chapters", () => {
      expect(calculateTargetCards(500)).toBe(3);
      expect(calculateTargetCards(1500)).toBe(3);
      expect(calculateTargetCards(2500)).toBe(5);
    });

    it("should cap at max cards for long chapters", () => {
      expect(calculateTargetCards(10000)).toBe(15);
      expect(calculateTargetCards(50000)).toBe(15);
    });

    it("should respect custom parameters", () => {
      expect(calculateTargetCards(2500, 2, 3, 20)).toBe(10);
      expect(calculateTargetCards(200, 1, 1, 5)).toBe(1);
    });
  });

  describe("buildExtractionPrompt", () => {
    it("should include target cards in prompt", () => {
      const prompt = buildExtractionPrompt("test chapter text", 5);
      expect(prompt).toContain("提取 5 张");
      expect(prompt).toContain("test chapter text");
    });

    it("should include Few-Shot examples", () => {
      const prompt = buildExtractionPrompt("test", 3);
      expect(prompt).toContain("示例1");
      expect(prompt).toContain("示例2");
      expect(prompt).toContain("示例3");
    });

    it("should include card type definitions", () => {
      const prompt = buildExtractionPrompt("test", 3);
      expect(prompt).toContain("问题");
      expect(prompt).toContain("概念");
      expect(prompt).toContain("主旨");
      expect(prompt).toContain("象征");
    });
  });

  describe("parseCards", () => {
    it("should parse valid JSON response", () => {
      const response = `{
        "cards": [
          {
            "type": "概念",
            "answer": "美德是一种习惯",
            "context": "美德不是天生的",
            "tags": ["美德", "习惯"]
          }
        ]
      }`;

      const cards = parseCards(response, "chapter_1");

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("概念");
      expect(cards[0].answer).toBe("美德是一种习惯");
      expect(cards[0].sourceNodeId).toBe("chapter_1");
    });

    it("should strip markdown code blocks", () => {
      const response = `\`\`\`json
      {
        "cards": [
          {
            "type": "主旨",
            "answer": "测试答案",
            "context": "测试原文",
            "tags": ["测试"]
          }
        ]
      }
      \`\`\``;

      const cards = parseCards(response, "test");

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("主旨");
    });

    it("should return empty array for invalid JSON", () => {
      const response = "not valid json";
      const cards = parseCards(response, "test");
      expect(cards).toHaveLength(0);
    });

    it("should assign unique IDs", () => {
      const response = `{
        "cards": [
          { "type": "概念", "answer": "a", "context": "b", "tags": [] },
          { "type": "主旨", "answer": "c", "context": "d", "tags": [] }
        ]
      }`;

      const cards = parseCards(response, "chapter_5");

      expect(cards[0].id).toBe("card_chapter_5_1");
      expect(cards[1].id).toBe("card_chapter_5_2");
    });
  });
});