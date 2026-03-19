/**
 * search_markdown_text Tool - 带空间感知的文本搜索
 *
 * 对标增强版 Linux grep，用于检视阅读阶段定位关键词位置
 * 支持 scopeNodeIds 过滤，只在指定章节范围内搜索
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { SearchHit } from './types.js';
import { buildLocalCache, MAX_SEARCH_HITS } from './utils.js';

const SEARCH_TEXT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_markdown_text',
    description: `【分析阅读】在当前书籍中搜索文本。用于定位关键词出现的章节位置。
- keywords: 关键词数组（AND 逻辑，必须同时出现在同一段落）
- scope_node_ids: 章节范围 ID 列表（可选，由系统自动注入）
- use_regex: 是否启用正则表达式（默认 false，搜索失败时可开启）

【摩擦力】如果命中超过 10 处，返回 ERROR_TOO_BROAD，请换更精准的词。
【scope 锁定】如果提供了 scope_node_ids，只在这些章节内搜索。`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组（AND 逻辑）'
        },
        scope_node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '章节范围 ID 列表（由系统自动注入，无需手动填写）'
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
    const scopeNodeIds = args.scope_node_ids as string[] | undefined;
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

      // 构建 node_id -> file 映射（用于 scope 过滤）
      const scopeSet = scopeNodeIds && scopeNodeIds.length > 0
        ? new Set(scopeNodeIds)
        : null;

      for (const file of files) {
        const fileCache = app.metadataCache.getFileCache(file);
        const nodeId = fileCache?.frontmatter?.node_id as string;

        // Scope 过滤：如果设置了 scope，只搜索范围内的文件
        if (scopeSet && !scopeSet.has(nodeId)) {
          continue;
        }

        const content = await app.vault.cachedRead(file);
        const paragraphs = content.split(/\n\n+/);
        const section = (fileCache?.frontmatter?.section as string) || '';

        for (let i = 0; i < paragraphs.length; i++) {
          const para = paragraphs[i];

          if (matchParagraph(para, keywords, useRegex)) {
            const blockId = extractBlockId(para);

            hits.push({
              node_id: nodeId,
              location: {
                heading: section.split('>').pop()?.trim() || file.basename,
                path: section.split('>').map(s => s.trim()).filter(Boolean),
                file_path: file.path
              },
              line_number: i + 1,
              snippet: para.slice(0, 150) + (para.length > 150 ? '...' : ''),
              block_id: blockId
            });

            if (hits.length > MAX_SEARCH_HITS) {
              return JSON.stringify({
                status: 'ERROR_TOO_BROAD',
                message: `命中超过 ${MAX_SEARCH_HITS} 处，请使用更精准的关键词或启用 use_regex`,
                hint: '尝试：1) 增加关键词数量 2) 使用更长的短语 3) 启用 use_regex',
                scope_filter: scopeSet ? `已限定在 ${scopeSet.size} 个章节` : '全局搜索',
                total_hits: hits.length
              });
            }
          }
        }
      }

      if (hits.length === 0) {
        const scopeInfo = scopeSet
          ? `（已限定在 ${scopeSet.size} 个章节内）`
          : '（全局搜索）';
        return JSON.stringify({
          status: 'ERROR_NOT_FOUND',
          message: `未找到匹配内容${scopeInfo}`,
          suggestions: generateSuggestions(keywords),
          hint: '尝试：1) 拆分关键词 2) 使用同义词 3) 检查拼写 4) 移除 scope 限制'
        });
      }

      return JSON.stringify({
        status: 'SUCCESS',
        hits,
        scope_filter: scopeSet ? `已限定在 ${scopeSet.size} 个章节` : '全局搜索',
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
 * 提取段落中的 block_id（带 ^ 前缀）
 */
function extractBlockId(para: string): string {
  const match = para.match(/\^[\w-]+/);
  return match ? match[0] : '';
}

/**
 * 生成搜索建议（简化版本）
 */
function generateSuggestions(_keywords: string[]): string[] {
  // TODO: 实现基于编辑距离的近似词建议
  return [];
}
