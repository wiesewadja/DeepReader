import type { LocalToolCache } from '../local/types.js';

export interface BookContext {
  indexId: string;
  pdfName: string;
  markdownFiles?: Record<string, string>;
  localCache?: LocalToolCache;
  currentNodeId?: string;
  documentMetadata?: { title?: string; page_count?: number; author?: string };
  docDescription?: string;
}
