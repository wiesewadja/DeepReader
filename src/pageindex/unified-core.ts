/**
 * pageindex-core: Unified API Entry (Node.js-compatible)
 * Auto-detects document type and routes to the correct pipeline.
 *
 * This module provides core document processing without Bun-specific vault features.
 * Suitable for use in Obsidian plugins and Node.js environments.
 *
 * Product-level function:
 *   docToIndex() — document → structured index tree (PageIndexResult)
 */

import * as path from "path";
import type {
  PageIndexResult,
  DocIndexOptions,
} from "./core/types";
import { PageIndex } from "./pageindex";
import { mdToTree } from "./parsers/markdown";

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
 * 
 * This is the core version without vault indexing features.
 * For full-featured version with vault support, use './unified.ts'.
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