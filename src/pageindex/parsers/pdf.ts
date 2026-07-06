/**
 * PageIndex: PDF parsing utilities
 * Uses MinerU cloud API for PDF parsing
 */

import { MineruClient } from "../../services/mineru-api";
import { nodeFsPromises } from "../../utils/node-compat.js";
import { log as piLog } from "../core/logger";
import type { PageContent } from "../core/types";
import { countTokens } from "../core/utils";
import type { MineruPdfResult, PageText } from "./mineru";

export interface PdfPage {
  text: string;
  tokenCount: number;
}

/**
 * Parse PDF using MinerU cloud API
 */
export async function parsePdf(
  input: string | Buffer | ArrayBuffer,
  token?: string,
  onProgress?: (message: string) => void
): Promise<MineruPdfResult> {
  const fs = nodeFsPromises();
  let dataBuffer: Buffer;
  if (typeof input === "string") {
    dataBuffer = await fs.readFile(input);
  } else if (input instanceof ArrayBuffer) {
    dataBuffer = Buffer.from(input);
  } else {
    dataBuffer = Buffer.from(input);
  }

  const fileName = typeof input === "string"
    ? input.split("/").pop() || "document.pdf"
    : "document.pdf";

  piLog(`[parsePdf] Parsing PDF with MinerU: ${fileName} (${dataBuffer.length} bytes)`);

  const client = new MineruClient(token, { onProgress });
  const result = await client.parse(dataBuffer, fileName);

  piLog(`[parsePdf] Done: ${result.totalPages} pages, ${result.outline.length} outline nodes`);

  return result;
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
  const parts = pdfPath.split("/");
  const basename = parts[parts.length - 1] || "Untitled";
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


