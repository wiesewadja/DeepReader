/**
 * pageindex-node v2.0
 * Node.js-compatible core API (without Bun-specific vault features)
 *
 * This module exports only the core document processing features:
 *   - PDF/EPUB parsing and indexing
 *   - Markdown structure extraction
 *   - LLM-based summarization and TOC generation
 *   - Obsidian note export (without vault indexing)
 *
 * Use this entry point when running in Node.js environments like:
 *   - Obsidian plugins (Electron)
 *   - Node.js scripts
 *   - Server-side applications
 *
 * For Bun-native vault indexing, use './index.ts' instead.
 */

import type {
  TreeNode,
  ExtractionMode,
  ProgressInfo,
} from "./core/types";
import { PageIndex } from "./pageindex";

// ── Core Class ───────────────────────────────────────────────────────────────

export { PageIndex } from "./pageindex";

// ── Unified API (core features only) ───────────────────────────────────────

export { docToIndex } from "./unified-core";

// ── Document Parsers ────────────────────────────────────────────────────────

export { parsePdf, getPdfName, type PdfPage } from "./parsers/pdf";

export {
  parseEpub,
  getEpubName,
  epubChaptersToPages,
  type EpubInfo,
  type EpubChapter,
} from "./parsers/epub";

export {
  pdfToImages,
  pdfBufferToImages,
  ocrImage,
  ocrImages,
  parsePdfWithOcr,
  getPdfInfo,
  type OcrOptions,
} from "./parsers/ocr";

export {
  mdToTree,
  markdownToTree,
  extractNodesFromMarkdown,
  extractNodeTextContent,
  buildTreeFromNodes,
  treeThinningForIndex,
  printTocMd,
} from "./parsers/markdown";

// ── Obsidian Export ────────────────────────────────────────────────────────

export { exportPdfToObsidian, type PdfObsidianExportOptions } from "./exporters/pdf-to-obsidian";
export { exportEpubToObsidian, type EpubObsidianExportOptions } from "./exporters/adapter";

// ── LLM Client ─────────────────────────────────────────────────────────────

export {
  chatGPT,
  chatGPTWithFinishReason,
  type ClientConfig,
  type ChatOptions,
  type ChatResult,
} from "./llm/client";

// ── Core Types ──────────────────────────────────────────────────────────────

export type {
  PageIndexOptions,
  MarkdownOptions,
  TreeNode,
  PageIndexResult,
  TocItem,
  PageContent,
  TocCheckResult,
  ExtractionMode,
  OcrPromptType,
  ProgressInfo,
  DocType,
  DocIndexOptions,
} from "./core/types";

// ── Helper Types for Obsidian Plugin Integration ────────────────────────────

/**
 * Simplified options for Obsidian plugin usage
 * Omits Bun-specific features (vault indexing, autoIndex)
 */
export interface ObsidianPluginOptions {
  /** LLM model for TOC extraction */
  model?: string;
  /** OpenAI API key */
  apiKey?: string;
  /** Custom API base URL (e.g., LM Studio) */
  baseUrl?: string;
  /** Add node IDs to output */
  addNodeId?: boolean;
  /** Add summaries to nodes */
  addNodeSummary?: boolean;
  /** Add document description */
  addDocDescription?: boolean;
  /** Include raw text in nodes */
  addNodeText?: boolean;
  /** OCR mode for scanned PDFs */
  extractionMode?: ExtractionMode;
  /** OCR model */
  ocrModel?: string;
  /** Progress callback */
  onProgress?: (progress: ProgressInfo) => void;
}

/**
 * Result for Obsidian plugin PDF processing
 * Contains tree structure and metadata
 */
export interface ObsidianPdfResult {
  /** Document name */
  docName: string;
  /** Structured tree */
  structure: TreeNode[];
  /** Total token count */
  totalTokens: number;
  /** Number of nodes */
  nodeCount: number;
}

/**
 * Process PDF for Obsidian plugin usage
 * Simplified wrapper around PageIndex.fromPdf()
 */
export async function processPdfForObsidian(
  input: string | Buffer | ArrayBuffer,
  options: ObsidianPluginOptions = {}
): Promise<ObsidianPdfResult> {
  const pageIndex = new PageIndex({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    addNodeId: options.addNodeId ?? true,
    addNodeSummary: options.addNodeSummary ?? true,
    addDocDescription: options.addDocDescription ?? false,
    addNodeText: options.addNodeText ?? false,
    extractionMode: options.extractionMode ?? "text",
    ocrModel: options.ocrModel,
    onProgress: options.onProgress,
  });

  const result = await pageIndex.fromPdf(input);
  
  const nodes = getAllNodes(result.structure);
  const totalTokens = nodes.reduce((sum, node) => {
    const text = node.text || "";
    return sum + estimateTokens(text);
  }, 0);

  return {
    docName: result.docName,
    structure: result.structure,
    totalTokens,
    nodeCount: nodes.length,
  };
}

/**
 * Process EPUB for Obsidian plugin usage
 */
export async function processEpubForObsidian(
  input: string | Buffer,
  options: ObsidianPluginOptions = {}
): Promise<ObsidianPdfResult> {
  const pageIndex = new PageIndex({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    addNodeId: options.addNodeId ?? true,
    addNodeSummary: options.addNodeSummary ?? true,
    addDocDescription: options.addDocDescription ?? false,
    addNodeText: options.addNodeText ?? false,
    onProgress: options.onProgress,
  });

  const result = await pageIndex.fromEpub(input);
  
  const nodes = getAllNodes(result.structure);
  const totalTokens = nodes.reduce((sum, node) => {
    const text = node.text || "";
    return sum + estimateTokens(text);
  }, 0);

  return {
    docName: result.docName,
    structure: result.structure,
    totalTokens,
    nodeCount: nodes.length,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function getAllNodes(structure: TreeNode[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const node of structure) {
    nodes.push(node);
    if (node.nodes) {
      nodes.push(...getAllNodes(node.nodes));
    }
  }
  return nodes;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Book Indexer & Search ───────────────────────────────────────────────────────

export {
  indexBook,
  isBookIndexed,
  deleteBookIndex,
  generateBookId,
  generateBookIdFromPath,
  migrateBookIndexes,
} from "./book-indexer.js";

// ── Proposition Cards ───────────────────────────────────────────────────────────

export {
  indexPropositions,
  calculateTargetCards,
  buildExtractionPrompt,
  parseCards,
  extractCardsFromChapter,
} from "./proposition-indexer.js";

export {
  searchPropositions,
  searchWithPropositions,
  loadPropositions,
  formatPropositionResults,
} from "./proposition-search.js";

export type {
  PropositionCard,
  PropositionsData,
  PropositionIndexOptions,
  PropositionIndexResult,
  PropositionMatch,
  CardType,
  BookIndexOptions,
  BookIndexResult,
  BookIndexProgress,
  BookMeta,
  BookSearchOptions,
  BookSearchResult,
  TreeData,
} from "./book-types.js";

export type { FusionResult } from "./proposition-search.js";