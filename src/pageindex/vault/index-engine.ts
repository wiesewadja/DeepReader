/**
 * PageIndex: Obsidian Vault File-level Indexing
 * Indexes individual markdown files using existing markdownToTree pipeline
 */

import { markdownToTree } from "../parsers/markdown";
import type { PageIndexResult } from "../core/types";
import type { ObsidianVaultIndexOptions } from "./types";
import type { ScannedFile } from "./scan";

export async function indexFile(
  file: ScannedFile,
  options: ObsidianVaultIndexOptions
): Promise<PageIndexResult> {
  return markdownToTree(file.content, file.relativePath, {
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    addNodeId: options.addNodeId ?? true,
    addNodeSummary: options.addNodeSummary ?? false,
    addNodeText: options.addNodeText ?? false,
    addDocDescription: options.addDocDescription ?? false,
    thinning: options.thinning,
    thinningThreshold: options.thinningThreshold,
    summaryTokenThreshold: options.summaryTokenThreshold,
  });
}
