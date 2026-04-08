/**
 * bun-pageindex v2.0 - Full API (Bun-native)
 * Bun-native document indexing and Obsidian vault management
 *
 * Three-layer API design:
 *   1. Product-Level  — high-level entry points for common tasks
 *   2. Parser-Level   — format-specific functions for advanced users
 *   3. LLM Client     — low-level chat utilities for specialized use
 *
 * ⚠️  IMPORTANT: This entry point includes Bun-specific vault features.
 *    For Node.js environments (Obsidian plugins), use './node.ts' instead.
 *
 * Runtime compatibility:
 *   - Bun:     Full features available (vault indexing, search, compilation)
 *   - Node.js: Core features only (PDF/EPUB parsing, TOC generation, export)
 *              Use './node.ts' for Node.js compatibility
 */

// ── Product-Level API ────────────────────────────────────────────────────────

// Unified entry points (auto-detect document type)
// Note: searchVault, indexVault, loadVaultIndex are Bun-only (dynamic import)
export { docToIndex, docToObsidian, searchVault, indexVault, loadVaultIndex } from "./unified";

// Core class
export { PageIndex, createPageIndex } from "./pageindex";

// Obsidian export
export { exportPdfToObsidian, type PdfObsidianExportOptions } from "./exporters/pdf-to-obsidian";
export { exportEpubToObsidian, type EpubObsidianExportOptions } from "./exporters/adapter";

// Markdown utilities
export {
  mdToTree,
  markdownToTree,
  extractNodesFromMarkdown,
  extractNodeTextContent,
  buildTreeFromNodes,
  treeThinningForIndex,
  printTocMd,
} from "./parsers/markdown";

// ── Types ────────────────────────────────────────────────────────────────────

// Core types
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
  DocObsidianOptions,
  ObsidianExportResult,
} from "./core/types";

// Vault types
export type {
  ObsidianVaultIndexOptions,
  VaultIndexResult,
  SearchOptions,
  SearchResult,
  EmbeddingOptions,
  VaultIndexMeta,
  FileMeta,
  DirectoryIndex,
  SearchIndex,
  VectorIndexMeta,
  RerankerOptions,
} from "./vault/types";

// ── Parser-Level API (advanced users) ────────────────────────────────────────

export { parsePdf, getPdfName, type PdfInfo, type PdfPage } from "./parsers/pdf";

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

// ── LLM Client (specialized use) ─────────────────────────────────────────────

export {
  chatGPT,
  chatGPTWithFinishReason,
  chatGPTBatch,
  getLMStudioConfig,
  getOllamaConfig,
  type ClientConfig,
  type ChatOptions,
  type ChatResult,
} from "./llm/client";

// ── Vault Compiler ──────────────────────────────────────────────────────────

export { compileVault } from "./vault/compiler";
export { scanDirectories, classifyDirectory } from "./vault/compiler-scan";
export { searchV2 } from "./vault/search-v2";
export type {
  CompileOptions,
  CompileResult,
  DirectoryScan,
  ConceptExtraction,
  DeepAnalysis,
  SearchResultV2,
} from "./vault/compiler-types";
