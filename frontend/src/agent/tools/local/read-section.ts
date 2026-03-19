/**
 * read_markdown_section Tool - 按标题读取完整章节
 *
 * 对标智能版 Linux cat/less，用于分析阅读阶段精读某个小节
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import { buildLocalCache, estimateTokens, MAX_TOKENS, normalizeHeading } from './utils.js';

const READ_SECTION_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_markdown_section',
    description: `【分析阅读】读取指定章节的完整内容。用于精读某个小节。
- heading: 标题名称（包含匹配，如 "MECE" 可匹配 "### MECE 原则"）
- block_id: 块引用 ID（如 "^ch2-p1"，自动定位到包含该块的章节）
二选一，优先 heading。`,
    parameters: {
      type: 'object',
      properties: {
        heading: {
          type: 'string',
          description: '标题名称（包含匹配）'
        },
        block_id: {
          type: 'string',
          description: '块引用 ID（如 ^ch2-p1）'
        }
      },
      required: []
    }
  }
};

export const readMarkdownSectionTool: ToolExecutor = {
  definition: READ_SECTION_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const heading = args.heading as string | undefined;
    const blockId = args.block_id as string | undefined;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!heading && !blockId) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: '必须提供 heading 或 block_id 参数'
      });
    }

    try {
      const cache = await buildLocalCache(app, pdfName);
      const files = cache.chapterFiles || [];

      let targetFile = null;
      const candidates: string[] = [];

      if (heading) {
        // 按标题查找
        const normalizedQuery = normalizeHeading(heading);

        for (const file of files) {
          const fileCache = app.metadataCache.getFileCache(file);
          const section = (fileCache?.frontmatter?.section as string) || file.basename;
          const normalizedSection = normalizeHeading(section);

          if (normalizedSection.includes(normalizedQuery)) {
            candidates.push(section);
            if (!targetFile) targetFile = file;
          }
        }

        if (candidates.length > 1) {
          return JSON.stringify({
            status: 'ERROR_MULTIPLE_MATCHES',
            message: '标题匹配到多个章节',
            candidates
          });
        }

        if (candidates.length === 0) {
          return JSON.stringify({
            status: 'ERROR_NOT_FOUND',
            message: `未找到标题: ${heading}`
          });
        }
      } else if (blockId) {
        // 按 block_id 查找
        const blockIdIndex = cache.blockIdIndex;
        if (blockIdIndex?.has(blockId)) {
          const filePath = blockIdIndex.get(blockId)!;
          targetFile = files.find(f => f.path === filePath);
        } else {
          // 降级：遍历查找
          for (const file of files) {
            const content = await app.vault.cachedRead(file);
            if (content.includes(blockId)) {
              targetFile = file;
              break;
            }
          }
        }

        if (!targetFile) {
          return JSON.stringify({
            status: 'ERROR_NOT_FOUND',
            message: `未找到 block_id: ${blockId}`
          });
        }
      }

      if (!targetFile) {
        return JSON.stringify({
          status: 'ERROR_NOT_FOUND',
          message: '未找到匹配的章节'
        });
      }

      const content = await app.vault.cachedRead(targetFile);
      const tokens = estimateTokens(content);

      // 超限截断
      if (tokens > MAX_TOKENS) {
        const overviewText = content.slice(0, 800);
        const subHeadings = extractSubHeadings(content);

        return JSON.stringify({
          status: 'WARNING_SECTION_TOO_LARGE',
          message: `章节过大（约 ${tokens} tokens），已截断。请钻取具体子标题。`,
          word_count: content.length,
          token_estimate: tokens,
          overview_text: overviewText,
          sub_headings: subHeadings
        });
      }

      return JSON.stringify({
        status: 'SUCCESS_FULL_SECTION',
        heading: targetFile.basename,
        word_count: content.length,
        token_estimate: tokens,
        content
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
 * 提取子标题列表
 */
function extractSubHeadings(content: string): { heading: string; line: number }[] {
  const lines = content.split('\n');
  const headings: { heading: string; line: number }[] = [];

  lines.forEach((line, idx) => {
    const match = line.match(/^(#{2,6})\s+(.+)/);
    if (match) {
      headings.push({
        heading: match[2],
        line: idx + 1
      });
    }
  });

  return headings;
}
