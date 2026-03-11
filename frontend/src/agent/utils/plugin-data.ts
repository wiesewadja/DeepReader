/**
 * 插件数据目录工具函数
 *
 * 管理隐藏在 .obsidian/plugins/deepreader/data/ 下的数据
 */

import type { App } from 'obsidian';
import { toolsLog as log, error } from '../../utils/logger.js';

/** 插件数据根目录 */
export const PLUGIN_DATA_DIR = '.obsidian/plugins/deepreader/data';

/** 阅读进度目录 */
export const READING_PROGRESS_DIR = `${PLUGIN_DATA_DIR}/reading-progress`;

/** Memory 目录 */
export const MEMORY_DATA_DIR = `${PLUGIN_DATA_DIR}/memory`;

/** Memory 条目目录 */
export const MEMORY_ENTRIES_DIR = `${MEMORY_DATA_DIR}/entries`;

/**
 * 阅读进度数据结构
 */
export interface ReadingProgressData {
  bookName: string;
  bookId: string;
  totalChapters: number;
  chapterFamiliarity: Record<string, number>;
  totalInteractions: number;
  coverage: number;
  absorption: number;
  created: string;
  lastUpdated: string;
  readingHistory: Array<{
    round: number;
    started: string;
    finished?: string;
    finalFamiliarity?: Record<string, number>;
    notes?: string;
    currentRound?: boolean;
  }>;
  currentRound: number;
}

/**
 * 确保插件数据目录结构存在
 */
export async function ensurePluginDataDirs(app: App): Promise<void> {
  const dirs = [
    PLUGIN_DATA_DIR,
    READING_PROGRESS_DIR,
    MEMORY_DATA_DIR,
    MEMORY_ENTRIES_DIR,
  ];

  for (const dir of dirs) {
    const exists = await app.vault.adapter.exists(dir);
    if (!exists) {
      await app.vault.createFolder(dir);
      log('[PluginData] Created directory:', dir);
    }
  }
}

/**
 * 获取书籍阅读进度文件路径
 */
export function getReadingProgressPath(bookName: string): string {
  // 清理书名，生成合法文件名
  const safeName = bookName.replace(/[\/\\?%*:|"<>]/g, '_');
  return `${READING_PROGRESS_DIR}/${safeName}.json`;
}

/**
 * 读取书籍阅读进度
 */
export async function readReadingProgress(
  app: App,
  bookName: string
): Promise<ReadingProgressData | null> {
  const path = getReadingProgressPath(bookName);

  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) {
      return null;
    }

    const content = await app.vault.adapter.read(path);
    return JSON.parse(content) as ReadingProgressData;
  } catch (err) {
    error('[PluginData] Failed to read reading progress:', err);
    return null;
  }
}

/**
 * 写入书籍阅读进度
 */
export async function writeReadingProgress(
  app: App,
  data: ReadingProgressData
): Promise<boolean> {
  const path = getReadingProgressPath(data.bookName);

  try {
    // 确保目录存在
    await ensurePluginDataDirs(app);

    // 更新时间戳
    data.lastUpdated = new Date().toISOString();

    await app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    log('[PluginData] Wrote reading progress:', data.bookName);
    return true;
  } catch (err) {
    error('[PluginData] Failed to write reading progress:', err);
    return false;
  }
}

/**
 * 创建新的阅读进度数据
 */
export function createEmptyReadingProgress(
  bookName: string,
  bookId: string,
  totalChapters: number
): ReadingProgressData {
  const now = new Date().toISOString();
  return {
    bookName,
    bookId,
    totalChapters,
    chapterFamiliarity: {},
    totalInteractions: 0,
    coverage: 0,
    absorption: 0,
    created: now,
    lastUpdated: now,
    readingHistory: [
      {
        round: 1,
        started: now.split('T')[0],
        currentRound: true,
      },
    ],
    currentRound: 1,
  };
}

/**
 * 计算覆盖度和吸收度
 */
export function calculateProgressMetrics(
  data: ReadingProgressData
): { coverage: number; absorption: number } {
  const totalChapters = data.totalChapters || 1;
  const benchmark = 3; // 假设每章提及 3 次算"基本吸收"

  // 覆盖度：熟悉度 > 0 的章节数 / 总章节
  const coveredChapters = Object.values(data.chapterFamiliarity).filter(
    (v) => v > 0
  ).length;
  const coverage = Math.round((coveredChapters / totalChapters) * 100);

  // 吸收度：Σ熟悉度 / (总章节 × 基准值)
  const totalFamiliarity = Object.values(data.chapterFamiliarity).reduce(
    (a, b) => a + b,
    0
  );
  const absorption = Math.round(
    (totalFamiliarity / (totalChapters * benchmark)) * 100
  );

  return { coverage, absorption };
}

/**
 * 获取所有已读书籍的进度列表
 */
export async function listAllReadingProgress(
  app: App
): Promise<ReadingProgressData[]> {
  try {
    const exists = await app.vault.adapter.exists(READING_PROGRESS_DIR);
    if (!exists) {
      return [];
    }

    const files = await app.vault.adapter.list(READING_PROGRESS_DIR);
    const progressList: ReadingProgressData[] = [];

    for (const file of files.files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = await app.vault.adapter.read(file);
        const data = JSON.parse(content) as ReadingProgressData;
        if (data.totalInteractions > 0) {
          progressList.push(data);
        }
      } catch {
        // 跳过无效文件
      }
    }

    return progressList;
  } catch (err) {
    error('[PluginData] Failed to list reading progress:', err);
    return [];
  }
}
