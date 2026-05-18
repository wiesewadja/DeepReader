import { describe, it, expect } from "vitest";
import type { MineruJson } from "../mineru";
import { parseMineruJson } from "../mineru";

const mockMineruJson: MineruJson = {
  pdf_info: [
    {
      page_idx: 0,
      page_size: [595, 842],
      preproc_blocks: [],
      para_blocks: [
        {
          bbox: [72, 72, 523, 120],
          type: "title",
          angle: 0,
          index: 0,
          lines: [
            {
              bbox: [72, 72, 523, 120],
              spans: [
                { type: "text", content: "The Founder's Playbook", bbox: [72, 72, 523, 120] },
              ],
            },
          ],
        },
        {
          bbox: [72, 150, 400, 180],
          type: "text",
          angle: 0,
          index: 1,
          lines: [
            {
              bbox: [72, 150, 400, 180],
              spans: [
                { type: "text", content: "A practical guide for startup founders building scalable companies.", bbox: [72, 150, 400, 180] },
              ],
            },
          ],
        },
      ],
    },
    {
      page_idx: 1,
      page_size: [595, 842],
      preproc_blocks: [],
      para_blocks: [
        {
          bbox: [72, 72, 400, 110],
          type: "title",
          angle: 0,
          index: 0,
          lines: [
            {
              bbox: [72, 72, 400, 110],
              spans: [
                { type: "text", content: "Chapter 1: Getting Started", bbox: [72, 72, 400, 110] },
              ],
            },
          ],
        },
        {
          bbox: [72, 130, 500, 200],
          type: "text",
          angle: 0,
          index: 1,
          lines: [
            {
              bbox: [72, 130, 500, 200],
              spans: [
                { type: "text", content: "Before you begin, you need to validate your idea.", bbox: [72, 130, 500, 200] },
              ],
            },
          ],
        },
        {
          bbox: [72, 220, 350, 260],
          type: "title",
          angle: 0,
          index: 2,
          lines: [
            {
              bbox: [72, 220, 350, 260],
              spans: [
                { type: "text", content: "1.1 Idea Validation", bbox: [72, 220, 350, 260] },
              ],
            },
          ],
        },
        {
          bbox: [72, 280, 500, 350],
          type: "text",
          angle: 0,
          index: 3,
          lines: [
            {
              bbox: [72, 280, 500, 350],
              spans: [
                { type: "text", content: "Test your assumptions early and often.", bbox: [72, 280, 500, 350] },
              ],
            },
          ],
        },
      ],
    },
    {
      page_idx: 2,
      page_size: [595, 842],
      preproc_blocks: [],
      para_blocks: [
        {
          bbox: [72, 72, 400, 110],
          type: "title",
          angle: 0,
          index: 0,
          lines: [
            {
              bbox: [72, 72, 400, 110],
              spans: [
                { type: "text", content: "Chapter 2: Building the Team", bbox: [72, 72, 400, 110] },
              ],
            },
          ],
        },
        {
          bbox: [72, 130, 500, 200],
          type: "text",
          angle: 0,
          index: 1,
          lines: [
            {
              bbox: [72, 130, 500, 200],
              spans: [
                { type: "text", content: "Your team is your most important asset.", bbox: [72, 130, 500, 200] },
              ],
            },
          ],
        },
        {
          bbox: [72, 220, 350, 260],
          type: "title",
          angle: 0,
          index: 2,
          lines: [
            {
              bbox: [72, 220, 350, 260],
              spans: [
                { type: "text", content: "2.1 Hiring", bbox: [72, 220, 350, 260] },
              ],
            },
          ],
        },
        {
          bbox: [72, 280, 500, 350],
          type: "table",
          angle: 0,
          index: 3,
          lines: [],
          blocks: [
            {
              bbox: [72, 280, 523, 400],
              type: "table",
              angle: 0,
              index: 0,
              lines: [
                {
                  bbox: [72, 280, 523, 300],
                  spans: [
                    {
                      type: "table",
                      html: "<table><tr><th>Role</th><th>Priority</th></tr><tr><td>Engineer</td><td>High</td></tr></table>",
                      bbox: [72, 280, 523, 400],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("parseMineruJson", () => {
  it("should parse a simple PDF and extract title", async () => {
    const result = await parseMineruJson(mockMineruJson);

    expect(result.title).toBe("The Founder's Playbook");
  });

  it("should extract correct total pages", async () => {
    const result = await parseMineruJson(mockMineruJson);

    expect(result.totalPages).toBe(3);
  });

  it("should extract pages with page numbers and text", async () => {
    const result = await parseMineruJson(mockMineruJson);

    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toMatchObject({
      pageNumber: 1,
      text: expect.stringContaining("The Founder's Playbook"),
    });
    expect(result.pages[1]).toMatchObject({
      pageNumber: 2,
      text: expect.stringContaining("Getting Started"),
    });
    expect(result.pages[2]).toMatchObject({
      pageNumber: 3,
      text: expect.stringContaining("Building the Team"),
    });
  });

  it("should include tokenCount for each page", async () => {
    const result = await parseMineruJson(mockMineruJson);

    for (const page of result.pages) {
      expect(page.tokenCount).toBeGreaterThan(0);
    }
  });

  it("should build outline tree with correct hierarchy", async () => {
    const result = await parseMineruJson(mockMineruJson);

    // 3 top-level nodes: "The Founder's Playbook" (h1), "Chapter 1" (h1), "Chapter 2" (h1)
    expect(result.outline).toHaveLength(3);

    const titleNode = result.outline[0];
    expect(titleNode.title).toBe("The Founder's Playbook");
    expect(titleNode.startIndex).toBe(1);

    const ch1 = result.outline[1];
    expect(ch1.title).toBe("Chapter 1: Getting Started");
    expect(ch1.startIndex).toBe(2);
    expect(ch1.nodes).toHaveLength(1);
    expect(ch1.nodes![0].title).toBe("1.1 Idea Validation");
    expect(ch1.nodes![0].startIndex).toBe(2);

    const ch2 = result.outline[2];
    expect(ch2.title).toBe("Chapter 2: Building the Team");
    expect(ch2.startIndex).toBe(3);
    expect(ch2.nodes![0].title).toBe("2.1 Hiring");
    expect(ch2.nodes![0].startIndex).toBe(3);
  });

  it("should handle table blocks in pages", async () => {
    const result = await parseMineruJson(mockMineruJson);

    const ch2Page = result.pages.find(p => p.pageNumber === 3);
    expect(ch2Page?.text).toMatch(/Role/);
    expect(ch2Page?.text).toMatch(/Engineer/);
  });

  it("should handle empty PDF", async () => {
    const emptyJson: MineruJson = {
      pdf_info: [],
    };

    const result = await parseMineruJson(emptyJson);

    expect(result.title).toBe("Untitled");
    expect(result.totalPages).toBe(0);
    expect(result.pages).toHaveLength(0);
    expect(result.outline).toHaveLength(0);
  });

  it("should handle PDF with no titles", async () => {
    const noTitleJson: MineruJson = {
      pdf_info: [
        {
          page_idx: 0,
          page_size: [595, 842],
          preproc_blocks: [],
          para_blocks: [
            {
              bbox: [72, 130, 500, 200],
              type: "text",
              angle: 0,
              index: 0,
              lines: [
                {
                  bbox: [72, 130, 500, 200],
                  spans: [
                    { type: "text", content: "Just some plain text.", bbox: [72, 130, 500, 200] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await parseMineruJson(noTitleJson);

    expect(result.title).toBe("Untitled");
    expect(result.pages[0].text).toContain("Just some plain text");
  });

  it("should fill node.text with content from pages", async () => {
    const result = await parseMineruJson(mockMineruJson);

    // Chapter 1 is outline[1] (title node is outline[0])
    const ch1 = result.outline[1];
    expect(ch1.text).toBeTruthy();
    expect(ch1.text).toContain("Getting Started");
    expect(ch1.text).toContain("validate your idea");
  });
});

describe("heading level estimation", () => {
  it("should assign h1 to titles in top 15% of page", async () => {
    const topTitleJson: MineruJson = {
      pdf_info: [
        {
          page_idx: 0,
          page_size: [595, 842],
          preproc_blocks: [],
          para_blocks: [
            {
              bbox: [72, 30, 400, 80],
              type: "title",
              angle: 0,
              index: 0,
              lines: [
                {
                  bbox: [72, 30, 400, 80],
                  spans: [
                    { type: "text", content: "Top of Page Title", bbox: [72, 30, 400, 80] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await parseMineruJson(topTitleJson);

    expect(result.outline[0].title).toBe("Top of Page Title");
  });
});
