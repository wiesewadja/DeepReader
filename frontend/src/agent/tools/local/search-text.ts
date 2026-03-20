/**
 * search_markdown_text Tool - 带空间感知的文本搜索
 *
 * 对标增强版 Linux grep，用于检视阅读阶段定位关键词位置
 * 支持 scopeNodeIds 过滤，只在指定章节范围内搜索
 *
 * 设计原则：
 * - 底层保持极速、愚蠢、透明（纯文本匹配）
 * - 智能逻辑由上层 LLM 承担（分词、同义词、容错）
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { SearchHit } from './types.js';
import { getOrBuildLocalCache, normalizeNodeId, MAX_SEARCH_HITS } from './utils.js';

const SEARCH_TEXT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_markdown_text',
    description: `在书中搜索关键词，返回匹配的段落位置。

返回结果包含 block_id，可传递给 read_markdown_section 读取完整内容。
如命中超过 10 处会报错，请使用更精准的关键词。`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组，AND 逻辑（所有词必须同时出现在同一段落）'
        },
        scope_node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '限定搜索范围（章节 ID 列表），留空则全局搜索'
        },
        use_regex: {
          type: 'boolean',
          description: '启用正则表达式匹配（默认 false）'
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
      // P1: 使用缓存复用，避免重复构建索引
      const cache = await getOrBuildLocalCache(context);
      const files = cache.chapterFiles || [];
      const hits: SearchHit[] = [];

      // 构建 scope 过滤集合（规范化：去除前导零）
      const scopeSet = scopeNodeIds && scopeNodeIds.length > 0
        ? new Set(scopeNodeIds.map(normalizeNodeId))
        : null;

      // P0: Scope 边界检查
      // 如果指定了 scope，检查是否有文件在范围内
      if (scopeSet && scopeSet.size > 0) {
        const filesInScope = files.filter(file => {
          const fileCache = app.metadataCache.getFileCache(file);
          const rawNodeId = fileCache?.frontmatter?.node_id;
          const nodeId = normalizeNodeId(rawNodeId);
          return scopeSet.has(nodeId);
        });

        if (filesInScope.length === 0) {
          // 检查是否有文件缺少 node_id
          const filesWithoutNodeId = files.filter(file => {
            const fileCache = app.metadataCache.getFileCache(file);
            return !fileCache?.frontmatter?.node_id;
          });

          if (filesWithoutNodeId.length > 0) {
            return JSON.stringify({
              status: 'ERROR_SCOPE_MISMATCH',
              message: `指定的 ${scopeSet.size} 个章节 ID 在当前书籍中未找到匹配的文件`,
              hint: '可能原因：1) 章节尚未导出为 Markdown 2) node_id 不匹配 3) 尝试移除 scope 限制进行全局搜索',
              requested_scope: Array.from(scopeSet),
              available_files: files.length,
              files_without_node_id: filesWithoutNodeId.length
            });
          }

          return JSON.stringify({
            status: 'ERROR_SCOPE_MISMATCH',
            message: `指定的 ${scopeSet.size} 个章节 ID 在当前书籍中未找到`,
            hint: '请检查 scope_node_ids 是否正确，或移除 scope 限制进行全局搜索',
            requested_scope: Array.from(scopeSet),
            available_files: files.length
          });
        }
      }

      for (const file of files) {
        const fileCache = app.metadataCache.getFileCache(file);
        const rawNodeId = fileCache?.frontmatter?.node_id;
        const nodeId = normalizeNodeId(rawNodeId);

        // Scope 过滤：如果设置了 scope，只搜索范围内的文件
        if (scopeSet && !scopeSet.has(nodeId)) {
          continue;
        }

        const content = await app.vault.cachedRead(file);
        const paragraphs = content.split(/\n\n+/);
        const section = (fileCache?.frontmatter?.section as string) || '';

        for (const para of paragraphs) {

          if (matchParagraph(para, keywords, useRegex)) {
            const blockId = extractBlockId(para);

            hits.push({
              node_id: nodeId,
              location: {
                heading: section.split('>').pop()?.trim() || file.basename,
                path: section.split('>').map(s => s.trim()).filter(Boolean),
                file_path: file.path
              },
              // Snippet 以关键词为中心，让用户看到匹配位置
              snippet: extractSnippet(para, keywords, 150),
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
 *
 * 保持简单：纯文本 indexOf 或正则 test
 * 智能逻辑（分词、同义词、容错）由上层 LLM 承担
 *
 * 注意：无论是否使用正则，都保持 AND 逻辑一致性
 */
function matchParagraph(para: string, keywords: string[], useRegex: boolean): boolean {
  if (useRegex) {
    // 正则模式：所有关键词都必须匹配（AND 逻辑）
    return keywords.every(kw => {
      try {
        return new RegExp(kw).test(para);
      } catch {
        return false;  // 无效正则视为不匹配
      }
    });
  }
  // 默认模式：所有关键词必须同时出现（AND 逻辑）
  return keywords.every(kw => para.includes(kw));
}

/**
 * 提取段落中的 block_id（带 ^ 前缀）
 * 
 * 一个段落只有一个 block_id，位于段落末尾
 */
function extractBlockId(para: string): string {
  const match = para.match(/\^[\w-]+/);
  return match ? match[0] : '';
}

/**
 * 以关键词为中心提取 Snippet
 *
 * 让用户看到匹配位置，而不是固定从开头截取
 *
 * @param para - 段落内容
 * @param keywords - 关键词列表
 * @param maxLen - 最大长度
 * @returns 以关键词为中心的摘要
 */
function extractSnippet(para: string, keywords: string[], maxLen: number = 150): string {
  // 找到所有匹配关键词的位置，取中位数作为中心
  const positions: number[] = [];
  for (const kw of keywords) {
    const idx = para.indexOf(kw);
    if (idx !== -1) {
      positions.push(idx);
    }
  }

  // 如果没有找到任何关键词，从开头截取
  const centerIdx = positions.length > 0
    ? positions.sort((a, b) => a - b)[Math.floor(positions.length / 2)]
    : 0;

  // 如果段落很短，直接返回
  if (para.length <= maxLen) {
    return para;
  }

  // 以关键词为中心，前后各取一部分
  const halfLen = Math.floor(maxLen / 2);
  let start = Math.max(0, centerIdx - halfLen);
  let end = Math.min(para.length, centerIdx + halfLen);

  // 尝试向句边界扩展（中文句号、问号、感叹号、分号）
  start = expandToSentenceBoundary(para, start, 'backward');
  end = expandToSentenceBoundary(para, end, 'forward');

  let snippet = para.slice(start, end).trim();

  // 添加省略号
  if (start > 0) snippet = '...' + snippet;
  if (end < para.length) snippet = snippet + '...';

  return snippet;
}

/**
 * 中文句子分隔符
 */
const SENTENCE_DELIMITERS = ['。', '？', '！', '；', '……'];

/**
 * 向句边界扩展
 *
 * @param para - 段落内容
 * @param pos - 当前位置
 * @param direction - 方向：'backward' 向前找分隔符，'forward' 向后找分隔符
 * @returns 调整后的位置
 */
function expandToSentenceBoundary(para: string, pos: number, direction: 'backward' | 'forward'): number {
  const maxOffset = 30; // 最多向句边界扩展 30 字符
  let bestPos = pos;

  for (const delim of SENTENCE_DELIMITERS) {
    if (direction === 'backward') {
      // 向前找最近的分隔符（尽量往右靠）
      const idx = para.lastIndexOf(delim, pos);
      if (idx !== -1 && idx > pos - maxOffset && idx + 1 > bestPos) {
        bestPos = idx + 1;
      }
    } else {
      // 向后找最近的分隔符（尽量往左靠）
      const idx = para.indexOf(delim, pos);
      // 修复：找最近的分隔符，条件应该是 idx + 1 < bestPos（初始值是 pos）
      if (idx !== -1 && idx < pos + maxOffset && (bestPos === pos || idx + 1 < bestPos)) {
        bestPos = idx + 1;
      }
    }
  }

  return bestPos;
}

/**
 * 生成搜索建议
 * 
 * 保持简单，让 LLM 自己处理同义词和分词
 */
function generateSuggestions(_keywords: string[]): string[] {
  // 不在底层实现复杂的近似词算法
  // 让上层 LLM 根据上下文自己调整搜索词
  return [];
}
