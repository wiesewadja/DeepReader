/**
 * get_document_outline Tool - 获取文档大纲
 *
 * 对标 Linux tree/ls，用于检视阅读阶段了解书籍整体结构
 * 返回 node_id 用于 scope 锁定
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { OutlineNode } from './types.js';
import { buildLocalCache, extractChapterMetadata, parseSectionPath, extractHeadingFromPath, normalizeNodeId } from './utils.js';

const GET_OUTLINE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_document_outline',
    description: `【检视阅读】获取当前书籍的目录大纲。用于了解书籍整体结构、定位章节。
- 无参数：返回完整层级树
- max_depth: 限制层级深度（如 max_depth=2 只显示到 H2）

【输出字段】
- node_id: 章节唯一标识（用于 scope 锁定）
- heading: 章节标题
- level: 层级深度
- summary: 章节摘要（如有）
- link: Obsidian 双链格式`,
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
      const outline = buildOutlineTree(files, app, pdfName, maxDepth);

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
 * 去重：同一 node_id 的多个 part 文件只保留一个节点
 */
function buildOutlineTree(
  files: any[],
  app: any,
  bookName: string,
  maxDepth?: number
): OutlineNode[] {
  const nodeMap = new Map<string, OutlineNode>();

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) continue;

    const metadata = extractChapterMetadata(cache.frontmatter);
    const path = parseSectionPath(metadata.section);

    // 根据深度过滤
    if (maxDepth && path.length > maxDepth) continue;

    const heading = path[path.length - 1] || extractHeadingFromPath(file.path);
    const nodeId = normalizeNodeId(metadata.node_id);

    // 去重：同一 node_id 只保留第一个（通常是 part 1）
    if (!nodeMap.has(nodeId)) {
      nodeMap.set(nodeId, {
        node_id: nodeId,
        heading: heading,
        level: metadata.level || path.length,
        line: 1,
        summary: metadata.summary,
        link: `[[${file.path}|${heading}]]`,
        children: []
      });
    }
  }

  // 按 node_id 数值排序
  const nodes = Array.from(nodeMap.values());
  nodes.sort((a, b) => {
    const numA = parseInt(a.node_id, 10);
    const numB = parseInt(b.node_id, 10);
    return numA - numB;
  });

  return nodes;
}
