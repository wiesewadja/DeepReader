/**
 * PageIndex: Obsidian Vault Index Types
 */

import type { TreeNode, MarkdownOptions, PageIndexResult } from "../core/types";


export interface EmbeddingOptions {
  /** Embedding provider */
  provider: "openai" | "ollama" | "lmstudio" | "local";
  /** Model name (default: text-embedding-3-small for openai, nomic-embed-text for ollama) */
  model?: string;
  /** API key */
  apiKey?: string;
  /** Base URL for API (default: http://localhost:1234/v1 for lmstudio) */
  baseUrl?: string;
  /** Vector dimensions (default: 1536 for OpenAI, 768 for nomic, 1024 for qwen3-embedding-0.6b) */
  dimensions?: number;
  /** Max texts per API request (default: 32, some providers limit to 32 or less) */
  batchSize?: number;
}

export interface ObsidianVaultIndexOptions extends MarkdownOptions {
  /** Vault root path */
  vaultPath: string;
  /** Subdirectories to index (relative paths). If omitted, index all */
  subdirectories?: string[];
  /** Glob patterns to exclude */
  excludePatterns?: string[];
  /** Enable incremental indexing (default: true) */
  incremental?: boolean;
  /** Auto-exclude derived files with type: pdf/epub in frontmatter (default: true) */
  excludeDerivedFiles?: boolean;
  /** Embedding model configuration for vector search */
  embedding?: EmbeddingOptions;
}

export interface FileMeta {
  /** Content hash */
  hash: string;
  /** Last modified timestamp */
  mtime: number;
  /** Token count */
  tokenCount: number;
  /** File-level index result */
  result: PageIndexResult;
}

export interface DirectoryIndex {
  docName: string;
  docDescription?: string;
  structure: TreeNode[];
}

export interface SearchIndex {
  invertedIndex: Record<string, string[]>;
  nodeMap: Record<string, { file: string; lineNum?: number; localNodeId?: string }>;
}

export interface VaultIndexMeta {
  version: number;
  indexedAt: string;
  vaultPath: string;
  files: Record<string, FileMeta>;
  directories: Record<string, DirectoryIndex>;
  searchIndex: SearchIndex;
}

export interface VaultIndexResult {
  vaultPath: string;
  totalFiles: number;
  changedFiles: number;
  directories: string[];
  files: Record<string, FileMeta>;
  directoriesIndex: Record<string, DirectoryIndex>;
  searchIndex: SearchIndex;
  meta: VaultIndexMeta;
}

// ─── JSONL Vector Storage Types ───────────────────────────────

/** 单条向量记录（JSONL 每行的结构） */
export interface VectorRecord {
  chunkId: string;
  nodeId: string;
  blockIds: string[];
  type: "summary" | "heading" | "body" | "list" | "quote";
  level: "L0" | "L1" | "L2";
  vector: number[];
}

/** 段落原文记录（chunks.jsonl 每行的结构） */
export interface ChunkTextRecord {
  chunkId: string;
  nodeId: string;
  blockIds: string[];
  text: string;
  type: "summary" | "heading" | "body" | "list" | "quote";
}

/** 单条 proposition 向量记录 */
export interface PropVectorRecord {
  cardId: string;
  vector: number[];
}

/** 全局目录 */
export interface CatalogMeta {
  version: number;
  books: Record<string, CatalogBookEntry>;
}

/** 全局目录中每本书的条目 */
export interface CatalogBookEntry {
  title: string;
  vectorModel: string;
  dimensions: number;
  nodeCount: number;
  hasPropositions: boolean;
  indexedAt: string;
}

export interface RerankerOptions {
  /** Reranker provider */
  provider: "lmstudio" | "ollama" | "openai";
  /** Model name (default: BAAI/bge-reranker-v2-m3) */
  model?: string;
  /** Base URL for API (default: http://localhost:1234/v1 for lmstudio, http://localhost:11434 for ollama) */
  baseUrl?: string;
  /** API key */
  apiKey?: string;
  /** Reranker weight in final score 0-1 (default: 0.7) */
  weight?: number;
  /** Max candidates to rerank (default: 50) */
  maxCandidates?: number;
}

export interface TreeSearchOptions {
  /** LLM model to use for tree search */
  model: string;
  /** API key */
  apiKey?: string;
  /** Base URL for LLM API */
  baseUrl?: string;
  /** Weight of tree search score in final merge (default: 0.6) */
  weight?: number;
}

export interface SearchOptions {
  /** Number of results to return (default: 10) */
  topK?: number;
  /** Vector search weight 0-1 (default: 0.7) */
  vectorWeight?: number;
  /** Keyword search weight 0-1 (default: 0.3) */
  keywordWeight?: number;
  /** Limit search to specific directories */
  directoryFilter?: string[];
  /** Embedding options for query vectorization */
  embedding?: EmbeddingOptions;
  /** Reranker options (optional, enables cross-encoder re-ranking) */
  reranker?: RerankerOptions;
  /** Whether to use dynamic recall (default: true) */
  dynamicRecall?: boolean;
  /** Whether to apply node level weighting (default: true) */
  levelWeighting?: boolean;
  /** LLM-driven tree search options (optional, enables semantic tree traversal) */
  treeSearch?: TreeSearchOptions;
}

export interface SearchResult {
  nodeId: string;
  title: string;
  summary: string;
  file: string;
  directory: string;
  lineNum?: number;
  score: number;
  vectorScore: number;
  keywordScore: number;
  levelWeight: number;
  rerankScore?: number;
  treeScore?: number;
  context: {
    parent?: string;
    siblings?: string[];
  };
}
