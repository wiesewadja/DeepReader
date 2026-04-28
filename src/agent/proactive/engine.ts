import type { App } from 'obsidian';
import type { ProactiveState, ProactiveParams } from './types';
import {
  createEmptyState,
  recordHighlight,
  markChapterTriggered,
  markInspectionalDone,
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
      const baseDir = (this.app.vault.adapter as any).basePath as string;
      state = (await loadProactiveState(baseDir, bookId)) ?? createEmptyState(bookId);
      this.states.set(bookId, state);
    }
    return state;
  }

  private async persistState(state: ProactiveState): Promise<void> {
    this.states.set(state.bookId, state);
    const baseDir = (this.app.vault.adapter as any).basePath as string;
    await saveProactiveState(baseDir, state);
  }

  private isInCooldown(): boolean {
    if (!this.lastGlobalTriggerAt) return false;
    const elapsed = Date.now() - this.lastGlobalTriggerAt;
    return elapsed < (this.settings.proactiveCooldownMinutes ?? 5) * 60 * 1000;
  }

  /** 计算 trigger 后的新 state（不调用 onTrigger） */
  private prepareTriggerState(params: ProactiveParams, state: ProactiveState): ProactiveState {
    this.lastGlobalTriggerAt = Date.now();
    let next = updateLastProactiveAt(state);
    if (params.trigger === 'inspectional') {
      next = markInspectionalDone(next);
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

    // 条件 B：章节内累积 >= 3 条划线
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
    // 预留：当前不需要在进入章节时做任何事
  }

  onUserMessage(): void {
    // 预留：冷却计时豁免（第二期实现）
  }

  setProcessing(value: boolean): void {
    this.processing = value;
  }

  destroy(): void {
    this.states.clear();
  }
}
