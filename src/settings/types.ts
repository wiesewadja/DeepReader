/**
 * Shared context passed to all section render functions.
 */

import type { App } from 'obsidian';
import type DeepReaderPlugin from '../main';

export interface SectionContext {
  plugin: DeepReaderPlugin;
  app: App;
  containerEl: HTMLElement;
  expandedSections: Set<string>;
  toggleSection: (sectionId: string) => void;
}
