import * as path from 'path';
import * as fs from 'fs/promises';
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

// ============ File I/O ============

function getStateFilePath(baseDir: string, bookId: string): string {
  return path.join(baseDir, '.pageindex', bookId, 'proactive-state.json');
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

export async function loadProactiveState(baseDir: string, bookId: string): Promise<ProactiveState | null> {
  const filePath = getStateFilePath(baseDir, bookId);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.version !== 1) return null;
    return migrateState(parsed);
  } catch {
    return null;
  }
}

export async function saveProactiveState(baseDir: string, state: ProactiveState): Promise<void> {
  const filePath = getStateFilePath(baseDir, state.bookId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}
