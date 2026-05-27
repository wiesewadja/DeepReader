import type { App } from 'obsidian';
import type { DeepReaderPlugin } from '../types.js';

export interface VaultContext {
  app: App;
  plugin: DeepReaderPlugin;
}
