/**
 * 书籍笔记工具函数
 *
 * 提供书籍笔记路径构建和熟悉度更新的公共函数
 */

import type { App } from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import { toolsLog as log, error } from '../../utils/logger.js';

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

// ==================== 熟悉度更新 ====================

/**
 * 更新书籍笔记的章节熟悉度
 *
 * 使用 Obsidian 的 processFrontMatter API 安全更新 frontmatter
 *
 * @param app Obsidian App 实例
 * @param bookName 书名
 * @param chapterIndex 章节索引
 * @param delta 增量值
 * @returns 是否更新成功
 */
export async function updateBookFamiliarity(
  app: App,
  bookName: string,
  chapterIndex: number,
  delta: number
): Promise<boolean> {
  const notePath = getBookNotePath(bookName);

  log('[updateBookFamiliarity] 开始更新', {
    bookName,
    notePath,
    chapterIndex,
    delta
  });

  try {
    const file = app.vault.getAbstractFileByPath(notePath);

    if (!file || !(file instanceof TFile)) {
      log('[updateBookFamiliarity] 书籍笔记不存在:', notePath);
      return false;
    }

    log('[updateBookFamiliarity] 找到文件:', file.path);

    // 使用 Obsidian API 安全更新 frontmatter
    await app.fileManager.processFrontMatter(file, (fm) => {
      log('[updateBookFamiliarity] 当前 frontmatter:', JSON.stringify(fm));

      // 获取或初始化 chapter_familiarity
      const familiarity: Record<string, number> = fm.chapter_familiarity || {};

      // 更新指定章节的熟悉度
      const key = String(chapterIndex);
      familiarity[key] = (familiarity[key] || 0) + delta;

      // 写回 frontmatter
      fm.chapter_familiarity = familiarity;

      // 更新总互动次数
      const totalInteractions = Object.values(familiarity).reduce((a, b) => a + b, 0);
      fm.total_interactions = totalInteractions;

      // 更新最后活跃日期
      fm.last_active = new Date().toISOString().split('T')[0];

      log('[updateBookFamiliarity] 更新后 frontmatter:', JSON.stringify(fm));
    });

    log('[updateBookFamiliarity] 章节', chapterIndex, '熟悉度+', delta, '更新成功');
    return true;
  } catch (err) {
    error('[updateBookFamiliarity] 更新失败:', err);
    return false;
  }
}

/**
 * 从 nodeId 提取章节索引
 * 格式如 "western-history_03-第一章" -> 3
 */
export function extractChapterIndexFromNodeId(nodeId: string): number | null {
  const match = nodeId.match(/_(\d+)-/);
  return match ? parseInt(match[1], 10) : null;
}
