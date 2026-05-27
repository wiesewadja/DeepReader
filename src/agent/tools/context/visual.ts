import type { FileSystemAdapter } from 'obsidian';

export interface VisualContext {
  infographicConfig?: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    relativeDir: string;
    vaultAdapter: FileSystemAdapter;
  };
  journalDir?: string;
}
