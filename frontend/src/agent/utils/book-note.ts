/**
 * 书籍笔记工具函数
 *
 * 提供书籍笔记路径构建和熟悉度更新的公共函数
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import { toolsLog as log, error } from '../../utils/logger.js';
import {
  readReadingProgress,
  writeReadingProgress,
  createEmptyReadingProgress,
  calculateProgressMetrics,
  type ReadingProgressData,
} from './plugin-data.js';

// ==================== 常量定义 ====================

/** 书籍笔记目录（与 reading-portal.ts 保持一致） */
export const BOOK_NOTES_DIR = 'DeepReader';

/** 用户配置文件路径 */
export const USER_PROFILE_PATH = 'DeepReader/DeepReader.md';

/** 熟悉度更新原因及对应增量 */
export const FAMILIARITY_DELTAS = {
  get_chapter: 2,
  highlight: 2,
  user_question: 1,
  ai_reference: 1,
} as const;

export type FamiliarityReason = keyof typeof FAMILIARITY_DELTAS;

// ==================== 路径工具 ====================

/**
 * 清理书名（移除文件扩展名）
 */
export function sanitizeBookName(name: string): string {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/\.epub$/i, '')
    .trim();
}

/**
 * 获取书籍笔记路径
 */
export function getBookNotePath(bookName: string): string {
  const sanitizedName = sanitizeBookName(bookName);
  return normalizePath(`${BOOK_NOTES_DIR}/${sanitizedName}/${sanitizedName}.md`);
}

// ==================== Frontmatter 工具 ====================

/**
 * 解析 Markdown 文件的 frontmatter
 * @deprecated 建议使用 app.fileManager.processFrontMatter 代替手动解析
 */
export function parseFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }
  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

/**
 * 从 nodeId 提取章节索引
 * 支持多种格式：
 * - "western-history_03-第一章" -> 3
 * - "0008" -> 8
 * - "03-something" -> 3
 */
export function extractChapterIndexFromNodeId(nodeId: string): number | null {
  // 优先匹配带分隔符的格式：_数字- 或 _数字_
  const match = nodeId.match(/_(\d+)(?:[-_]|$)/);
  if (match) {
    return parseInt(match[1], 10);
  }

  // 如果整个 nodeId 就是纯数字，直接返回
  if (/^\d+$/.test(nodeId)) {
    return parseInt(nodeId, 10);
  }

  // 尝试匹配开头的数字：03-something
  const leadingMatch = nodeId.match(/^(\d+)(?:[-_]|$)/);
  return leadingMatch ? parseInt(leadingMatch[1], 10) : null;
}

// ==================== 阅读进度存储（插件数据目录）====================

/**
 * 更新书籍阅读进度（存储到插件数据目录）
 *
 * @param app Obsidian App 实例
 * @param bookName 书名
 * @param bookId 书籍 ID（index_id）
 * @param totalChapters 总章节数
 * @param chapterIndex 章节索引
 * @param delta 增量值
 * @returns 是否更新成功
 */
export async function updateReadingProgress(
  app: App,
  bookName: string,
  bookId: string,
  totalChapters: number,
  chapterIndex: number,
  delta: number
): Promise<boolean> {
  try {
    // 读取现有进度或创建新的
    let progress =
      (await readReadingProgress(app, bookName)) ||
      createEmptyReadingProgress(bookName, bookId, totalChapters);

    // 更新章节熟悉度
    const key = String(chapterIndex);
    progress.chapterFamiliarity[key] =
      (progress.chapterFamiliarity[key] || 0) + delta;

    // 更新总互动次数
    progress.totalInteractions = Object.values(
      progress.chapterFamiliarity
    ).reduce((a, b) => a + b, 0);

    // 计算指标
    const metrics = calculateProgressMetrics(progress);
    progress.coverage = metrics.coverage;
    progress.absorption = metrics.absorption;

    // 写入
    const success = await writeReadingProgress(app, progress);

    if (success) {
      log(
        '[updateReadingProgress]',
        bookName,
        '章节',
        chapterIndex,
        '熟悉度+',
        delta
      );
    }

    return success;
  } catch (err) {
    error('[updateReadingProgress] 更新失败:', err);
    return false;
  }
}

/**
 * 获取书籍阅读进度
 */
export async function getBookReadingProgress(
  app: App,
  bookName: string
): Promise<ReadingProgressData | null> {
  return readReadingProgress(app, bookName);
}

// ==================== 向后兼容（已废弃）====================

/**
 * 更新书籍笔记的章节熟悉度
 * @deprecated 已废弃，请使用 updateReadingProgress。数据现在存储在插件数据目录而非 frontmatter。
 */
export async function updateBookFamiliarity(
  app: App,
  bookName: string,
  chapterIndex: number,
  delta: number
): Promise<boolean> {
  // 转发到新函数
  const indexId = bookName;
  const totalChapters = 100; // 默认值
  return updateReadingProgress(app, bookName, indexId, totalChapters, chapterIndex, delta);
}
