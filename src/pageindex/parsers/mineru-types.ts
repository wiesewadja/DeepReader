/**
 * MinerU 共享类型和工具函数
 *
 * 供 mineru-api.ts 和 mineru.ts 共同使用，避免循环依赖
 */

import type { TreeNode } from '../core/types';
import { countTokens } from '../core/utils';

// ════════════════════════════════════════════════════════════════
// MinerU JSON 类型定义
// ════════════════════════════════════════════════════════════════

export interface MineruSpan {
  type: 'text' | 'table' | 'image';
  content?: string;
  html?: string;
  image_path?: string;
  bbox: number[];
  score?: number;
}

export interface MineruLine {
  bbox: number[];
  spans: MineruSpan[];
}

export interface MineruBlock {
  bbox: number[];
  type: string;
  angle: number;
  index: number;
  lines: MineruLine[];
  merge_prev?: boolean;
  blocks?: MineruBlock[];
}

export interface MineruPage {
  preproc_blocks: MineruBlock[];
  para_blocks: MineruBlock[];
  page_size: [number, number];
  page_idx: number;
}

export interface MineruJson {
  pdf_info: MineruPage[];
}

// ════════════════════════════════════════════════════════════════
// 解析结果类型
// ════════════════════════════════════════════════════════════════

export interface MineruPdfResult {
  title: string;
  totalPages: number;
  pages: PageText[];
  outline: TreeNode[];
  images: MineruImage[];
}

export interface MineruImage {
  url: string;
  fileName: string;
  caption?: string;
}

export interface PageText {
  pageNumber: number;
  text: string;
  tokenCount: number;
}

// ════════════════════════════════════════════════════════════════
// 共享工具函数
// ════════════════════════════════════════════════════════════════

/** 从 URL 中提取图片扩展名，默认 .jpg */
export function extractImageExt(url: string): string {
  const match = url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}

export { countTokens };

/** 构建 TOC 树 */
export function buildTocTree(
  titles: { title: string; level: 1 | 2 | 3; pageIdx: number }[]
): TreeNode[] {
  const root: TreeNode[] = [];
  const stack: { level: number; node: TreeNode }[] = [];

  for (const t of titles) {
    const node: TreeNode = {
      title: t.title,
      startIndex: t.pageIdx + 1,
      nodes: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= t.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      parent.nodes = parent.nodes || [];
      parent.nodes.push(node);
    }

    stack.push({ level: t.level, node });
  }

  return root;
}

/** 为 TOC 节点填充文本内容 */
export function fillNodeText(
  nodes: TreeNode[],
  pages: PageText[],
  getNextPage: (index: number) => number
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextPage = i + 1 < nodes.length
      ? getNextPage(i + 1)
      : Infinity;

    const textParts: string[] = [];
    for (const page of pages) {
      if (page.pageNumber >= node.startIndex! && page.pageNumber < nextPage) {
        if (page.text.trim()) {
          textParts.push(page.text);
        }
      }
    }
    node.text = textParts.join('\n\n');

    if (node.nodes && node.nodes.length > 0) {
      fillNodeText(node.nodes, pages, getNextPage);
    }
  }
}
