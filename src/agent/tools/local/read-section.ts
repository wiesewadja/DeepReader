/**
 * read_book_section Tool - 智能段落读取
 *
 * v2: 从 tree.json 查找文件，支持批量 node_ids 读取
 * 文件定位靠 tree.json 的 nodeFileMap，不再依赖 frontmatter
 */

import type { App } from 'obsidian';
import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { LocalToolCache } from './types.js';
import { getOrBuildLocalCache } from './utils.js';

const MAX_SECTION_LENGTH = 8000;

const READ_BOOK_SECTION_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_book_section',
    description: `读取指定章节的完整内容（含 ^block_id 标记）。

【推荐用法】先 search_book 获取 node_id 列表，再批量读取。
参数优先级: node_ids (批量) > node_id+block_id (精确定位) > heading`,
    parameters: {
      type: 'object',
      properties: {
        node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '批量读取多个章节（推荐，一次读取多个 node_id）'
        },
        node_id: {
          type: 'string',
          description: '单个章节 ID'
        },
        block_id: {
          type: 'string',
          description: '块引用 ID（如 ^s1-002），需配合 node_id 使用'
        },
        heading: {
          type: 'string',
          description: '标题名称（模糊匹配）'
        }
      },
      required: []
    }
  }
};

export const readBookSectionTool: ToolExecutor = {
  definition: READ_BOOK_SECTION_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const nodeIds = args.node_ids as string[] | undefined;
    const nodeId = args.node_id as string | undefined;
    const blockId = args.block_id as string | undefined;
    const heading = args.heading as string | undefined;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!nodeIds?.length && !nodeId && !blockId && !heading) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: '必须提供 node_ids、node_id、block_id 或 heading 参数'
      });
    }

    try {
      const cache = await getOrBuildLocalCache(context);
      const treeData = cache.treeData;
      if (!treeData) {
        return JSON.stringify({
          status: 'ERROR_NO_TREE_DATA',
          message: '未找到 tree.json，请重新索引书籍'
        });
      }

      const vaultPath = (app.vault.adapter as any).basePath;
      const bookName = pdfName?.replace(/\.pdf$/i, '').replace(/\.epub$/i, '') || '';

      // Priority 1: Batch read by node_ids
      if (nodeIds && nodeIds.length > 0) {
        return await readMultipleSections(app, nodeIds, treeData, vaultPath, bookName);
      }

      // Priority 2: Single node_id (with optional block_id)
      if (nodeId) {
        return await readSingleNode(app, nodeId, blockId, treeData, vaultPath, bookName);
      }

      // Priority 3: block_id only (need to scan files)
      if (blockId) {
        return await readByBlockId(app, blockId, treeData, vaultPath, bookName);
      }

      // Priority 4: heading fuzzy match
      if (heading) {
        return await readByHeading(app, heading, treeData, vaultPath, bookName);
      }

      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: '必须提供 node_ids、node_id、block_id 或 heading 参数'
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

// ─── Batch read ─────────────────────────────────────────────────────────────

async function readMultipleSections(
  app: App,
  nodeIds: string[],
  treeData: any,
  vaultPath: string,
  bookName: string
): Promise<string> {
  const results: any[] = [];

  for (const nodeId of nodeIds) {
    const fileName = treeData.nodeFileMap[nodeId];
    if (!fileName) continue;

    const { content, truncated } = await readMdFile(
      app, vaultPath, treeData.title, fileName
    );

    const title = findNodeTitle(nodeId, treeData.structure) || nodeId;
    const mdFileName = fileName.replace(/\.md$/i, '');
    results.push({
      node_id: nodeId,
      title,
      file_name: mdFileName,
      content,
      word_count: content.length,
      truncated,
    });
  }

  if (results.length === 0) {
    return JSON.stringify({
      status: 'ERROR_NOT_FOUND',
      message: `未找到任何匹配的 node_id`
    });
  }

  return JSON.stringify({
    status: 'SUCCESS',
    sections: results,
    total_sections: results.length,
  });
}

// ─── Single node read ───────────────────────────────────────────────────────

async function readSingleNode(
  app: App,
  nodeId: string,
  blockId: string | undefined,
  treeData: any,
  vaultPath: string,
  bookName: string
): Promise<string> {
  const fileName = treeData.nodeFileMap[nodeId];
  if (!fileName) {
    return JSON.stringify({
      status: 'ERROR_NOT_FOUND',
      message: `未找到 node_id: ${nodeId}`
    });
  }

  const { content } = await readMdFile(app, vaultPath, treeData.title, fileName);
  const title = findNodeTitle(nodeId, treeData.structure) || nodeId;
  const mdFileName = fileName.replace(/\.md$/i, '');

  // If block_id specified, locate the paragraph
  if (blockId) {
    const blockContent = extractBlockContext(content, blockId);
    if (blockContent) {
      return JSON.stringify({
        status: 'SUCCESS',
        node_id: nodeId,
        title,
        file_name: mdFileName,
        block_id: blockId,
        content: blockContent,
        word_count: blockContent.length,
      });
    }
    // Fall through to return full section
  }

  return JSON.stringify({
    status: 'SUCCESS',
    node_id: nodeId,
    title,
    file_name: mdFileName,
    content,
    word_count: content.length,
  });
}

// ─── Block ID read ──────────────────────────────────────────────────────────

async function readByBlockId(
  app: App,
  blockId: string,
  treeData: any,
  vaultPath: string,
  bookName: string
): Promise<string> {
  // Scan all files for the block_id
  const nodeFileMap = treeData.nodeFileMap as Record<string, string>;

  for (const [nodeId, fileName] of Object.entries(nodeFileMap)) {
    const { content } = await readMdFile(app, vaultPath, treeData.title, fileName);
    if (content.includes(blockId)) {
      const blockContent = extractBlockContext(content, blockId);
      const title = findNodeTitle(nodeId, treeData.structure) || nodeId;
      return JSON.stringify({
        status: 'SUCCESS',
        node_id: nodeId,
        title,
        block_id: blockId,
        content: blockContent || content,
        word_count: (blockContent || content).length,
      });
    }
  }

  return JSON.stringify({
    status: 'ERROR_NOT_FOUND',
    message: `未找到 block_id: ${blockId}`
  });
}

// ─── Heading read ───────────────────────────────────────────────────────────

async function readByHeading(
  app: App,
  heading: string,
  treeData: any,
  vaultPath: string,
  bookName: string
): Promise<string> {
  const normalizedQuery = heading.toLowerCase().trim();
  const nodeFileMap = treeData.nodeFileMap as Record<string, string>;

  // Search all nodes for a matching title
  for (const [nodeId, fileName] of Object.entries(nodeFileMap)) {
    const title = findNodeTitle(nodeId, treeData.structure) || '';
    if (title.toLowerCase().includes(normalizedQuery) || normalizedQuery.includes(title.toLowerCase())) {
      const { content } = await readMdFile(app, vaultPath, treeData.title, fileName);
      return JSON.stringify({
        status: 'SUCCESS',
        node_id: nodeId,
        title,
        content,
        word_count: content.length,
      });
    }
  }

  return JSON.stringify({
    status: 'ERROR_NOT_FOUND',
    message: `未找到标题: ${heading}`
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function readMdFile(
  app: App,
  vaultPath: string,
  bookTitle: string,
  fileName: string
): Promise<{ content: string; truncated: boolean }> {
  // 使用 vault 相对路径（adapter.read 会自动拼接 vault root）
  const relativePath = `DeepReader/${bookTitle}/${fileName}`;
  try {
    let content = await (app.vault as any).adapter.read(relativePath);
    // Remove frontmatter
    content = content.replace(/^---[\s\S]*?---\n/, "");
    // Remove navigation markers
    content = content.replace(/\[\[.*?\]\]/g, "");
    // Remove callout blocks
    content = content.replace(/> \[!.*?\][^\n]*\n(> .*\n)*/g, "");
    // Remove horizontal rules (navigation separators)
    content = content.replace(/\n---+\n/g, "\n\n");
    // Trim
    content = content.trim();

    const truncated = content.length > MAX_SECTION_LENGTH;
    if (truncated) {
      content = content.slice(0, MAX_SECTION_LENGTH) + "\n... (truncated)";
    }

    return { content, truncated };
  } catch {
    return { content: "", truncated: false };
  }
}

function extractBlockContext(content: string, blockId: string): string | null {
  const lines = content.split("\n");
  let blockLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(blockId)) {
      blockLineIndex = i;
      break;
    }
  }

  if (blockLineIndex === -1) return null;

  // Expand context around the block_id (~500 chars each direction)
  let start = blockLineIndex;
  let end = blockLineIndex + 1;
  let charCount = 0;

  // Expand forward
  while (end < lines.length && charCount < 500) {
    charCount += lines[end].length + 1;
    end++;
  }

  // Expand backward
  charCount = 0;
  while (start > 0 && charCount < 500) {
    start--;
    charCount += lines[start].length + 1;
  }

  return lines.slice(start, end).join("\n");
}

function findNodeTitle(nodeId: string, nodes: any[]): string | null {
  for (const node of nodes) {
    if (node.nodeId === nodeId) return node.title;
    if (node.nodes) {
      const found = findNodeTitle(nodeId, node.nodes);
      if (found) return found;
    }
  }
  return null;
}
