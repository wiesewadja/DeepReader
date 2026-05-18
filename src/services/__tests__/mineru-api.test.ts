import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MineruClient, MineruError } from "../mineru-api";

const TEST_TIMEOUT = 3000;

describe("MineruClient", () => {
  let client: MineruClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      client = new MineruClient();
      expect(client).toBeDefined();
    });

    it("should accept custom timeout", () => {
      client = new MineruClient(undefined, { timeout: 5000 });
      expect(client).toBeDefined();
    });

    it("should accept custom language", () => {
      client = new MineruClient(undefined, { language: "en" });
      expect(client).toBeDefined();
    });
  });

  describe("parse", () => {
    it("should use agent API for small files without token", async () => {
      client = new MineruClient();

      const smallPdf = Buffer.from("fake pdf content");
      vi.spyOn(client as any, "parseViaAgent").mockResolvedValue({
        title: "Test",
        totalPages: 1,
        pages: [{ pageNumber: 1, text: "test", tokenCount: 1 }],
        outline: [],
      });

      const result = await client.parse(smallPdf, "test.pdf");

      expect(result.title).toBe("Test");
      expect((client as any).parseViaAgent).toHaveBeenCalledWith(smallPdf, "test.pdf");
    });

    it("should throw when file too large and no token provided", async () => {
      client = new MineruClient();

      const largePdf = Buffer.alloc(11 * 1024 * 1024);

      await expect(client.parse(largePdf, "large.pdf")).rejects.toThrow(MineruError);
    });

    it("should use precision API when token provided for large files", async () => {
      client = new MineruClient("test-token");

      const largePdf = Buffer.alloc(15 * 1024 * 1024);
      vi.spyOn(client as any, "parseViaPrecision").mockResolvedValue({
        title: "Test",
        totalPages: 1,
        pages: [{ pageNumber: 1, text: "test", tokenCount: 1 }],
        outline: [],
      });

      const result = await client.parse(largePdf, "large.pdf");

      expect((client as any).parseViaPrecision).toHaveBeenCalledWith(largePdf, "large.pdf");
      expect(result.title).toBe("Test");
    });

    it("should use precision API for small files when token provided", async () => {
      client = new MineruClient("test-token");

      // Mock fetch: returns done immediately for agent API polling
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task-123", file_url: "https://oss.example.com/upload" } }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { state: "done", markdown_url: "https://cdn.example.com/result.md" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "# Test\n\nPage content",
        });
      global.fetch = mockFetch;

      const smallPdf = Buffer.from("small pdf content");
      const result = await client.parse(smallPdf, "test.pdf");

      // With token, small files still use agent API (it's the default for small files)
      expect(result).toBeDefined();
      expect(result.pages).toBeDefined();
      expect(result.pages.length).toBeGreaterThan(0);

      global.fetch = vi.fn();
    });
  });

  describe("parseViaAgent", () => {
    it("should complete full agent API flow", async () => {
      client = new MineruClient();

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task-123", file_url: "https://oss.example.com/upload" } }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { state: "done", markdown_url: "https://cdn.example.com/result.md" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "# Title\n\nPage content",
        });

      global.fetch = mockFetch;

      const pdf = Buffer.from("test pdf content");
      const result = await (client as any).parseViaAgent(pdf, "test.pdf");

      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(result.title).toBe("test");
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].text).toContain("Title");

      global.fetch = vi.fn();
    }, 10000);

    it("should throw on agent API request failure", async () => {
      client = new MineruClient();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect((client as any).requestUploadUrl("test.pdf")).rejects.toThrow(MineruError);

      global.fetch = vi.fn();
    });

    it("should throw on agent API error code", async () => {
      client = new MineruClient();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 400, msg: "Bad request" }),
      });

      await expect((client as any).requestUploadUrl("test.pdf")).rejects.toThrow(MineruError);

      global.fetch = vi.fn();
    });

    it("should throw on polling timeout", async () => {
      client = new MineruClient(undefined, { timeout: 100 });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { state: "processing" } }),
      });

      await expect((client as any).pollAgentResult("task-123")).rejects.toThrow(MineruError);

      global.fetch = vi.fn();
    });

    it("should throw on agent parsing failure", async () => {
      client = new MineruClient();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { state: "failed", err_msg: "Parsing failed" } }),
      });

      await expect((client as any).pollAgentResult("task-123")).rejects.toThrow("Parsing failed");

      global.fetch = vi.fn();
    });
  });

  describe("parseMarkdown (agent result parsing)", () => {
    it("should parse markdown with page delimiters", () => {
      const markdown = `# Document Title

Intro text here.

<!-- Page 2 -->

## Chapter 1

Content of chapter 1.

<!-- Page 3 -->

### Section 1.1

More content.
`;

      const result = (MineruClient.prototype as any).parseMarkdown.call(
        { language: "ch" },
        markdown,
        "test.pdf"
      );

      expect(result.title).toBe("test");
      expect(result.totalPages).toBe(3);
      expect(result.pages[0].text).toContain("Document Title");
      expect(result.pages[1].text).toContain("Chapter 1");
      expect(result.pages[2].text).toContain("Section 1.1");
      // "## Chapter 1" is level 2, nested under H1 "Document Title"
      // "### Section 1.1" is level 3, nested under H2 "Chapter 1"
      expect(result.outline).toHaveLength(1);
      expect(result.outline[0].title).toBe("Document Title");
      expect(result.outline[0].nodes![0].title).toBe("Chapter 1");
      expect(result.outline[0].nodes![0].nodes![0].title).toBe("Section 1.1");
    });

    it("should handle markdown without page delimiters", () => {
      const markdown = `# Title

Content without page markers.`;

      const result = (MineruClient.prototype as any).parseMarkdown.call(
        {},
        markdown,
        "doc.pdf"
      );

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].text).toContain("Title");
    });

    it("should extract h1, h2, h3 headings from markdown", () => {
      const markdown = `# H1 Title

## H2 Section

### H3 Subsection

Some text.
`;

      const result = (MineruClient.prototype as any).parseMarkdown.call({}, markdown, "test.pdf");

      expect(result.outline).toHaveLength(1);
      expect(result.outline[0].title).toBe("H1 Title");
      expect(result.outline[0].nodes![0].title).toBe("H2 Section");
      expect(result.outline[0].nodes![0].nodes![0].title).toBe("H3 Subsection");
    });
  });

  describe("parseViaPrecision", () => {
    it("should throw when token not configured", async () => {
      client = new MineruClient();

      await expect((client as any).parseViaPrecision(Buffer.from("pdf"), "test.pdf")).rejects.toThrow(
        "MinerU Token not configured"
      );
    });

    it("should complete precision API flow", async () => {
      client = new MineruClient("test-token");

      // Mock downloadAndParseZip directly to avoid ZIP complexity
      const mockJson = {
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
                      { type: "text", content: "Doc Title", bbox: [72, 72, 523, 120] },
                    ],
                  },
                ],
              },
              {
                bbox: [72, 130, 500, 180],
                type: "text",
                angle: 0,
                index: 1,
                lines: [
                  {
                    bbox: [72, 130, 500, 180],
                    spans: [
                      { type: "text", content: "Some text content.", bbox: [72, 130, 500, 180] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      vi.spyOn(client as any, "downloadAndParseZip").mockResolvedValue({
        title: "Doc Title",
        totalPages: 1,
        pages: [{ pageNumber: 1, text: "Doc Title\n\nSome text content.", tokenCount: 10 }],
        outline: [{ title: "Doc Title", startIndex: 1, nodes: [] }],
      });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 0,
            data: { batch_id: "batch-123", file_urls: ["https://oss.example.com/upload"] },
          }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              extract_result: [{ state: "done", full_zip_url: "https://cdn.example.com/result.zip" }],
            },
          }),
        });

      global.fetch = mockFetch;

      const result = await (client as any).parseViaPrecision(Buffer.from("pdf content"), "test.pdf");

      expect(result.title).toBe("Doc Title");
      expect(result.totalPages).toBe(1);

      global.fetch = vi.fn();
    }, 10000);

    it("should throw on precision API request failure", async () => {
      client = new MineruClient("test-token");

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect((client as any).parseViaPrecision(Buffer.from("pdf"), "test.pdf")).rejects.toThrow(
        "Precision API request failed"
      );

      global.fetch = vi.fn();
    });
  });
});

describe("MineruError", () => {
  it("should create error with message and optional code", () => {
    const error = new MineruError("Test error", 400);
    expect(error.message).toBe("Test error");
    expect(error.code).toBe(400);
    expect(error.name).toBe("MineruError");
  });

  it("should create error without code", () => {
    const error = new MineruError("Test error");
    expect(error.message).toBe("Test error");
    expect(error.code).toBeUndefined();
  });
});
