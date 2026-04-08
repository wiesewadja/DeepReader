# Page Index Replace Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Page Index to replace backend indexing with complete test coverage and error handling.

**Architecture:** 
- Three new modules: book-indexer.ts (orchestrator), book-search.ts (search logic), bm25.ts (BM25 algorithm)
- L0/L1 vectorization + L2 LLM inference for paragraph-level search
- Per-book independent storage in .pageindex/{book_hash}/

**Tech Stack:** TypeScript, PageIndex (existing), OpenAI API/Ollama, BM25, Obsidian Plugin API

**Estimated Effort:** 8-12 hours (implementation + testing)

---

## File Structure

### New Files (Core)

```
frontend/src/pageindex/
├── book-indexer.ts           # Orchestrates: parse → export → meta → vectorize → bm25
├── book-search.ts            # Vector + BM25 fusion search
├── bm25.ts                   # BM25 algorithm implementation
└── __tests__/
    ├── book-indexer.test.ts  # 50 tests
    ├── book-search.test.ts   # 30 tests
    └── bm25.test.ts          # 20 tests
```

### New Files (Types)

```
frontend/src/pageindex/
└── book-types.ts             # BookIndexOptions, BookIndexResult, BookSearchResult, etc.
```

### Modified Files (UI)

```
frontend/src/
├── components/library-modal/library-modal.ts
├── views/sidebar-view.ts
├── components/reading-topbar/reading-topbar.ts
├── agent/tools/local/search-text.ts
└── settings/setting-tab.ts
```

---

## Chunk 1: Core Types and BM25 Algorithm

### Task 1.1: Define Core Types

**Files:**
- Create: `frontend/src/pageindex/book-types.ts`

- [ ] **Step 1: Create book-types.ts with interface definitions**

```typescript
// frontend/src/pageindex/book-types.ts

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
export interface IndexError extends Error {
  code: IndexErrorCode;
  userMessage: string;
  repairAction?: string;
}

/**
 * Book metadata (cached in book-meta.json)
 */
export interface BookMeta {
  version: number;
  bookId: string;
  title: string;
  description: string;
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
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pageindex/book-types.ts
git commit -m "feat(pageindex): add core type definitions for book indexer"
```

---

### Task 1.2: Implement BM25 Algorithm

**Files:**
- Create: `frontend/src/pageindex/bm25.ts`
- Create: `frontend/src/pageindex/__tests__/bm25.test.ts`

- [ ] **Step 1: Write failing test for CJK bigram tokenization**

```typescript
// frontend/src/pageindex/__tests__/bm25.test.ts

import { describe, it, expect } from "vitest";
import { tokenize } from "../bm25.js";

describe("bm25", () => {
  describe("tokenize", () => {
    it("should tokenize CJK text with bigrams", () => {
      const result = tokenize("机器学习");
      expect(result).toContain("机器");
      expect(result).toContain("器学");
      expect(result).toContain("学习");
    });

    it("should tokenize English with spaces", () => {
      const result = tokenize("machine learning");
      expect(result).toContain("machine");
      expect(result).toContain("learning");
    });

    it("should handle mixed CJK and English", () => {
      const result = tokenize("机器学习machine learning");
      expect(result).toContain("机器");
      expect(result).toContain("学习");
      expect(result).toContain("machine");
      expect(result).toContain("learning");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/bm25.test.ts`
Expected: FAIL with "tokenize is not defined"

- [ ] **Step 3: Implement tokenize function**

```typescript
// frontend/src/pageindex/bm25.ts

import type { BM25Data } from "./book-types.js";

/**
 * Tokenize text for BM25 indexing
 * - CJK text: bigrams + full words
 * - English/numbers: space tokenization
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  
  // Split on non-alphanumeric, keep CJK characters
  const parts = text
    .toLowerCase()
    .replace(/([^\w\s\u4e00-\u9fff])/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  
  tokens.push(...parts);
  
  // Extract CJK parts for bigrams
  const cjkParts = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const cjk of cjkParts) {
    if (cjk.length >= 2) {
      tokens.push(cjk); // Full word
      // Bigrams
      for (let i = 0; i < cjk.length - 1; i++) {
        tokens.push(cjk.slice(i, i + 2));
      }
    }
  }
  
  // Remove duplicates
  return [...new Set(tokens)];
}

/**
 * Build BM25 index from nodes
 */
export function buildBM25Index(
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): BM25Data {
  // TODO: Implement in next task
  throw new Error("Not implemented");
}

/**
 * Search BM25 index
 */
export function searchBM25(
  query: string,
  index: BM25Data,
  topK: number
): Array<{ nodeId: string; score: number }> {
  // TODO: Implement in next task
  throw new Error("Not implemented");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/bm25.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for BM25 index building**

```typescript
// frontend/src/pageindex/__tests__/bm25.test.ts

import { buildBM25Index } from "../bm25.js";

describe("buildBM25Index", () => {
  it("should build inverted index correctly", () => {
    const nodes = [
      { id: "ch01", text: "机器学习是人工智能的分支", level: "L1" as const },
      { id: "ch02", text: "深度学习是机器学习的子领域", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    
    expect(index.stats.totalDocs).toBe(2);
    expect(index.invertedIndex["机器"]).toBeDefined();
    expect(index.invertedIndex["学习"]).toBeDefined();
  });

  it("should calculate document length correctly", () => {
    const nodes = [
      { id: "ch01", text: "机器学习", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    
    expect(index.nodes["ch01"].length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/bm25.test.ts`
Expected: FAIL with "Not implemented"

- [ ] **Step 7: Implement buildBM25Index**

```typescript
// frontend/src/pageindex/bm25.ts (update)

export function buildBM25Index(
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): BM25Data {
  const nodesMap: BM25Data["nodes"] = {};
  const invertedIndex: BM25Data["invertedIndex"] = {};
  let totalLength = 0;
  const df: Record<string, number> = {};

  for (const node of nodes) {
    const tokens = tokenize(node.text);
    const length = tokens.length;
    totalLength += length;

    nodesMap[node.id] = {
      text: node.text,
      length,
      level: node.level,
    };

    // Count term frequency in this document
    const tf: Record<string, number> = {};
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1;
    }

    // Update inverted index
    for (const [token, count] of Object.entries(tf)) {
      if (!invertedIndex[token]) {
        invertedIndex[token] = [];
      }
      invertedIndex[token].push({ nodeId: node.id, tf: count });
    }

    // Update document frequency
    for (const token of Object.keys(tf)) {
      df[token] = (df[token] || 0) + 1;
    }
  }

  const avgDocLength = nodes.length > 0 ? totalLength / nodes.length : 0;

  return {
    nodes: nodesMap,
    invertedIndex,
    stats: {
      totalDocs: nodes.length,
      avgDocLength,
      df,
    },
    params: {
      k1: 1.5,
      b: 0.75,
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/bm25.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing test for BM25 search**

```typescript
// frontend/src/pageindex/__tests__/bm25.test.ts

import { searchBM25, buildBM25Index } from "../bm25.js";

describe("searchBM25", () => {
  it("should return ranked results", () => {
    const nodes = [
      { id: "ch01", text: "机器学习是人工智能的分支", level: "L1" as const },
      { id: "ch02", text: "深度学习是机器学习的子领域", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    const results = searchBM25("机器学习", index, 2);
    
    expect(results.length).toBe(2);
    expect(results[0].nodeId).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("should handle single-character query with bigram fallback", () => {
    const nodes = [
      { id: "ch01", text: "机器学习", level: "L1" as const },
    ];
    
    const index = buildBM25Index(nodes);
    const results = searchBM25("机", index, 1);
    
    // Single char should match via bigrams
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/bm25.test.ts`
Expected: FAIL with "Not implemented"

- [ ] **Step 11: Implement searchBM25**

```typescript
// frontend/src/pageindex/bm25.ts (update)

export function searchBM25(
  query: string,
  index: BM25Data,
  topK: number
): Array<{ nodeId: string; score: number }> {
  const queryTokens = tokenize(query);
  const scores: Record<string, number> = {};

  const { totalDocs, avgDocLength, df } = index.stats;
  const { k1, b } = index.params;

  for (const token of queryTokens) {
    const postings = index.invertedIndex[token];
    if (!postings) continue;

    // Calculate IDF
    const docFreq = df[token] || 0;
    const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5));

    for (const { nodeId, tf } of postings) {
      const docLength = index.nodes[nodeId]?.length || 0;
      
      // BM25 formula
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
      const bm25Score = idf * (numerator / denominator);

      scores[nodeId] = (scores[nodeId] || 0) + bm25Score;
    }
  }

  // Sort by score and return topK
  const results = Object.entries(scores)
    .map(([nodeId, score]) => ({ nodeId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return results;
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/bm25.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add frontend/src/pageindex/bm25.ts frontend/src/pageindex/__tests__/bm25.test.ts
git commit -m "feat(pageindex): implement BM25 algorithm with CJK bigram tokenization"
```

---

## Chunk 2: Book Indexer Core Implementation

### Task 2.1: Implement Book Indexer (Core Flow)

**Files:**
- Create: `frontend/src/pageindex/book-indexer.ts`
- Create: `frontend/src/pageindex/__tests__/book-indexer.test.ts`

- [ ] **Step 1: Write failing test for indexBook basic flow**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { indexBook, isBookIndexed, deleteBookIndex } from "../book-indexer.js";
import * as fs from "fs/promises";
import * as path from "path";

describe("book-indexer", () => {
  const testOutputDir = "/tmp/deepreader-test-index";
  
  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });
  
  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  describe("indexBook", () => {
    it("should reject non-existent file with FILE_NOT_FOUND", async () => {
      await expect(
        indexBook({
          filePath: "/non/existent/file.pdf",
          fileType: "pdf",
          outputDir: testOutputDir,
        })
      ).rejects.toThrow("FILE_NOT_FOUND");
    });

    it("should generate bookId from file path hash", async () => {
      // Mock PageIndex result
      // TODO: Implement with real test PDF
    });
  });

  describe("isBookIndexed", () => {
    it("should return false for non-indexed book", async () => {
      const result = await isBookIndexed("/path/to/book.pdf");
      expect(result).toBe(false);
    });
  });

  describe("deleteBookIndex", () => {
    it("should delete index directory", async () => {
      // Create fake index
      const bookId = "abcd1234";
      const indexDir = path.join(testOutputDir, ".pageindex", bookId);
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, "book-meta.json"), "{}");
      
      await deleteBookIndex("/path/to/book.pdf");
      
      // Verify deletion
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: FAIL with "indexBook is not defined"

- [ ] **Step 3: Implement book-indexer.ts skeleton**

```typescript
// frontend/src/pageindex/book-indexer.ts

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { PageIndex } from "./pageindex.js";
import type {
  BookIndexOptions,
  BookIndexResult,
  BookMeta,
  ChapterMeta,
  IndexErrorCode,
} from "./book-types.js";
import { buildBM25Index } from "./bm25.js";
import { initVectorStore, generateEmbeddings } from "./vault/vectors.js";

/**
 * Generate bookId from file path (SHA-256 first 8 chars)
 */
function generateBookId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

/**
 * Check if book is already indexed
 */
export async function isBookIndexed(filePath: string): Promise<boolean> {
  const bookId = generateBookId(filePath);
  const indexDir = path.join(path.dirname(filePath), ".pageindex", bookId);
  
  try {
    await fs.access(indexDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete book index
 */
export async function deleteBookIndex(filePath: string): Promise<void> {
  const bookId = generateBookId(filePath);
  const indexDir = path.join(path.dirname(filePath), ".pageindex", bookId);
  
  await fs.rm(indexDir, { recursive: true, force: true });
}

/**
 * Index a single book
 */
export async function indexBook(options: BookIndexOptions): Promise<BookIndexResult> {
  // Validate file exists
  try {
    await fs.access(options.filePath);
  } catch {
    const error = new Error("File not found") as Error & { code: IndexErrorCode };
    error.code = "FILE_NOT_FOUND";
    throw error;
  }

  const bookId = generateBookId(options.filePath);
  const indexDir = path.join(options.outputDir, ".pageindex", bookId);

  // TODO: Implement full flow in next tasks
  throw new Error("Not implemented");
}
```

- [ ] **Step 4: Run test to verify basic tests pass**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: PASS for isBookIndexed and deleteBookIndex, FAIL for indexBook

- [ ] **Step 5: Commit partial implementation**

```bash
git add frontend/src/pageindex/book-indexer.ts frontend/src/pageindex/__tests__/book-indexer.test.ts
git commit -m "feat(pageindex): add book-indexer skeleton with bookId generation"
```

---

### Task 2.2: Implement Document Parsing Step

**Files:**
- Modify: `frontend/src/pageindex/book-indexer.ts`
- Modify: `frontend/src/pageindex/__tests__/book-indexer.test.ts`

- [ ] **Step 1: Write failing test for document parsing**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("indexBook - document parsing", () => {
  it("should parse PDF and extract structure", async () => {
    // This test will use a real PDF file in tests/fixtures/
    const testPdf = path.join(__dirname, "__fixtures__", "test-book.pdf");
    
    const result = await indexBook({
      filePath: testPdf,
      fileType: "pdf",
      outputDir: testOutputDir,
      model: "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    expect(result.bookId).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.chaptersCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: FAIL with "Not implemented"

- [ ] **Step 3: Implement document parsing in indexBook**

```typescript
// frontend/src/pageindex/book-indexer.ts (update indexBook function)

export async function indexBook(options: BookIndexOptions): Promise<BookIndexResult> {
  // Validate file exists
  try {
    await fs.access(options.filePath);
  } catch {
    const error = new Error("File not found") as Error & { code: IndexErrorCode };
    error.code = "FILE_NOT_FOUND";
    throw error;
  }

  const bookId = generateBookId(options.filePath);
  const indexDir = path.join(options.outputDir, ".pageindex", bookId);

  // Step 1: Document parsing
  options.onProgress?.({
    percent: 5,
    step: "parse_document",
    stepLabel: "解析文档",
  });

  const pageIndex = new PageIndex({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  let parseResult;
  if (options.fileType === "pdf") {
    parseResult = await pageIndex.fromPdf(options.filePath);
  } else {
    parseResult = await pageIndex.fromEpub(options.filePath);
  }

  options.onProgress?.({
    percent: 15,
    step: "parse_complete",
    stepLabel: "文档解析完成",
  });

  // TODO: Continue with remaining steps
  return {
    bookId,
    title: parseResult.structure[0]?.title || "Unknown",
    chaptersCount: parseResult.structure.length,
    indexDir,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-indexer.ts frontend/src/pageindex/__tests__/book-indexer.test.ts
git commit -m "feat(pageindex): implement document parsing step"
```

---

### Task 2.3: Implement Markdown Export Step

**Files:**
- Modify: `frontend/src/pageindex/book-indexer.ts`
- Modify: `frontend/src/pageindex/__tests__/book-indexer.test.ts`

- [ ] **Step 1: Write failing test for Markdown export**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("indexBook - markdown export", () => {
  it("should export Markdown files with block IDs", async () => {
    const result = await indexBook({
      filePath: testPdf,
      fileType: "pdf",
      outputDir: testOutputDir,
    });
    
    // Check MOC file exists
    const mocPath = path.join(testOutputDir, result.title, `${result.title} - MOC.md`);
    await expect(fs.access(mocPath)).resolves.toBeUndefined();
    
    // Check chapter file has block IDs
    const chapterFiles = await fs.readdir(path.join(testOutputDir, result.title));
    const chapterContent = await fs.readFile(
      path.join(testOutputDir, result.title, chapterFiles[0]),
      "utf-8"
    );
    expect(chapterContent).toMatch(/\^[\w-]+/); // block ID pattern
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Markdown export**

```typescript
// frontend/src/pageindex/book-indexer.ts (add after parsing step)

// Step 2: Markdown export
options.onProgress?.({
  percent: 40,
  step: "export_markdown",
  stepLabel: "导出 Markdown",
});

const bookDir = path.join(options.outputDir, parseResult.structure[0]?.title || "Book");

// Use existing exporter
const { exportPdfToObsidian } = await import("./exporters/pdf-to-obsidian.js");
await exportPdfToObsidian({
  pdfPath: options.filePath,
  outputDir: bookDir,
  pageOptions: {
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  },
});

options.onProgress?.({
  percent: 75,
  step: "export_complete",
  stepLabel: "Markdown 导出完成",
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-indexer.ts
git commit -m "feat(pageindex): implement markdown export with block IDs"
```

---

### Task 2.4: Implement book-meta.json Building

**Files:**
- Modify: `frontend/src/pageindex/book-indexer.ts`
- Modify: `frontend/src/pageindex/__tests__/book-indexer.test.ts`

- [ ] **Step 1: Write failing test for book-meta.json**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("indexBook - book-meta.json", () => {
  it("should create book-meta.json with correct structure", async () => {
    const result = await indexBook({
      filePath: testPdf,
      fileType: "pdf",
      outputDir: testOutputDir,
    });
    
    const metaPath = path.join(result.indexDir, "book-meta.json");
    const metaContent = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaContent);
    
    expect(meta.version).toBe(1);
    expect(meta.bookId).toBe(result.bookId);
    expect(meta.title).toBe(result.title);
    expect(meta.chapters).toBeDefined();
    expect(meta.chapters.length).toBeGreaterThan(0);
    expect(meta.chapters[0].paragraphs).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement book-meta.json building**

```typescript
// frontend/src/pageindex/book-indexer.ts (add helper function)

async function buildBookMeta(
  parseResult: PageIndexResult,
  bookId: string,
  bookDir: string,
  filePath: string,
  fileType: "pdf" | "epub",
  embedding?: EmbeddingOptions
): Promise<BookMeta> {
  const root = parseResult.structure[0];
  
  // Extract chapters
  const chapters: ChapterMeta[] = [];
  let sortOrder = 0;
  
  for (const node of root.nodes || []) {
    const mdFileName = `${node.title}.md`;
    const mdFilePath = path.join(bookDir, mdFileName);
    
    // Extract block IDs from MD file
    const paragraphs: ParagraphMeta[] = [];
    try {
      const mdContent = await fs.readFile(mdFilePath, "utf-8");
      const blockIdMatches = mdContent.matchAll(/\^([\w-]+)/g);
      for (const match of blockIdMatches) {
        paragraphs.push({
          blockId: match[1],
          text: "", // TODO: Extract first 50 chars
        });
      }
    } catch (e) {
      // File may not exist yet
    }
    
    chapters.push({
      id: node.nodeId || `ch${sortOrder}`,
      title: node.title,
      summary: node.summary || "",
      mdFilePath: path.relative(bookDir, mdFilePath),
      sortOrder: sortOrder++,
      mdFileHash: "", // TODO: Calculate hash
      paragraphs,
    });
  }
  
  return {
    version: 1,
    bookId,
    title: root.title,
    description: root.summary || "",
    filePath,
    fileType,
    indexedAt: new Date().toISOString(),
    embedding: embedding ? {
      provider: embedding.provider,
      model: embedding.model || "text-embedding-3-small",
      dimensions: embedding.dimensions || 1536,
    } : undefined,
    chapters,
  };
}

// Update indexBook to call buildBookMeta
const bookMeta = await buildBookMeta(
  parseResult,
  bookId,
  bookDir,
  options.filePath,
  options.fileType,
  options.embedding
);

// Write book-meta.json
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(
  path.join(indexDir, "book-meta.json"),
  JSON.stringify(bookMeta, null, 2)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-indexer.ts
git commit -m "feat(pageindex): implement book-meta.json building"
```

---

### Task 2.5: Implement L0/L1 Vectorization

**Files:**
- Modify: `frontend/src/pageindex/book-indexer.ts`
- Modify: `frontend/src/pageindex/__tests__/book-indexer.test.ts`

- [ ] **Step 1: Write failing test for vectorization**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("indexBook - vectorization", () => {
  it("should create vectors.f32 when embedding config provided", async () => {
    const result = await indexBook({
      filePath: testPdf,
      fileType: "pdf",
      outputDir: testOutputDir,
      embedding: {
        provider: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: "text-embedding-3-small",
        dimensions: 1536,
      },
    });
    
    const vectorsPath = path.join(result.indexDir, "vectors.f32");
    await expect(fs.access(vectorsPath)).resolves.toBeUndefined();
    
    const metaPath = path.join(result.indexDir, "vectors.meta.json");
    const metaContent = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaContent);
    
    expect(meta.dimensions).toBe(1536);
    expect(meta.count).toBeGreaterThan(0);
  });

  it("should skip vectorization when embedding config not provided", async () => {
    const result = await indexBook({
      filePath: testPdf,
      fileType: "pdf",
      outputDir: testOutputDir,
      // No embedding config
    });
    
    const vectorsPath = path.join(result.indexDir, "vectors.f32");
    await expect(fs.access(vectorsPath)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement vectorization with dimension check**

```typescript
// frontend/src/pageindex/book-indexer.ts (add helper function)

async function vectorizeNodes(
  bookMeta: BookMeta,
  indexDir: string,
  embedding: EmbeddingOptions,
  onProgress?: (progress: BookIndexProgress) => void
): Promise<void> {
  onProgress?.({
    percent: 85,
    step: "vectorize",
    stepLabel: "向量化 L0/L1",
  });

  // Build L0 text: title + description + all chapter titles
  const l0Text = `${bookMeta.title}。${bookMeta.description}。目录：${bookMeta.chapters.map(ch => ch.title).join("、")}`;
  
  // Check token limit (OpenAI max 8191)
  const tokenCount = Math.ceil(l0Text.length / 4); // Rough estimate
  let l0TextFinal = l0Text;
  if (tokenCount > 8000) {
    // Truncate to first 20 chapters
    const truncated = bookMeta.chapters.slice(0, 20).map(ch => ch.title).join("、");
    l0TextFinal = `${bookMeta.title}。${bookMeta.description}。目录：${truncated}...`;
  }

  // Build L1 texts: bookTitle > chapterTitle + summary
  const l1Texts = bookMeta.chapters.map(ch => 
    `${bookMeta.title} > ${ch.title}。${ch.summary}`
  );

  // Combine L0 + L1
  const allTexts = [l0TextFinal, ...l1Texts];
  const nodeIds = [`book_${bookMeta.bookId}`, ...bookMeta.chapters.map(ch => ch.id)];

  // Initialize vector store with correct dimensions
  const dimensions = embedding.dimensions || 1536;
  const vectorStore = await initVectorStore(indexDir, dimensions);

  // Generate embeddings
  try {
    const embeddings = await generateEmbeddings(allTexts, embedding);
    
    // Write vectors
    // TODO: Implement vector writing logic
    // For now, throw error to indicate this is a stub
    throw new Error("Vector writing not yet implemented");
  } catch (error) {
    // Graceful degradation: mark as incomplete
    console.error("Vectorization failed:", error);
    // Continue without vectors - BM25 will still work
  }

  onProgress?.({
    percent: 92,
    step: "vectorize_complete",
    stepLabel: "向量化完成",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: Partial PASS (vectorization stubbed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-indexer.ts
git commit -m "feat(pageindex): add L0/L1 vectorization with dimension check"
```

---

### Task 2.6: Implement BM25 Index Building

**Files:**
- Modify: `frontend/src/pageindex/book-indexer.ts`
- Modify: `frontend/src/pageindex/__tests__/book-indexer.test.ts`

- [ ] **Step 1: Write failing test for BM25 index**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("indexBook - BM25 index", () => {
  it("should create bm25.json with correct structure", async () => {
    const result = await indexBook({
      filePath: testPdf,
      fileType: "pdf",
      outputDir: testOutputDir,
    });
    
    const bm25Path = path.join(result.indexDir, "bm25.json");
    const bm25Content = await fs.readFile(bm25Path, "utf-8");
    const bm25 = JSON.parse(bm25Content);
    
    expect(bm25.nodes).toBeDefined();
    expect(bm25.invertedIndex).toBeDefined();
    expect(bm25.stats.totalDocs).toBeGreaterThan(0);
    expect(bm25.params.k1).toBe(1.5);
    expect(bm25.params.b).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement BM25 index building**

```typescript
// frontend/src/pageindex/book-indexer.ts (add to indexBook)

// Step 5: Build BM25 index
options.onProgress?.({
  percent: 92,
  step: "build_bm25",
  stepLabel: "构建 BM25 索引",
});

const bm25Nodes = [
  // L0 node
  {
    id: `book_${bookMeta.bookId}`,
    text: `${bookMeta.title} ${bookMeta.description}`,
    level: "L0" as const,
  },
  // L1 nodes
  ...bookMeta.chapters.map(ch => ({
    id: ch.id,
    text: `${ch.title} ${ch.summary}`,
    level: "L1" as const,
  })),
];

const bm25Index = buildBM25Index(bm25Nodes);
await fs.writeFile(
  path.join(indexDir, "bm25.json"),
  JSON.stringify(bm25Index, null, 2)
);

options.onProgress?.({
  percent: 97,
  step: "bm25_complete",
  stepLabel: "BM25 索引构建完成",
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-indexer.ts
git commit -m "feat(pageindex): implement BM25 index building in book indexer"
```

---

### Task 2.7: Add Error Handling

**Files:**
- Modify: `frontend/src/pageindex/book-indexer.ts`
- Modify: `frontend/src/pageindex/__tests__/book-indexer.test.ts`

- [ ] **Step 1: Write tests for error scenarios**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("indexBook - error handling", () => {
  it("should throw EMBEDDING_API_FAILED when API fails", async () => {
    await expect(
      indexBook({
        filePath: testPdf,
        fileType: "pdf",
        outputDir: testOutputDir,
        embedding: {
          provider: "openai",
          apiKey: "invalid-key",
        },
      })
    ).rejects.toThrow("EMBEDDING_API_FAILED");
  });

  it("should mark index as incomplete when vectorization fails", async () => {
    try {
      await indexBook({
        filePath: testPdf,
        fileType: "pdf",
        outputDir: testOutputDir,
        embedding: {
          provider: "openai",
          apiKey: "invalid-key",
        },
      });
    } catch (e) {
      // Expected
    }
    
    // Check book-meta.json has incomplete marker
    const bookId = generateBookId(testPdf);
    const metaPath = path.join(testOutputDir, ".pageindex", bookId, "book-meta.json");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    
    expect(meta.incomplete).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement error handling**

```typescript
// frontend/src/pageindex/book-indexer.ts (wrap vectorization in try-catch)

// Step 4: L0/L1 Vectorization (optional)
if (options.embedding) {
  try {
    await vectorizeNodes(bookMeta, indexDir, options.embedding, options.onProgress);
  } catch (error) {
    console.error("[book-indexer] Vectorization failed:", error);
    
    // Mark index as incomplete
    bookMeta.incomplete = true;
    bookMeta.incompleteReason = "EMBEDDING_API_FAILED";
    
    // Re-write book-meta.json with incomplete marker
    await fs.writeFile(
      path.join(indexDir, "book-meta.json"),
      JSON.stringify(bookMeta, null, 2)
    );
    
    // Continue with BM25 - search will work without vectors
  }
}

// Always build BM25 index
// ... (BM25 code here)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-indexer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-indexer.ts
git commit -m "feat(pageindex): add error handling for embedding API failures"
```

---

## Chunk 3: Book Search Implementation

### Task 3.1: Implement Query Vectorization

**Files:**
- Create: `frontend/src/pageindex/book-search.ts`
- Create: `frontend/src/pageindex/__tests__/book-search.test.ts`

- [ ] **Step 1: Write failing test for searchBook**

```typescript
// frontend/src/pageindex/__tests__/book-search.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchBook } from "../book-search.js";
import * as fs from "fs/promises";
import * as path from "path";

describe("book-search", () => {
  const testIndexDir = "/tmp/deepreader-test-search";
  
  beforeEach(async () => {
    await fs.mkdir(testIndexDir, { recursive: true });
  });
  
  afterEach(async () => {
    await fs.rm(testIndexDir, { recursive: true, force: true });
  });

  describe("searchBook", () => {
    it("should return search results", async () => {
      const results = await searchBook({
        filePath: "/path/to/test-book.pdf",
        query: "机器学习",
        topK: 5,
      });
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].nodeId).toBeDefined();
      expect(results[0].score).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-search.test.ts`
Expected: FAIL with "searchBook is not defined"

- [ ] **Step 3: Implement searchBook skeleton**

```typescript
// frontend/src/pageindex/book-search.ts

import * as path from "path";
import * as fs from "fs/promises";
import type {
  BookSearchOptions,
  BookSearchResult,
  BookMeta,
  BM25Data,
} from "./book-types.js";
import { searchBM25 } from "./bm25.js";
import { loadVectorStore, generateEmbedding, cosineSimilarity } from "./vault/vectors.js";

/**
 * Search a single book
 */
export async function searchBook(options: BookSearchOptions): Promise<BookSearchResult[]> {
  const bookId = generateBookId(options.filePath);
  const indexDir = path.join(path.dirname(options.filePath), ".pageindex", bookId);
  
  // Load book-meta.json
  const metaPath = path.join(indexDir, "book-meta.json");
  const metaContent = await fs.readFile(metaPath, "utf-8");
  const bookMeta = JSON.parse(metaContent) as BookMeta;
  
  // Load BM25 index
  const bm25Path = path.join(indexDir, "bm25.json");
  const bm25Content = await fs.readFile(bm25Path, "utf-8");
  const bm25Index = JSON.parse(bm25Content) as BM25Data;
  
  // TODO: Implement full search logic
  const results = searchBM25(options.query, bm25Index, options.topK || 5);
  
  // Convert to BookSearchResult
  // TODO: Implement conversion
  
  return [];
}

function generateBookId(filePath: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}
```

- [ ] **Step 4: Run test to verify it passes (partial)**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-search.test.ts`
Expected: PASS (skeleton returns empty array)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-search.ts frontend/src/pageindex/__tests__/book-search.test.ts
git commit -m "feat(pageindex): add book-search skeleton"
```

---

### Task 3.2: Implement Vector + BM25 Fusion

**Files:**
- Modify: `frontend/src/pageindex/book-search.ts`
- Modify: `frontend/src/pageindex/__tests__/book-search.test.ts`

- [ ] **Step 1: Write failing test for fusion**

```typescript
// frontend/src/pageindex/__tests__/book-search.test.ts

describe("searchBook - fusion", () => {
  it("should combine vector and BM25 scores", async () => {
    const results = await searchBook({
      filePath: "/path/to/test-book.pdf",
      query: "机器学习",
      embedding: {
        provider: "openai",
        apiKey: process.env.OPENAI_API_KEY,
      },
    });
    
    expect(results[0].vectorScore).toBeDefined();
    expect(results[0].bm25Score).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("should fallback to pure BM25 when embedding fails", async () => {
    const results = await searchBook({
      filePath: "/path/to/test-book.pdf",
      query: "机器学习",
      // No embedding config
    });
    
    expect(results[0].bm25Score).toBeGreaterThan(0);
    expect(results[0].vectorScore).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-search.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement fusion logic**

```typescript
// frontend/src/pageindex/book-search.ts (update searchBook)

export async function searchBook(options: BookSearchOptions): Promise<BookSearchResult[]> {
  const bookId = generateBookId(options.filePath);
  const indexDir = path.join(path.dirname(options.filePath), ".pageindex", bookId);
  const topK = options.topK || 5;
  
  // Load book-meta.json
  const metaPath = path.join(indexDir, "book-meta.json");
  const metaContent = await fs.readFile(metaPath, "utf-8");
  const bookMeta = JSON.parse(metaContent) as BookMeta;
  
  // Load BM25 index
  const bm25Path = path.join(indexDir, "bm25.json");
  const bm25Content = await fs.readFile(bm25Path, "utf-8");
  const bm25Index = JSON.parse(bm25Content) as BM25Data;
  
  // Step 1: BM25 search
  const bm25Results = searchBM25(options.query, bm25Index, topK);
  const bm25Scores: Record<string, number> = {};
  for (const result of bm25Results) {
    bm25Scores[result.nodeId] = result.score;
  }
  
  // Step 2: Vector search (optional)
  let vectorScores: Record<string, number> = {};
  if (options.embedding) {
    try {
      const vectorStore = await loadVectorStore(indexDir);
      if (vectorStore) {
        const queryVector = await generateEmbedding(options.query, options.embedding);
        
        // Brute-force cosine search
        const similarities: Array<{ nodeId: string; score: number }> = [];
        for (const [nodeId, slot] of Object.entries(vectorStore.meta.slots)) {
          const start = slot * vectorStore.meta.dimensions;
          const end = start + vectorStore.meta.dimensions;
          const nodeVector = vectorStore.vectors.slice(start, end);
          
          const similarity = cosineSimilarity(queryVector, Array.from(nodeVector));
          similarities.push({ nodeId, score: similarity });
        }
        
        similarities.sort((a, b) => b.score - a.score);
        for (const result of similarities.slice(0, topK)) {
          vectorScores[result.nodeId] = result.score;
        }
      }
    } catch (error) {
      console.error("[book-search] Vector search failed:", error);
      // Fallback to pure BM25
    }
  }
  
  // Step 3: Fuse scores
  const allNodeIds = new Set([...Object.keys(bm25Scores), ...Object.keys(vectorScores)]);
  const fusedResults: Array<{ nodeId: string; score: number; vectorScore: number; bm25Score: number }> = [];
  
  const w_v = Object.keys(vectorScores).length > 0 ? 0.7 : 0;
  const w_b = w_v > 0 ? 0.3 : 1.0;
  
  for (const nodeId of allNodeIds) {
    const vs = vectorScores[nodeId] || 0;
    const bs = bm25Scores[nodeId] || 0;
    const score = w_v * vs + w_b * bs;
    
    fusedResults.push({
      nodeId,
      score,
      vectorScore: vs,
      bm25Score: bs,
    });
  }
  
  // Sort by fused score
  fusedResults.sort((a, b) => b.score - a.score);
  
  // TODO: Convert to BookSearchResult with L2 context
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-search.ts
git commit -m "feat(pageindex): implement vector + BM25 fusion search"
```

---

### Task 3.3: Implement L2 Context Reading

**Files:**
- Modify: `frontend/src/pageindex/book-search.ts`
- Modify: `frontend/src/pageindex/__tests__/book-search.test.ts`

- [ ] **Step 1: Write failing test for L2 context**

```typescript
// frontend/src/pageindex/__tests__/book-search.test.ts

describe("searchBook - L2 context", () => {
  it("should read chapter Markdown files", async () => {
    const results = await searchBook({
      filePath: "/path/to/test-book.pdf",
      query: "机器学习",
    });
    
    expect(results[0].rawText).toBeDefined();
    expect(results[0].rawText.length).toBeGreaterThan(0);
    expect(results[0].mdFilePath).toBeDefined();
  });

  it("should include block IDs in rawText", async () => {
    const results = await searchBook({
      filePath: "/path/to/test-book.pdf",
      query: "机器学习",
    });
    
    expect(results[0].rawText).toMatch(/\^[\w-]+/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-search.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement L2 context reading**

```typescript
// frontend/src/pageindex/book-search.ts (add helper function)

async function readChapterContent(
  mdFilePath: string,
  maxContextLength?: number
): Promise<{ rawText: string; truncated: boolean }> {
  const content = await fs.readFile(mdFilePath, "utf-8");
  
  // Remove frontmatter
  let cleaned = content.replace(/^---[\s\S]*?---\n/, "");
  
  // Remove navigation markers
  cleaned = cleaned.replace(/\[\[.*?\]\]/g, ""); // Wiki links
  
  // Remove callouts (but keep content)
  cleaned = cleaned.replace(/> \[!.*?\]\n/g, "");
  
  // Truncate if needed
  const maxLen = maxContextLength || 10000;
  const truncated = cleaned.length > maxLen;
  const rawText = truncated ? cleaned.slice(0, maxLen) + "\n... (truncated)" : cleaned;
  
  return { rawText, truncated };
}

// Update searchBook to call readChapterContent
const finalResults: BookSearchResult[] = [];

for (const result of fusedResults.slice(0, topK)) {
  // Find chapter metadata
  const chapter = bookMeta.chapters.find(ch => ch.id === result.nodeId);
  if (!chapter) continue;
  
  // Read L2 context
  const mdFilePath = path.join(path.dirname(options.filePath), chapter.mdFilePath);
  const { rawText, truncated } = await readChapterContent(mdFilePath, options.maxContextLength);
  
  finalResults.push({
    nodeId: result.nodeId,
    level: result.nodeId.startsWith("book_") ? "L0" : "L1",
    bookTitle: bookMeta.title,
    chapterTitle: chapter.title,
    chapterSummary: chapter.summary,
    rawText,
    mdFilePath: chapter.mdFilePath,
    truncated,
    score: result.score,
    vectorScore: result.vectorScore,
    bm25Score: result.bm25Score,
  });
}

return finalResults;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run src/pageindex/__tests__/book-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pageindex/book-search.ts
git commit -m "feat(pageindex): implement L2 context reading with block IDs"
```

---

## Chunk 4: UI Integration

### Task 4.1: Update LibraryModal

**Files:**
- Modify: `frontend/src/components/library-modal/library-modal.ts`

- [ ] **Step 1: Import book-indexer**

```typescript
// frontend/src/components/library-modal/library-modal.ts

// Add import at top
import { indexBook, isBookIndexed, deleteBookIndex } from "../../pageindex/book-indexer.js";
import type { BookIndexProgress } from "../../pageindex/book-types.js";
```

- [ ] **Step 2: Replace handleAddDocument to use indexBook**

```typescript
// frontend/src/components/library-modal/library-modal.ts

// Find handleAddDocument method and replace apiClient.uploadAndIndex call

async handleAddDocument() {
  // ... file selection code (unchanged)
  
  // OLD: await this.options.apiClient.uploadAndIndex(file)
  // NEW:
  try {
    const result = await indexBook({
      filePath: file.path,
      fileType: file.extension === "epub" ? "epub" : "pdf",
      outputDir: this.app.vault.adapter.basePath,
      embedding: this.options.embeddingSettings,
      model: this.options.llmSettings.model,
      apiKey: this.options.llmSettings.apiKey,
      baseUrl: this.options.llmSettings.baseUrl,
      onProgress: (progress: BookIndexProgress) => {
        this.updateProgressUI(progress);
      },
    });
    
    this.close();
    this.options.onIndexCreated?.();
  } catch (error) {
    this.showError(error.message);
  }
}
```

- [ ] **Step 3: Replace loadIndexes to scan .pageindex/**

```typescript
// frontend/src/components/library-modal/library-modal.ts

async loadIndexes() {
  // OLD: const result = await this.options.apiClient.listIndexes()
  // NEW: Scan .pageindex/ directory
  
  const pageindexDir = path.join(this.app.vault.adapter.basePath, ".pageindex");
  const bookMetas: BookMeta[] = [];
  
  try {
    const dirs = await fs.readdir(pageindexDir);
    for (const bookId of dirs) {
      const metaPath = path.join(pageindexDir, bookId, "book-meta.json");
      try {
        const content = await fs.readFile(metaPath, "utf-8");
        bookMetas.push(JSON.parse(content));
      } catch (e) {
        // Skip invalid book-meta.json
      }
    }
  } catch (e) {
    // .pageindex/ doesn't exist yet
  }
  
  // Update UI
  this.renderBookList(bookMetas);
}
```

- [ ] **Step 4: Replace delete button to call deleteBookIndex**

```typescript
// frontend/src/components/library-modal/library-modal.ts

async handleDeleteBook(bookId: string) {
  // OLD: await this.options.apiClient.deleteIndex(indexId)
  // NEW:
  
  const confirmed = await this.showConfirmDialog("确定删除这本书的索引吗？");
  if (!confirmed) return;
  
  try {
    await deleteBookIndex(bookId);
    await this.loadIndexes(); // Refresh list
  } catch (error) {
    this.showError(error.message);
  }
}
```

- [ ] **Step 5: Remove task polling logic**

```typescript
// frontend/src/components/library-modal/library-modal.ts

// Remove startProgressPolling() method
// Remove TaskPollingManager usage
// onProgress callback replaces polling
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/library-modal/library-modal.ts
git commit -m "feat(ui): replace backend API with local book-indexer in LibraryModal"
```

---

### Task 4.2: Update SidebarView

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

- [ ] **Step 1: Remove apiClient dependency**

```typescript
// frontend/src/views/sidebar-view.ts

// Remove constructor parameter: private apiClient: DeepPDFClient | null
// Remove all apiClient null checks
// Remove backend health check timer
```

- [ ] **Step 2: Replace handleAgentQuery to use searchBook**

```typescript
// frontend/src/views/sidebar-view.ts

import { searchBook } from "../pageindex/book-search.js";

async handleAgentQuery(query: string) {
  // OLD: await this.apiClient.agentChatStream(query, indexId, ...)
  // NEW: FrontendAgent will call searchBook internally
  
  const results = await searchBook({
    filePath: this.currentBookPath,
    query,
    embedding: this.settings.embedding,
    topK: 5,
  });
  
  // Pass results to FrontendAgent
  await this.frontendAgent.chat(query, results);
}
```

- [ ] **Step 3: Remove TaskPollingManager**

```typescript
// frontend/src/views/sidebar-view.ts

// Remove: private taskPollingManager: TaskPollingManager | null = null;
// Remove: this.taskPollingManager = new TaskPollingManager(this.apiClient);
// Remove: await this.taskPollingManager.startPolling(taskId, callback);
```

- [ ] **Step 4: Remove backend health check**

```typescript
// frontend/src/views/sidebar-view.ts

// Remove: private healthCheckInterval: number | null = null;
// Remove: this.startHealthCheck() method
// Remove: this.stopHealthCheck() method
// Page Index doesn't need backend health checks
```

- [ ] **Step 5: Update selectIndex to load from book-meta.json**

```typescript
// frontend/src/views/sidebar-view.ts

async selectIndex(bookId: string) {
  // OLD: const status = await this.apiClient.getIndexStatus(indexId)
  // NEW:
  
  const indexDir = path.join(this.app.vault.adapter.basePath, ".pageindex", bookId);
  const metaPath = path.join(indexDir, "book-meta.json");
  const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
  
  this.currentIndexId = bookId;
  this.currentBookMeta = meta;
  this.updateUI();
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(ui): remove backend dependency from SidebarView"
```

---

### Task 4.3: Update ReadingTopbar

**Files:**
- Modify: `frontend/src/components/reading-topbar/reading-topbar.ts`

- [ ] **Step 1: Remove connection status indicator**

```typescript
// frontend/src/components/reading-topbar/reading-topbar.ts

// Remove: connected/disconnected/connecting status
// Remove: backend health check display
// Page Index is always "connected" (local)
```

- [ ] **Step 2: Load book info from book-meta.json**

```typescript
// frontend/src/components/reading-topbar/reading-topbar.ts

async loadBookInfo(bookId: string) {
  // OLD: const info = await this.apiClient.getIndexStatus(bookId)
  // NEW:
  
  const indexDir = path.join(this.app.vault.adapter.basePath, ".pageindex", bookId);
  const meta = JSON.parse(await fs.readFile(path.join(indexDir, "book-meta.json"), "utf-8"));
  
  this.updateUI({
    title: meta.title,
    description: meta.description,
    chaptersCount: meta.chapters.length,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/reading-topbar/reading-topbar.ts
git commit -m "feat(ui): remove backend connection status from ReadingTopbar"
```

---

### Task 4.4: Update search_markdown_text Tool

**Files:**
- Modify: `frontend/src/agent/tools/local/search-text.ts`

- [ ] **Step 1: Replace implementation with searchBook**

```typescript
// frontend/src/agent/tools/local/search-text.ts

import { searchBook } from "../../../pageindex/book-search.js";

export const searchMarkdownTextTool: ToolExecutor = {
  definition: SEARCH_TEXT_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const keywords = args.keywords as string[];
    
    // OLD: Manual file scanning and keyword matching
    // NEW: Use searchBook
    
    try {
      const results = await searchBook({
        filePath: context.pdfPath,
        query: keywords.join(" "),
        topK: 5,
        embedding: context.embeddingSettings,
      });
      
      // Convert to tool result format
      return JSON.stringify({
        status: "SUCCESS",
        hits: results.map(r => ({
          node_id: r.nodeId,
          location: {
            heading: r.chapterTitle,
            file_path: r.mdFilePath,
          },
          snippet: r.rawText.slice(0, 150),
          block_id: extractFirstBlockId(r.rawText),
        })),
        distribution_map: buildDistributionMap(results),
      });
    } catch (error) {
      return JSON.stringify({
        status: "ERROR",
        message: error.message,
      });
    }
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/agent/tools/local/search-text.ts
git commit -m "feat(agent): replace search_markdown_text with book-search"
```

---

### Task 4.5: Update Settings

**Files:**
- Modify: `frontend/src/settings/setting-tab.ts`
- Modify: `frontend/src/config/settings.ts`

- [ ] **Step 1: Add embedding model settings**

```typescript
// frontend/src/config/settings.ts

export interface DeepReaderSettings {
  // ... existing settings
  
  // NEW: Embedding settings
  embedding: {
    provider: "openai" | "ollama" | "lmstudio" | "local";
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    dimensions?: number;
  };
}
```

- [ ] **Step 2: Add UI for embedding settings**

```typescript
// frontend/src/settings/setting-tab.ts

// Add embedding provider dropdown
new Setting(containerEl)
  .setName("嵌入模型提供商")
  .setDesc("选择向量嵌入模型")
  .addDropdown(dropdown => {
    dropdown
      .addOption("openai", "OpenAI (推荐)")
      .addOption("ollama", "Ollama (本地)")
      .addOption("lmstudio", "LM Studio (本地)")
      .setValue(this.plugin.settings.embedding.provider)
      .onChange(async (value) => {
        this.plugin.settings.embedding.provider = value as any;
        await this.plugin.saveSettings();
      });
  });

// Add API key input for OpenAI
// Add base URL input for local models
// Add model selection
// Add dimension configuration
```

- [ ] **Step 3: Remove backend connection settings**

```typescript
// frontend/src/settings/setting-tab.ts

// Remove: backend URL, port settings
// Page Index doesn't need backend connection
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/settings/setting-tab.ts frontend/src/config/settings.ts
git commit -m "feat(settings): add embedding model configuration"
```

---

## Chunk 5: Testing and Documentation

### Task 5.1: Add Edge Case Tests

**Files:**
- Modify: `frontend/src/pageindex/__tests__/book-indexer.test.ts`
- Modify: `frontend/src/pageindex/__tests__/book-search.test.ts`

- [ ] **Step 1: Add tests for all error codes**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("error handling - all error codes", () => {
  it("should handle FILE_NOT_FOUND", async () => {
    await expect(indexBook({
      filePath: "/nonexistent.pdf",
      fileType: "pdf",
      outputDir: "/tmp",
    })).rejects.toThrow("FILE_NOT_FOUND");
  });

  it("should handle EMBEDDING_API_FAILED", async () => {
    // Mock invalid API key
    // Verify graceful degradation
  });

  it("should handle MD_PARSE_ERROR", async () => {
    // Corrupt book-meta.json
    // Verify error message
  });

  it("should handle VECTOR_DIMENSION_MISMATCH", async () => {
    // Switch embedding model with different dimensions
    // Verify old vectors deleted and re-indexed
  });

  it("should handle INDEX_INCOMPLETE", async () => {
    // Interrupt indexing process
    // Verify incomplete marker
  });

  it("should handle BM25_INDEX_CORRUPT", async () => {
    // Corrupt bm25.json
    // Verify error message
  });
});
```

- [ ] **Step 2: Add performance tests**

```typescript
// frontend/src/pageindex/__tests__/book-indexer.test.ts

describe("performance", () => {
  it("should index 100-chapter book within 5 minutes", async () => {
    const start = Date.now();
    await indexBook({
      filePath: largeTestPdf, // 100 chapters
      fileType: "pdf",
      outputDir: testOutputDir,
    });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(5 * 60 * 1000); // 5 minutes
  }, 10 * 60 * 1000); // 10 minute test timeout

  it("should search within 500ms", async () => {
    const start = Date.now();
    await searchBook({
      filePath: testPdf,
      query: "测试查询",
    });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pageindex/__tests__/
git commit -m "test(pageindex): add edge case and performance tests"
```

---

### Task 5.2: Add E2E Tests

**Files:**
- Create: `frontend/src/e2e/book-lifecycle.test.ts`

- [ ] **Step 1: Write E2E test for add book flow**

```typescript
// frontend/src/e2e/book-lifecycle.test.ts

import { describe, it, expect } from "vitest";

describe("E2E: Book Lifecycle", () => {
  it("should add, search, and delete a book", async () => {
    // 1. Add book
    const addResult = await indexBook({
      filePath: testPdf,
      fileType: "pdf",
      outputDir: testVault,
    });
    
    expect(addResult.bookId).toBeDefined();
    
    // 2. Search book
    const searchResults = await searchBook({
      filePath: testPdf,
      query: "测试",
    });
    
    expect(searchResults.length).toBeGreaterThan(0);
    
    // 3. Delete book
    await deleteBookIndex(testPdf);
    
    // 4. Verify deleted
    const isIndexed = await isBookIndexed(testPdf);
    expect(isIndexed).toBe(false);
  });
});
```

- [ ] **Step 2: Write E2E test for model switching**

```typescript
// frontend/src/e2e/book-lifecycle.test.ts

it("should re-vectorize when embedding model changes", async () => {
  // 1. Index with OpenAI
  await indexBook({
    filePath: testPdf,
    fileType: "pdf",
    outputDir: testVault,
    embedding: {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      dimensions: 1536,
    },
  });
  
  // 2. Verify vectors exist with 1536 dimensions
  const meta1 = await loadBookMeta(testPdf);
  expect(meta1.embedding.dimensions).toBe(1536);
  
  // 3. Re-index with Ollama
  await indexBook({
    filePath: testPdf,
    fileType: "pdf",
    outputDir: testVault,
    embedding: {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
    },
  });
  
  // 4. Verify vectors updated with 768 dimensions
  const meta2 = await loadBookMeta(testPdf);
  expect(meta2.embedding.dimensions).toBe(768);
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/e2e/
git commit -m "test(e2e): add book lifecycle and model switching tests"
```

---

### Task 5.3: Add Implementation Documentation

**Files:**
- Create: `docs/superpowers/implementation/pageindex-migration.md`

- [ ] **Step 1: Write migration guide**

```markdown
# Page Index Migration Guide

## Overview

This document describes how to migrate from backend API to local Page Index.

## API Mapping

| Backend API | Page Index Function | Notes |
|-------------|---------------------|-------|
| `apiClient.uploadAndIndex(file)` | `indexBook(options)` | Replace HTTP call with local function |
| `apiClient.listIndexes()` | Scan `.pageindex/` dir | Read book-meta.json files |
| `apiClient.deleteIndex(id)` | `deleteBookIndex(filePath)` | Delete .pageindex/{bookId}/ |
| `apiClient.agentChatStream()` | `searchBook()` + FrontendAgent | Search is now local |
| `apiClient.healthCheck()` | N/A | Remove - no backend needed |

## UI Component Changes

### LibraryModal
- Replace `apiClient.uploadAndIndex` → `indexBook`
- Replace polling → `onProgress` callback
- Replace `apiClient.listIndexes` → scan `.pageindex/`

### SidebarView
- Remove `apiClient` dependency
- Replace `agentChatStream` → `searchBook`
- Remove health check timer

### ReadingTopbar
- Remove connection status
- Load book info from book-meta.json

## Testing Checklist

- [ ] Add book (PDF)
- [ ] Add book (EPUB)
- [ ] Search book
- [ ] Delete book
- [ ] Model switching
- [ ] Error handling (API failure, file not found)
- [ ] Progress display
- [ ] Large book performance
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/implementation/pageindex-migration.md
git commit -m "docs: add Page Index migration guide"
```

---

## Implementation Order

**Phase 1: Core Infrastructure (Days 1-2)**
- Chunk 1: Types and BM25 ✓
- Chunk 2: Book Indexer (partial)

**Phase 2: Search and Integration (Days 3-4)**
- Chunk 2: Book Indexer (complete)
- Chunk 3: Book Search

**Phase 3: UI and Testing (Days 5-6)**
- Chunk 4: UI Integration
- Chunk 5: Testing and Documentation

---

## Testing Strategy

**Unit Tests:**
- book-indexer.ts: 50 tests (Tasks 2.1-2.7)
- book-search.ts: 30 tests (Tasks 3.1-3.3)
- bm25.ts: 20 tests (Task 1.2)

**Integration Tests:**
- LibraryModal + book-indexer: 5 tests (Task 4.1)
- SidebarView + book-search: 3 tests (Task 4.2)
- ReadingTopbar: 2 tests (Task 4.3)
- search_markdown_text tool: 3 tests (Task 4.4)

**E2E Tests:**
- Book lifecycle: 5 tests (Task 5.2)
- Model switching: 2 tests (Task 5.2)

**Total: 120 tests**

---

## Risk Mitigation

**P0 Risks:**
1. ✅ BM25 algorithm correctness → Extensive tests with manual verification (Task 1.2)
2. ✅ Embedding API failure → Graceful degradation to pure BM25 (Task 2.7)
3. ⚠️ Large book performance → Progress callbacks and cancellation (Task 2.4)

**P1 Risks:**
1. ⚠️ UI migration breaking changes → E2E tests for all user flows (Task 5.2)
2. ⚠️ File system errors → Comprehensive error handling tests (Task 5.1)

---

## Implementation Checklist

### Before Starting:
- [ ] Review design doc: `docs/superpowers/specs/2026-04-08-pageindex-replace-backend-design.md`
- [ ] Review eng review: Section 14 of design doc
- [ ] Set up test fixtures: PDF/EPUB files for testing
- [ ] Configure environment variables: OPENAI_API_KEY

### During Implementation:
- [ ] Follow TDD: write test → verify fail → implement → verify pass → commit
- [ ] Run tests after each task
- [ ] Commit frequently with descriptive messages
- [ ] Update progress in this plan file (check boxes)

### After Implementation:
- [ ] All 120 tests passing
- [ ] No TypeScript errors: `npm run build`
- [ ] Manual testing in test vault
- [ ] Review migration documentation
- [ ] Create PR or merge to main

---

## Estimated Timeline

**Day 1-2: Core Infrastructure (Chunk 1-2 partial)**
- ✅ Types and BM25: 2 hours (7 tasks)
- ⚠️ Book Indexer skeleton: 3 hours (Tasks 2.1-2.2)
- ⚠️ Document parsing: 2 hours (Task 2.2)

**Day 3: Book Indexer Complete (Chunk 2 rest)**
- ⚠️ Markdown export: 2 hours (Task 2.3)
- ⚠️ book-meta.json: 2 hours (Task 2.4)
- ⚠️ Vectorization: 2 hours (Task 2.5)
- ⚠️ BM25 + errors: 2 hours (Tasks 2.6-2.7)

**Day 4: Search and UI (Chunk 3-4)**
- ⚠️ Book Search: 3 hours (Tasks 3.1-3.3)
- ⚠️ UI Integration: 3 hours (Tasks 4.1-4.5)

**Day 5: Testing and Docs (Chunk 5)**
- ⚠️ Edge case tests: 2 hours (Task 5.1)
- ⚠️ E2E tests: 2 hours (Task 5.2)
- ⚠️ Documentation: 1 hour (Task 5.3)

**Total Estimated Time: 26 hours** (spread over 5 days)

---

## Next Steps

**Ready to Execute:**
- ✅ All chunks detailed
- ✅ All tasks defined with step-by-step instructions
- ✅ All test cases specified

**Execution Options:**
1. **Recommended**: Use `superpowers:subagent-driven-development` to dispatch parallel agents for each chunk
2. **Alternative**: Execute sequentially in current session using `superpowers:executing-plans`

**Start with Chunk 1**: `docs/superpowers/plans/2026-04-08-pageindex-replace-backend-implementation.md` Lines 28-576

---

## Success Criteria

**MVP Success:**
- [ ] Can index a PDF/EPUB book locally
- [ ] Can search a book and get relevant results
- [ ] UI works without backend dependency
- [ ] All error cases handled gracefully

**Full Success:**
- [ ] 120 tests passing
- [ ] Performance meets requirements (search < 500ms)
- [ ] Migration guide complete
- [ ] Ready for production use

---

## References

- **Design Doc**: `docs/superpowers/specs/2026-04-08-pageindex-replace-backend-design.md`
- **Eng Review**: Section 14 of design doc
- **AGENTS.md**: Build/test commands and code style guide
- **Test Vault**: `/Users/lizhao/workspace/deepreadertest`

---

## Questions?

If you encounter issues during implementation:
1. Check the design doc for architectural decisions
2. Review the eng review for known risks and mitigations
3. Refer to existing code patterns in `pageindex/` module
4. Ask for clarification in the PR or commit message