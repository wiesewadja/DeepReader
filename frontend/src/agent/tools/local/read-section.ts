/**
 * read_markdown_section Tool - 智能段落读取
 *
 * 核心逻辑：
 * 1. 通过 block_id 定位段落
 * 2. 找到段落所属的 heading
 * 3. 读取整个 heading 内容
 * 4. 长度调整：
 *    - < 500字 → 往后补到 1000字
 *    - > 4000字 → 从 block_id 往前截取 4000字
 */

import type { App, TFile } from 'obsidian';
import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { LocalToolCache } from './types.js';
import { getOrBuildLocalCache, normalizeNodeId, normalizeHeading } from './utils.js';

/** 长度阈值常量 */
const MIN_LENGTH = 500;
const TARGET_LENGTH = 1000;
const MAX_LENGTH = 4000;

const READ_SECTION_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_markdown_section',
    description: `读取指定章节或段落的内容。

参数优先级: block_id > node_id > heading
- block_id: 读取该段落所在的小节（自动调整长度，确保目标段落可见）
- node_id: 读取整个章节
- heading: 按标题匹配读取（支持包含匹配）`,
    parameters: {
      type: 'object',
      properties: {
        block_id: {
          type: 'string',
          description: '块引用 ID（如 ^ch2-p17）'
        },
        node_id: {
          type: 'string',
          description: '章节 ID（如 "0004"）'
        },
        heading: {
          type: 'string',
          description: '标题名称（包含匹配）'
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
    const blockId = args.block_id as string | undefined;
    const nodeId = args.node_id as string | undefined;
    const heading = args.heading as string | undefined;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!blockId && !nodeId && !heading) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: '必须提供 block_id、node_id 或 heading 参数'
      });
    }

    try {
      const cache = await getOrBuildLocalCache(context);
      const files = cache.chapterFiles || [];

      // 优先级 1: block_id - 智能段落读取
      if (blockId) {
        return await readByBlockId(app, cache, files, blockId, nodeId);
      }

      // 优先级 2: node_id - 整章读取
      if (nodeId) {
        return await readByNodeId(app, cache, files, nodeId);
      }

      // 优先级 3: heading - 整章读取
      if (heading) {
        return await readByHeading(app, cache, files, heading);
      }

      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: '必须提供 block_id、node_id 或 heading 参数'
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
 * 构建成功响应
 */
function buildSuccessResponse(
  targetFile: TFile,
  content: string,
  app: App,
  extra?: { block_id?: string; heading?: string }
): string {
  const fileCache = app.metadataCache.getFileCache(targetFile);
  const nodeId = normalizeNodeId(fileCache?.frontmatter?.node_id);

  return JSON.stringify({
    status: 'SUCCESS',
    node_id: nodeId,
    block_id: extra?.block_id || '',
    heading: extra?.heading || targetFile.basename,
    word_count: content.length,
    content
  });
}

/**
 * 按 block_id 智能读取
 *
 * 1. 定位段落
 * 2. 找所属 heading
 * 3. 读取 heading 内容
 * 4. 长度调整
 */
async function readByBlockId(
  app: App,
  cache: LocalToolCache,
  files: TFile[],
  blockId: string,
  nodeIdHint?: string
): Promise<string> {
  // 1. 查找文件（优先使用 node_id 提示）
  let targetFile: TFile | null = null;
  const blockIdIndex = cache.blockIdIndex;

  // 如果有 node_id 提示，先通过 node_id 定位文件
  if (nodeIdHint) {
    const normalizedId = normalizeNodeId(nodeIdHint);
    const filePath = cache.nodeIdIndex?.get(normalizedId);
    if (filePath) {
      targetFile = files.find(f => f.path === filePath) || null;
    }
  }

  // 降级：通过 block_id 索引或遍历查找
  if (!targetFile) {
    if (blockIdIndex?.has(blockId)) {
      const filePath = blockIdIndex.get(blockId)!;
      targetFile = files.find(f => f.path === filePath) || null;
    } else {
      for (const file of files) {
        const content = await app.vault.cachedRead(file);
        if (content.includes(blockId)) {
          targetFile = file;
          break;
        }
      }
    }
  }

  if (!targetFile) {
    return JSON.stringify({
      status: 'ERROR_NOT_FOUND',
      message: `未找到 block_id: ${blockId}`
    });
  }

  // 2. 读取文件内容
  const content = await app.vault.cachedRead(targetFile);
  const lines = content.split('\n');
  
  // 3. 找到 block_id 所在行
  let blockLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(blockId)) {
      blockLineIndex = i;
      break;
    }
  }

  if (blockLineIndex === -1) {
    return JSON.stringify({
      status: 'ERROR_NOT_FOUND',
      message: `在文件中未找到 block_id: ${blockId}`
    });
  }

  // 4. 找到 block_id 所属的 heading（最近的上一级标题）
  const headingInfo = findParentHeading(lines, blockLineIndex);
  
  // 5. 提取 heading 内容
  let headingContent: string;
  let headingStartLine: number;
  let headingEndLine: number;

  if (headingInfo) {
    // 找到 heading 的结束位置（下一个同级或更高级标题）
    headingStartLine = headingInfo.lineIndex;
    headingEndLine = findHeadingEnd(lines, headingStartLine, headingInfo.level);
    headingContent = lines.slice(headingStartLine, headingEndLine).join('\n');
  } else {
    // 没有 heading，使用整个文件
    headingStartLine = 0;
    headingEndLine = lines.length;
    headingContent = content;
  }

  // 6. 长度调整
  const finalContent = adjustContentLength(
    headingContent,
    lines,
    headingStartLine,
    headingEndLine,
    blockLineIndex
  );

  // 7. 返回结果
  return buildSuccessResponse(targetFile, finalContent, app, {
    block_id: blockId,
    heading: headingInfo?.text || targetFile.basename
  });
}

/**
 * 找到某行所属的 heading
 * 
 * 匹配所有级别的 Markdown 标题（# ~ ######）
 */
function findParentHeading(
  lines: string[],
  lineIndex: number
): { text: string; level: number; lineIndex: number } | null {
  for (let i = lineIndex - 1; i >= 0; i--) {
    // 修复：匹配所有级别标题 #{1,6}
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      return {
        text: match[2].trim(),
        level: match[1].length,
        lineIndex: i
      };
    }
  }
  return null;
}

/**
 * 找到 heading 的结束位置
 * 
 * 下一个更高级标题（level 更小）或同级标题的位置
 * 注意：同级标题也作为结束边界，因为每个 heading 应该是独立的
 */
function findHeadingEnd(
  lines: string[],
  headingLineIndex: number,
  headingLevel: number
): number {
  for (let i = headingLineIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    // 同级或更高级标题作为结束边界
    if (match && match[1].length <= headingLevel) {
      return i;
    }
  }
  return lines.length;
}

/**
 * 调整内容长度
 *
 * - < 500字 → 往后补到 1000字
 * - > 4000字 → 从 block_id 往前截取 4000字（保留 block_id 附近上下文）
 */
function adjustContentLength(
  headingContent: string,
  lines: string[],
  headingStartLine: number,
  headingEndLine: number,
  blockLineIndex: number
): string {
  const length = headingContent.length;

  // 情况 1: 长度合适，直接返回
  if (length >= MIN_LENGTH && length <= MAX_LENGTH) {
    return headingContent;
  }

  // 情况 2: 太短，往后补
  if (length < MIN_LENGTH) {
    let currentEnd = headingEndLine;
    let currentContent = headingContent;

    while (currentContent.length < TARGET_LENGTH && currentEnd < lines.length) {
      // 找下一个段落
      let nextParaEnd = currentEnd;
      while (nextParaEnd < lines.length && lines[nextParaEnd].trim() !== '') {
        nextParaEnd++;
      }
      // 包含空行
      while (nextParaEnd < lines.length && lines[nextParaEnd].trim() === '') {
        nextParaEnd++;
      }

      currentContent = lines.slice(headingStartLine, nextParaEnd).join('\n');
      currentEnd = nextParaEnd;

      if (nextParaEnd >= lines.length) break;
    }

    return currentContent;
  }

  // 情况 3: 太长，从 block_id 往前截取（保留 block_id 附近上下文）
  if (length > MAX_LENGTH) {
    // 计算 block_id 在 heading 中的字符偏移
    const blockRelativeLine = blockLineIndex - headingStartLine;
    let blockCharOffset = 0;
    for (let i = 0; i <= blockRelativeLine; i++) {
      blockCharOffset += lines[headingStartLine + i].length + 1;
    }

    // 从 block_id 位置往前取 MAX_LENGTH 字符
    const startIdx = Math.max(0, blockCharOffset - MAX_LENGTH);
    const truncated = headingContent.slice(startIdx, startIdx + MAX_LENGTH);

    // 如果截取位置不在开头，添加省略号提示
    if (startIdx > 0) {
      return '...' + truncated;
    }
    return truncated;
  }

  return headingContent;
}

/**
 * 按 node_id 读取整个章节
 */
async function readByNodeId(
  app: App,
  cache: LocalToolCache,
  files: TFile[],
  nodeId: string
): Promise<string> {
  const normalizedId = normalizeNodeId(nodeId);
  const nodeIdIndex = cache.nodeIdIndex;

  const filePath = nodeIdIndex?.get(normalizedId);
  const targetFile = filePath ? files.find(f => f.path === filePath) : null;

  if (!targetFile) {
    return JSON.stringify({
      status: 'ERROR_NOT_FOUND',
      message: `未找到 node_id: ${nodeId}`
    });
  }

  const content = await app.vault.cachedRead(targetFile);
  return buildSuccessResponse(targetFile, content, app);
}

/**
 * 按 heading 读取章节
 *
 * 优先使用 headingIndex 进行 O(1) 查找，失败时降级遍历（支持模糊匹配）
 */
async function readByHeading(
  app: App,
  cache: LocalToolCache,
  files: TFile[],
  heading: string
): Promise<string> {
  const headingIndex = cache.headingIndex;

  // 优先：精确匹配 headingIndex
  if (headingIndex?.has(heading)) {
    const filePath = headingIndex.get(heading)!;
    const targetFile = files.find(f => f.path === filePath);
    if (targetFile) {
      const content = await app.vault.cachedRead(targetFile);
      return buildSuccessResponse(targetFile, content, app);
    }
  }

  // 降级：遍历查找（支持模糊匹配）
  const normalizedQuery = normalizeHeading(heading);
  const candidates: string[] = [];
  let targetFile: TFile | null = null;

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

  if (!targetFile) {
    return JSON.stringify({
      status: 'ERROR_NOT_FOUND',
      message: `未找到标题: ${heading}`
    });
  }

  const content = await app.vault.cachedRead(targetFile);
  return buildSuccessResponse(targetFile, content, app);
}
