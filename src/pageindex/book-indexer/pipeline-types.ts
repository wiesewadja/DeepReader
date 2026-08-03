/**
 * Pipeline type definitions for book-indexer decomposition
 */

import type { BookIndexOptions } from "../book-types.js";

export interface PipelineContext {
  bookId: string;
  indexDir: string;
  deepReaderDir: string;
  bookDir: string;
  exportName: string;
  rootTitle: string;
  filePath: string;
  fileType: "pdf" | "epub";
  options: BookIndexOptions;
  parseResult?: any;
  treeData?: any;
  bookMeta?: any;
  coverRelPath?: string;
  quality?: "good" | "degraded" | "poor";
  qualityReason?: string;
  nodeFileMap?: Map<string, string>;
  embeddings?: any[];
  tracer: any;
  reportProgress: (progress: ProgressInfo) => void;
  cleanupStatus?: () => void;
  indexingStatusPath?: string;
  plugin?: any;
  app?: any;
}

export interface PipelineStep {
  name: string;
  execute(ctx: PipelineContext): Promise<void>;
}

export interface ProgressInfo {
  percent: number;
  step: string;
  stepLabel: string;
  message?: string;
}
