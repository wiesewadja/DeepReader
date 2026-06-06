/**
 * Unit tests for EPUB paragraph merging
 *
 * Validates that fragmented paragraphs (one sentence per <p> tag)
 * are merged into single paragraphs with a single block ID.
 */

import { describe, it, expect } from "vitest";

// Import the merge function directly by testing through the markdown output
// Since the function is private, we test the merge logic in isolation.

/**
 * Standalone implementation of mergeFragmentedParagraphs for testing.
 * Mirrors the logic in epub.ts.
 */

const SENTENCE_END_RE = /[。？！.?!、\u201d\u2019'"\"”'）》」\d]$/;
const BLOCK_ID_RE = / \^([a-zA-Z0-9_-]+)$/;

function mergeFragmentedParagraphs(
  markdown: string,
  blocks: string[],
  blockMap: Map<string, string>
): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  const blocksToRemove = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    const blockMatch = trimmed.match(BLOCK_ID_RE);
    if (blockMatch) {
      const textBeforeBlock = trimmed.slice(0, trimmed.length - blockMatch[0].length).trim();
      const blockId = blockMatch[1];

      if (textBeforeBlock.startsWith("#") || textBeforeBlock.startsWith("![]") || textBeforeBlock.startsWith("![")) {
        result.push(line);
        i++;
        continue;
      }

      const endsWithSentenceEnd = SENTENCE_END_RE.test(textBeforeBlock);

      if (!endsWithSentenceEnd) {
        let mergedText = textBeforeBlock;
        const removedBlocks = [blockId];
        let j = i + 1;

        while (j < lines.length) {
          if (lines[j].trim() === "") {
            j++;
            continue;
          }

          const nextTrimmed = lines[j].trim();
          const nextBlockMatch = nextTrimmed.match(BLOCK_ID_RE);

          if (!nextBlockMatch) break;

          const nextText = nextTrimmed.slice(0, nextTrimmed.length - nextBlockMatch[0].length).trim();

          if (nextText.startsWith("#") || nextText.startsWith("![]") || nextText.startsWith("![")) break;

          mergedText += nextText;
          removedBlocks.push(nextBlockMatch[1]);

          if (SENTENCE_END_RE.test(nextText)) {
            j++;
            break;
          }

          j++;
        }

        if (j > i + 1) {
          const lastBlockId = removedBlocks[removedBlocks.length - 1];
          result.push(`\n${mergedText} ^${lastBlockId}`);

          for (let k = 0; k < removedBlocks.length - 1; k++) {
            blocksToRemove.add(removedBlocks[k]);
          }

          i = j;
          continue;
        }
      }
    }

    result.push(line);
    i++;
  }

  if (blocksToRemove.size > 0) {
    for (const rb of blocksToRemove) {
      for (const [key, val] of blockMap.entries()) {
        if (val === rb) {
          blockMap.delete(key);
        }
      }
    }

    const originalBlocks = [...blocks];
    blocks.length = 0;
    for (const b of originalBlocks) {
      if (!blocksToRemove.has(b)) {
        blocks.push(b);
      }
    }
  }

  return result.join("\n");
}

describe("EPUB paragraph merging", () => {
  it("should merge fragmented lines that don't end with sentence punctuation", () => {
    const markdown = `肯·西格尔是史蒂夫·乔布斯的得力助手。在与乔布斯共事的12年时 ^p125

间里，他一直被人们公认为是最具创意的设计师。 ^p595`;

    const blocks = ["p125", "p595"];
    const blockMap = new Map([["p125_orig", "p125"], ["p595_orig", "p595"]]);
    const result = mergeFragmentedParagraphs(markdown, blocks, blockMap);

    // Should merge into one paragraph
    expect(result).toContain("肯·西格尔是史蒂夫·乔布斯的得力助手。在与乔布斯共事的12年时间里");
    expect(result).toContain("^p595");
    expect(result).not.toContain("^p125");

    // blocks should only have p595
    expect(blocks).toEqual(["p595"]);
  });

  it("should merge multiple fragments until sentence end", () => {
    const markdown = `在20世纪80年代初 ^p001

期就到苹果公司工作了。 ^p002`;

    const blocks = ["p001", "p002"];
    const blockMap = new Map();
    const result = mergeFragmentedParagraphs(markdown, blocks, blockMap);

    expect(result).toContain("在20世纪80年代初");
    expect(result).toContain("期就到苹果公司工作了");
    expect(result).toContain("^p002");
    expect(result).not.toContain("^p001");
  });

  it("should NOT merge lines that end with sentence punctuation", () => {
    const markdown = `这是一个完整的句子。 ^p001

这是另一个完整的句子。 ^p002`;

    const blocks = ["p001", "p002"];
    const blockMap = new Map();
    const result = mergeFragmentedParagraphs(markdown, blocks, blockMap);

    // Both should remain separate
    expect(result).toContain("^p001");
    expect(result).toContain("^p002");
    expect(blocks).toEqual(["p001", "p002"]);
  });

  it("should NOT merge headings", () => {
    const markdown = `### 决策剖析

预测机器在决策层面上 ^p001

会产生最直接的影响。 ^p002`;

    const blocks = ["p001", "p002"];
    const blockMap = new Map();
    const result = mergeFragmentedParagraphs(markdown, blocks, blockMap);

    // Heading should be preserved
    expect(result).toContain("### 决策剖析");
    // Fragments after heading should be merged
    expect(result).toContain("预测机器在决策层面上会产生最直接的影响");
  });

  it("should NOT merge image lines", () => {
    const markdown = `![](Images/00004.jpg) ^p008

接下来的一段文字。 ^p009`;

    const blocks = ["p008", "p009"];
    const blockMap = new Map();
    const result = mergeFragmentedParagraphs(markdown, blocks, blockMap);

    expect(result).toContain("![](Images/00004.jpg) ^p008");
    expect(result).toContain("接下来的一段文字。 ^p009");
  });

  it("should handle a complete chapter with mixed content", () => {
    const markdown = `### 模仿的心态

在一段商务旅行中或与朋友外出度假时 ^p001

假如你来到了一个陌生的 ^p002

城市。你入住了一个旅馆，洗完澡之后，肚子感觉饥饿。 ^p003

你想去一个好地方吃饭 ^p004

但你对这个城市并不熟悉。 ^p005`;

    const blocks = ["p001", "p002", "p003", "p004", "p005"];
    const blockMap = new Map();
    const result = mergeFragmentedParagraphs(markdown, blocks, blockMap);

    // Should produce 2 merged paragraphs
    expect(result).toContain("在一段商务旅行中或与朋友外出度假时假如你来到了一个陌生的城市。你入住了一个旅馆，洗完澡之后，肚子感觉饥饿");
    expect(result).toContain("你想去一个好地方吃饭但你对这个城市并不熟悉");
    expect(blocks).toHaveLength(2);
  });

  it("should handle lines ending with digits (like page numbers)", () => {
    const markdown = `一些文字内容12 ^p126

笔记本电脑关闭时，徽标指向使用者，这样让使用者重新打开时，能够 ^p625`;

    const blocks = ["p126", "p625"];
    const blockMap = new Map();
    const result = mergeFragmentedParagraphs(markdown, blocks, blockMap);

    // "12" ends with digit, should be treated as sentence end
    expect(result).toContain("一些文字内容12 ^p126");
    expect(result).toContain("^p625");
  });
});
