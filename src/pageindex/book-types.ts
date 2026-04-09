import type { EmbeddingOptions } from "./vault/types.js";

/**
 * Single book index options
 */
export interface BookIndexOptions {
  /** Input file path */
  filePath: string;
  /** File type */
  fileType: "pdf" | "epub";
  /** Output directory for Markdown files */
  outputDir: string;
  /** Embedding model config (optional, skip vectorization if not provided) */
  embedding?: EmbeddingOptions;
  /** LLM config (for summary generation) */
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Progress callback */
  onProgress?: (progress: BookIndexProgress) => void;
}

/**
 * Book index result
 */
export interface BookIndexResult {
  bookId: string;
  title: string;
  fileType: "pdf" | "epub";
  chaptersCount: number;
  indexDir: string; // .pageindex/{book_hash}/
}

/**
 * Book index progress
 */
export interface BookIndexProgress {
  /** Current progress 0-100 */
  percent: number;
  /** Current step identifier */
  step: string;
  /** User-visible step label */
  stepLabel: string;
  /** Detailed message */
  message?: string;
}

/**
 * Book search options
 */
export interface BookSearchOptions {
  /** Book file path to search */
  filePath: string;
  /** Query text */
  query: string;
  /** Number of results to return */
  topK?: number;
  /** Embedding model config (for query vectorization) */
  embedding?: EmbeddingOptions;
  /** L2 context max character count */
  maxContextLength?: number;
}

/**
 * Book search result
 */
export interface BookSearchResult {
  /** Node identifier */
  nodeId: string;
  /** Node level */
  level: "L0" | "L1";
  
  /** Book title */
  bookTitle: string;
  /** Chapter title */
  chapterTitle: string;
  /** Chapter summary */
  chapterSummary: string;
  
  /** Chapter content (with block ID markers for FrontendAgent) */
  rawText: string;
  /** Markdown file path */
  mdFilePath: string;
  /** Whether rawText was truncated */
  truncated: boolean;
  
  /** Relevance scores */
  score: number;
  vectorScore: number;
  bm25Score: number;
}

/**
 * Index error codes
 */
export enum IndexErrorCode {
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  EMBEDDING_API_FAILED = "EMBEDDING_API_FAILED",
  MD_PARSE_ERROR = "MD_PARSE_ERROR",
  VECTOR_DIMENSION_MISMATCH = "VECTOR_DIMENSION_MISMATCH",
  INDEX_INCOMPLETE = "INDEX_INCOMPLETE",
  BM25_INDEX_CORRUPT = "BM25_INDEX_CORRUPT",
}

/**
 * Index error with user-friendly message
 */
export class IndexError extends Error {
  constructor(
    message: string,
    public code: IndexErrorCode,
    public userMessage: string,
    public repairAction?: string
  ) {
    super(message);
    this.name = "IndexError";
  }
}

/**
 * Book metadata (cached in book-meta.json)
 */
export interface BookMeta {
  version: number;
  bookId: string;
  title: string;
  description: string;
  author?: string;
  filePath: string;
  fileType: "pdf" | "epub";
  indexedAt: string;
  embedding?: {
    provider: string;
    model: string;
    dimensions: number;
  };
  chapters: ChapterMeta[];
}

/**
 * Chapter metadata
 */
export interface ChapterMeta {
  id: string;
  title: string;
  summary: string;
  mdFilePath: string;
  sortOrder: number;
  mdFileHash: string;
  paragraphs: ParagraphMeta[];
}

/**
 * Paragraph metadata (extracted from MD file)
 */
export interface ParagraphMeta {
  blockId: string;
  text: string; // First 50 chars
}

/**
 * Index integrity report
 */
export interface IndexIntegrityReport {
  valid: boolean;
  missingFiles: string[];
  vectorDimensionsMatch: boolean;
  chaptersMatchMdFiles: boolean;
  embeddingProviderAvailable: boolean;
  repairActions: string[];
}

/**
 * BM25 data structure
 */
export interface BM25Data {
  nodes: Record<string, { text: string; length: number; level: "L0" | "L1" }>;
  invertedIndex: Record<string, Array<{ nodeId: string; tf: number }>>;
  stats: {
    totalDocs: number;
    avgDocLength: number;
    df: Record<string, number>;
  };
  params: {
    k1: number;
    b: number;
  };
}