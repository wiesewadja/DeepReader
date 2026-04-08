/**
 * bun-pageindex: Parsers barrel
 * Re-exports all parser modules for convenient importing
 */

// PDF parser
export { parsePdf, getPdfName, getTextOfPages, getTextOfPagesWithStartIndex, getTokenCountForPages, getAllText, getNumberOfPages, pagesToPageContent } from "./pdf";
export type { PdfPage, PdfInfo } from "./pdf";

// EPUB parser
export { parseEpub, getEpubName, epubChaptersToPages } from "./epub";
export type { EpubCoverImage, EpubInfo, EpubChapter } from "./epub";

// Markdown parser
export {
  extractNodesFromMarkdown,
  extractNodeTextContent,
  updateNodeListWithTextTokenCount,
  treeThinningForIndex,
  buildTreeFromNodes,
  cleanTreeForOutput,
  generateSummariesForStructureMd,
  mdToTree,
  markdownToTree,
  printTocMd,
} from "./markdown";

// OCR parser
export { checkPopplerInstalled, pdfToImages, pdfBufferToImages, ocrImage, ocrImages, parsePdfWithOcr, getPdfInfo } from "./ocr";
export type { OcrOptions } from "./ocr";

// PDF to Markdown converter
export { convertPdfToMarkdown, formatAsMarkdown, formatPdfPageAsMarkdown } from "./pdf-to-markdown";
export type { ConversionOptions } from "./pdf-to-markdown";
