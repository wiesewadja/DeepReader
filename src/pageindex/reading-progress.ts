/**
 * Reading Progress Data Module
 *
 * Stores per-book reading progress in `.pageindex/{bookId}/reading-progress.json`.
 * Tracks which chapters have been visited and the last-read position.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { serviceLog as log, error } from '../utils/logger.js';

// ============ Data Model ============

export interface ReadingProgress {
  /** Schema version */
  version: 1;
  /** Book identifier (matches book-meta.json directory) */
  bookId: string;
  /** Last-read chapter ID from ChapterMeta.id */
  lastReadChapterId: string;
  /** ISO timestamp of last read */
  lastReadAt: string;
  /** Per-chapter visited state, keyed by ChapterMeta.id */
  chapters: Record<string, {
    visited: boolean;
  }>;
}

// ============ Pure Functions ============

/**
 * Create an empty reading progress object for a book.
 */
export function createEmptyProgress(bookId: string): ReadingProgress {
  return {
    version: 1,
    bookId,
    lastReadChapterId: '',
    lastReadAt: '',
    chapters: {},
  };
}

/**
 * Mark a chapter as visited. No-op if already visited.
 * Returns a new object (immutable).
 */
export function markChapterVisited(
  progress: ReadingProgress,
  chapterId: string
): ReadingProgress {
  if (progress.chapters[chapterId]?.visited) {
    return progress;
  }

  return {
    ...progress,
    chapters: {
      ...progress.chapters,
      [chapterId]: { visited: true },
    },
  };
}

/**
 * Update the last-read chapter and timestamp.
 * Returns a new object (immutable).
 */
export function updateLastRead(
  progress: ReadingProgress,
  chapterId: string
): ReadingProgress {
  return {
    ...progress,
    lastReadChapterId: chapterId,
    lastReadAt: new Date().toISOString(),
  };
}

/**
 * Calculate reading progress as a percentage (0-100).
 * Returns the floor of the percentage to avoid displaying "100%" prematurely.
 */
export function getProgressPercent(
  progress: ReadingProgress,
  totalChapters: number
): number {
  if (totalChapters <= 0) return 0;

  const visitedCount = Object.values(progress.chapters)
    .filter((ch) => ch.visited)
    .length;

  return Math.floor((visitedCount / totalChapters) * 100);
}

// ============ File I/O ============

/**
 * Build the file path for a book's reading progress file.
 */
function getProgressFilePath(baseDir: string, bookId: string): string {
  return path.join(baseDir, '.pageindex', bookId, 'reading-progress.json');
}

/**
 * Load reading progress from disk.
 * Returns null if the file does not exist or data is invalid.
 */
export async function loadProgress(
  baseDir: string,
  bookId: string
): Promise<ReadingProgress | null> {
  const filePath = getProgressFilePath(baseDir, bookId);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Validate essential fields
    if (!data || typeof data !== 'object' || data.bookId !== bookId || typeof data.chapters !== 'object') {
      log(`Invalid reading progress file for book ${bookId}, ignoring`);
      return null;
    }

    log(`Loaded reading progress for book ${bookId}`);
    return data as ReadingProgress;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return null;
    }
    error(`Failed to load reading progress for book ${bookId}:`, err);
    throw err;
  }
}

/**
 * Save reading progress to disk.
 * Creates parent directories if needed.
 */
export async function saveProgress(
  baseDir: string,
  progress: ReadingProgress
): Promise<void> {
  const filePath = getProgressFilePath(baseDir, progress.bookId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(progress, null, 2), 'utf-8');
  log(`Saved reading progress for book ${progress.bookId}`);
}
