/**
 * EPUB Structure Sampler & Strategy Inferrer
 *
 * Extracts a compact structural fingerprint from an EPUB file,
 * then uses deterministic rules to infer a parsing strategy.
 *
 * The strategy tells parseEpub() how to handle this specific EPUB:
 * - Where to get chapter titles from (HTML <h> tags vs NCX TOC)
 * - How to detect sub-section headings
 * - Whether to split bulk files using NCX anchors
 * - What ◆-prefixed lines mean (TOC entries vs section headings)
 *
 * Optionally, an LLM can be called to refine the strategy
 * (see analyzeWithLLM), but the rule-based inferencer is sufficient
 * for most cases.
 */


import type AdmZip from "adm-zip";
import { nodePath } from "../../utils/node-compat.js";


// ─── Strategy interface ─────────────────────────────────────────

export interface EpubParsingStrategy {
  /** HTML structure type */
  htmlStructure: "perChapter" | "bulkPdf" | "mixed";
  /** How to detect chapter headings in HTML */
  headingDetection: "hTags" | "boldClass" | "ncxOnly";
  /** How to detect sub-section headings */
  sectionDetection: "h2h3" | "boldShort" | "none";
  /** What ◆-prefixed lines represent */
  diamondLines: "tocEntries" | "sectionHeadings" | "notPresent";
  /** Where to get chapter titles */
  titleSource: "hTag" | "ncxText";
  /** Whether to split using NCX anchors */
  splitStrategy: "ncxAnchors" | "none";
}

// ─── Structure stats (per spine item) ───────────────────────────

interface SpineStats {
  href: string;
  size: number;
  hCounts: Record<string, number>; // "1" → count of <h1>, etc.
  pCount: number;
  diamondCount: number;
  anchorIds: string[]; // sample of id/name attributes
  boldPatterns: string[]; // sample of <b>/<strong> with short text
}

// ─── NCX TOC entry ──────────────────────────────────────────────

interface TocEntry {
  text: string;
  src: string; // file#anchor or just file
}

// ─── Extract structure sample ───────────────────────────────────

/**
 * Extract a compact structural fingerprint from an EPUB zip.
 *
 * Returns a ~2KB text summary containing:
 * - Spine count and HTML file count
 * - Per-spine-item stats (heading tag counts, <p> counts, ◆ count,
 *   anchor IDs, bold patterns)
 * - NCX TOC entry list
 *
 * This sample can be fed to an LLM for analysis, but is primarily
 * used by the rule-based strategy inferrer.
 */
export function extractEpubStructureSample(zip: AdmZip): string {
  const { opfPath, basePath, opfXml } = parseOpfMeta(zip);
  const { spineIds, manifestMap } = parseOpfContent(opfXml);

  // Collect spine stats
  const spineStats: SpineStats[] = [];
  for (const id of spineIds) {
    const href = manifestMap.get(id);
    if (!href) continue;
    const fullPath = nodePath().join(basePath, href).replace(/\\/g, "/");
    const entry = zip.getEntry(fullPath);
    if (!entry) continue;
    const html = entry.getData().toString("utf-8");
    spineStats.push(computeSpineStats(href, html));
  }

  // Extract NCX TOC
  const tocEntries = extractNcxToc(zip, basePath);

  // Format output
  let out = "";
  out += `spine: ${spineStats.length}\n`;

  for (let i = 0; i < spineStats.length; i++) {
    const s = spineStats[i];
    out += `\n--- spine[${i}] ${s.href} (${(s.size / 1024).toFixed(1)}KB) ---\n`;
    for (let lvl = 1; lvl <= 6; lvl++) {
      const count = s.hCounts[String(lvl)] || 0;
      if (count > 0 || lvl <= 3) {
        out += `<h${lvl}>: ${count}\n`;
      }
    }
    out += `<p>: ${s.pCount}\n`;
    out += `◆: ${s.diamondCount}\n`;

    if (s.anchorIds.length > 0) {
      const sample = s.anchorIds.slice(0, 5).join(", ");
      out += `anchors: ${sample}\n`;
    }
    if (s.boldPatterns.length > 0) {
      const sample = s.boldPatterns.slice(0, 3).join("; ");
      out += `bold: ${sample}\n`;
    }
  }

  if (tocEntries.length > 0) {
    out += `\n--- NCX TOC (${tocEntries.length} entries) ---\n`;
    for (let i = 0; i < tocEntries.length; i++) {
      out += `${i + 1}. ${tocEntries[i].text}\n`;
    }
  }

  return out;
}

// ─── Infer strategy from zip ────────────────────────────────────

/**
 * Infer a parsing strategy from an EPUB zip using deterministic rules.
 *
 * This is a pure function — no LLM, no network, no side effects.
 * It examines structural signals (spine count, heading tags, NCX TOC,
 * ◆ counts, bold patterns) and produces a strategy.
 */
export function inferStrategyFromZip(zip: AdmZip): EpubParsingStrategy {
  const { basePath, opfXml } = parseOpfMeta(zip);
  const { spineIds, manifestMap } = parseOpfContent(opfXml);

  // Collect stats across all spine items
  const allStats: SpineStats[] = [];
  for (const id of spineIds) {
    const href = manifestMap.get(id);
    if (!href) continue;
    const fullPath = nodePath().join(basePath, href).replace(/\\/g, "/");
    const entry = zip.getEntry(fullPath);
    if (!entry) continue;
    const html = entry.getData().toString("utf-8");
    allStats.push(computeSpineStats(href, html));
  }

  // ─── Aggregate signals ───

  const totalH = allStats.reduce(
    (sum, s) => sum + Object.values(s.hCounts).reduce((a, b) => a + b, 0),
    0
  );
  const totalDiamond = allStats.reduce(
    (sum, s) => sum + s.diamondCount,
    0
  );

  // "Meaningful" bold patterns: exclude CIP, dots, very short fragments,
  // and only count bold in files that have substantial paragraph content.
  // Bold text in copyright/CIP pages, reading guides, and TOC pages
  // is NOT a heading signal.
  //
  // We require pCount >= 30 to filter out guide/TOC pages that happen
  // to have bold text (e.g., 反脆弱's reading guide has 11 <p> tags
  // with "第一卷" etc. as bold but it's a summary, not structure).
  const substantialContentFiles = allStats.filter((s) => s.pCount >= 30);
  const meaningfulBold = substantialContentFiles.some((s) =>
    s.boldPatterns.some(
      (b) =>
        b.length >= 4 &&
        !/^[·\.\-\s]+$/.test(b) &&
        !b.startsWith("版权") &&
        !b.startsWith("图书在版编目") &&
        !/^图\d/.test(b) &&
        !/^表\s*\d/.test(b)
    )
  );

  // Does any file have MULTIPLE <h> tags (not just one chapter heading)?
  const filesWithMultipleH = allStats.filter(
    (s) => Object.values(s.hCounts).reduce((a, b) => a + b, 0) > 1
  );
  // Does any file have <h3>+ tags (sub-section level)?
  const filesWithSubHeadings = allStats.filter(
    (s) => (s.hCounts["3"] || 0) + (s.hCounts["4"] || 0) + (s.hCounts["5"] || 0) + (s.hCounts["6"] || 0) > 0
  );

  // NCX TOC
  const tocEntries = extractNcxToc(zip, basePath);
  const ncxCount = tocEntries.length;

  // ─── htmlStructure ───
  // bulkPdf: few spine items (≤6), NCX >> spine count
  //   → content packed into 1-2 large HTML files
  // mixed: moderate spine (7-15), multiple <h> per file
  //   → chapters packed into groups, each file has sub-chapters
  // perChapter: many spine items, typically 1 <h> per file
  let htmlStructure: EpubParsingStrategy["htmlStructure"];
  if (spineIds.length <= 6 && ncxCount > spineIds.length * 3) {
    htmlStructure = "bulkPdf";
  } else if (spineIds.length <= 15 && filesWithMultipleH.length > 0) {
    htmlStructure = "mixed";
  } else {
    htmlStructure = "perChapter";
  }

  // ─── headingDetection ───
  // hTags: <h1>-<h6> tags exist in CONTENT files (not just cover pages)
  // boldClass: meaningful bold patterns in content files
  // ncxOnly: content files have no structural headings at all
  //
  // Key: only count <h> tags from files with actual paragraph content.
  // Cover pages, CIP pages, and image-only pages may have <h1> but they
  // don't indicate the book uses <h> tags for chapter structure.
  //
  // For bulkPdf books, always use ncxOnly: these books have poor HTML
  // structure (pdftohtml output), and bold patterns are unreliable
  // (TOC listings, CIP data, cover text).
  // contentFiles: files with real paragraph content (used for h tag counting)
  const contentFiles = allStats.filter((s) => s.pCount >= 10);
  const contentTotalH = contentFiles.reduce(
    (sum, s) => sum + Object.values(s.hCounts).reduce((a, b) => a + b, 0),
    0
  );
  let headingDetection: EpubParsingStrategy["headingDetection"];
  if (htmlStructure === "bulkPdf") {
    headingDetection = "ncxOnly";
  } else if (contentTotalH > 0) {
    headingDetection = "hTags";
  } else if (meaningfulBold) {
    headingDetection = "boldClass";
  } else {
    headingDetection = "ncxOnly";
  }

  // ─── sectionDetection ───
  // h2h3: files contain <h3>+ tags (sub-chapter level headings)
  // boldShort: meaningful bold patterns in perChapter/mixed files
  // none: only one <h> per file (chapter-level only)
  //
  // Only look for bold sub-sections when:
  // - The book uses <h> for chapter headings (headingDetection === "hTags")
  // - There are meaningful bold patterns in substantial content files
  // - Not a bulkPdf book
  let sectionDetection: EpubParsingStrategy["sectionDetection"];
  if (filesWithSubHeadings.length > 0) {
    sectionDetection = "h2h3";
  } else if (meaningfulBold && headingDetection === "hTags" && htmlStructure !== "bulkPdf") {
    sectionDetection = "boldShort";
  } else {
    sectionDetection = "none";
  }

  // ─── diamondLines ───
  // In bulkPdf books, ◆ lines are TOC entries listed at chapter start
  // In perChapter/mixed books, ◆ are section headings
  let diamondLines: EpubParsingStrategy["diamondLines"];
  if (totalDiamond === 0) {
    diamondLines = "notPresent";
  } else if (htmlStructure === "bulkPdf") {
    diamondLines = "tocEntries";
  } else {
    diamondLines = "sectionHeadings";
  }

  // ─── titleSource ───
  // ncxText: when HTML has no headings, or NCX provides better granularity
  // hTag: when HTML has reliable <h> tags per chapter
  let titleSource: EpubParsingStrategy["titleSource"];
  if (
    headingDetection === "ncxOnly" ||
    htmlStructure === "bulkPdf" ||
    ncxCount > spineIds.length * 2
  ) {
    titleSource = "ncxText";
  } else {
    titleSource = "hTag";
  }

  // ─── splitStrategy ───
  // ncxAnchors: bulkPdf files need splitting at NCX anchor points
  // none: already split per chapter
  let splitStrategy: EpubParsingStrategy["splitStrategy"];
  if (htmlStructure === "bulkPdf" && ncxCount > 0) {
    const hasAnchors = tocEntries.some((e) => e.src.includes("#"));
    splitStrategy = hasAnchors ? "ncxAnchors" : "none";
  } else {
    splitStrategy = "none";
  }

  return {
    htmlStructure,
    headingDetection,
    sectionDetection,
    diamondLines,
    titleSource,
    splitStrategy,
  };
}

// ─── Internal helpers ───────────────────────────────────────────

/** Parse OPF metadata from EPUB zip */
function parseOpfMeta(zip: AdmZip): {
  opfPath: string;
  basePath: string;
  opfXml: string;
} {
  const containerXml = zip
    .getEntry("META-INF/container.xml")!
    .getData()
    .toString("utf-8");
  const opfPath = containerXml.match(/full-path=["']([^"']+)["']/)![1];
  const basePath = nodePath().dirname(opfPath);
  const opfXml = zip.getEntry(opfPath)!.getData().toString("utf-8");
  return { opfPath, basePath, opfXml };
}

/** Parse OPF content to get spine IDs and manifest map */
function parseOpfContent(opfXml: string): {
  spineIds: string[];
  manifestMap: Map<string, string>;
} {
  const spineIds = [...opfXml.matchAll(/<itemref\s+idref="([^"]+)"/g)].map(
    (m) => m[1]
  );
  // Manifest items may have id and href in either order:
  //   <item id="x" href="y" .../>   OR   <item href="y" id="x" .../>
  const manifestItems = [
    ...opfXml.matchAll(/<item\s+[^>]*?>/g),
  ];
  const manifestMap = new Map<string, string>();
  for (const m of manifestItems) {
    const tag = m[0];
    const idMatch = tag.match(/id="([^"]+)"/);
    const hrefMatch = tag.match(/href="([^"]+)"/);
    if (idMatch && hrefMatch) {
      manifestMap.set(idMatch[1], hrefMatch[1]);
    }
  }
  return { spineIds, manifestMap };
}

/** Compute structural stats for one spine item's HTML */
function computeSpineStats(href: string, html: string): SpineStats {
  const hCounts: Record<string, number> = {};
  for (const m of html.matchAll(/<h([1-6])[\s>]/gi)) {
    const lvl = m[1];
    hCounts[lvl] = (hCounts[lvl] || 0) + 1;
  }

  const pCount = (html.match(/<p[\s>]/gi) || []).length;
  const diamondCount = (html.match(/◆/g) || []).length;

  // Sample anchor IDs
  const anchorIds = [
    ...html.matchAll(/(?:id|name)="([^"]+)"/gi),
  ]
    .map((m) => m[1])
    .filter((id) => !id.startsWith("calibre_pb_"))
    .slice(0, 10);

  // Sample bold patterns with short text
  const boldPatterns: string[] = [];
  for (const m of html.matchAll(
    /<(?:b|strong|span[^>]*class="[^"]*bold[^"]*")[^>]*>([^<]{1,60})<\/(?:b|strong|span)>/gi
  )) {
    if (boldPatterns.length < 5) {
      boldPatterns.push(m[1].trim());
    }
  }

  return {
    href,
    size: html.length,
    hCounts,
    pCount,
    diamondCount,
    anchorIds,
    boldPatterns,
  };
}

/** Extract NCX TOC entries from EPUB zip */
function extractNcxToc(zip: AdmZip, basePath: string): TocEntry[] {
  const ncxFiles = zip.getEntries().filter((e) =>
    e.entryName.endsWith(".ncx")
  );
  if (ncxFiles.length === 0) return [];

  const ncxXml = ncxFiles[0].getData().toString("utf-8");
  const textMatches = [...ncxXml.matchAll(/<text>([^<]+)<\/text>/g)];
  const srcMatches = [...ncxXml.matchAll(/<content\s+src="([^"]+)"/g)];

  const entries: TocEntry[] = [];
  for (
    let i = 0;
    i < Math.min(textMatches.length, srcMatches.length);
    i++
  ) {
    const text = textMatches[i][1].trim();
    const src = srcMatches[i][1];
    if (text) {
      entries.push({ text, src });
    }
  }
  return entries;
}
