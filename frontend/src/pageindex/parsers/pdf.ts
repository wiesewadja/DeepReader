/**
 * PageIndex: PDF parsing utilities
 * Uses pdf-parse for text extraction
 */

import PDFParse from "pdf-parse";
import { countTokens } from "../core/utils";
import type { PageContent, TocItem } from "../core/types";
import * as fs from "fs/promises";

export interface PdfPage {
  text: string;
  tokenCount: number;
}

export interface PdfInfo {
  title: string;
  numPages: number;
  pages: PdfPage[];
  outline?: PdfOutlineItem[];
}

export interface PdfOutlineItem {
  title: string;
  pageNumber: number; // 1-based
  children?: PdfOutlineItem[];
}

/**
 * Parse PDF and extract text per page with token counts
 */
export async function parsePdf(
  input: string | Buffer | ArrayBuffer
): Promise<PdfInfo> {
  // Convert input to Uint8Array if needed
  let data: Uint8Array;
  if (typeof input === "string") {
    // File path
    const buffer = await fs.readFile(input);
    data = new Uint8Array(buffer);
  } else if (input instanceof ArrayBuffer) {
    data = new Uint8Array(input);
  } else {
    data = new Uint8Array(input);
  }

  // Parse PDF with data
  const parser = new PDFParse({ data });
  
  // Get text for all pages
  const textResult = await parser.getText();
  
  // Get metadata
  const infoResult = await parser.getInfo();

  const pages: PdfPage[] = [];
  let title = "Untitled";

  // Extract text from each page first
  for (const pageText of textResult.pages) {
    const text = pageText.text;
    const tokenCount = countTokens(text);
    pages.push({ text, tokenCount });
  }

  // Get title from metadata, or fallback to filename/first page
  if (infoResult?.info?.Title) {
    title = infoResult.info.Title;
  } else if (typeof input === "string") {
    // Fallback to filename without extension
    title = getPdfName(input);
  } else if (pages.length > 0 && pages[0]?.text) {
    // Fallback to first non-empty line of first page
    const firstLine = pages[0].text.trim().split("\n")[0];
    if (firstLine && firstLine.length < 100) {
      title = firstLine;
    }
  }

  // Extract PDF bookmarks/outline (embedded TOC)
  let outline: PdfOutlineItem[] | undefined;
  if (infoResult?.outline && infoResult.outline.length > 0) {
    outline = await resolveOutlineToPages(infoResult.outline, parser.doc);
  }

  // Clean up
  await parser.destroy();

  return {
    title,
    numPages: textResult.pages.length,
    pages,
    outline,
  };
}

/**
 * Get text from specific pages (1-indexed)
 */
export function getTextOfPages(
  pages: PdfPage[],
  startPage: number,
  endPage: number,
  addTags: boolean = true
): string {
  let text = "";
  
  for (let pageNum = startPage - 1; pageNum < Math.min(endPage, pages.length); pageNum++) {
    const pageText = pages[pageNum]?.text || "";
    if (addTags) {
      text += `<physical_index_${pageNum + 1}>\n${pageText}\n</physical_index_${pageNum + 1}>\n`;
    } else {
      text += pageText;
    }
  }
  
  return text;
}

/**
 * Get text of pages with start_index tags (for legacy compatibility)
 */
export function getTextOfPagesWithStartIndex(
  pages: PdfPage[],
  startPage: number,
  endPage: number
): string {
  let text = "";
  
  for (let pageNum = startPage - 1; pageNum < Math.min(endPage, pages.length); pageNum++) {
    const pageText = pages[pageNum]?.text || "";
    text += `<start_index_${pageNum + 1}>\n${pageText}\n<end_index_${pageNum + 1}>\n`;
  }
  
  return text;
}

/**
 * Get token count for a range of pages
 */
export function getTokenCountForPages(
  pages: PdfPage[],
  startPage: number,
  endPage: number
): number {
  let totalTokens = 0;
  
  for (let pageNum = startPage - 1; pageNum < Math.min(endPage, pages.length); pageNum++) {
    totalTokens += pages[pageNum]?.tokenCount || 0;
  }
  
  return totalTokens;
}

/**
 * Get all text from PDF pages
 */
export function getAllText(pages: PdfPage[]): string {
  return pages.map((p) => p.text).join("\n");
}

/**
 * Extract PDF name from path or metadata
 */
export function getPdfName(pdfPath: string): string {
  // Get basename from path
  const parts = pdfPath.split("/");
  const basename = parts[parts.length - 1] || "Untitled";
  // Remove .pdf extension if present
  return basename.replace(/\.pdf$/i, "");
}

/**
 * Get total number of pages
 */
export function getNumberOfPages(pages: PdfPage[]): number {
  return pages.length;
}

/**
 * Convert pages to PageContent format for compatibility
 */
export function pagesToPageContent(pages: PdfPage[]): PageContent[] {
  return pages.map((p) => ({
    text: p.text,
    tokenCount: p.tokenCount,
  }));
}

/**
 * Resolve PDF outline (bookmarks) to page numbers
 * Converts internal PDF object references to 1-based page numbers
 */
async function resolveOutlineToPages(
  outline: any[],
  doc: any
): Promise<PdfOutlineItem[]> {
  const result: PdfOutlineItem[] = [];

  for (const item of outline) {
    let pageNumber = 0;

    try {
      let dest = item.dest;
      if (typeof dest === "string") {
        dest = await doc.getDestination(dest);
      }
      if (Array.isArray(dest)) {
        const pageIdx = await doc.getPageIndex(dest[0]);
        pageNumber = pageIdx + 1; // 0-based → 1-based
      }
    } catch {
      // Skip items with unresolvable destinations
    }

    const children = item.items?.length > 0
      ? await resolveOutlineToPages(item.items, doc)
      : undefined;

    result.push({
      title: item.title || "",
      pageNumber,
      children: children?.length ? children : undefined,
    });
  }

  return result;
}

/**
 * Convert PDF outline items to TocItem format for use in the indexing pipeline
 */
export function outlineToTocItems(outline: PdfOutlineItem[]): TocItem[] {
  const items: TocItem[] = [];
  let listIndex = 0;

  function flatten(nodes: PdfOutlineItem[], parentStructure?: string) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const structure = parentStructure
        ? `${parentStructure}.${i + 1}`
        : `${i + 1}`;

      if (node.pageNumber > 0) {
        items.push({
          structure,
          title: node.title,
          physicalIndex: node.pageNumber,
          listIndex: listIndex++,
        });
      }

      if (node.children?.length) {
        flatten(node.children, structure);
      }
    }
  }

  flatten(outline);
  return items;
}
