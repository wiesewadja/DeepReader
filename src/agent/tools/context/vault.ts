import type { App, PluginManifest } from 'obsidian';
import type { DeepPDFSettings } from '../../../config/settings.js';

export interface DeepReaderPluginInterface {
  settings: DeepPDFSettings;
  saveSettings(): Promise<void>;
  manifest: PluginManifest;
  /** 插件 ID（dev='deepreader-dev'，daily='deepreader'）— 派生自 manifest.id */
  readonly pluginId: string;
  profileBuilder?: {
    readSummary(): Promise<string | null>;
    readMeta(): Promise<import('../../../services/profile-builder.js').ProfileMeta | null>;
    accumulateConversationRound(userMessage: string, assistantMessage: string): void;
  };
  readingModeService?: import('../../../components/reading-mode/reading-mode-orchestrator.js').ReadingModeService | null;
  getFrontendAgent(): Promise<import('../../index.js').FrontendAgent>;
  /** 暴露 ExcerptService 单例供 UI 层注入（部分 caller 仍走 fallback） */
  getExcerptService?(): import('../../../services/excerpt-service.js').ExcerptService;
}

export interface VaultContext {
  app: App;
  plugin: DeepReaderPluginInterface;
}
