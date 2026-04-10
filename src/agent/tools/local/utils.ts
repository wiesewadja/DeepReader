/**
 * 本地工具共享函数 (v2)
 *
 * v2: 从 .pageindex/{bookId}/tree.json 加载缓存
 * 不再扫描 frontmatter
 */

import type { App } from 'obsidian';
import type { LocalToolCache } from './types.js';
import type { ToolContext } from '../types.js';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Token 上限常量
 */
export const MAX_TOKENS = 8000;

/**
 * 获取或构建本地工具缓存
 */
export async function getOrBuildLocalCache(
  context: ToolContext
): Promise<LocalToolCache> {
  const { localCache } = context;

  // 如果已有 treeData 缓存，直接返回
  if (localCache?.treeData) {
    return localCache;
  }

  // 构建新缓存
  const cache = await buildLocalCache(context);
  context.localCache = cache;
  return cache;
}

/**
 * 构建 local cache from tree.json
 */
async function buildLocalCache(context: ToolContext): Promise<LocalToolCache> {
  const { app, pdfName, indexId } = context;
  if (!app || !pdfName) {
    console.log('[buildLocalCache] Missing app or pdfName');
    return {};
  }

  try {
    const vaultPath = (app.vault.adapter as any).basePath;

    // 优先使用 indexId（即 bookId），避免重新计算路径导致的 bookId 不匹配
    let bookId = indexId;

    if (!bookId) {
      // Fallback: 从 vault 文件路径计算 bookId
      const bookName = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
      const files = app.vault.getFiles();
      const bookFile = files.find(f =>
        f.path.includes(bookName) && (f.extension === 'pdf' || f.extension === 'epub')
      );

      if (!bookFile) {
        console.log('[buildLocalCache] Book file not found for:', bookName);
        return {};
      }

      const filePath = `${vaultPath}/${bookFile.path}`;
      bookId = crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
    }

    console.log('[buildLocalCache] bookId:', bookId, 'pdfName:', pdfName, 'indexId:', indexId);

    // Load tree.json from .pageindex（使用 vault 相对路径，adapter.read 会自动拼接 vault root）
    const treePath = `.pageindex/${bookId}/tree.json`;
    const treeContent = await (app.vault as any).adapter.read(treePath);
    const treeData = JSON.parse(treeContent);

    console.log('[buildLocalCache] Loaded tree.json, structure length:', treeData.structure?.length);

    // Build nodeTitleMap
    const nodeTitleMap = new Map<string, string>();
    buildNodeTitleMap(treeData.structure || [], nodeTitleMap);

    return { treeData, nodeTitleMap };
  } catch (err) {
    console.error('[buildLocalCache] Error:', err);
    return {};
  }
}

function buildNodeTitleMap(nodes: any[], map: Map<string, string>): void {
  for (const node of nodes) {
    if (node.nodeId && node.title) {
      map.set(node.nodeId, node.title);
    }
    if (node.nodes) {
      buildNodeTitleMap(node.nodes, map);
    }
  }
}

/**
 * 估算 Token 数量
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(chineseChars / 2) + englishWords;
}

/**
 * 规范化标题
 */
export function normalizeHeading(heading: string): string {
  return heading
    .replace(/[#\s]/g, '')
    .replace(/[：:]/g, ':')
    .replace(/[，,]/g, ',')
    .toLowerCase();
}
