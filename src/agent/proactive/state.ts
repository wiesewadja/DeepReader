import type { App } from 'obsidian';
import type { ProactiveState, ChapterTrigger } from './types';
import { serviceLog as log } from '../../utils/logger.js';

// ============ Pure Functions ============

export function createEmptyState(bookId: string): ProactiveState {
  return {
    version: 1,
    bookId,
    guidanceInitiated: false,
    chapterTriggers: {},
    lastProactiveAt: null,
  };
}

export function recordHighlight(
  state: ProactiveState,
  chapterId: string,
  content: string,
): ProactiveState {
  const existing = state.chapterTriggers[chapterId];
  if (existing?.triggered) return state;

  const trigger: ChapterTrigger = existing
    ? { ...existing, highlightCount: existing.highlightCount + 1, highlights: [...existing.highlights, content] }
    : { highlightCount: 1, highlights: [content], triggered: false };

  return {
    ...state,
    chapterTriggers: { ...state.chapterTriggers, [chapterId]: trigger },
  };
}

export function markChapterTriggered(state: ProactiveState, chapterId: string): ProactiveState {
  const existing = state.chapterTriggers[chapterId];
  if (!existing) return state;
  return {
    ...state,
    chapterTriggers: {
      ...state.chapterTriggers,
      [chapterId]: { ...existing, triggered: true },
    },
  };
}

export function markGuidanceInitiated(state: ProactiveState): ProactiveState {
  return { ...state, guidanceInitiated: true };
}

export function updateLastProactiveAt(state: ProactiveState): ProactiveState {
  return { ...state, lastProactiveAt: new Date().toISOString() };
}

export function shouldTriggerInspectional(
  state: ProactiveState,
  hasHistory: boolean,
  progressPercent: number,
): boolean {
  if (state.guidanceInitiated) return false;
  if (hasHistory) return false;
  if (progressPercent >= 10) return false;
  return true;
}

export function shouldTriggerChapter(
  state: ProactiveState,
  chapterId: string,
): { canTrigger: boolean; highlights: string[] } {
  const trigger = state.chapterTriggers[chapterId];
  if (!trigger || trigger.triggered) return { canTrigger: false, highlights: [] };
  if (trigger.highlightCount < 2) return { canTrigger: false, highlights: [] };
  return { canTrigger: true, highlights: trigger.highlights };
}

// ============ File I/O via Vault API ============

function getStateFilePath(bookId: string): string {
  return `.pageindex/${bookId}/proactive-state.json`;
}

/** 兼容旧版 state 字段 */
function migrateState(raw: any): ProactiveState | null {
  // Migrate inspectionalStep → guidanceInitiated
  if ('inspectionalStep' in raw && !('guidanceInitiated' in raw)) {
    raw.guidanceInitiated = raw.inspectionalStep > 0;
    delete raw.inspectionalStep;
  }
  if (typeof raw.guidanceInitiated !== 'boolean') raw.guidanceInitiated = false;
  if (typeof raw.bookId !== 'string') return null;
  raw.chapterTriggers = raw.chapterTriggers || {};
  raw.lastProactiveAt = raw.lastProactiveAt ?? null;
  // Drop deprecated fields
  delete raw.socraticSkipCount;
  delete raw.proactiveStep;
  return raw as ProactiveState;
}

export async function loadProactiveState(app: App, bookId: string): Promise<ProactiveState | null> {
  const filePath = getStateFilePath(bookId);
  try {
    const exists = await app.vault.adapter.exists(filePath);
    if (!exists) return null;
    const data = await app.vault.adapter.read(filePath);
    const parsed = JSON.parse(data);
    if (parsed.version !== 1) return null;
    return migrateState(parsed);
  } catch {
    return null;
  }
}

export async function saveProactiveState(app: App, state: ProactiveState): Promise<void> {
  const filePath = getStateFilePath(state.bookId);
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (!(await app.vault.adapter.exists(dir))) {
    await app.vault.adapter.mkdir(dir);
  }
  await app.vault.adapter.write(filePath, JSON.stringify(state, null, 2));
}
