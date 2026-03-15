/**
 * get_toc Tool - 获取 PDF 目录结构
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

const GET_TOC_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_toc',
    description: `【检视阅读】获取书籍的目录结构。
适用场景：了解书籍组织架构、回答"讲什么"、"目录"类问题、定位相关章节。
返回：层级目录列表和页码范围。`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const getTocTool: ToolExecutor = {
  definition: GET_TOC_DEFINITION,

  async execute(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
    try {
      log('[get_toc] 获取目录:', { indexId: context.indexId });

      const toc = await deeppdfClient.getTableOfContents(context.indexId);

      if (!toc.chapters || toc.chapters.length === 0) {
        return `No table of contents available for "${context.pdfName}"`;
      }

      // 格式化目录为嵌套列表
      const formatChapters = (chapters: typeof toc.chapters, indent: number = 0): string => {
        return chapters
          .map((chapter) => {
            const prefix = '  '.repeat(indent) + (indent > 0 ? '- ' : '');
            const pageRange = chapter.start_page === chapter.end_page
              ? `p.${chapter.start_page}`
              : `p.${chapter.start_page}-${chapter.end_page}`;
            return `${prefix}${chapter.title} (${pageRange})`;
          })
          .join('\n');
      };

      const formattedToc = formatChapters(toc.chapters);

      log('[get_toc] 找到', toc.chapters.length, '个章节');
      return `Table of Contents for "${toc.book_name}" (Total: ${toc.total_pages} pages)\n\n${formattedToc}`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[get_toc] 获取目录失败:', errorMsg);
      return `Error getting table of contents: ${errorMsg}`;
    }
  },
};
