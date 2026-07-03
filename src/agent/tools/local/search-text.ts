/**
 * search_book Tool - Multi-query parallel + RRF fusion search
 *
 * Retrieval strategy: each keyword is searched independently via searchBookV2,
 * then results are merged using Reciprocal Rank Fusion (RRF).
 * This avoids vector embedding dilution when multiple keywords are combined.
 */

import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions, toRerankerOptions } from '../../../config/role-adapters.js';
import type { BookSearchResultV2 } from '../../../pageindex/book-types.js';
import { parseCallouts } from '../../../utils/callout-parser.js';
import { bookExcerptDir } from '../../../utils/book-paths.js';
import { toolsLog } from '../../../utils/logger.js';
import { Notice } from 'obsidian';
import { sanitizeFileName } from '../../../weread/utils/helpers.js';
import type { ToolExecutor, ToolContext } from '../types.js';

// === RRF (Reciprocal Rank Fusion) ===

interface FusionEntry {
  nodeId: string;
  fileName: string;
  title: string;
  hierarchyPath: string[];
  blockId: string;
  content: string;
  rrfScore: number;
  sourceCount: number; // 出现在几个子查询中
}

/**
 * Reciprocal Rank Fusion: 合并多个检索结果列表。
 * 每个结果按其在各列表中的倒数排名累加得分。
 */
function reciprocalRankFusion(
  subResults: BookSearchResultV2[][],
  k: number = 60,
): FusionEntry[] {
  const scoreMap = new Map<string, FusionEntry>();

  for (const results of subResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const rrfScore = 1 / (k + rank + 1);

      for (const block of r.matchedBlocks) {
        const cleanBlockId = block.blockId.replace(/^\^/, '');
        const key = `${r.nodeId}:${cleanBlockId}`;

        if (scoreMap.has(key)) {
          const entry = scoreMap.get(key)!;
          entry.rrfScore += rrfScore;
          entry.sourceCount += 1;
        } else {
          scoreMap.set(key, {
            nodeId: r.nodeId,
            fileName: r.fileName,
            title: r.title,
            hierarchyPath: r.hierarchyPath,
            blockId: cleanBlockId,
            content: block.content,
            rrfScore,
            sourceCount: 1,
          });
        }
      }
    }
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * 将 RRF 融合后的结果按 nodeId 分组为 hit 格式
 */
function fusionToHits(
  entries: FusionEntry[],
  topK: number,
): Array<{
  node_id: string;
  title: string;
  file_name: string;
  path: string[];
  matched_blocks: Array<{ block_id: string; file_name: string; content: string }>;
  score: number;
  source_count: number;
}> {
  const nodeMap = new Map<string, {
    node_id: string;
    title: string;
    file_name: string;
    path: string[];
    blocks: FusionEntry[];
    maxScore: number;
    maxSourceCount: number;
  }>();

  for (const entry of entries) {
    if (!nodeMap.has(entry.nodeId)) {
      nodeMap.set(entry.nodeId, {
        node_id: entry.nodeId,
        title: entry.title,
        file_name: entry.fileName,
        path: entry.hierarchyPath,
        blocks: [],
        maxScore: 0,
        maxSourceCount: 0,
      });
    }
    const node = nodeMap.get(entry.nodeId)!;
    node.blocks.push(entry);
    if (entry.rrfScore > node.maxScore) {
      node.maxScore = entry.rrfScore;
    }
    if (entry.sourceCount > node.maxSourceCount) {
      node.maxSourceCount = entry.sourceCount;
    }
  }

  const sortedNodes = Array.from(nodeMap.values())
    .sort((a, b) => b.maxScore - a.maxScore)
    .slice(0, topK);

  return sortedNodes.map(node => ({
    node_id: node.node_id,
    title: node.title,
    file_name: node.file_name,
    path: node.path,
    matched_blocks: node.blocks.slice(0, 3).map(b => ({
      block_id: b.blockId,
      file_name: node.file_name,
      content: b.content,
    })),
    score: Math.round(node.maxScore * 10000) / 100,
    source_count: node.maxSourceCount,
  }));
}

export const searchBookTool: ToolExecutor = {

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { vault, book } = context;
    const { app } = vault;
    const { pdfName, indexId } = book;
    const keywords = args.keywords as string[];
    const scopeNodeIds = args.scope_node_ids as string[] | undefined;
    const topK = (args.top_k as number) || 10;

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

    if (!pdfName) {
      return JSON.stringify({
        status: 'ERROR_NO_BOOK_SELECTED',
        message: '未选择书籍，请先在书库中选择一本书'
      });
    }

    try {
      const { resolveBookIdFromPdf } = require('../../../pageindex/book-resolver.js');
      const { searchBookV2 } = require('../../../pageindex/book-search-v2.js');
      toolsLog.log('[search_book] indexId:', indexId, 'keywords:', keywords, 'scope:', scopeNodeIds?.length ?? 0);

      const settings = context.vault.plugin?.settings;
      const embeddingRole = settings ? resolveRoleConfig('embedding', settings) : null;
      const rerankerRole = settings ? resolveRoleConfig('reranker', settings) : null;
      const rerankerWeight = settings?.rerankerWeight ?? 0.7;

      const baseOptions: any = {
        topK: 20, // 每个子查询多取，供 RRF 挑选
        embedding: embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined,
        reranker: rerankerRole ? toRerankerOptions(rerankerRole, rerankerWeight) : undefined,
        scopeNodeIds,
        app,
      };

      if (context.queryVector) {
        baseOptions.precomputedEmbedding = context.queryVector;
      }

      if (indexId) {
        baseOptions.bookId = indexId;
      } else {
        const bookId = await resolveBookIdFromPdf(app, pdfName);
        if (!bookId) {
          return JSON.stringify({
            status: 'ERROR_BOOK_NOT_FOUND',
            message: `未找到书籍文件: ${pdfName}`
          });
        }
        baseOptions.bookId = bookId;
      }

      // 多查询并行检索：每个关键词独立搜索
      let indexMissing = false; // 索引未同步（移动端常见）标志，命中则 Notice 提示
      const subResults: BookSearchResultV2[][] = await Promise.all(
        keywords.map(async (kw) => {
          try {
            return await searchBookV2({ ...baseOptions, query: kw });
          } catch (error) {
            const msg = error instanceof Error ? error.message : '';
            if (/索引|index/i.test(msg)) indexMissing = true;
            return [];
          }
        })
      );

      // RRF 融合
      let fusedEntries = reciprocalRankFusion(subResults);

      // ── 标注检索 ──────────────────────────────
      try {
        const annotationEntries = await searchAnnotations(keywords, context, fusedEntries);
        if (annotationEntries.length > 0) {
          fusedEntries = fusedEntries.concat(annotationEntries);
          fusedEntries.sort((a, b) => b.rrfScore - a.rrfScore);
        }
      } catch {
        // 标注检索失败不影响主搜索
      }

      // 当前章节提权：用户正在阅读的章节搜索结果加权 1.5x
      const currentNodeId = context.book.currentNodeId;
      if (currentNodeId) {
        for (const entry of fusedEntries) {
          if (entry.nodeId === currentNodeId) {
            entry.rrfScore *= 1.5;
          }
        }
        fusedEntries = fusedEntries.sort((a, b) => b.rrfScore - a.rrfScore);
      }

      const hits = fusionToHits(fusedEntries, topK);

      // 索引未同步（移动端对未从 PC 同步索引的书对话）：Notice 提示，Agent 仍基于通用知识继续
      if (indexMissing && hits.length === 0) {
        try {
          new Notice(`《${pdfName}》索引未同步，请在桌面端建立。本次基于通用知识回答。`, 6000);
        } catch { /* Notice 不可用时忽略 */ }
      }

      return JSON.stringify({
        status: 'SUCCESS',
        total_hits: hits.length,
        hits,
        query_strategy: keywords.length > 1
          ? `多查询并行 RRF 融合 (${keywords.length} 个关键词)`
          : '单关键词检索',
        scope_filter: scopeNodeIds ? `已限定在 ${scopeNodeIds.length} 个章节` : '全局搜索'
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        status: 'ERROR_SEARCH_FAILED',
        message: `搜索失败: ${errorMsg}`
      });
    }
  }
};

// === 标注检索 ===

/**
 * 从书籍摘录目录中检索用户标注（DeepReader 原生 + 微信读书），
 * 匹配关键词后生成 FusionEntry，应用 1.3x 提权。
 */
async function searchAnnotations(
  keywords: string[],
  context: ToolContext,
  existingEntries: FusionEntry[],
): Promise<FusionEntry[]> {
  const { app } = context.vault;
  const { pdfName } = context.book;
  if (!app || !pdfName) return [];

  const bookName = pdfName.replace(/\.(pdf|epub)$/i, '');
  if (!bookName) return [];

  // 两种 sanitize 方式生成可能的摘录目录
  const sanitizeA = bookName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.(pdf|epub|txt)$/i, '')
    .trim()
    .substring(0, 100);
  const sanitizeB = sanitizeFileName(bookName);
  const possibleDirs = [...new Set([bookExcerptDir(sanitizeA), bookExcerptDir(sanitizeB)])];

  // 查找摘录目录下的 .md 文件
  const mdFiles = app.vault.getFiles().filter(f =>
    f.extension === 'md' && possibleDirs.some(dir => f.path.startsWith(dir + '/'))
  );
  if (mdFiles.length === 0) return [];

  // 读取并解析 callout
  const allCallouts: { text: string; filePath: string }[] = [];
  for (const file of mdFiles) {
    try {
      const content = await app.vault.cachedRead(file);
      const callouts = parseCallouts(content);
      for (const text of callouts) {
        allCallouts.push({ text, filePath: file.path });
      }
    } catch { /* skip unreadable files */ }
  }
  if (allCallouts.length === 0) return [];

  // 关键词匹配（任一 keyword 命中即保留）
  const lowerKeywords = keywords.map(k => k.toLowerCase());
  const matched = allCallouts.filter(c =>
    lowerKeywords.some(kw => c.text.toLowerCase().includes(kw))
  );
  if (matched.length === 0) return [];

  // 计算分数：基于现有最高分的 1.3x
  const topScore = existingEntries.length > 0 ? existingEntries[0].rrfScore : 0.02;
  const annotationScore = topScore * 1.3;

  return matched.map((c, i) => ({
    nodeId: c.filePath,
    fileName: c.filePath.split('/').pop() || '',
    title: '[用户标注]',
    hierarchyPath: ['标注'],
    blockId: `annotation-${i}`,
    content: `[用户标注] ${c.text}`,
    rrfScore: annotationScore,
    sourceCount: 1,
  }));
}
