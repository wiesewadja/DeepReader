/**
 * PageIndex: Unified API Entry
 * Auto-detects document type and routes to the correct pipeline.
 *
 * Two product-level functions:
 *   docToIndex()     — document → structured index tree (PageIndexResult)
 *   docToObsidian()  — document → Obsidian vault (md files + MOC + tree.json)
 */

import * as path from "path";
import * as fs from "fs";
import { PageIndex } from "./pageindex";
import { mdToTree } from "./parsers/markdown";
import { exportPdfToObsidian } from "./exporters/pdf-to-obsidian";
import { exportEpubToObsidian, type EpubObsidianExportOptions } from "./exporters/adapter";
import type {
  PageIndexResult,
  DocIndexOptions,
  DocObsidianOptions,
  ObsidianExportResult,
} from "./core/types";
import type { VaultIndexResult } from "./vault/types";

// Runtime detection - in Node.js, vault features are disabled
// Bun runtime features can be enabled by importing this module in a Bun environment
const isBunRuntime = false; // Always false in Node.js

// ─── Type detection ──────────────────────────────────────────────────────────

function detectDocType(input: string, hint?: string): "pdf" | "epub" | "markdown" {
  if (hint) return hint as "pdf" | "epub" | "markdown";

  if (typeof input !== "string") {
    throw new Error("Cannot auto-detect type from Buffer/ArrayBuffer. Pass docType explicitly.");
  }

  const ext = path.extname(input).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "pdf";
    case ".epub":
      return "epub";
    case ".md":
    case ".markdown":
      return "markdown";
    default:
      throw new Error(
        `Unsupported file extension: "${ext}". Supported: .pdf, .epub, .md, .markdown. ` +
        `Pass docType explicitly to override.`
      );
  }
}

// ─── docToIndex ──────────────────────────────────────────────────────────────

/**
 * Unified document → index tree entry point.
 * Auto-detects file type and routes to the correct pipeline.
 */
export async function docToIndex(
  input: string | Buffer | ArrayBuffer,
  options: DocIndexOptions = {}
): Promise<PageIndexResult> {
  const docType = detectDocType(
    typeof input === "string" ? input : "",
    options.docType
  );

  switch (docType) {
    case "pdf": {
      const pageIndex = new PageIndex({
        ...options,
        extractionMode: options.extractionMode,
        ocrModel: options.ocrModel,
      });
      return pageIndex.fromPdf(input as string | Buffer | ArrayBuffer);
    }

    case "epub": {
      const pageIndex = new PageIndex(options);
      return pageIndex.fromEpub(input as string | Buffer);
    }

    case "markdown": {
      if (typeof input !== "string") {
        throw new Error("Markdown input must be a file path (string).");
      }
      return mdToTree(input, {
        ...options,
        thinning: options.thinning,
        thinningThreshold: options.thinningThreshold,
      });
    }
  }
}

// ─── docToObsidian ───────────────────────────────────────────────────────────

/**
 * Unified document → Obsidian vault export.
 * Auto-detects file type, routes to the correct exporter,
 * returns a standardized result.
 */
export async function docToObsidian(
  input: string,
  options: DocObsidianOptions
): Promise<ObsidianExportResult> {
  const docType = detectDocType(input, options.docType);

  switch (docType) {
    case "pdf":
      return exportPdfToVault(input, options);

    case "epub":
      return exportEpubToVault(input, options);

    default:
      throw new Error(
        `docToObsidian does not support "${docType}". ` +
        `Only PDF and EPUB can be exported to Obsidian vaults.`
      );
  }
}

// ─── PDF → Obsidian ──────────────────────────────────────────────────────────

async function exportPdfToVault(
  input: string,
  options: DocObsidianOptions
): Promise<ObsidianExportResult> {
  // First parse the PDF via PageIndex
  const pageIndex = new PageIndex({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    addNodeText: true,
    addNodeSummary: true,
    addDocDescription: true,
  });
  const parseResult = await pageIndex.fromPdf(input);

  const result = await exportPdfToObsidian({
    outputDir: options.outputDir,
    parseResult,
    noteTemplate: options.noteTemplate,
    mocName: options.mocName,
    includeIndex: options.includeIndex,
    sourcePdf: options.sourceFile || input,
  });

  const docName = path.basename(input, path.extname(input));
  const outputDir = path.join(options.outputDir, sanitizeFileName(docName));
  const treePath = path.join(outputDir, "tree.json");
  const notePaths = result.notes.map((n) => n.filePath);

  const vaultIndex = await maybeAutoIndex(options);

  return {
    outputDir,
    docName,
    mocPath: result.mocPath,
    treePath,
    noteCount: result.notes.length,
    totalTokens: result.notes.reduce(
      (sum, n) => sum + ((n.frontmatter.token_count as number) || 0), 0
    ),
    notePaths,
    vaultIndex,
  };
}

// ─── EPUB → Obsidian ─────────────────────────────────────────────────────────

async function exportEpubToVault(
  input: string,
  options: DocObsidianOptions
): Promise<ObsidianExportResult> {
  const epubOptions: EpubObsidianExportOptions = {
    outputDir: options.outputDir,
    noteTemplate: options.noteTemplate,
    mocName: options.mocName,
    includeIndex: options.includeIndex,
    maxTokensPerNode: options.maxTokensPerNode,
    maxNodesPerChapter: options.maxNodesPerChapter,
    generateNodeSummaries: options.generateNodeSummaries,
    summaryModel: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    onProgress: options.onProgress,
  };

  const result = await exportEpubToObsidian(input, epubOptions);

  // Derive actual output dir from mocPath — the adapter creates the book
  // directory using EPUB metadata title, not the filename.
  const outputDir = path.dirname(result.mocPath);
  const docName = path.basename(outputDir);
  const treePath = path.join(outputDir, "tree.json");
  const notePaths = collectNotePaths(outputDir);

  const vaultIndex = await maybeAutoIndex(options);

  return {
    outputDir,
    docName,
    mocPath: result.mocPath,
    treePath,
    noteCount: result.totalNodes,
    totalTokens: 0,
    notePaths,
    vaultIndex,
  };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim().substring(0, 100);
}

function collectNotePaths(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.includes("MOC"))
    .map((f) => path.join(dir, f));
}

async function maybeAutoIndex(options: DocObsidianOptions): Promise<VaultIndexResult | undefined> {
  if (!options.autoIndex || !options.vaultPath) return undefined;
  
  // Vault features require Bun runtime
  if (!isBunRuntime) {
    console.warn("[pageindex] Vault auto-index requires Bun runtime. Skipping auto-index.");
    return undefined;
  }
  
  // Dynamic import to avoid Node.js import errors
  const vaultModule = await import("./vault/index.js");
  return vaultModule.indexObsidianVault({
    vaultPath: options.vaultPath,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });
}

// ─── Vault-level exports (Bun-only) ──────────────────────────────────────────

/**
 * Search vault - requires Bun runtime
 * In Node.js environments, use './node.ts' entry point instead
 */
export async function searchVault(...args: Parameters<typeof import("./vault/search.js").searchVault>) {
  if (!isBunRuntime) {
    throw new Error("[pageindex] searchVault requires Bun runtime. Use './node.ts' for Node.js environments.");
  }
  const searchModule = await import("./vault/search.js");
  return searchModule.searchVault(...args);
}

/**
 * Index vault - requires Bun runtime
 */
export async function indexVault(...args: Parameters<typeof import("./vault/index.js").indexObsidianVault>) {
  if (!isBunRuntime) {
    throw new Error("[pageindex] indexVault requires Bun runtime. Use './node.ts' for Node.js environments.");
  }
  const vaultModule = await import("./vault/index.js");
  return vaultModule.indexObsidianVault(...args);
}

/**
 * Load vault index - requires Bun runtime
 */
export async function loadVaultIndex(...args: Parameters<typeof import("./vault/index.js").loadVaultIndex>) {
  if (!isBunRuntime) {
    throw new Error("[pageindex] loadVaultIndex requires Bun runtime. Use './node.ts' for Node.js environments.");
  }
  const vaultModule = await import("./vault/index.js");
  return vaultModule.loadVaultIndex(...args);
}
