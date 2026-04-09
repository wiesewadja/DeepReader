/**
 * PageIndex: PDF parsing utilities
 * Uses pdf-parse for text extraction
 */

import * as PDFParse from "pdf-parse";
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
  // Convert input to Buffer
  let dataBuffer: Buffer;
  if (typeof input === "string") {
    dataBuffer = await fs.readFile(input);
  } else if (input instanceof ArrayBuffer) {
    dataBuffer = Buffer.from(input);
  } else {
    dataBuffer = Buffer.from(input);
  }

  // Workaround for Obsidian / Browser environment worker issues
  if (typeof globalThis !== 'undefined') {
    (globalThis as any).PDFJS = (globalThis as any).PDFJS || {};
    (globalThis as any).PDFJS.disableWorker = true;
  }

  // Use Custom pagerender to extract pages safely
  function render_page(pageData: any): Promise<string> {
    const render_options = {
        normalizeWhitespace: false,
        disableCombineTextItems: false
    };

    return pageData.getTextContent(render_options)
        .then(async function(textContent: any) {
            // 释放主线程，防止 WebDriver / 浏览器由于长时间计算抛出 Script Timeout
            await new Promise(r => setTimeout(r, 0));
            
            let lastY, text = '';
            for (let item of textContent.items) {
                if (lastY == item.transform[5] || !lastY) {
                    text += item.str;
                } else {
                    text += '\n' + item.str;
                }    
                lastY = item.transform[5];
            }
            return "===PAGE_DELIMITER===" + text + "===PAGE_DELIMITER_END===\n";
        });
  }

  const pdfParse = (PDFParse as any).default || PDFParse;
  const result = await pdfParse(dataBuffer, { pagerender: render_page });

  const pages: PdfPage[] = [];
  let title = "Untitled";

  // Parse out the pages from the delimited text
  const fullText = result.text || "";
  const pageMatches = [...fullText.matchAll(/===PAGE_DELIMITER===([\s\S]*?)===PAGE_DELIMITER_END===/g)];
  
  if (pageMatches.length > 0) {
    for (const match of pageMatches) {
      const pageText = match[1];
      pages.push({ text: pageText, tokenCount: countTokens(pageText) });
    }
  } else {
    pages.push({ text: fullText, tokenCount: countTokens(fullText) });
  }

  const totalPages = result.numpages || pages.length || 1;

  if (result.info?.Title) {
    title = result.info.Title;
  } else if (typeof input === "string") {
    title = getPdfName(input);
  } else if (pages.length > 0 && pages[0]?.text) {
    const firstLine = pages[0].text.trim().split("\n")[0];
    if (firstLine && firstLine.length < 100) {
      title = firstLine;
    }
  }

  let outline: PdfOutlineItem[] | undefined = undefined;

  return {
    title,
    numPages: totalPages,
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
