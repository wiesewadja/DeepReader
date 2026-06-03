/**
 * PageIndex: Types and interfaces
 */

import type { LlmCallTrace } from "../index-tracer.js";

/** Extraction mode for PDF processing */
export type ExtractionMode = "text" | "ocr";

/** OCR prompt type for GLM-OCR */
export type OcrPromptType = "text" | "formula" | "table";

export interface PageIndexOptions {
  /** OpenAI model to use for reasoning (default: gpt-4o-2024-11-20) */
  model?: string;
  /** Number of pages to check for TOC (default: 20) */
  tocCheckPageNum?: number;
  /** Max pages per node before splitting (default: 10) */
  maxPageNumEachNode?: number;
  /** Max tokens per node before splitting (default: 20000) */
  maxTokenNumEachNode?: number;
  /** Add node IDs to output (default: true) */
  addNodeId?: boolean;
  /** Add summaries to nodes (default: true) */
  addNodeSummary?: boolean;
  /** Add document description (default: false) */
  addDocDescription?: boolean;
  /** Add raw text to nodes (default: false) */
  addNodeText?: boolean;
  /** OpenAI API key (default: from OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Base URL for API (e.g., LM Studio: http://localhost:1234/v1) */
  baseUrl?: string;
  /** MinerU API key for precision PDF parsing (optional) */
  mineruApiKey?: string;
  /** Progress callback for real-time updates */
  onProgress?: (progress: ProgressInfo) => void;
  /** LLM 调用追踪回调（可选，用于索引追踪日志） */
  onLlmCall?: (call: Omit<LlmCallTrace, "phase">) => void;
  
  // OCR-specific options
  /** Extraction mode: 'text' for native PDFs, 'ocr' for scanned PDFs (default: 'text') */
  extractionMode?: ExtractionMode;
  /** OCR model to use (default: glm-ocr) */
  ocrModel?: string;
  /** OCR prompt type (default: 'text') */
  ocrPromptType?: OcrPromptType;
  /** Image DPI for OCR conversion (default: 150) */
  imageDpi?: number;
  /** Image format for OCR conversion (default: 'png') */
  imageFormat?: "png" | "jpeg";
  /** Concurrent OCR requests (default: 3) */
  ocrConcurrency?: number;
}

/** Progress information for real-time updates */
export interface ProgressInfo {
  /** Current processing stage */
  stage: "detecting_toc" | "parsing_structure" | "verifying_pages" | "generating_summaries" | "generating_description" | "mineru_batch" | "complete";
  /** Human-readable stage description */
  message: string;
  /** Current step number */
  step: number;
  /** Total number of steps */
  totalSteps: number;
  /** Percentage complete (0-100) */
  percent: number;
  /** Additional details (e.g., current page being processed) */
  details?: string;
}

export interface MarkdownOptions extends PageIndexOptions {
  /** Apply tree thinning (default: false) */
  thinning?: boolean;
  /** Minimum token threshold for thinning (default: 5000) */
  thinningThreshold?: number;
  /** Token threshold for generating summaries (default: 200) */
  summaryTokenThreshold?: number;
}

export interface TreeNode {
  title: string;
  nodeId?: string;
  startIndex?: number;
  endIndex?: number;
  summary?: string;
  prefixSummary?: string;
  text?: string;
  lineNum?: number;
  nodes?: TreeNode[];
}

export interface PageIndexResult {
  docName: string;
  docDescription?: string;
  /** Author (EPUB only) */
  author?: string;
  structure: TreeNode[];
  /** Cover image extracted from source (EPUB) */
  coverImage?: { name: string; data: Buffer; mediaType: string };
  /** First page rendered as PNG (PDF) */
  coverPng?: Buffer;
  /** Raw EPUB info for reuse by exporters (avoids re-parsing) */
  epubInfo?: import("../parsers/epub").EpubInfo;
  images?: import("../parsers/mineru-types").MineruImage[];
  /** 导出阶段注入的节点-文件映射 */
  _nodeFileMap?: Record<string, string>;
  /** EPUB 层级树（仅 EPUB 来源） */
  _hierarchicalTree?: TreeNode[];
}

export interface TocItem {
  structure?: string;
  title: string;
  page?: number;
  physicalIndex?: number;
  appearStart?: string;
  listIndex?: number;
}

export interface PageContent {
  text: string;
  tokenCount: number;
}

export interface TocCheckResult {
  tocContent: string | null;
  tocPageList: number[];
  pageIndexGivenInToc: string;
}

// ─── Unified API Types ───────────────────────────────────────────────────────

/** Supported document types */
export type DocType = "pdf" | "epub" | "markdown";

/** Options for docToIndex() unified entry */
export interface DocIndexOptions extends PageIndexOptions {
  /** Force document type (auto-detected from file extension if omitted) */
  docType?: DocType;
  /** OCR model (PDF only) */
  ocrModel?: string;
  /** OCR prompt type (PDF only) */
  ocrPromptType?: OcrPromptType;
  /** Markdown tree thinning (MD only) */
  thinning?: boolean;
  /** Thinning token threshold (MD only) */
  thinningThreshold?: number;
}

/** Options for docToObsidian() unified entry */
export interface DocObsidianOptions {
  /** Output directory for the Obsidian vault files */
  outputDir: string;
  /** LLM model for TOC extraction */
  model?: string;
  /** Use LM Studio endpoint */
  lmStudio?: boolean;
  /** Use Ollama endpoint */
  ollama?: boolean;
  /** Custom OpenAI-compatible API URL */
  baseUrl?: string;
  /** API key */
  apiKey?: string;
  /** Force document type (auto-detected if omitted) */
  docType?: DocType;
  /** Note template: supports {{content}}, {{title}}, {{source}}, {{index}} */
  noteTemplate?: string;
  /** MOC filename */
  mocName?: string;
  /** Add index prefix to filenames */
  includeIndex?: boolean;
  /** Original source file path (written to frontmatter, PDF only) */
  sourceFile?: string;
  /** Max tokens per node, splits large chapters (EPUB only) */
  maxTokensPerNode?: number;
  /** Max nodes per chapter (EPUB only) */
  maxNodesPerChapter?: number;
  /** Generate LLM summaries per node (EPUB only) */
  generateNodeSummaries?: boolean;
  /** OCR model (scanned PDF only) */
  ocrModel?: string;
  /** OCR mode for scanned PDFs */
  ocr?: boolean;
  /** After export, auto-update vault index */
  autoIndex?: boolean;
  /** Vault path for auto-indexing (required if autoIndex=true) */
  vaultPath?: string;
  /** Progress callback */
  onProgress?: (info: { stage: string; percent: number }) => void;
}

/** Unified result from docToObsidian() */
export interface ObsidianExportResult {
  /** Output directory where files were written */
  outputDir: string;
  /** Document name */
  docName: string;
  /** Path to the MOC file */
  mocPath: string;
  /** Path to tree.json */
  treePath: string;
  /** Total number of notes generated */
  noteCount: number;
  /** Total tokens across all notes */
  totalTokens: number;
  /** Generated note paths */
  notePaths: string[];
  /** Vault index result (only if autoIndex=true) */
  vaultIndex?: import("../vault/types").VaultIndexResult;
}
