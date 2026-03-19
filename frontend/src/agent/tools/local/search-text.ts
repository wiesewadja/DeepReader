/**
 * search_markdown_text Tool - 带空间感知的文本搜索
 *
 * 对标增强版 Linux grep，用于检视阅读阶段定位关键词位置
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { SearchHit } from './types.js';
import { buildLocalCache, MAX_SEARCH_HITS } from './utils.js';

const SEARCH_TEXT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_markdown_text',
    description: `【检视阅读】在当前书籍中搜索文本。用于定位关键词出现的章节位置。
- keywords: 关键词数组（AND 逻辑，必须同时出现在同一段落）
- use_regex: 是否启用正则表达式（默认 false，搜索失败时可开启）

【摩擦力】如果命中超过 10 处，返回 ERROR_TOO_BROAD，请换更精准的词。`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组（AND 逻辑）'
        },
        use_regex: {
          type: 'boolean',
          description: '是否启用正则表达式（默认 false）'
        }
      },
      required: ['keywords']
    }
  }
};

export const searchMarkdownTextTool: ToolExecutor = {
  definition: SEARCH_TEXT_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const keywords = args.keywords as string[];
    const useRegex = (args.use_regex as boolean) || false;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!keywords || keywords.length === 0) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: 'keywords 参数不能为空'
      });
    }

    try {
      const cache = await buildLocalCache(app, pdfName);
      const files = cache.chapterFiles || [];
      const hits: SearchHit[] = [];

      for (const file of files) {
        const content = await app.vault.cachedRead(file);
        const paragraphs = content.split(/\n\n+/);

        for (let i = 0; i < paragraphs.length; i++) {
          const para = paragraphs[i];

          if (matchParagraph(para, keywords, useRegex)) {
            const blockId = extractBlockId(para) || '';
            const fileCache = app.metadataCache.getFileCache(file);
            const section = (fileCache?.frontmatter?.section as string) || '';

            hits.push({
              location: {
                heading: section.split('>').pop()?.trim() || file.basename,
                path: section.split('>').map(s => s.trim()).filter(Boolean),
                file_path: file.path
              },
              line_number: i + 1,
              snippet: para.slice(0, 100) + (para.length > 100 ? '...' : ''),
              block_id: blockId
            });

            if (hits.length > MAX_SEARCH_HITS) {
              return JSON.stringify({
                status: 'ERROR_TOO_BROAD',
                message: `命中超过 ${MAX_SEARCH_HITS} 处，请使用更精准的关键词或启用 use_regex`,
                total_hits: hits.length
              });
            }
          }
        }
      }

      if (hits.length === 0) {
        return JSON.stringify({
          status: 'ERROR_NOT_FOUND',
          message: '未找到匹配内容',
          suggestions: generateSuggestions(keywords)
        });
      }

      return JSON.stringify({
        status: 'SUCCESS',
        hits,
        total_hits: hits.length
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({
        status: 'ERROR_FILE_READ_FAILED',
        message: `读取文件失败: ${errorMsg}`
      });
    }
  }
};

/**
 * 段落匹配
 */
function matchParagraph(para: string, keywords: string[], useRegex: boolean): boolean {
  if (useRegex) {
    // 正则模式：任意一个关键词匹配即可
    return keywords.some(kw => {
      try {
        return new RegExp(kw).test(para);
      } catch {
        return false;
      }
    });
  }
  // 默认模式：所有关键词必须同时出现（AND 逻辑）
  return keywords.every(kw => para.includes(kw));
}

/**
 * 提取段落中的 block_id
 */
function extractBlockId(para: string): string | null {
  const match = para.match(/\^[\w-]+/);
  return match ? match[0] : null;
}

/**
 * 生成搜索建议（简化版本）
 */
function generateSuggestions(_keywords: string[]): string[] {
  // TODO: 实现基于编辑距离的近似词建议
  return [];
}
