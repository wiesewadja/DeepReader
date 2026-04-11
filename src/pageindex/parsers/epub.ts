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

    // Paragraphs - add block ID to every paragraph
    paragraph: {
      filter: ["p", "div", "section", "blockquote"],
      replacement: (content, node: any) => {
        if (!content.trim()) return content;

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

        // Add block reference marker at the end
        return `\n\n${content} ^${blockId}\n\n`;
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
  // Remove script and style tags completely
  let cleanHtml = html
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
 * parenthetical site info like "(z-library.sk, ...)", and trims whitespace.
 * Short 【...】 like 【第2版】 are preserved.
 */
function cleanEpubTitle(title: string): string {
  return title
    // Remove 【...】 blocks longer than 10 chars (marketing copy, not version tags)
    .replace(/【[^】]{10,}】/g, "")
    // Remove trailing (...) blocks that contain ebook site markers
    .replace(/\s*\([^)]*(?:z-lib|z-library|1lib|epub|mobi|pdf)[^)]*\)/gi, "")
    // Remove trailing standalone CJK author parenthetical at end of string
    // e.g. " (兰小欢)" but NOT "(John Doe)" — only pure CJK names
    .replace(/\s*\(\s*[\u4e00-\u9fff·•\s]{1,10}\)\s*$/, "")
    // Collapse multiple spaces
    .replace(/\s{2,}/g, " ")
    .trim();
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

  // Parse OPF XML
  const opfData = await parseStringPromise(opfXml);
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
    // Strategy: 1) Try <h1>-<h6> tags (strip inner HTML tags), 2) Fall back to first non-empty line of markdown
    // Use [\s\S]*? to match content with nested tags, then strip HTML to get plain text
    const headingMatches = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi);
    let chapterTitle: string;

    if (headingMatches && headingMatches.length > 0) {
      // Collect all heading texts, pick the most descriptive one
      const headingTexts = headingMatches
        .map(m => cleanTitle(m.replace(/<[^>]+>/g, "").trim()))
        .filter(t => t.length > 0);

      // Prefer the longest heading (usually the descriptive subtitle, not just "第N章")
      if (headingTexts.length > 1) {
        // If one heading is short (like "第N章") and another is longer, prefer the longer
        const longest = headingTexts.reduce((a, b) => a.length >= b.length ? a : b);
        const shortest = headingTexts.reduce((a, b) => a.length <= b.length ? a : b);
        // Combine if they're different: "第1章 没有人真的对钱失去理智"
        if (shortest !== longest && shortest.length <= 5) {
          chapterTitle = `${shortest} ${longest}`;
        } else {
          chapterTitle = longest;
        }
      } else {
        chapterTitle = headingTexts[0] || `Chapter ${order + 1}`;
      }
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
