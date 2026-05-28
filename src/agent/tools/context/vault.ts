import type { App } from 'obsidian';
import type { DeepPDFSettings } from '../../../config/settings.js';

export interface DeepReaderPlugin {
  settings: DeepPDFSettings;
  profileBuilder?: {
    readSummary(): Promise<string | null>;
    readMeta(): Promise<import('../../../services/profile-builder.js').ProfileMeta | null>;
    accumulateConversationRound(userMessage: string, assistantMessage: string): void;
  };
}

export interface VaultContext {
  app: App;
  plugin: DeepReaderPlugin;
}
