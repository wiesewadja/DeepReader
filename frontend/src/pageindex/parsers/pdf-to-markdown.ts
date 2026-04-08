/**
 * PDF to Markdown converter using font-based structure detection
 *
 * Uses pdfjs-dist (already installed) to extract font size and style info,
 * then classifies text into heading levels based on relative font sizes.
 */

import * as fs from "fs/promises";
import { resolve } from "path";

// ─── pdfjs-dist lazy loader ────────────────────────────────────────────────────

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let _pdfjs: PdfjsModule | null | undefined;

async function getPdfjs(): Promise<PdfjsModule | null> {
  if (_pdfjs !== undefined) return _pdfjs;
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Set worker to actual file path (required for Bun runtime)
    const workerPath = resolve(
      typeof __dirname !== "undefined"
        ? __dirname
        : ".",
      "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
    );
    mod.GlobalWorkerOptions.workerSrc = workerPath;
    _pdfjs = mod;
  } catch {
    _pdfjs = null;
  }
  return _pdfjs;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface RichTextItem {
  str: string;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  isBold: boolean;
  isItalic: boolean;
  x: number;
  y: number;
  hasEOL: boolean;
  width: number;
}

interface Line {
  items: RichTextItem[];
  y: number;
}

interface FontStats {
  /** Most common font size (= body text size) */
  bodySize: number;
  max: number;
}

export interface ConversionOptions {
  /** Include <!-- Page N --> markers in output */
  includePageMarkers?: boolean;
  /** Document title for the first heading */
  title?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function computeFontSize(transform: number[]): number {
  const direct = Math.abs(transform[3]);
  if (direct > 0) return Math.round(direct * 2) / 2;
  return Math.round(Math.sqrt(transform[0] ** 2 + transform[1] ** 2) * 2) / 2;
}

function isBold(fontName: string, fontFamily: string): boolean {
  return /bold|heavy|black|demi/i.test(fontName) || /bold|heavy|black|demi/i.test(fontFamily);
}

function isItalic(fontName: string, fontFamily: string): boolean {
  return /italic|oblique/i.test(fontName) || /italic|oblique/i.test(fontFamily);
}

function computeFontStats(sizes: number[]): FontStats {
  const counts = new Map<number, number>();
  for (const s of sizes) {
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let bodySize = 12;
  let maxCount = 0;
  for (const [size, count] of counts) {
    if (count > maxCount && size > 0) {
      maxCount = count;
      bodySize = size;
    }
  }
  return { bodySize, max: Math.max(...counts.keys()) };
}

// ─── Table detection ──────────────────────────────────────────────────────────

interface TableRegion {
  startLineIdx: number;
  endLineIdx: number;
  /** Average X position of each column cluster */
  columnXs: number[];
}

/**
 * Cluster X positions by proximity into column groups.
 * Returns the average X of each cluster, sorted ascending.
 */
function clusterXPositions(
  allX: number[],
  proximity: number
): number[] {
  if (allX.length === 0) return [];
  const sorted = [...allX].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = clusters[clusters.length - 1];
    if (sorted[i] - prev[prev.length - 1] <= proximity) {
      prev.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

/**
 * Count how many significant column gaps a line has.
 * A gap is "significant" if the space between two adjacent items' edges
 * exceeds `gapThreshold`.
 */
function countColumnGaps(line: Line, gapThreshold: number): number {
  let gaps = 0;
  for (let j = 0; j < line.items.length - 1; j++) {
    const rightEdge = line.items[j].x + line.items[j].width;
    if (line.items[j + 1].x - rightEdge >= gapThreshold) {
      gaps++;
    }
  }
  return gaps;
}

/**
 * Detect table regions in a page's lines.
 * A table region is a group of consecutive lines where each has >= 2 column gaps
 * (i.e., >= 3 visual columns) and column X positions align.
 */
function detectTableRegions(lines: Line[], bodySize: number): TableRegion[] {
  const gapThreshold = bodySize * 2; // Minimum gap between columns
  const colProximity = bodySize * 3; // Clustering tolerance for column detection

  const tables: TableRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Need >= 3 items and >= 2 significant gaps for a potential table header
    if (line.items.length < 3 || countColumnGaps(line, gapThreshold) < 2) {
      i++;
      continue;
    }

    // Collect X positions of items in the header row
    const headerXs = line.items.map((it) => it.x);

    // Extend: look for consecutive lines with items at similar X positions
    let endIdx = i;
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      // A line belongs to the table if it has items near known column positions
      const alignsWithTable = nextLine.items.some((item) =>
        headerXs.some((hx) => Math.abs(item.x - hx) < colProximity)
      );
      // Or if it has its own multi-column structure (new column text)
      const hasMultiCol =
        nextLine.items.length >= 2 &&
        countColumnGaps(nextLine, gapThreshold) >= 1;

      if (alignsWithTable || hasMultiCol) {
        endIdx = j;
      } else {
        break;
      }
    }

    // Need at least 3 rows (header + 2 data) to be a table
    if (endIdx - i >= 2) {
      // Collect ALL X positions from the table region to determine column boundaries
      const allItemXs: number[] = [];
      for (let k = i; k <= endIdx; k++) {
        for (const item of lines[k].items) {
          allItemXs.push(item.x);
        }
      }
      const columnXs = clusterXPositions(allItemXs, colProximity);

      // Only create table if we detected >= 3 columns
      if (columnXs.length >= 3) {
        tables.push({ startLineIdx: i, endLineIdx: endIdx, columnXs });
        i = endIdx + 1;
        continue;
      }
    }

    i++;
  }

  return tables;
}

/**
 * Merge multiple physical lines into a single logical row.
 * For each column, concatenate text from all physical lines.
 */
function mergePhysLines(
  physLineIndices: number[],
  lines: Line[],
  columnXs: number[],
  bodySize: number
): string[] {
  const numCols = columnXs.length;
  const cells: string[] = Array(numCols).fill("");
  const proximity = bodySize * 3;

  for (const idx of physLineIndices) {
    for (const item of lines[idx].items) {
      // Find nearest column
      let bestCol = 0;
      let bestDist = Infinity;
      for (let c = 0; c < numCols; c++) {
        const dist = Math.abs(item.x - columnXs[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = c;
        }
      }
      if (bestDist <= proximity) {
        const text = item.str.trim();
        if (text) {
          cells[bestCol] = cells[bestCol] ? cells[bestCol] + " " + text : text;
        }
      }
    }
  }

  return cells;
}

/**
 * Assign each item in a line to the nearest column.
 * Returns an array of strings, one per column.
 */
function assignItemsToColumns(
  line: Line,
  columnXs: number[],
  bodySize: number
): string[] {
  const cells: string[] = Array(columnXs.length).fill("");
  const proximity = bodySize * 3;

  for (const item of line.items) {
    // Find nearest column
    let bestCol = 0;
    let bestDist = Infinity;
    for (let c = 0; c < columnXs.length; c++) {
      const dist = Math.abs(item.x - columnXs[c]);
      if (dist < bestDist) {
        bestDist = dist;
        bestCol = c;
      }
    }
    // Only assign if reasonably close to a column
    if (bestDist <= proximity) {
      if (cells[bestCol]) cells[bestCol] += " " + item.str.trim();
      else cells[bestCol] = item.str.trim();
    }
  }

  return cells;
}

/**
 * Convert a detected table region to Markdown table lines.
 * Uses Y-coordinate gaps to distinguish new logical rows from multi-line cell wrapping.
 */
function tableToMarkdown(
  table: TableRegion,
  lines: Line[],
  bodySize: number
): string[] {
  const { columnXs, startLineIdx, endLineIdx } = table;

  // Compute Y gaps between consecutive lines
  // A gap > 1.5x bodySize = new logical row boundary
  const rowGapThreshold = bodySize * 1.5;

  // Build logical rows by grouping physical lines based on Y gaps
  const logicalRows: string[][] = [];
  let currentPhysLines: number[] = [startLineIdx];

  for (let k = startLineIdx + 1; k <= endLineIdx; k++) {
    const prevY = lines[k - 1].y;
    const curY = lines[k].y;
    const gap = Math.abs(prevY - curY);

    if (gap > rowGapThreshold) {
      // New logical row — finalize current
      logicalRows.push(mergePhysLines(currentPhysLines, lines, columnXs, bodySize));
      currentPhysLines = [k];
    } else {
      // Same logical row (text wrapping within cell)
      currentPhysLines.push(k);
    }
  }
  // Don't forget the last group
  if (currentPhysLines.length > 0) {
    logicalRows.push(mergePhysLines(currentPhysLines, lines, columnXs, bodySize));
  }

  // Generate Markdown table
  const md: string[] = [];

  // Header row
  const headerCells = logicalRows[0].map((c) => c.trim() || " ");
  md.push("| " + headerCells.join(" | ") + " |");
  md.push("| " + headerCells.map(() => "---").join(" | ") + " |");

  // Data rows
  for (let r = 1; r < logicalRows.length; r++) {
    const cells = logicalRows[r].map((c) => c.trim() || " ");
    md.push("| " + cells.join(" | ") + " |");
  }

  md.push("");
  return md;
}

/**
 * Group text items into lines by Y coordinate proximity.
 * PDF Y axis goes bottom-up, so we sort descending.
 */
function groupIntoLines(items: RichTextItem[], tolerance: number): Line[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  let currentLine: RichTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentY) <= tolerance) {
      currentLine.push(item);
    } else {
      // Sort items within line by X for reading order
      currentLine.sort((a, b) => a.x - b.x);
      lines.push({ items: currentLine, y: currentY });
      currentLine = [item];
      currentY = item.y;
    }
  }
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.x - b.x);
    lines.push({ items: currentLine, y: currentY });
  }

  return lines;
}

type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

interface ClassifiedLine {
  text: string;
  level: HeadingLevel | "body";
  isBold: boolean;
  isItalic: boolean;
}

function classifyLine(line: Line, bodySize: number): ClassifiedLine {
  // Average font size of the line (weighted by string length)
  let totalLen = 0;
  let weightedSize = 0;
  let anyBold = false;
  let anyItalic = false;

  for (const item of line.items) {
    const len = item.str.length;
    totalLen += len;
    weightedSize += item.fontSize * len;
    if (item.isBold) anyBold = true;
    if (item.isItalic) anyItalic = true;
  }

  const avgSize = totalLen > 0 ? weightedSize / totalLen : bodySize;

  // Build the line text with inline formatting
  const parts: string[] = [];
  for (const item of line.items) {
    let text = item.str;
    if (avgSize <= bodySize * 1.2) {
      // Only apply inline formatting for body text
      if (item.isBold && item.isItalic) text = `***${text}***`;
      else if (item.isBold) text = `**${text}**`;
      else if (item.isItalic) text = `*${text}*`;
    }
    parts.push(text);
  }
  const text = parts.join("").trim();

  // Classify heading level
  let level: HeadingLevel | "body" = "body";
  const ratio = avgSize / bodySize;

  if (ratio >= 3.5) level = "h1";
  else if (ratio >= 2.3) level = "h2";
  else if (ratio >= 1.5) level = "h3";
  else if (ratio >= 1.15) level = "h4";

  // Also consider bold + slightly larger as heading
  if (level === "body" && anyBold && ratio >= 1.05) {
    level = "h4";
  }

  return { text, level, isBold: anyBold, isItalic: anyItalic };
}

// ─── Main converter ────────────────────────────────────────────────────────────

/**
 * Convert PDF to structured Markdown using font-based heading detection.
 *
 * Uses pdfjs-dist to extract font metadata (size, bold, italic) and classify
 * text into heading levels based on relative font sizes.
 */
export async function convertPdfToMarkdown(
  input: string | Buffer | ArrayBuffer | Uint8Array,
  options: ConversionOptions = {}
): Promise<string> {
  const pdfjs = await getPdfjs();
  if (!pdfjs) {
    throw new Error("pdfjs-dist is not available. Cannot extract font-based Markdown.");
  }

  // Normalize input to Uint8Array
  let data: Uint8Array;
  if (typeof input === "string") {
    const buffer = await fs.readFile(input);
    data = new Uint8Array(buffer);
  } else if (input instanceof ArrayBuffer) {
    data = new Uint8Array(input);
  } else {
    data = new Uint8Array(input);
  }

  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: false });
  const doc = await loadingTask.promise;

  // ── Pass 1: Collect all font sizes to determine body text size ──
  const allSizes: number[] = [];
  const pageTextContents: { items: RichTextItem[]; styles: Record<string, { fontFamily: string }> }[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();

    const styles = textContent.styles as Record<string, { fontFamily: string }>;
    const items: RichTextItem[] = [];

    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      const ti = item as { str: string; transform: number[]; fontName: string; hasEOL: boolean; width: number };
      if (!ti.str.trim()) continue;

      const fontSize = computeFontSize(ti.transform);
      const style = styles[ti.fontName];
      const fontFamily = style?.fontFamily || "";
      const fontName = ti.fontName || "";

      allSizes.push(fontSize);
      items.push({
        str: ti.str,
        fontSize,
        fontName,
        fontFamily,
        isBold: isBold(fontName, fontFamily),
        isItalic: isItalic(fontName, fontFamily),
        x: ti.transform[4],
        y: ti.transform[5],
        hasEOL: ti.hasEOL,
        width: ti.width,
      });
    }

    pageTextContents.push({ items, styles });
  }

  const stats = computeFontStats(allSizes);
  const bodySize = stats.bodySize;
  const lineTolerance = bodySize * 0.35;

  // ── Pass 2: Detect repeated lines (headers/footers) ──
  // Build per-page line texts to find page-wide repeated text
  const pageLineTexts: string[][] = [];
  for (const { items } of pageTextContents) {
    const lines = groupIntoLines(items, lineTolerance);
    pageLineTexts.push(lines.map((l) => l.items.map((i) => i.str).join("").trim()).filter((t) => t));
  }

  // Count how many pages each text appears on
  const textPageFreq = new Map<string, number>();
  for (const texts of pageLineTexts) {
    for (const t of texts) {
      textPageFreq.set(t, (textPageFreq.get(t) || 0) + 1);
    }
  }
  const totalPages = pageTextContents.length;
  // Lines appearing on > 40% of pages are likely headers/footers
  const headerFooterTexts = new Set<string>();
  for (const [text, count] of textPageFreq) {
    if (count > totalPages * 0.4 && text.length < 100) {
      headerFooterTexts.add(text);
    }
  }

  // ── Pass 3: Classify and generate Markdown (with table detection) ──
  const mdLines: string[] = [];

  if (options.title) {
    mdLines.push(`# ${options.title}`, "");
  }

  for (let pageIdx = 0; pageIdx < pageTextContents.length; pageIdx++) {
    const { items } = pageTextContents[pageIdx];
    if (items.length === 0) continue;

    if (options.includePageMarkers) {
      mdLines.push(`<!-- Page ${pageIdx + 1} -->`, "");
    }

    const lines = groupIntoLines(items, lineTolerance);

    // Detect table regions on this page
    const tableRegions = detectTableRegions(lines, bodySize);
    const tableLineSet = new Set<number>();
    for (const tr of tableRegions) {
      for (let k = tr.startLineIdx; k <= tr.endLineIdx; k++) {
        tableLineSet.add(k);
      }
    }

    let prevLevel: string | null = null;
    let paragraphParts: string[] = [];

    const flushParagraph = () => {
      if (paragraphParts.length > 0) {
        mdLines.push(paragraphParts.join(" "));
        mdLines.push("");
        paragraphParts = [];
      }
    };

    let lineIdx = 0;
    while (lineIdx < lines.length) {
      // Check if this line starts a table region
      const table = tableRegions.find((t) => t.startLineIdx === lineIdx);
      if (table) {
        flushParagraph();
        const tableMd = tableToMarkdown(table, lines, bodySize);
        mdLines.push(...tableMd);
        lineIdx = table.endLineIdx + 1;
        prevLevel = null;
        continue;
      }

      // Normal line processing
      const cl = classifyLine(lines[lineIdx], bodySize);
      const text = cl.text;
      lineIdx++;

      if (!text) continue;

      // Skip headers/footers
      if (headerFooterTexts.has(text)) continue;

      // Skip standalone page numbers (pure digits or "N/M" patterns)
      if (/^\d+$/.test(text) || /^\d+\s*\/\s*\d+$/.test(text)) continue;

      if (cl.level !== "body") {
        flushParagraph();
        const hashes = "#".repeat(parseInt(cl.level.replace("h", "")));
        mdLines.push(`${hashes} ${text}`, "");
        prevLevel = cl.level;
      } else {
        // Merge consecutive body lines into paragraph
        if (prevLevel === "body" && paragraphParts.length > 0) {
          paragraphParts.push(text);
        } else {
          flushParagraph();
          paragraphParts.push(text);
        }
        prevLevel = "body";
      }
    }
    flushParagraph();

    // Page separator
    if (options.includePageMarkers && pageIdx < pageTextContents.length - 1) {
      mdLines.push("---", "");
    }
  }

  await doc.destroy();

  return mdLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Legacy API (backward-compatible heuristic formatting) ─────────────────────

/**
 * Detect if text line is a heading (heuristic)
 */
function heuristicIsHeading(line: string, prevLine: string = ""): boolean {
  const trimmed = line.trim();

  if (trimmed.length < 100 && trimmed.length > 3) {
    if (!/[.，。；：]$/.test(trimmed)) {
      if (
        /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(trimmed) ||
        /^[A-Z\s\d]{5,}$/.test(trimmed) ||
        /^(Chapter|Section|Part|第[一二三四五六七八九十\d]+章|[\d]+\.)/i.test(trimmed)
      ) {
        return true;
      }
    }
  }

  if (trimmed.length < 50 && prevLine === "") {
    return true;
  }

  return false;
}

/**
 * Detect list items
 */
function heuristicIsListItem(line: string): boolean {
  return /^[\s]*[-•·\d][.)\s]/.test(line) || /^[\s]*\([\d\w]\)/.test(line);
}

/**
 * Format text as Markdown with heuristic structure detection (legacy)
 */
export function formatAsMarkdown(text: string, options: { title?: string } = {}): string {
  const lines = text.split("\n");
  const result: string[] = [];

  if (options.title) {
    result.push(`# ${options.title}`);
    result.push("");
  }

  let i = 0;
  let prevLine = "";

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      result.push("");
      prevLine = "";
      i++;
      continue;
    }

    if (heuristicIsHeading(line, prevLine)) {
      const level = prevLine === "" ? 2 : 3;
      result.push(`${"#".repeat(level)} ${trimmed}`);
    } else if (heuristicIsListItem(line)) {
      result.push(trimmed);
    } else {
      if (
        result.length > 0 &&
        !result[result.length - 1].startsWith("#") &&
        result[result.length - 1] &&
        !result[result.length - 1].startsWith("```") &&
        !heuristicIsListItem(result[result.length - 1])
      ) {
        result[result.length - 1] += " " + trimmed;
      } else {
        result.push(trimmed);
      }
    }

    prevLine = trimmed;
    i++;
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Format PDF page as Markdown (legacy)
 */
export function formatPdfPageAsMarkdown(
  pageNum: number,
  text: string,
  docTitle?: string
): string {
  const title = docTitle || `Page ${pageNum}`;
  const formatted = formatAsMarkdown(text, { title: pageNum === 1 ? title : undefined });

  return `<!-- Page ${pageNum} -->\n\n${formatted}`;
}
