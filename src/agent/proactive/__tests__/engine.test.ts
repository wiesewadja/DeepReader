import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProactiveEngine } from '../engine';
import type { ProactiveParams } from '../types';

describe('ProactiveEngine', () => {
  let triggered: ProactiveParams[];
  let engine: ProactiveEngine;
  const testBaseDir = '/tmp/test-vault-proactive';

  beforeEach(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
    triggered = [];
    engine = new ProactiveEngine(
      { vault: { adapter: { basePath: testBaseDir } } } as any,
      { settings: { proactiveGuidanceEnabled: true, proactiveCooldownMinutes: 5 } } as any,
      (params) => { triggered.push(params); },
    );
  });

  afterEach(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  });

  describe('场景一：检视引导', () => {
    it('triggers inspectional on first book open with no history', async () => {
      await engine.onBookOpen('book-1', false, 0);
      expect(triggered).toHaveLength(1);
      expect(triggered[0].trigger).toBe('inspectional');
      expect(triggered[0].bookId).toBe('book-1');
    });

    it('does not trigger when has history', async () => {
      await engine.onBookOpen('book-1', true, 0);
      expect(triggered).toHaveLength(0);
    });

    it('does not trigger when progress >= 10%', async () => {
      await engine.onBookOpen('book-1', false, 15);
      expect(triggered).toHaveLength(0);
    });

    it('does not trigger twice for same book', async () => {
      await engine.onBookOpen('book-1', false, 0);
      await engine.onBookOpen('book-1', false, 0);
      expect(triggered).toHaveLength(1);
    });
  });

  describe('场景二：划线追问', () => {
    it('does not trigger with < 2 highlights', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onChapterLeave('book-1', 'ch-1');
      expect(triggered).toHaveLength(0);
    });

    it('triggers on chapter leave with >= 2 highlights', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onHighlight('book-1', 'ch-1', 'text b');
      await engine.onChapterLeave('book-1', 'ch-1');
      expect(triggered).toHaveLength(1);
      expect(triggered[0].trigger).toBe('chapter');
      expect(triggered[0].highlightContext).toEqual(['text a', 'text b']);
    });

    it('triggers in-chapter with >= 3 highlights', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onHighlight('book-1', 'ch-1', 'text b');
      await engine.onHighlight('book-1', 'ch-1', 'text c');
      expect(triggered).toHaveLength(1);
      expect(triggered[0].trigger).toBe('highlight');
    });

    it('does not trigger twice for same chapter', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onHighlight('book-1', 'ch-1', 'text b');
      await engine.onHighlight('book-1', 'ch-1', 'text c');
      await engine.onChapterLeave('book-1', 'ch-1');
      expect(triggered).toHaveLength(1);
    });
  });

  describe('节流', () => {
    it('respects global cooldown', async () => {
      await engine.onBookOpen('book-1', false, 0); // 触发检视引导
      await engine.onHighlight('book-2', 'ch-1', 'a');
      await engine.onHighlight('book-2', 'ch-1', 'b');
      await engine.onChapterLeave('book-2', 'ch-1');
      expect(triggered).toHaveLength(1);
    });
  });

  describe('设置开关', () => {
    it('does not trigger when disabled', async () => {
      const disabledEngine = new ProactiveEngine(
        {} as any,
        { settings: { proactiveGuidanceEnabled: false, proactiveCooldownMinutes: 5 } } as any,
        (params) => { triggered.push(params); },
      );
      await disabledEngine.onBookOpen('book-1', false, 0);
      expect(triggered).toHaveLength(0);
    });
  });

  describe('shouldEnableSocratic', () => {
    it('returns false when feature disabled', () => {
      const disabledEngine = new ProactiveEngine(
        { vault: { adapter: { basePath: testBaseDir } } } as any,
        { settings: { proactiveGuidanceEnabled: false, proactiveCooldownMinutes: 5 } } as any,
        () => {},
      );
      expect(disabledEngine.shouldEnableSocratic('book-1')).toBe(false);
    });

    it('returns false when no state for book', () => {
      expect(engine.shouldEnableSocratic('unknown-book')).toBe(false);
    });

    it('returns true when guidance has been initiated', async () => {
      await engine.onBookOpen('book-1', false, 0);
      expect(engine.shouldEnableSocratic('book-1')).toBe(true);
    });
  });
});
