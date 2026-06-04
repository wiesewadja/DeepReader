/**
 * PageIndex: EPUB parsing module
 * Extracts text content from EPUB e-books
 * Based on obsidian-epub-importer implementation
 */

import * as path from "path";
import AdmZip from "adm-zip";
import { parseStringPromise } from "xml2js";
import TurndownService from "turndown";
import { countTokens, cleanTitle } from "../core/utils";
import type { PdfPage } from "./pdf";

export interface EpubCoverImage {
  /** File name with extension (e.g., "cover.jpg") */
  name: string;
  /** Image data */
  data: Buffer;
  /** MIME type (e.g., "image/jpeg") */
  mediaType: string;
}

export interface EpubInfo {
  title: string;
  /** Original full title before cleanup */
  fullTitle?: string;
  author: string;
  numChapters: number;
  chapters: EpubChapter[];
  coverImage?: EpubCoverImage;
}

export interface EpubChapter {
  id: string;
  title: string;
  content: string;
  tokenCount: number;
  order: number;
  href: string;
  /** Map of original anchor IDs to generated block IDs (anchor -> blockId) */
  blockMap?: Map<string, string>;
  /** Array of all block IDs in this chapter in order */
  blocks?: string[];
}

/**
 * Create Turndown service for HTML to Markdown conversion with block IDs
 * @param chapterIndex - Chapter index for generating block IDs
 * @param blockMap - Map to store original anchor -> block ID mapping
 * @param blocks - Array to store all block IDs in order
 */
function createTurndownServiceWithBlocks(
  chapterIndex: number,
  blockMap: Map<string, string>,
  blocks: string[]
): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  // Remove title tag
  turndown.remove("title");

  // Paragraph counter for generating block IDs
  let paragraphIndex = 0;

  // Generate block ID - use hyphen only (no underscores)
  // Obsidian block ID format: letters, numbers, and hyphens only
  const generateBlockId = (originalId?: string): string => {
    if (originalId) {
      // 替换下划线为连字符，清理其他特殊字符
      // jz_1_14 -> jz-1-14
      const sanitized = originalId
        .replace(/_/g, "-")           // 下划线改连字符
        .replace(/[^a-zA-Z0-9-]/g, ""); // 只保留字母数字连字符
      return sanitized || `p${String(paragraphIndex++).padStart(3, "0")}`;
    }
    // 无原始ID时使用段落序号
    return `p${String(paragraphIndex++).padStart(3, "0")}`;
  };

  // Custom rules
  const rules: Record<string, TurndownService.Rule> = {
    // Images - convert to Markdown format
    img: {
      filter: "img",
      replacement: (_content, node: any) => {
        const alt = node.getAttribute("alt") || "";
        const src = node.getAttribute("src") || "";
        if (src) {
          return `![${alt}](${src})`;
        }
        return "";
      },
    },

    // Footnote links
    footnoteLinks: {
      filter: (node: any) => {
        return node.nodeName === "A" && /^\[?\[?\d+\]?\]?$/.test(node.textContent || "");
      },
      replacement: (_content, node: any) => {
        const text = node.textContent || "";
        return `[^${text.replace(/[[\]]/g, "")}]`;
      },
    },

    // Internal links (EPUB → Obsidian block reference format)
    internalLinks: {
      filter: (node: any) => {
        const href = node.getAttribute("href");
        if (!href) return false;
        // Skip http links, footnotes, and already-processed markdown links
        if (href.startsWith("http") || href.startsWith("#fn") || /^\[?\[?\d+\]?\]?$/.test(node.textContent || "")) {
          return false;
        }
        return node.nodeName === "A";
      },
      replacement: (_content, node: any) => {
        const href = node.getAttribute("href") || "";
        const text = node.textContent || "";

        // Parse href: "chapter.html#section" or "#section"
        const [filePart, anchorPart] = href.split("#");

        // Remove .html/.xhtml extension from filename
        const fileName = filePart
          ? filePart.replace(/\.(html|xhtml|htm)$/i, "")
          : "";

        // Build Obsidian link with block reference (^anchor)
        if (fileName && anchorPart) {
          // Link to another file with block anchor: [[filename#^anchor|text]]
          return `[[${fileName}#^${anchorPart}|${text}]]`;
        } else if (fileName) {
          // Link to another file: [[filename|text]]
          return `[[${fileName}|${text}]]`;
        } else if (anchorPart) {
          // Same-file block anchor: [[#^anchor|text]]
          return `[[#^${anchorPart}|${text}]]`;
        }

        // Fallback to regular markdown link
        return `[${text}](${href})`;
      },
    },

    // Paragraphs - add block ID to every paragraph, detect potential h3 headings
    // Only process leaf paragraph elements (not containers with nested p/div)
    paragraph: {
      filter: (node: any) => {
        const tagName = node.tagName?.toLowerCase();
        if (!["p", "div", "section", "blockquote"].includes(tagName)) {
          return false;
        }
        // Skip Calibre pagebreak markers (empty divs with calibre-pb id/class)
        if (node.getAttribute?.("class") === "calibre-pb" ||
            /^calibre-pb-\d+$/.test(node.getAttribute?.("id") || "")) {
          return false;
        }
        // Skip container elements that have nested paragraph-like elements
        // This prevents double-processing when <div><p>text</p></div>
        const hasNestedParagraph = node.querySelector?.("p, div:not(:empty), section, blockquote");
        if (hasNestedParagraph) {
          return false;
        }
        return true;
      },
      replacement: (content, node: any) => {
        if (!content.trim()) return "";

        // Get original ID if exists
        const originalId = node.getAttribute?.("id");

        // Get ID from child anchor if exists (for footnotes)
        let childId: string | null = null;
        if (!originalId) {
          const childWithId = node.querySelector?.("[id]");
          if (childWithId) {
            childId = childWithId.getAttribute("id");
          }
        }

        // Generate block ID
        const blockId = generateBlockId(originalId || childId || undefined);
        blocks.push(blockId);

        // Store mapping from original ID to block ID
        if (originalId) {
          blockMap.set(originalId, blockId);
        }
        if (childId) {
          blockMap.set(childId, blockId);
        }

        const trimmedContent = content.trim();

        // Add block reference marker at the end of content (same line)
        return `\n\n${trimmedContent} ^${blockId}\n\n`;
      },
    },

    // List items - also add block IDs
    listItem: {
      filter: "li",
      replacement: (content, node: any) => {
        const prefix = "- ";
        const originalId = node.getAttribute?.("id");

        // Generate block ID for list items too
        const blockId = generateBlockId(originalId || undefined);
        blocks.push(blockId);

        if (originalId) {
          blockMap.set(originalId, blockId);
        }

        content = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n/gm, "\n    ");
        return `${prefix}${content} ^${blockId}\n`;
      },
    },

    // Ruby text (CJK phonetic guide)
    ruby: {
      filter: "ruby",
      replacement: (_content, node: any) => {
        const baseText = Array.from(node.childNodes)
          .filter((child: any) => {
            return (
              child.nodeType === 3 ||
              (child.nodeType === 1 && child.tagName?.toLowerCase() !== "rt")
            );
          })
          .map((child: any) => child.textContent || "")
          .join("");

        const rtElement = node.querySelector("rt");
        const rubyText = rtElement ? rtElement.textContent || "" : "";

        return rubyText ? `{${baseText}|${rubyText}}` : baseText;
      },
    },

    // RT tags - no output
    rt: {
      filter: "rt",
      replacement: () => "",
    },

    // Tables - better formatting
    table: {
      filter: "table",
      replacement: (content: string) => {
        return "\n\n" + content + "\n\n";
      },
    },
  };

  // Add custom rules
  Object.entries(rules).forEach(([key, rule]) => {
    turndown.addRule(key, rule);
  });

  return turndown;
}

/**
 * Extract text from HTML content using Turndown with block IDs
 * @param html - Raw HTML content
 * @param chapterIndex - Chapter index for block ID generation
 * @returns Object with markdown content, blockMap, and blocks array
 */
function extractTextFromHTMLWithBlocks(
  html: string,
  chapterIndex: number
): { content: string; blockMap: Map<string, string>; blocks: string[] } {
  // Remove <head> entirely — some Kobo EPUBs use self-closing <title/>
  // which DOMParser in text/html mode treats as an opening <title> tag,
  // causing the entire document body to be swallowed into the title element.
  let cleanHtml = html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Create block tracking structures
  const blockMap = new Map<string, string>();
  const blocks: string[] = [];

  // Use Turndown for HTML to Markdown conversion with block IDs
  const turndown = createTurndownServiceWithBlocks(chapterIndex, blockMap, blocks);
  let markdown = turndown.turndown(cleanHtml);

  // Clean up excessive whitespace
  markdown = markdown
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { content: markdown, blockMap, blocks };
}

/**
 * Clean EPUB title by removing marketing suffixes commonly added by ebook sites.
 * Strips long 【...】 blocks (marketing copy, recommendations), removes trailing
 * parenthetical blocks like author info "(作者名)" and site info "(z-library.sk, ...)",
 * and trims whitespace. Short 【...】 like 【第2版】 are preserved.
 *
 * Examples:
 *   "如何阅读一本书 ([美]莫提默·J·艾德勒,查尔斯·范多伦) (z-library.sk, 1lib.sk)"
 *     → "如何阅读一本书"
 *   "遥远的救世主 (豆豆) (z-lib.sk)" → "遥远的救世主"
 *   "Python编程【第2版】" → "Python编程【第2版】"  (short 【】 preserved)
 */
function cleanEpubTitle(title: string): string {
  let result = title
    // Remove 【...】 blocks longer than 10 chars (marketing copy, not version tags)
    .replace(/【[^】]{10,}】/g, "");

  // Repeatedly strip trailing (...) blocks — handles multiple stacked parentheticals
  // e.g. "书名 (作者) (z-lib.sk)" needs two passes
  let prev: string;
  do {
    prev = result;
    result = result
      // Remove trailing (...) blocks that contain ebook site markers
      .replace(/\s*\([^)]*(?:z-lib|z-library|1lib|epub|mobi|pdf)[^)]*\)\s*$/gi, "")
      // Remove trailing author/publisher parentheticals:
      // matches (...) at end of string that look like author credits added by ebook sites,
      // i.e. contains CJK chars, brackets like [美], dots, or commas (author lists)
      // but NOT short version tags like "(2nd ed)" which are typically all-ASCII and short
      .replace(/\s*\([^)]*[\u4e00-\u9fff][^)]*\)\s*$/, "")
      .trim();
  } while (result !== prev);

  // Collapse multiple spaces, protect against over-stripping
  const cleaned = result.replace(/\s{2,}/g, " ").trim();
  return cleaned || title.trim();
}

/**
 * Parse EPUB file
 */
export async function parseEpub(input: string | Buffer): Promise<EpubInfo> {
  let zip: AdmZip;

  if (typeof input === "string") {
    // File path
    zip = new AdmZip(input);
  } else {
    // Buffer
    zip = new AdmZip(input);
  }

  // Find container.xml
  const containerEntry = zip.getEntry("META-INF/container.xml");
  if (!containerEntry) {
    throw new Error("Invalid EPUB: META-INF/container.xml not found");
  }

  const containerXml = containerEntry.getData().toString("utf-8");
  const opfPathMatch = containerXml.match(/full-path=["']([^"']+)["']/);
  if (!opfPathMatch) {
    throw new Error("Invalid EPUB: Cannot find OPF path in container.xml");
  }
  const opfPath = opfPathMatch[1];

  // Read OPF file
  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) {
    throw new Error(`Invalid EPUB: OPF file not found: ${opfPath}`);
  }

  const opfXml = opfEntry.getData().toString("utf-8");
  const basePath = path.dirname(opfPath);

  // 清理 XML 注释：sax 严格解析器要求注释内部不能出现 "--" 且必须正确闭合。
  // 很多中文 EPUB 的 OPF 文件含有格式不规范的注释（未闭合、或内部含 "--"），
  // 会导致 "Malformed comment" 错误。
  // 安全策略：正确闭合的注释完整移除；未闭合的只移除 "<!--" 标记本身，
  // 保留后续内容，避免破坏 XML 结构。
  let sanitizedOpfXml = opfXml;

  // Step 1: 循环移除所有正确闭合的注释（包括跨多行）
  let maxIterations = 1000;
  while (maxIterations-- > 0) {
    const match = sanitizedOpfXml.match(/<!--[\s\S]*?-->/);
    if (!match || match.index === undefined) break;
    sanitizedOpfXml = sanitizedOpfXml.substring(0, match.index) + sanitizedOpfXml.substring(match.index + match[0].length);
  }

  // Step 2: 移除残留的未闭合注释起始标记（此时不应再有正确闭合的注释）
  sanitizedOpfXml = sanitizedOpfXml.replace(/<!--/g, "");

  // Parse OPF XML
  const opfData = await parseStringPromise(sanitizedOpfXml);
  const packageData = opfData.package;

  // Extract metadata
  const metadata = packageData.metadata?.[0] || {};

  // xml2js may return { _: "text", $: { attrs } } for elements with attributes
  const extractText = (val: any): string => {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "object" && val._ !== undefined) return val._;
    return String(val);
  };

  const rawTitle = extractText(metadata["dc:title"]?.[0]) || "Untitled";
  const title = cleanEpubTitle(rawTitle);
  const creator = extractText(metadata["dc:creator"]?.[0]) || "Unknown";

  // Build manifest map
  const manifest = packageData.manifest?.[0]?.item || [];
  const manifestMap = new Map<string, string>();
  for (const item of manifest) {
    const id = item.$.id;
    const href = item.$.href;
    if (id && href) {
      manifestMap.set(id, path.join(basePath, href).replace(/\\/g, "/"));
    }
  }

  // Get reading order from spine
  const spine = packageData.spine?.[0]?.itemref || [];
  const readingOrder: string[] = [];
  for (const itemref of spine) {
    const idref = itemref.$.idref;
    if (idref) {
      readingOrder.push(idref);
    }
  }

  // Extract cover image
  let coverImage: EpubCoverImage | undefined;
  // EPUB 3.0: manifest item with properties="cover-image"
  const coverManifestItem = manifest.find(
    (item: any) => item.$.properties?.includes("cover-image")
  );
  // EPUB 2.0: <meta name="cover" content="manifest-id">
  const coverMeta = metadata.meta?.find(
    (m: any) => m.$.name === "cover"
  );
  const coverId = coverManifestItem?.$.id || coverMeta?.$.content;

  if (coverId) {
    const coverHref = manifestMap.get(coverId);
    if (coverHref) {
      const coverEntry = zip.getEntry(coverHref);
      if (coverEntry) {
        const ext = path.extname(coverHref).toLowerCase();
        const mediaTypes: Record<string, string> = {
          ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".gif": "image/gif",
          ".svg": "image/svg+xml", ".webp": "image/webp",
        };
        coverImage = {
          name: `cover${ext}`,
          data: coverEntry.getData(),
          mediaType: mediaTypes[ext] || "image/jpeg",
        };
      }
    }
  }

  // Extract chapters
  const chapters: EpubChapter[] = [];
  let order = 0;

  for (const id of readingOrder) {
    const href = manifestMap.get(id);
    if (!href) continue;

    const entry = zip.getEntry(href);
    if (!entry) continue;

    const html = entry.getData().toString("utf-8");
    const result = extractTextFromHTMLWithBlocks(html, order);

    // Extract chapter title
    // Strategy: 1) Try <h1> first, then <h2>, etc. (strip inner HTML tags),
    //           2) Fall back to first non-empty line of markdown
    // Use [\s\S]*? to match content with nested tags, then strip HTML to get plain text
    // Kobo EPUBs often have h1 as chapter title and h5/h6 as sub-sections within the same
    // XHTML file. We must NOT pick sub-section headings as the chapter title.
    let chapterTitle: string;
    const headingLevelMatches = html.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi);

    if (headingLevelMatches && headingLevelMatches.length > 0) {
      // Group by heading level to prefer higher-level headings (h1 > h2 > ...)
      const byLevel: Record<string, string[]> = {};
      for (const m of headingLevelMatches) {
        const levelMatch = m.match(/^<h([1-6])/i);
        const level = levelMatch ? levelMatch[1] : "6";
        const text = cleanTitle(m.replace(/<[^>]+>/g, "").trim());
        if (text.length > 0) {
          if (!byLevel[level]) byLevel[level] = [];
          byLevel[level].push(text);
        }
      }

      // Pick the first available level (h1 -> h2 -> ...)
      let pickedTitle = "";
      for (let lvl = 1; lvl <= 6; lvl++) {
        const texts = byLevel[String(lvl)];
        if (texts && texts.length > 0) {
          // If multiple headings at same level, use the first one (usually the chapter title)
          // or combine short + long if first is very short (e.g. "第1章" + "标题")
          if (texts.length > 1) {
            const first = texts[0];
            const longest = texts.reduce((a, b) => a.length >= b.length ? a : b);
            if (first !== longest && first.length <= 5 && longest.length > first.length) {
              pickedTitle = `${first} ${longest}`;
            } else {
              pickedTitle = first;
            }
          } else {
            pickedTitle = texts[0];
          }
          break;
        }
      }
      chapterTitle = pickedTitle || `Chapter ${order + 1}`;
    } else {
      // No heading tag: use first non-empty line of markdown as title
      const firstLine = result.content.split("\n").find(l => l.trim().length > 0);
      // Strip block ID marker from the end (e.g., " ^p001")
      chapterTitle = firstLine
        ? cleanTitle(firstLine.replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, "").trim())
        : `Chapter ${order + 1}`;
    }

    // Skip cover/image-only pages (title is a markdown image syntax)
    if (chapterTitle.startsWith("![") || chapterTitle.startsWith("![Cover")) {
      order++;
      continue;
    }

    chapters.push({
      id,
      title: chapterTitle,
      content: result.content,
      tokenCount: countTokens(result.content),
      order: order++,
      href,
      blockMap: result.blockMap,
      blocks: result.blocks,
    });
  }

  return {
    title,
    author: creator,
    numChapters: chapters.length,
    chapters,
    coverImage,
  };
}

/**
 * Convert EPUB chapters to PdfPage format for compatibility
 */
export function epubChaptersToPages(chapters: EpubChapter[]): PdfPage[] {
  return chapters.map((chapter) => ({
    text: `=== ${chapter.title} ===\n\n${chapter.content}`,
    tokenCount: chapter.tokenCount,
  }));
}

/**
 * EPUB-specific token threshold for splitting large pages at chapter boundaries.
 *
 * EPUB spine may have few entries with the entire book packed into one HTML file.
 * When a single page exceeds this token count, we split it at heading markers
 * (# / ## / 第X章 / Chapter N / Part X) to improve chapter granularity.
 *
 * Not tied to `maxTokenNumEachNode` (which defaults to 100K) because we want
 * finer-grained splitting for EPUB regardless of LLM tree depth config.
 */
export const EPUB_SPLIT_THRESHOLD = 4500;

/** Heading-based split boundary (kept as a positive lookahead) */
const EPUB_SPLIT_PATTERN = /\n(?=# |## |第[一二三四五六七八九十百千]+章\s|Chapter\s+\d+|CHAPTER\s+\d+|Part\s+[IVX\d]+)/;

/** Heading prefix used to extract a title from a split part */
const EPUB_TITLE_PREFIX = /^(?:# |## |第[一二三四五六七八九十百千]+章\s*|Chapter\s+\d+\s*|CHAPTER\s+\d+\s*|Part\s+[IVX\d]+\s*)/;

export interface SplitEpubResult {
  pages: PdfPage[];
  chapters: EpubChapter[];
  /** true if any page was actually split; false if input was below threshold */
  split: boolean;
}

/**
 * Split large EPUB pages by markdown heading markers.
 *
 * Pages with `tokenCount <= EPUB_SPLIT_THRESHOLD` are passed through unchanged.
 * Pages exceeding the threshold are split at heading boundaries; if a page
 * cannot be split (no heading markers), it is kept as a single page.
 *
 * Pure function — does not mutate input arrays.
 */
export function splitLargeEpubPages(
  pages: PdfPage[],
  chapters: EpubChapter[],
): SplitEpubResult {
  const needsSplit = pages.some((p) => p.tokenCount > EPUB_SPLIT_THRESHOLD);
  if (!needsSplit) {
    return { pages, chapters, split: false };
  }

  const newPages: PdfPage[] = [];
  const newChapters: EpubChapter[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const chapter = chapters[i];

    if (page.tokenCount <= EPUB_SPLIT_THRESHOLD) {
      newPages.push(page);
      newChapters.push(chapter);
      continue;
    }

    const parts = page.text.split(EPUB_SPLIT_PATTERN).filter((p) => p.trim());
    if (parts.length <= 1) {
      newPages.push(page);
      newChapters.push(chapter);
      continue;
    }

    for (let j = 0; j < parts.length; j++) {
      const part = parts[j].trim();
      if (!part) continue;
      const titleMatch = part.match(EPUB_TITLE_PREFIX);
      const title = titleMatch
        ? titleMatch[0].trim()
        : j === 0
          ? chapter.title
          : `Section ${newChapters.length + 1}`;
      newPages.push({ text: part, tokenCount: countTokens(part) });
      newChapters.push({ ...chapter, title, content: part });
    }
  }

  return { pages: newPages, chapters: newChapters, split: true };
}

/**
 * Get EPUB file name without extension
 */
export function getEpubName(epubPath: string): string {
  const parts = epubPath.split("/");
  const basename = parts[parts.length - 1] || "Untitled";
  return basename.replace(/\.epub$/i, "");
}

/**
 * Clean chapter title: remove Markdown formatting artifacts
 * e.g. "#**第****2****章**" → "第2章"
 * e.g. "# --第----1----章--" → "第1章"
 * Uses cleanTitle from core/utils
 */
