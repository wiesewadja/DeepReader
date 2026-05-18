import type { EmbeddingOptions, RerankerOptions } from "./vault/types.js";

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
  /** MinerU API Token for precision PDF parsing */
  mineruApiKey?: string;
  /** Generate LLM summaries for each node (default: true) */
  addNodeSummary?: boolean;
  /** Generate document-level description (default: true) */
  addDocDescription?: boolean;
  /** Progress callback */
  onProgress?: (progress: BookIndexProgress) => void;
  /** Proposition cards config (optional) */
  propositions?: {
    enabled: boolean;
    model: string;
    apiKey: string;
    baseUrl: string;
    cardsPer500Words?: number;
  };
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
  /** Directory name used for DeepReader/{exportName}/ export folder */
  exportName: string;
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
  /** Proposition cards info (optional) */
  propositions?: {
    enabled: boolean;
    totalCards?: number;
    model: string;
    generatedAt?: string;
    error?: string;
  };
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
  topK?: number;
  embedding?: EmbeddingOptions;
  scopeNodeIds?: string[];
  reranker?: RerankerOptions;
  treeSearch?: boolean;
  llmClient?: any;
  maxContentLength?: number;
  bookId?: string;
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
  exportName?: string;
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

// ─── Proposition Cards Types ───────────────────────────────────────────────────

/** 卡片类型（基于《如何阅读一本书》分析阅读方法） */
export type CardType = 
  | '问题' 
  | '概念' 
  | '主旨' 
  | '论述' 
  | '结论' 
  | '人物' 
  | '情节' 
  | '象征';

/** 原子事实卡片 */
export interface PropositionCard {
  id: string;
  type: CardType;
  answer: string;
  context: string;
  tags: string[];
  sourceNodeId: string;
  matchScore?: number;
}

/** 命题卡片数据 */
export interface PropositionsData {
  version: number;
  bookId: string;
  totalCards: number;
  cards: PropositionCard[];
  generatedAt: string;
  model: string;
}

/** 命题卡片索引选项 */
export interface PropositionIndexOptions {
  bookId: string;
  vaultPath: string;
  treeData: TreeData;
  embedding?: EmbeddingOptions;
  llm: {
    model: string;
    apiKey: string;
    baseUrl: string;
  };
  cardsPer500Words?: number;
  minCards?: number;
  maxCards?: number;
  onProgress?: (progress: { percent: number; message: string }) => void;
}

/** 命题卡片索引结果 */
export interface PropositionIndexResult {
  bookId: string;
  totalCards: number;
  indexDir: string;
}

/** 命题卡片匹配结果 */
export interface PropositionMatch {
  card: PropositionCard;
  score: number;
}