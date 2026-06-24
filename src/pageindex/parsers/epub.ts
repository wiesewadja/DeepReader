/**
 * PageIndex: EPUB parsing module
 * Extracts text content from EPUB e-books
 * Based on obsidian-epub-importer implementation
 */

import * as path from "path";
import AdmZip from "adm-zip";
import TurndownService from "turndown";
import { parseStringPromise } from "xml2js";
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
  blocks: string[],
  strategy?: import("./epub-structure-sampler").EpubParsingStrategy
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
      const sanitized = originalId
        .replace(/_/g, "-")
        .replace(/[^a-zA-Z0-9-]/g, "");
      // Skip Calibre pagebreak markers (calibre-pb-* after sanitization)
      if (sanitized && !/^calibre-pb-\d+$/.test(sanitized)) {
        return sanitized;
      }
    }
    // 无原始ID或为 Calibre 辅助 ID 时使用章节+段落序号，确保跨章节唯一
    return `p${chapterIndex}-${String(paragraphIndex++).padStart(3, "0")}`;
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

    // Paragraphs - add block ID to every paragraph, detect implicit H3 headings
    // Only process leaf paragraph elements (not containers with nested p/div)
    //
    // Implicit heading patterns detected in replacement():
    //   1. "◆ prefix" lines  →  ### text  (Calibre TOC-style)
    //   2. <p><span class="bold*">short text</span></p>  →  ### text  (bold-only paragraphs)
    //   3. <p><a id="xxx"></a>short text</p>  →  ### text  (anchor-only short paragraphs)
    paragraph: {
      filter: (node: any) => {
        const tagName = node.tagName?.toLowerCase();
        if (!["p", "div", "section", "blockquote"].includes(tagName)) {
          return false;
        }
        // Skip Calibre pagebreak markers (id: calibre_pb_N or calibre-pb-N)
        const nodeId = (node.getAttribute?.("id") || "").replace(/_/g, "-");
        if (/^calibre-pb-\d+$/.test(nodeId)) {
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

        // --- Implicit H3 heading detection ---
        const headingText = detectImplicitHeading(node, strategy);
        if (headingText !== null) {
          const cleaned = headingText.replace(/[ \t]+/g, " ").trim();
          if (!cleaned) return "";
          return `\n\n### ${cleaned}\n\n`;
        }

        // --- Regular paragraph processing ---
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
 * Detect if a DOM node is an implicit H3 heading.
 * Returns the heading text (stripped of ◆ prefix) or null.
 *
 * Three patterns:
 *   1. ◆ prefix lines  →  ### text  (Calibre TOC-style)
 *   2. <p><span class="bold*">short text</span></p>  →  ### text  (bold-only paragraphs)
 *   3. <p><a id="xxx"></a>short text</p>  →  ### text  (anchor-only short paragraphs)
 */
export function detectImplicitHeading(
  node: any,
  strategy?: import("./epub-structure-sampler").EpubParsingStrategy
): string | null {
  if (node.nodeName !== "P") return null;

  const nodeText = (node.textContent || "").trim();

  // Pattern 1: ◆ prefix (e.g. "◆ 模仿的心态")
  // Skip when strategy says ◆ lines are TOC entries, not headings
  if (/^◆\s+/.test(nodeText)) {
    if (strategy?.diamondLines === "tocEntries") return null;
    return nodeText.replace(/^◆\s+/, "");
  }

  // Pattern 2: bold span covering entire paragraph content
  const meaningfulChildren = Array.from(node.childNodes).filter((child: any) => {
    if (child.nodeType === 3) return child.textContent.trim().length > 0;
    return child.nodeType === 1;
  });
  if (meaningfulChildren.length === 1) {
    const child = meaningfulChildren[0] as any;
    if (child.nodeType === 1) {
      const tag = child.tagName?.toLowerCase();
      if (tag === "span" || tag === "b" || tag === "strong") {
        const cls = (child.getAttribute("class") || "").toLowerCase();
        if (/(?:^|\s)bold/i.test(cls) || tag === "b" || tag === "strong") {
          if (nodeText.length > 0 && nodeText.length <= 60) return nodeText;
        }
      }
    }
  }

  // Pattern 3: anchor-only short paragraph
  if (nodeText.length > 0 && nodeText.length <= 30) {
    const hasDirectAnchorId = Array.from(node.childNodes).some((child: any) => {
      if (child.nodeType === 1 && child.tagName?.toLowerCase() === "a") {
        return !!child.getAttribute("id");
      }
      return false;
    });
    if (hasDirectAnchorId) return nodeText;
  }

  return null;
}

/**
 * Sentence-ending punctuation patterns (CJK + Latin).
 * A line ending with one of these is considered a complete sentence.
 */
const SENTENCE_END_RE = /[。？！.?!、”’'""”'）》」\d]$/;

/**
 * Block ID pattern at end of a line: ` ^blockId`
 */
const BLOCK_ID_RE = / \^([a-zA-Z0-9_-]+)$/;

/** Check if a markdown line is a heading or image (not a regular paragraph) */
const isSpecialLine = (text: string): boolean =>
  text.startsWith("#") || text.startsWith("![");

/**
 * Merge fragmented paragraphs produced by Calibre-style EPUB splitting.
 *
 * Many EPUBs split one logical paragraph into multiple <p> tags, each
 * containing a single sentence. After Turndown conversion, this results in
 * lines like:
 *
 *   肯·西格尔是史蒂夫·乔布斯的得力助手。在与乔布斯共事的12年时 ^p125
 *   间里，他一直被人们公认为是最具创意的设计师。 ^p595
 *   期就到苹果公司工作了。 ^p596
 *
 * This function merges consecutive fragment lines into single paragraphs,
 * keeping only the last block ID and removing intermediate ones from the
 * blocks array and blockMap.
 *
 * A line is considered a fragment if:
 *   - It is a regular paragraph (has a block ID at the end)
 *   - It does NOT end with sentence-ending punctuation after the block ID
 *   - The next line is also a regular paragraph (not a heading, image, etc.)
 */
export function mergeFragmentedParagraphs(
  markdown: string,
  blocks: string[],
  blockMap: Map<string, string>
): string {
  const lines = markdown.split("\n");
  const result: string[] = [];

  // Track which block IDs to remove (intermediate fragments)
  const blocksToRemove = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if this line is a fragment candidate:
    // - Has a block ID at the end
    // - Text before block ID does NOT end with sentence-ending punctuation
    const blockMatch = trimmed.match(BLOCK_ID_RE);
    if (blockMatch) {
      const textBeforeBlock = trimmed.slice(0, trimmed.length - blockMatch[0].length).trim();
      const blockId = blockMatch[1];

      // Check if this is a heading (starts with #) or image (starts with !)
      if (isSpecialLine(textBeforeBlock)) {
        result.push(line);
        i++;
        continue;
      }

      // Check if the text ends with sentence-ending punctuation
      const endsWithSentenceEnd = SENTENCE_END_RE.test(textBeforeBlock);

      if (!endsWithSentenceEnd) {
        // This is a fragment — try to merge with following lines
        let mergedText = textBeforeBlock;
        const removedBlocks = [blockId];
        let j = i + 1;

        while (j < lines.length) {
          // Skip empty lines between fragments (they're artifacts of \n\n output)
          if (lines[j].trim() === "") {
            j++;
            continue;
          }

          const nextTrimmed = lines[j].trim();
          const nextBlockMatch = nextTrimmed.match(BLOCK_ID_RE);

          // Next line must also be a regular paragraph with block ID
          if (!nextBlockMatch) break;

          const nextText = nextTrimmed.slice(0, nextTrimmed.length - nextBlockMatch[0].length).trim();

          // Don't merge with headings or images
          if (isSpecialLine(nextText)) break;

          mergedText += nextText;
          removedBlocks.push(nextBlockMatch[1]);

          // If this merged line ends with sentence punctuation, stop merging
          if (SENTENCE_END_RE.test(nextText)) {
            j++;
            break;
          }

          j++;
        }

        // Only actually merge if we found at least one fragment to merge with
        if (j > i + 1) {
          // Keep the last block ID
          const lastBlockId = removedBlocks[removedBlocks.length - 1];
          result.push(`\n${mergedText} ^${lastBlockId}`);

          // Remove all intermediate block IDs
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

  // Clean up blocks array and blockMap
  if (blocksToRemove.size > 0) {
    // Remove from blockMap entries pointing to removed block IDs
    for (const rb of blocksToRemove) {
      for (const [key, val] of blockMap.entries()) {
        if (val === rb) {
          blockMap.delete(key);
        }
      }
    }

    // Filter blocks array
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

/**
 * Extract text from HTML content using Turndown with block IDs
 * @param html - Raw HTML content
 * @param chapterIndex - Chapter index for block ID generation
 * @returns Object with markdown content, blockMap, and blocks array
 */
function extractTextFromHTMLWithBlocks(
  html: string,
  chapterIndex: number,
  strategy?: import("./epub-structure-sampler").EpubParsingStrategy
): { content: string; blockMap: Map<string, string>; blocks: string[] } {
  // Remove <head> entirely — some Kobo EPUBs use self-closing <title/>
  // which DOMParser in text/html mode treats as an opening <title> tag,
  // causing the entire document body to be swallowed into the title element.
  const cleanHtml = html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Create block tracking structures
  const blockMap = new Map<string, string>();
  const blocks: string[] = [];

  const turndown = createTurndownServiceWithBlocks(chapterIndex, blockMap, blocks, strategy);
  let markdown = turndown.turndown(cleanHtml);

  // Merge fragmented paragraphs
  // Many EPUBs (especially Calibre-converted) split one logical paragraph
  // into multiple <p> tags (one sentence each). This produces many short
  // lines each with their own block ID. We merge consecutive fragments
  // that don't end with sentence-ending punctuation into single paragraphs.
  markdown = mergeFragmentedParagraphs(markdown, blocks, blockMap);

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

/** NCX TOC entry */
interface NcxTocEntry {
  text: string;
  src: string; // "file#anchor" or just "file"
}

/** Section extracted from HTML split at NCX anchor */
interface HtmlSection {
  title: string;
  anchor: string;
  html: string;
}

/**
 * Parse NCX TOC entries from EPUB zip.
 * Returns entries with text and src (file#anchor).
 */
function parseNcxToc(zip: AdmZip, basePath: string): NcxTocEntry[] {
  const ncxFiles = zip.getEntries().filter((e) => e.entryName.endsWith(".ncx"));
  if (ncxFiles.length === 0) return [];
  const ncxXml = ncxFiles[0].getData().toString("utf-8");

  // Match <navLabel><text>...</text></navLabel> followed by <content src="..."/>
  // This avoids matching <docTitle><text> which causes offset issues
  const labelSrcRegex = /<navLabel>\s*<text>([^<]+)<\/text>\s*<\/navLabel>\s*<content\s+src="([^"]+)"/g;

  const entries: NcxTocEntry[] = [];
  let match;
  while ((match = labelSrcRegex.exec(ncxXml)) !== null) {
    const text = match[1].trim();
    const src = match[2];
    if (text) entries.push({ text, src });
  }
  return entries;
}

/**
 * Group NCX entries by source file.
 * NCX src uses relative paths; we need to match against manifestMap's full paths.
 * Returns map: fullFilePath → entries for that file.
 */
function groupNcxEntriesByFile(
  entries: NcxTocEntry[],
  basePath: string
): Map<string, NcxTocEntry[]> {
  const result = new Map<string, NcxTocEntry[]>();
  for (const entry of entries) {
    const [file] = entry.src.split("#");
    const fullPath = path.join(basePath, file).replace(/\\/g, "/");
    if (!result.has(fullPath)) result.set(fullPath, []);
    result.get(fullPath)!.push(entry);
  }
  return result;
}

/**
 * Split HTML at NCX anchor points.
 *
 * Finds each anchor in the HTML, then extracts the content between
 * that anchor and the next one. Returns one HtmlSection per NCX entry.
 */
function splitHtmlByAnchors(
  html: string,
  entries: NcxTocEntry[]
): HtmlSection[] {
  // Find anchor positions in HTML
  interface AnchorPos {
    anchor: string;
    title: string;
    index: number;
  }

  const positions: AnchorPos[] = [];

  for (const entry of entries) {
    const anchor = entry.src.split("#")[1];
    if (!anchor) {
      // No anchor — skip (file-level entry like cover page)
      continue;
    }

    // Try multiple patterns to find the anchor in HTML
    const patterns = [
      // <a id="anchor">
      new RegExp(`<a[^>]*id="${escapeRegex(anchor)}"[^>]*>`, "i"),
      // id="anchor" on any element
      new RegExp(`id="${escapeRegex(anchor)}"`, "i"),
      // <span id="anchor">
      new RegExp(`<span[^>]*id="${escapeRegex(anchor)}"[^>]*>`, "i"),
      // name="anchor" (old HTML)
      new RegExp(`name="${escapeRegex(anchor)}"`, "i"),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match) {
        positions.push({
          anchor,
          title: entry.text,
          index: match.index,
        });
        break;
      }
    }
  }

  // Sort by position in HTML
  positions.sort((a, b) => a.index - b.index);

  if (positions.length === 0) {
    // No anchors found — return entire HTML as one section
    return [{ title: entries[0]?.text || "Section", anchor: "start", html }];
  }

  // Split at positions
  const sections: HtmlSection[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const end = i + 1 < positions.length ? positions[i + 1].index : html.length;
    const sectionHtml = html.substring(start, end);
    sections.push({
      title: positions[i].title,
      anchor: positions[i].anchor,
      html: sectionHtml,
    });
  }

  return sections;
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse EPUB file
 */
export async function parseEpub(
  input: string | Buffer,
  strategy?: import("./epub-structure-sampler").EpubParsingStrategy
): Promise<EpubInfo> {
  let zip: AdmZip;

  if (typeof input === "string") {
    // File path
    zip = new AdmZip(input);
  } else {
    // Buffer
    zip = new AdmZip(input);
  }

  // Auto-infer strategy if not provided
  if (!strategy) {
    const { inferStrategyFromZip } = await import("./epub-structure-sampler");
    strategy = inferStrategyFromZip(zip);
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

  // Extract cover image (multiple fallback strategies)
  let coverImage: EpubCoverImage | undefined;

  // Strategy 1: EPUB 3.0 — manifest item with properties="cover-image"
  const coverManifestItem = manifest.find(
    (item: any) => item.$.properties?.includes("cover-image")
  );
  // Strategy 2: EPUB 2.0 — <meta name="cover" content="manifest-id">
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

  // Strategy 3: EPUB 2.0 — <guide><reference type="cover" href="..."/>
  // Some EPUBs use guide instead of meta for cover reference.
  // Note: guide href may point to an HTML cover page, not an image directly.
  // Only use it if the href extension looks like an image file.
  if (!coverImage) {
    const guide = packageData.guide?.[0]?.reference || [];
    const coverGuideRef = guide.find((ref: any) =>
      ref.$.type === "cover" || ref.$.type === "other.ms-coverimage"
    );
    if (coverGuideRef?.$.href) {
      const guideHref = path.join(basePath, coverGuideRef.$.href).replace(/\\/g, "/");
      const ext = path.extname(guideHref).toLowerCase();
      const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
      if (imageExts.includes(ext)) {
        const guideEntry = zip.getEntry(guideHref);
        if (guideEntry) {
          coverImage = {
            name: `cover${ext}`,
            data: guideEntry.getData(),
            mediaType: "image/jpeg",
          };
        }
      }
    }
  }

  // Strategy 4: Search manifest for common cover image names
  if (!coverImage) {
    const coverPatterns = ["cover", "coverimage", "cover-image", "titlepage"];
    for (const item of manifest) {
      const id = (item.$.id || "").toLowerCase();
      const href = (item.$.href || "").toLowerCase();
      const properties = item.$.properties || "";
      const mediaType = ((item.$ as Record<string, string>)["media-type"] || "").toLowerCase();
      const isImage = mediaType.startsWith("image/");
      if (!isImage) continue;
      const match = coverPatterns.some(p => id.includes(p) || href.includes(p));
      if (match && !properties.includes("nav")) {
        const coverHref = manifestMap.get(item.$.id);
        if (coverHref) {
          const coverEntry = zip.getEntry(coverHref);
          if (coverEntry) {
            const ext = path.extname(coverHref).toLowerCase();
            coverImage = {
              name: `cover${ext || ".jpg"}`,
              data: coverEntry.getData(),
              mediaType: "image/jpeg",
            };
            break;
          }
        }
      }
    }
  }

  // Extract chapters
  const chapters: EpubChapter[] = [];
  let order = 0;

  // ─── Load NCX TOC for title mapping ───
  // Build href → first-title mapping from NCX TOC, used for all parsing paths.
  // Uses groupNcxEntriesByFile to avoid docTitle <text> tag offset issue.
  const ncxEntries = parseNcxToc(zip, basePath);
  const ncxByFile = groupNcxEntriesByFile(ncxEntries, basePath);
  const ncxTitleMap = new Map<string, string>();
  for (const [fileHref, entries] of ncxByFile) {
    if (entries.length > 0 && entries[0].text) {
      ncxTitleMap.set(fileHref, entries[0].text);
    }
  }

  // ─── Strategy-driven path: NCX anchor splitting ───
  if (strategy?.splitStrategy === "ncxAnchors") {

    for (const id of readingOrder) {
      const href = manifestMap.get(id);
      if (!href) continue;
      // href already includes basePath (manifestMap stores full paths)
      const entry = zip.getEntry(href);
      if (!entry) continue;
      const html = entry.getData().toString("utf-8");

      // Get NCX entries for this file
      const fileEntries = ncxByFile.get(href) || [];
      if (fileEntries.length === 0) {
        // No NCX entries for this file — skip or keep as-is
        const result = extractTextFromHTMLWithBlocks(html, order, strategy);
        if (result.content.trim()) {
          chapters.push({
            id,
            title: `Section ${order + 1}`,
            content: result.content,
            tokenCount: countTokens(result.content),
            order: order++,
            href,
            blockMap: result.blockMap,
            blocks: result.blocks,
          });
        }
        continue;
      }

      // Split HTML at NCX anchor points
      const sections = splitHtmlByAnchors(html, fileEntries);

      for (const section of sections) {
        if (!section.html.trim()) continue;

        // Skip noise entries (书名页, 版权页, 目录, etc.)
        const noiseKeywords = ["书名页", "版权页", "扉页", "目录",
          "版权信息", "图书在版编目", "CIP"];
        if (noiseKeywords.some(kw => section.title.includes(kw))) continue;

        const result = extractTextFromHTMLWithBlocks(section.html, order, strategy);

        // Skip empty/image-only sections
        const textOnly = result.content
          .replace(/#!\[[^\]]*\]\([^)]*\)/g, "")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
          .replace(/[^\w\u4e00-\u9fff]/g, "")
          .trim();
        if (textOnly.length === 0) continue;

        // Use NCX text as title (strategy: titleSource=ncxText)
        const chapterTitle = strategy?.titleSource === "ncxText"
          ? section.title
          : `Chapter ${order + 1}`;

        chapters.push({
          id: `${id}#${section.anchor}`,
          title: chapterTitle,
          content: result.content,
          tokenCount: countTokens(result.content),
          order: order++,
          href: `${href}#${section.anchor}`,
          blockMap: result.blockMap,
          blocks: result.blocks,
        });
      }
    }
  } else {
  // ─── Default path: one chapter per spine item ───

  for (const id of readingOrder) {
    const href = manifestMap.get(id);
    if (!href) continue;

    const entry = zip.getEntry(href);
    if (!entry) continue;

    const html = entry.getData().toString("utf-8");
    const result = extractTextFromHTMLWithBlocks(html, order, strategy);

    // Skip noise pages (书名页, 版权页, etc.) based on NCX title or content
    const ncxTitle = ncxTitleMap.get(href);
    const noiseKeywords = ["书名页", "版权页", "扉页", "目录",
      "版权信息", "图书在版编目", "CIP", "献给"];
    if (ncxTitle && noiseKeywords.some(kw => ncxTitle.includes(kw))) {
      order++;
      continue;
    }

    // Extract chapter title
    // Priority: 1) NCX TOC title (most reliable), 2) <h1>-<h6> tags, 3) first line
    let chapterTitle: string;

    // 1. Try NCX title first
    if (ncxTitle) {
      chapterTitle = cleanTitle(ncxTitle);
    } else {
      // 2. Try <h1>-<h6> tags
      const headingLevelMatches = html.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi);

      if (headingLevelMatches && headingLevelMatches.length > 0) {
        // Group by heading level to prefer higher-level headings (h1 > h2 > ...)
        const byLevel: Record<string, string[]> = {};
        for (const m of headingLevelMatches) {
          const levelMatch = m.match(/^<h([1-6])/i);
          const level = levelMatch ? levelMatch[1] : "6";
          let text = cleanTitle(m.replace(/<[^>]+>/g, "").trim());
          // If heading text is empty (e.g. <h1><img/></h1>), try title attribute
          if (text.length === 0) {
            const titleAttr = m.match(/title=["']([^"']+)["']/i);
            if (titleAttr) {
              text = cleanTitle(titleAttr[1].trim());
            }
          }
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
              // Combine chapter number + subtitle (e.g. "第1章" + "导言" → "第1章 导言")
              if (first.length <= 8) {
                pickedTitle = texts.slice(0, 2).join(" ");
              } else {
                const longest = texts.reduce((a, b) => a.length >= b.length ? a : b);
                if (first !== longest && first.length <= 5 && longest.length > first.length) {
                  pickedTitle = `${first} ${longest}`;
                } else {
                  pickedTitle = first;
                }
              }
            } else {
              pickedTitle = texts[0];
            }
            break;
          }
        }
        chapterTitle = pickedTitle || `Chapter ${order + 1}`;
      } else {
        // 3. No heading tag: use first non-empty line of markdown as title
        const firstLine = result.content.split("\n").find(l => l.trim().length > 0);
        // Strip block ID marker from the end
        let rawTitle = firstLine
          ? firstLine.replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, "").trim()
          : "";
        // If the line contains links, extract only the text BEFORE the first link.
        // This handles TOC pages where first line is "目录[[link1|text1]][[link2|text2]]"
        if (rawTitle.includes("[[") || /\]\(/.test(rawTitle)) {
          const beforeFirstLink = rawTitle.split(/\[\[/)[0].trim();
          if (beforeFirstLink.length > 0) {
            rawTitle = beforeFirstLink;
          } else {
            // If no text before links, extract alias from first wiki link
            const aliasMatch = rawTitle.match(/\[\[[^\]|]*\|([^\]]*)\]\]/);
            if (aliasMatch) {
              rawTitle = aliasMatch[1];
            }
          }
        }
        chapterTitle = cleanTitle(rawTitle) || `Chapter ${order + 1}`;
        // Truncate overly long titles
        if (chapterTitle.length > 50) {
          chapterTitle = chapterTitle.substring(0, 20).trim();
        }
      }
    }

    // Skip cover/image-only pages
    // Case 1: title looks like a markdown image
    if (chapterTitle.startsWith("![") || chapterTitle.startsWith("![Cover")) {
      order++;
      continue;
    }
    // Case 2: content is empty or only contains images (e.g. Part divider pages)
    const textOnlyContent = result.content
      .replace(/#!\[[^\]]*\]\([^)]*\)/g, "")  // remove H1 image lines
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")    // remove all images
      .replace(/[^\w\u4e00-\u9fff]/g, "")      // keep only word chars and CJK
      .trim();
    if (textOnlyContent.length === 0) {
      // Image-only page: skip if it doesn't have meaningful text in title
      // But keep it if the title comes from heading tag with useful text
      // (e.g. "第一部分　预测" from h1 title attribute)
      if (chapterTitle.startsWith("Chapter ") || chapterTitle.length === 0) {
        order++;
        continue;
      }
      // Part divider with meaningful title: keep as lightweight chapter
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

  } // end else (default path)

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
      // 提取 part 第一行的 heading 全文：匹配 prefix（# / ## / 第X章 / Chapter N / Part X），
      // 取 prefix 之后的 heading 文本，而不是把 prefix 本身当作 title
      // 例: "## 判断的价值" → prefix "## " → slice 后 "判断的价值" → cleanTitle 标准化
      const firstLine = part.split("\n", 1)[0];
      const titleMatch = firstLine.match(EPUB_TITLE_PREFIX);
      let title: string;
      if (titleMatch) {
        const headingText = cleanTitle(firstLine.slice(titleMatch[0].length));
        // 防御: cleanTitle 把 heading 文本清空时（如 "## " 单独成行），回退到 chapter.title
        title = headingText || chapter.title;
      } else if (j === 0) {
        title = chapter.title;
      } else {
        title = `Section ${newChapters.length + 1}`;
      }
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
