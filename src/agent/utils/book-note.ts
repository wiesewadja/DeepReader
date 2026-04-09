/**
 * 书籍笔记工具函数
 *
 * 提供书籍笔记路径构建的公共函数
 */

import { normalizePath } from 'obsidian';

// ==================== 常量定义 ====================

/** 书籍笔记目录（与 reading-portal.ts 保持一致） */
export const BOOK_NOTES_DIR = 'DeepReader';

/** 用户配置文件路径 */
export const USER_PROFILE_PATH = 'DeepReader/DeepReader.md';

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
