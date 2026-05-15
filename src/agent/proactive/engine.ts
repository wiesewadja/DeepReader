import type { App } from 'obsidian';
import type { ProactiveState, ProactiveParams } from './types';
import {
  createEmptyState,
  recordHighlight,
  markChapterTriggered,
  markGuidanceInitiated,
  updateLastProactiveAt,
  shouldTriggerInspectional,
  shouldTriggerChapter,
  loadProactiveState,
  saveProactiveState,
} from './state';
import type { DeepPDFSettings } from '../../config/settings.js';

type SettingsProvider = { settings: DeepPDFSettings };

export class ProactiveEngine {
  private states = new Map<string, ProactiveState>();
  private processing = false;
  private lastGlobalTriggerAt: number | null = null;

  constructor(
    private app: App,
    private plugin: SettingsProvider,
    private onTrigger: (params: ProactiveParams) => void,
  ) {}

  private get settings(): DeepPDFSettings {
    return this.plugin.settings;
  }

  private async getState(bookId: string): Promise<ProactiveState> {
    let state = this.states.get(bookId);
    if (!state) {
      state = (await loadProactiveState(this.app, bookId)) ?? createEmptyState(bookId);
      this.states.set(bookId, state);
    }
    return state;
  }

  private async persistState(state: ProactiveState): Promise<void> {
    this.states.set(state.bookId, state);
    await saveProactiveState(this.app, state);
  }

  private isInCooldown(): boolean {
    if (!this.lastGlobalTriggerAt) return false;
    const elapsed = Date.now() - this.lastGlobalTriggerAt;
    return elapsed < (this.settings.proactiveCooldownMinutes ?? 5) * 60 * 1000;
  }

  private prepareTriggerState(params: ProactiveParams, state: ProactiveState): ProactiveState {
    this.lastGlobalTriggerAt = Date.now();
    let next = updateLastProactiveAt(state);
    if (params.trigger === 'inspectional') {
      next = markGuidanceInitiated(next);
    } else if (params.chapterId) {
      next = markChapterTriggered(next, params.chapterId);
    }
    return next;
  }

  async onBookOpen(bookId: string, hasHistory: boolean, progressPercent: number): Promise<void> {
    if (!this.settings.proactiveGuidanceEnabled) return;
    if (this.processing) return;

    const state = await this.getState(bookId);
    if (!shouldTriggerInspectional(state, hasHistory, progressPercent)) return;
    if (this.isInCooldown()) return;

    const params: ProactiveParams = { trigger: 'inspectional', bookId };
    const next = this.prepareTriggerState(params, state);
    await this.persistState(next);
    this.onTrigger(params);
  }

  async onHighlight(bookId: string, chapterId: string, content: string): Promise<void> {
    if (!this.settings.proactiveGuidanceEnabled) return;
    if (this.processing) return;

    let state = await this.getState(bookId);
    state = recordHighlight(state, chapterId, content);
    await this.persistState(state);

    const trigger = state.chapterTriggers[chapterId];
    if (trigger && !trigger.triggered && trigger.highlightCount >= 3 && !this.isInCooldown()) {
      const params: ProactiveParams = {
        trigger: 'highlight',
        bookId,
        chapterId,
        highlightContext: trigger.highlights,
      };
      const next = this.prepareTriggerState(params, state);
      await this.persistState(next);
      this.onTrigger(params);
    }
  }

  async onChapterLeave(bookId: string, chapterId: string): Promise<void> {
    if (!this.settings.proactiveGuidanceEnabled) return;
    if (this.processing) return;

    const state = await this.getState(bookId);
    const { canTrigger, highlights } = shouldTriggerChapter(state, chapterId);
    if (!canTrigger || this.isInCooldown()) return;

    const params: ProactiveParams = {
      trigger: 'chapter',
      bookId,
      chapterId,
      highlightContext: highlights,
    };
    const next = this.prepareTriggerState(params, state);
    await this.persistState(next);
    this.onTrigger(params);
  }

  onChapterEnter(_bookId: string, _chapterId: string): void {
    // 预留
  }

  setProcessing(value: boolean): void {
    this.processing = value;
  }

  /** 苏格拉底模式：只要发送过初始引导就启用（后续由对话历史驱动） */
  shouldEnableSocratic(bookId: string): boolean {
    if (!this.settings.proactiveGuidanceEnabled) return false;
    const state = this.states.get(bookId);
    if (!state) return false;
    return state.guidanceInitiated;
  }

  destroy(): void {
    this.states.clear();
  }
}
