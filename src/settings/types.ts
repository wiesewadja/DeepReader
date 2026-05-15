/**
 * Shared context passed to all section render functions.
 */

import type { App } from 'obsidian';
import type DeepPDFPlugin from '../main';

export interface SectionContext {
  plugin: DeepPDFPlugin;
  app: App;
  containerEl: HTMLElement;
  expandedSections: Set<string>;
  toggleSection: (sectionId: string) => void;
}
