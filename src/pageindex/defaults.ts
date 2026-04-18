/**
 * PageIndex: Default configuration
 * Centralized defaults for indexing, parsing, exporting, and OCR
 */

// ─── LLM / API ────────────────────────────────────────────────
/** Default LLM model for TOC extraction and summaries */
export const DEFAULT_MODEL = "deepseek-chat";

/** Default API base URL (DeepSeek) */
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

// ─── Indexing ──────────────────────────────────────────────────
/** Add unique node IDs to tree structure */
export const DEFAULT_ADD_NODE_ID = true;

/** Generate LLM summaries for each chapter/node */
export const DEFAULT_ADD_NODE_SUMMARY = true;

/** Generate document-level description */
export const DEFAULT_ADD_DOC_DESCRIPTION = true;

/** Include full text content in tree nodes */
export const DEFAULT_ADD_NODE_TEXT = true;

// ─── TOC / Structure ──────────────────────────────────────────
/** Max pages to scan for TOC detection */
export const DEFAULT_TOC_CHECK_PAGE_NUM = 20;

/** Max pages per node before splitting */
export const DEFAULT_MAX_PAGE_NUM_EACH_NODE = 10;

/** Max tokens per content group before splitting */
export const DEFAULT_MAX_TOKEN_NUM_EACH_NODE = 20000;

// ─── Export ────────────────────────────────────────────────────
/** Export output subdirectory (relative to vault root) */
export const DEFAULT_EXPORT_DIR = "DeepReader";

/** Image assets subdirectory name (relative to book dir) */
export const DEFAULT_ASSETS_PATH = "assets";

/** Add chapter index prefix to filenames (e.g., "01 - 第一章.md") */
export const DEFAULT_INCLUDE_INDEX = true;

// ─── OCR ──────────────────────────────────────────────────────
/** Default extraction mode */
export const DEFAULT_EXTRACTION_MODE = "text" as const;

/** OCR model for scanned PDFs (智谱云端 GLM-OCR) */
export const DEFAULT_OCR_MODEL = "glm-ocr";

/** OCR prompt type */
export const DEFAULT_OCR_PROMPT_TYPE = "text" as const;

/** Image DPI for OCR conversion */
export const DEFAULT_IMAGE_DPI = 150;

/** Image format for OCR conversion */
export const DEFAULT_IMAGE_FORMAT = "png" as const;

/** Concurrent OCR requests */
export const DEFAULT_OCR_CONCURRENCY = 3;

// ─── Covers ───────────────────────────────────────────────────
/** Cover images subdirectory (relative to export dir) */
export const DEFAULT_COVERS_PATH = "covers";
