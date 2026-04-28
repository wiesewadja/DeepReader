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
      expect(triggered[0].step).toBe(1);
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

  describe('多步引导 follow-up', () => {
    it('checkFollowUp returns null when no inspectional triggered', () => {
      expect(engine.checkFollowUp('book-1')).toBeNull();
    });

    it('checkFollowUp returns step 2 after first inspectional', async () => {
      await engine.onBookOpen('book-1', false, 0);
      const followUp = engine.checkFollowUp('book-1');
      expect(followUp).not.toBeNull();
      expect(followUp!.trigger).toBe('inspectional_followup');
      expect(followUp!.step).toBe(2);
    });

    it('checkFollowUp returns step 3 after second step executed', async () => {
      await engine.onBookOpen('book-1', false, 0);
      const followUp1 = engine.checkFollowUp('book-1');
      expect(followUp1!.step).toBe(2);

      await engine.executeFollowUp(followUp1!);
      const followUp2 = engine.checkFollowUp('book-1');
      expect(followUp2).not.toBeNull();
      expect(followUp2!.step).toBe(3);
    });

    it('checkFollowUp returns null after step 3 completed', async () => {
      await engine.onBookOpen('book-1', false, 0);
      const f1 = engine.checkFollowUp('book-1')!;
      await engine.executeFollowUp(f1);
      const f2 = engine.checkFollowUp('book-1')!;
      await engine.executeFollowUp(f2);
      expect(engine.checkFollowUp('book-1')).toBeNull();
    });

    it('executeFollowUp calls onTrigger with correct params', async () => {
      await engine.onBookOpen('book-1', false, 0);
      triggered.length = 0; // reset

      const followUp = engine.checkFollowUp('book-1')!;
      await engine.executeFollowUp(followUp);
      expect(triggered).toHaveLength(1);
      expect(triggered[0].trigger).toBe('inspectional_followup');
      expect(triggered[0].step).toBe(2);
    });

    it('checkFollowUp returns null when disabled', async () => {
      const disabledEngine = new ProactiveEngine(
        { vault: { adapter: { basePath: testBaseDir } } } as any,
        { settings: { proactiveGuidanceEnabled: false, proactiveCooldownMinutes: 5 } } as any,
        (params) => { triggered.push(params); },
      );
      await disabledEngine.onBookOpen('book-1', false, 0);
      expect(disabledEngine.checkFollowUp('book-1')).toBeNull();
    });
  });
});
