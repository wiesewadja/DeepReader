import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  createEmptyProgress,
  markChapterVisited,
  updateLastRead,
  getProgressPercent,
  loadProgress,
  saveProgress,
} from '@/pageindex/reading-progress';
import type { ReadingProgress } from '@/pageindex/reading-progress';
import { getPageindexRoot, getBookDir, getBookFile } from '@/pageindex/paths.js';

describe('ReadingProgress - Data Module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reading-progress-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createEmptyProgress', () => {
    it('should create progress with correct defaults', () => {
      const progress = createEmptyProgress('abc12345');

      expect(progress.version).toBe(1);
      expect(progress.bookId).toBe('abc12345');
      expect(progress.lastReadChapterId).toBe('');
      expect(progress.lastReadAt).toBe('');
      expect(progress.chapters).toEqual({});
    });
  });

  describe('markChapterVisited', () => {
    it('should mark a chapter as visited', () => {
      const progress = createEmptyProgress('abc12345');
      const updated = markChapterVisited(progress, 'chapter-1');

      expect(updated.chapters['chapter-1']).toEqual({ visited: true });
    });

    it('should not duplicate if already visited', () => {
      const progress = createEmptyProgress('abc12345');
      const first = markChapterVisited(progress, 'chapter-1');
      const second = markChapterVisited(first, 'chapter-1');

      const keys = Object.keys(second.chapters);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe('chapter-1');
    });

    it('should mark multiple different chapters', () => {
      const progress = createEmptyProgress('abc12345');
      const updated = markChapterVisited(
        markChapterVisited(progress, 'chapter-1'),
        'chapter-2'
      );

      expect(Object.keys(updated.chapters)).toHaveLength(2);
      expect(updated.chapters['chapter-1']).toEqual({ visited: true });
      expect(updated.chapters['chapter-2']).toEqual({ visited: true });
    });

    it('should not mutate the original progress', () => {
      const progress = createEmptyProgress('abc12345');
      markChapterVisited(progress, 'chapter-1');

      expect(progress.chapters).toEqual({});
    });
  });

  describe('updateLastRead', () => {
    it('should set lastReadChapterId and lastReadAt timestamp', () => {
      const progress = createEmptyProgress('abc12345');
      const before = new Date().toISOString();
      const updated = updateLastRead(progress, 'chapter-3');
      const after = new Date().toISOString();

      expect(updated.lastReadChapterId).toBe('chapter-3');
      expect(updated.lastReadAt >= before).toBe(true);
      expect(updated.lastReadAt <= after).toBe(true);
    });

    it('should not mutate the original progress', () => {
      const progress = createEmptyProgress('abc12345');
      progress.lastReadChapterId = 'old-chapter';
      updateLastRead(progress, 'new-chapter');

      expect(progress.lastReadChapterId).toBe('old-chapter');
    });
  });

  describe('getProgressPercent', () => {
    it('should return 0 when no chapters visited', () => {
      const progress = createEmptyProgress('abc12345');
      expect(getProgressPercent(progress, 10)).toBe(0);
    });

    it('should return 0 when totalChapters is 0', () => {
      const progress = createEmptyProgress('abc12345');
      expect(getProgressPercent(progress, 0)).toBe(0);
    });

    it('should return correct percentage for partial progress', () => {
      const progress = createEmptyProgress('abc12345');
      const updated = markChapterVisited(
        markChapterVisited(progress, 'chapter-1'),
        'chapter-2'
      );
      expect(getProgressPercent(updated, 5)).toBe(40);
    });

    it('should return 100 when all chapters visited', () => {
      const progress = createEmptyProgress('abc12345');
      const updated = markChapterVisited(
        markChapterVisited(
          markChapterVisited(progress, 'chapter-1'),
          'chapter-2'
        ),
        'chapter-3'
      );
      expect(getProgressPercent(updated, 3)).toBe(100);
    });

    it('should handle percentage rounding correctly', () => {
      const progress = createEmptyProgress('abc12345');
      const updated = markChapterVisited(progress, 'chapter-1');
      expect(getProgressPercent(updated, 3)).toBe(33);
    });
  });

  describe('loadProgress', () => {
    it('should return null for nonexistent progress file', async () => {
      const result = await loadProgress(tempDir, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return null for invalid data (missing bookId)', async () => {
      const dir = getBookDir(tempDir, 'bad-book');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'reading-progress.json'), JSON.stringify({ version: 1 }));

      const result = await loadProgress(tempDir, 'bad-book');
      expect(result).toBeNull();
    });

    it('should return null for invalid data (chapters not object)', async () => {
      const dir = getBookDir(tempDir, 'bad2');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'reading-progress.json'), JSON.stringify({
        version: 1, bookId: 'bad2', chapters: 'invalid'
      }));

      const result = await loadProgress(tempDir, 'bad2');
      expect(result).toBeNull();
    });

    it('should load a previously saved progress file', async () => {
      const progress = createEmptyProgress('abc12345');
      const updated = markChapterVisited(
        updateLastRead(progress, 'chapter-1'),
        'chapter-1'
      );

      await saveProgress(tempDir, updated);
      const loaded = await loadProgress(tempDir, 'abc12345');

      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(1);
      expect(loaded!.bookId).toBe('abc12345');
      expect(loaded!.lastReadChapterId).toBe('chapter-1');
      expect(loaded!.chapters['chapter-1']).toEqual({ visited: true });
    });
  });

  describe('saveProgress / loadProgress round-trip', () => {
    it('should preserve all data through save and load', async () => {
      let progress = createEmptyProgress('test-book');
      progress = markChapterVisited(progress, 'ch-1');
      progress = markChapterVisited(progress, 'ch-2');
      progress = markChapterVisited(progress, 'ch-3');
      progress = updateLastRead(progress, 'ch-3');

      await saveProgress(tempDir, progress);
      const loaded = await loadProgress(tempDir, 'test-book');

      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(1);
      expect(loaded!.bookId).toBe('test-book');
      expect(loaded!.lastReadChapterId).toBe('ch-3');
      expect(loaded!.lastReadAt).toBe(progress.lastReadAt);
      expect(Object.keys(loaded!.chapters)).toHaveLength(3);
      expect(loaded!.chapters['ch-1'].visited).toBe(true);
      expect(loaded!.chapters['ch-2'].visited).toBe(true);
      expect(loaded!.chapters['ch-3'].visited).toBe(true);
    });

    it('should create .pageindex directory if it does not exist', async () => {
      const progress = createEmptyProgress('new-book');
      await saveProgress(tempDir, progress);

      const dirExists = await fs
        .stat(getBookDir(tempDir, 'new-book'))
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      const fileExists = await fs
        .stat(getBookFile(tempDir, 'new-book', 'reading-progress.json'))
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });
  });
});
