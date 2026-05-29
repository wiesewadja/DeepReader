import { describe, it, expect } from 'vitest';
import {
  createEmptyState,
  recordHighlight,
  markChapterTriggered,
  markGuidanceInitiated,
  shouldTriggerInspectional,
  shouldTriggerChapter,
} from '@/agent/proactive/state';
import type { ProactiveState } from '@/agent/proactive/types';

describe('ProactiveState pure functions', () => {
  const baseState: ProactiveState = {
    version: 1,
    bookId: 'book-1',
    guidanceInitiated: false,
    chapterTriggers: {},
    lastProactiveAt: null,
  };

  describe('createEmptyState', () => {
    it('creates empty state with bookId', () => {
      const state = createEmptyState('book-1');
      expect(state.bookId).toBe('book-1');
      expect(state.guidanceInitiated).toBe(false);
      expect(state.chapterTriggers).toEqual({});
      expect(state.lastProactiveAt).toBeNull();
    });
  });

  describe('recordHighlight', () => {
    it('adds highlight to new chapter', () => {
      const next = recordHighlight(baseState, 'ch-1', 'some text');
      expect(next.chapterTriggers['ch-1'].highlightCount).toBe(1);
      expect(next.chapterTriggers['ch-1'].highlights).toEqual(['some text']);
      expect(next.chapterTriggers['ch-1'].triggered).toBe(false);
    });

    it('appends highlight to existing chapter', () => {
      const s1 = recordHighlight(baseState, 'ch-1', 'text a');
      const s2 = recordHighlight(s1, 'ch-1', 'text b');
      expect(s2.chapterTriggers['ch-1'].highlightCount).toBe(2);
      expect(s2.chapterTriggers['ch-1'].highlights).toEqual(['text a', 'text b']);
    });

    it('does not add highlight to triggered chapter', () => {
      const s1 = recordHighlight(baseState, 'ch-1', 'text a');
      const s2 = markChapterTriggered(s1, 'ch-1');
      const s3 = recordHighlight(s2, 'ch-1', 'text b');
      expect(s3.chapterTriggers['ch-1'].highlightCount).toBe(1);
    });
  });

  describe('markGuidanceInitiated', () => {
    it('sets guidanceInitiated to true', () => {
      const s = markGuidanceInitiated(baseState);
      expect(s.guidanceInitiated).toBe(true);
    });

    it('does not mutate original state', () => {
      const before = { ...baseState };
      markGuidanceInitiated(baseState);
      expect(baseState.guidanceInitiated).toBe(before.guidanceInitiated);
    });
  });

  describe('shouldTriggerInspectional', () => {
    it('returns true when not initiated and no history', () => {
      expect(shouldTriggerInspectional(baseState, false, 0)).toBe(true);
    });

    it('returns false when already initiated', () => {
      const s = markGuidanceInitiated(baseState);
      expect(shouldTriggerInspectional(s, false, 0)).toBe(false);
    });

    it('returns false when has conversation history', () => {
      expect(shouldTriggerInspectional(baseState, true, 0)).toBe(false);
    });

    it('returns false when progress >= 10%', () => {
      expect(shouldTriggerInspectional(baseState, false, 15)).toBe(false);
    });
  });

  describe('shouldTriggerChapter', () => {
    it('returns true when highlights >= 2 and not triggered', () => {
      const s = recordHighlight(recordHighlight(baseState, 'ch-1', 'a'), 'ch-1', 'b');
      const result = shouldTriggerChapter(s, 'ch-1');
      expect(result.canTrigger).toBe(true);
      expect(result.highlights).toEqual(['a', 'b']);
    });

    it('returns false when already triggered', () => {
      const s = markChapterTriggered(
        recordHighlight(recordHighlight(baseState, 'ch-1', 'a'), 'ch-1', 'b'),
        'ch-1'
      );
      expect(shouldTriggerChapter(s, 'ch-1').canTrigger).toBe(false);
    });

    it('returns false when highlights < 2', () => {
      const s = recordHighlight(baseState, 'ch-1', 'a');
      expect(shouldTriggerChapter(s, 'ch-1').canTrigger).toBe(false);
    });

    it('returns false for unknown chapter', () => {
      expect(shouldTriggerChapter(baseState, 'ch-unknown').canTrigger).toBe(false);
    });
  });
});
