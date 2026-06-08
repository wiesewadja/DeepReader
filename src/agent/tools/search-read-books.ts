/**
 * search_read_books Tool - 在已读书籍中搜索相关章节
 *
 * 用于关联阅读功能，帮助用户找到已读书籍中与当前主题相关的内容
 */

import { toolsLog as log, error as logError } from '../../utils/logger.js';
import { BOOK_NOTES_DIR } from '../utils/book-note.js';
import type { ToolExecutor, ToolContext } from './types.js';

/**
 * 从 frontmatter 提取 summary 字段
 */
function extractSummary(content: string): string {
  // 尝试匹配 summary: "xxx" 格式
  const summaryMatch = content.match(/summary:\s*"([^"]+)"/);
  if (summaryMatch) {
    return summaryMatch[1];
  }

  // 尝试匹配 summary: xxx 格式（无引号）
  const summaryMatch2 = content.match(/summary:\s*(.+)\n/);
  if (summaryMatch2) {
    return summaryMatch2[1].trim();
  }

  return '';
}

/**
 * 从文件路径提取章节索引
 */
function extractChapterIndex(path: string): number {
  const match = path.match(/(\d+)-[^/]+\.md$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * 计算文本与查询的相关性分数
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateRelevance(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/);
  const textLower = text.toLowerCase();

  let score = 0;
  for (const word of queryWords) {
    // 完全匹配
    if (textLower.includes(word)) {
      score += 1;
    }
    // 部分匹配（子串）
    if (word.length > 2) {
      const prefix = escapeRegex(word.slice(0, 3));
      const partialMatches = (textLower.match(new RegExp(prefix, 'g')) || []).length;
      score += partialMatches * 0.3;
    }
  }

  return score;
}

export const searchReadBooksTool: ToolExecutor = {

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const query = args.query as string;
    const maxResults = (args.maxResults as number) || 5;

    if (!query) {
      return 'Error: query 参数是必需的';
    }

    if (!context.vault?.app) {
      return 'Error: Obsidian App 实例不可用';
    }

    try {
      log('[search_read_books] 搜索已读书籍:', query);

      // 1. 获取已读书籍目录
      const notesDir = BOOK_NOTES_DIR;
      const exists = await context.vault.app.vault.adapter.exists(notesDir);

      if (!exists) {
        return '没有找到已读书籍。请先阅读一些书籍。';
      }

      const bookDirs = await context.vault.app.vault.adapter.list(notesDir);
      const results: Array<{
        bookName: string;
        chapterTitle: string;
        chapterIndex: number;
        summary: string;
        link: string;
        relevance: number;
      }> = [];

      // 2. 遍历每本书的章节
      for (const bookDir of bookDirs.folders) {
        const bookName = bookDir.split('/').pop() || '';
        const chapterFiles = await context.vault.app.vault.adapter.list(bookDir);

        for (const chapterFile of chapterFiles.files) {
          if (!chapterFile.endsWith('.md')) continue;

          // 跳过主笔记文件
          if (chapterFile.endsWith(`${bookName}.md`)) continue;

          try {
            const content = await context.vault.app.vault.adapter.read(chapterFile);

            // 提取摘要
            const summary = extractSummary(content);

            // 提取章节标题
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const chapterTitle = titleMatch ? titleMatch[1] : chapterFile.split('/').pop() || '';

            // 计算相关性（基于摘要和标题）
            const searchText = `${summary} ${chapterTitle}`;
            const relevance = calculateRelevance(query, searchText);

            if (relevance > 0) {
              // 构建 wikilink
              const relativePath = chapterFile.replace(/\.md$/, '');
              const link = `[[${relativePath}|${chapterTitle}]]`;

              // 提取章节索引
              const chapterIndex = extractChapterIndex(chapterFile);

              results.push({
                bookName,
                chapterTitle,
                chapterIndex,
                summary,
                link,
                relevance,
              });
            }
          } catch (readError) {
            // 读取失败，跳过该章节
            log('[search_read_books] 读取章节失败:', chapterFile, readError);
          }
        }
      }

      // 3. 按相关性排序，返回前 N 个
      results.sort((a, b) => b.relevance - a.relevance);
      const topResults = results.slice(0, maxResults);

      if (topResults.length === 0) {
        return `未找到与 "${query}" 相关的章节。\n\n建议：\n- 尝试使用更通用的关键词\n- 检查是否有已读的书籍`;
      }

      // 4. 格式化输出
      const outputLines = topResults.map((r, i) => {
        return `### ${i + 1}. ${r.link}
**书籍**: ${r.bookName}
**章节索引**: ${r.chapterIndex}
**摘要**: ${r.summary || '（无摘要）'}
**相关性**: ${r.relevance.toFixed(1)}`;
      });

      return `找到 ${topResults.length} 个相关章节（共搜索 ${results.length} 个匹配）：

${outputLines.join('\n\n')}

---
*提示：如需查看完整内容，可以使用 read_markdown_section 工具读取具体章节。*`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[search_read_books] 搜索失败:', errorMsg);
      return `搜索时出错: ${errorMsg}`;
    }
  },
};
