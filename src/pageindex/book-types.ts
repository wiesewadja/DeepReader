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
  /** Generate LLM summaries for each node (default: true) */
  addNodeSummary?: boolean;
  /** Generate document-level description (default: true) */
  addDocDescription?: boolean;
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
    dimensions?: number;  // Auto-detected after vectorization
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

// ─── Book Search v2 types ──────────────────────────────────────────────────────

/** Book Search v2 输入 */
export interface BookSearchOptionsV2 {
  filePath: string;
  query: string;
  topK?: number;                    // 默认 5
  embedding?: EmbeddingOptions;     // 向量配置（可选）
  scopeNodeIds?: string[];          // S1 圈定的章节范围（可选）
  reranker?: any;                   // 重排配置（可选）
  treeSearch?: boolean;             // 是否启用 LLM 树搜索
  llmClient?: any;                  // LLM 客户端（树搜索需要）
  maxContentLength?: number;        // 每个结果最大内容长度，默认 8000
  /** 直接提供 bookId，避免从 filePath 重新计算（推荐） */
  bookId?: string;
  /** 直接提供 vaultPath，避免从 filePath 推导（推荐） */
  vaultPath?: string;
}

/** 匹配片段（聚焦到 block_id 级别） */
export interface MatchedBlock {
  blockId: string;                  // 最近的 block_id
  content: string;                  // 片段内容（含 ^block_id 标记，~500 字）
}

/** Book Search v2 输出（聚焦到段落级） */
export interface BookSearchResultV2 {
  nodeId: string;
  title: string;
  fileName: string;                 // Markdown 文件名（不含 .md），用于 wiki 链接
  hierarchyPath: string[];          // 层级路径 ["第1章", "概述"]
  matchedBlocks: MatchedBlock[];    // 该 node 内匹配的段落片段
  score: number;
  bm25Score: number;
  vectorScore: number;
}

/** Book Section 读取结果（read_book_section 返回，含完整内容） */
export interface BookSectionResult {
  nodeId: string;
  title: string;
  content: string;                  // 完整内容（^block_id 内联在段落末尾）
  wordCount: number;
  truncated: boolean;               // 是否超过 8000 字截断
  truncatedAt?: number;
}

/** tree.json 数据结构 */
export interface TreeData {
  title: string;
  docDescription?: string;
  source?: string;
  type?: string;
  nodeFileMap: Record<string, string>;  // nodeId → fileName
  structure: TreeNode[];
}

/** TreeNode 结构（复用 core/types.ts 的 TreeNode，增加可选字段） */
export interface TreeNode {
  title: string;
  nodeId?: string;
  summary?: string;
  text?: string;
  startIndex?: number;
  endIndex?: number;
  nodes?: TreeNode[];
}