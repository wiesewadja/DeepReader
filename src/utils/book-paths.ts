/**
 * 书籍摘录/笔记路径生成 module
 *
 * 所有 "书籍摘录/{书名}" 形式的路径拼接走这里。
 * 调用方负责 sanitize（不同子系统保留各自历史行为，
 * 见 weread/utils/file.ts 与 excerpt-service.ts:sanitizeFilename）。
 */

const EXCERPT_BASE_DIR = '书籍摘录';

/** 摘录根目录："书籍摘录" */
export function excerptBaseDir(): string {
  return EXCERPT_BASE_DIR;
}

/** 单本书的摘录目录："书籍摘录/{safeName}" */
export function bookExcerptDir(safeName: string): string {
  return `${EXCERPT_BASE_DIR}/${safeName}`;
}

/** 书籍笔记文件路径："书籍摘录/{safeName}/{safeName}.md" */
export function bookNotePath(safeName: string): string {
  return `${EXCERPT_BASE_DIR}/${safeName}/${safeName}.md`;
}

/**
 * 按日期归档的摘录文件路径："书籍摘录/{safeName}/摘录-{YYYY-MM-DD}.md"
 *
 * @param safeName 已经过 sanitize 的书籍名
 * @param date 默认当前日期，可传固定日期便于测试
 */
export function dailyExcerptPath(safeName: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${EXCERPT_BASE_DIR}/${safeName}/摘录-${yyyy}-${mm}-${dd}.md`;
}
