/**
 * Unit tests for EPUB heading paragraph detection
 *
 * Validates that three implicit heading patterns are converted to H3
 * inside the paragraph rule's replacement function:
 *   1. ◆ prefix lines (Calibre TOC-style)
 *   2. <p><span class="bold*">short text</span></p> (bold-only paragraphs)
 *   3. <p><a id="xxx"></a>short text</p> (anchor-only short paragraphs)
 */

import { describe, it, expect } from "vitest";
import TurndownService from "turndown";

/**
 * Create a Turndown service that mirrors the heading detection logic
 * from epub.ts paragraph rule replacement().
 */
function createTestTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.remove("title");

  let paragraphIndex = 0;
  const blocks: string[] = [];
  const blockMap = new Map<string, string>();

  const generateBlockId = (originalId?: string): string => {
    if (originalId) {
      const sanitized = originalId
        .replace(/_/g, "-")
        .replace(/[^a-zA-Z0-9-]/g, "");
      if (sanitized && !/^calibre-pb-\d+$/.test(sanitized)) {
        return sanitized;
      }
    }
    return `p${String(paragraphIndex++).padStart(3, "0")}`;
  };

  // Single paragraph rule with integrated heading detection
  turndown.addRule("paragraph", {
    filter: (node: any) => {
      const tagName = node.tagName?.toLowerCase();
      if (!["p", "div", "section", "blockquote"].includes(tagName)) {
        return false;
      }
      const nodeId = (node.getAttribute?.("id") || "").replace(/_/g, "-");
      if (/^calibre-pb-\d+$/.test(nodeId)) {
        return false;
      }
      const hasNestedParagraph = node.querySelector?.("p, div:not(:empty), section, blockquote");
      if (hasNestedParagraph) {
        return false;
      }
      return true;
    },
    replacement: (content: string, node: any) => {
      if (!content.trim()) return "";

      const nodeText = (node.textContent || "").trim();
      let isHeading = false;
      let headingText = "";

      // Pattern 1: ◆ prefix
      if (/^◆\s+/.test(nodeText)) {
        isHeading = true;
        headingText = nodeText.replace(/^◆\s+/, "");
      }

      // Pattern 2: bold span covering entire paragraph
      if (!isHeading && node.nodeName === "P") {
        const meaningfulChildren = Array.from(node.childNodes).filter((child: any) => {
          if (child.nodeType === 3) {
            return child.textContent.trim().length > 0;
          }
          return child.nodeType === 1;
        });
        if (meaningfulChildren.length === 1) {
          const child = meaningfulChildren[0] as any;
          if (child.nodeType === 1) {
            const tag = child.tagName?.toLowerCase();
            if (tag === "span" || tag === "b" || tag === "strong") {
              const cls = (child.getAttribute("class") || "").toLowerCase();
              if (/(?:^|\s)bold/i.test(cls) || tag === "b" || tag === "strong") {
                if (nodeText.length > 0 && nodeText.length <= 60) {
                  isHeading = true;
                  headingText = nodeText;
                }
              }
            }
          }
        }
      }

      // Pattern 3: anchor-only short paragraph
      if (!isHeading && node.nodeName === "P" && nodeText.length > 0 && nodeText.length <= 30) {
        const hasDirectAnchorId = Array.from(node.childNodes).some((child: any) => {
          if (child.nodeType === 1 && child.tagName?.toLowerCase() === "a") {
            return !!child.getAttribute("id");
          }
          return false;
        });
        if (hasDirectAnchorId) {
          isHeading = true;
          headingText = nodeText;
        }
      }

      if (isHeading) {
        headingText = headingText.replace(/[ \t]+/g, " ").trim();
        if (!headingText) return "";
        return `\n\n### ${headingText}\n\n`;
      }

      // Regular paragraph
      const originalId = node.getAttribute?.("id");
      let childId: string | null = null;
      if (!originalId) {
        const childWithId = node.querySelector?.("[id]");
        if (childWithId) {
          childId = childWithId.getAttribute("id");
        }
      }
      const blockId = generateBlockId(originalId || childId || undefined);
      blocks.push(blockId);
      if (originalId) blockMap.set(originalId, blockId);
      if (childId) blockMap.set(childId, blockId);

      const trimmedContent = content.trim();
      return `\n\n${trimmedContent} ^${blockId}\n\n`;
    },
  });

  return turndown;
}

describe("EPUB heading paragraph detection", () => {
  const td = createTestTurndown();

  it("should convert ◆ prefix lines to H3", () => {
    const html = `<p class="calibre1">◆ 模仿的心态</p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 模仿的心态");
  });

  it("should convert bold-only <p> with bold1 class to H3", () => {
    const html = `<p class="calibre_10"><span class="bold1">决策剖析</span></p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 决策剖析");
  });

  it("should convert bold-only <p> with <b> tag to H3", () => {
    const html = `<p class="calibre_10"><b>本章要点</b></p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 本章要点");
  });

  it("should convert bold-only <p> with <strong> tag to H3", () => {
    const html = `<p class="calibre_10"><strong>关键概念</strong></p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 关键概念");
  });

  it("should convert anchor-only short <p> to H3", () => {
    const html = `<p class="calibre1"><a id="p127"></a>模仿的心态</p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 模仿的心态");
  });

  it("should convert anchor with text inside <a> to H3", () => {
    const html = `<p class="calibre1"><a id="p131">可视性的能量</a></p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 可视性的能量");
  });

  it("should NOT convert regular paragraphs with bold inside", () => {
    const html = `<p class="calibre_10">这是一段普通的文字，其中包含<b>加粗部分</b>和其他内容。</p>`;
    const result = td.turndown(html).trim();
    expect(result).not.toContain("###");
    expect(result).toContain("这是一段普通的文字");
  });

  it("should NOT convert long bold-only paragraphs (>60 chars)", () => {
    const longText = "这是一段非常长的加粗文字".repeat(6);
    const html = `<p><span class="bold1">${longText}</span></p>`;
    const result = td.turndown(html).trim();
    expect(result).not.toContain("###");
  });

  it("should NOT convert regular paragraphs to headings", () => {
    const html = `<p class="calibre1">肯·西格尔是史蒂夫·乔布斯的得力助手。在与乔布斯共事的12年时间里，他一直被人们公认为是最具创意的设计师。</p>`;
    const result = td.turndown(html).trim();
    expect(result).not.toContain("###");
    expect(result).toContain("肯·西格尔");
  });

  it("should handle multiple ◆ headings in sequence", () => {
    const html = `
      <p class="calibre1">◆ 模仿的心态</p>
      <p class="calibre1">◆ 可视性的能量</p>
      <p class="calibre1">◆ 使隐蔽的产品公开化——胡子的作用</p>
    `;
    const result = td.turndown(html).trim();
    expect(result).toContain("### 模仿的心态");
    expect(result).toContain("### 可视性的能量");
    expect(result).toContain("### 使隐蔽的产品公开化——胡子的作用");
  });

  it("should handle mixed headings and paragraphs", () => {
    const html = `
      <p class="calibre_10"><span class="bold1">决策剖析</span></p>
      <p class="calibre_10">预测机器在决策层面上会产生最直接的影响。</p>
      <p class="calibre_10"><span class="bold1">"知识"没了</span></p>
      <p class="calibre_10">伦敦的司机为获得驾驶著名的黑色出租车的资格。</p>
    `;
    const result = td.turndown(html);
    expect(result).toContain("### 决策剖析");
    expect(result).toContain('### "知识"没了');
    expect(result).toContain("预测机器在决策层面上会产生最直接的影响");
    expect(result).toContain("伦敦的司机为获得驾驶著名的黑色出租车的资格");
  });

  it("should handle ◆ with various whitespace", () => {
    const html = `<p class="calibre1">◆  有效诱因是怎样炼成的</p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 有效诱因是怎样炼成的");
  });

  it("should convert chapter heading with anchor ID to H3", () => {
    const html = `<p class="calibre1"><a id="p124"></a>第四章　公共性</p>`;
    const result = td.turndown(html).trim();
    expect(result).toBe("### 第四章　公共性");
  });

  it("should NOT convert long anchor paragraphs to headings", () => {
    const longText = "这是一段带有锚点的长文本段落它不应该被识别为标题因为内容太长了超过了三十个字符的限制";
    const html = `<p class="calibre1"><a id="p200"></a>${longText}</p>`;
    const result = td.turndown(html).trim();
    expect(result).not.toContain("###");
  });
});
