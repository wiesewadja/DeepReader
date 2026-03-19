/**
 * get_document_outline Tool - 获取文档大纲
 *
 * 对标 Linux tree/ls，用于检视阅读阶段了解书籍整体结构
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { OutlineNode } from './types.js';
import { buildLocalCache, extractChapterMetadata, parseSectionPath, extractHeadingFromPath } from './utils.js';

const GET_OUTLINE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_document_outline',
    description: `【检视阅读】获取当前书籍的目录大纲。用于了解书籍整体结构、定位章节。
- 无参数：返回完整层级树
- max_depth: 限制层级深度（如 max_depth=2 只显示到 H2）`,
    parameters: {
      type: 'object',
      properties: {
        max_depth: {
          type: 'number',
          description: '限制层级深度（1=H1, 2=H2...）'
        }
      },
      required: []
    }
  }
};

export const getDocumentOutlineTool: ToolExecutor = {
  definition: GET_OUTLINE_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const maxDepth = args.max_depth as number | undefined;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    try {
      const cache = await buildLocalCache(app, pdfName);
      const files = cache.chapterFiles || [];

      if (files.length === 0) {
        return JSON.stringify({
          status: 'ERROR_NO_FILES',
          message: `未找到书籍 "${pdfName}" 的章节文件`
        });
      }

      // 构建大纲树
      const outline = buildOutlineTree(files, app, maxDepth);

      return JSON.stringify({
        status: 'SUCCESS',
        book_title: pdfName,
        total_chapters: files.length,
        outline
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
 * 构建大纲树
 */
function buildOutlineTree(
  files: any[],
  app: any,
  maxDepth?: number
): OutlineNode[] {
  const nodes: OutlineNode[] = [];

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) continue;

    const metadata = extractChapterMetadata(cache.frontmatter);
    const path = parseSectionPath(metadata.section);

    // 根据深度过滤
    if (maxDepth && path.length > maxDepth) continue;

    nodes.push({
      heading: path[path.length - 1] || extractHeadingFromPath(file.path),
      line: 1,
      summary: metadata.summary,
      children: []
    });
  }

  // TODO: 构建层级树（按 section 路径嵌套）
  // 当前版本返回扁平列表，后续迭代优化
  return nodes;
}
