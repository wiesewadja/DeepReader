/**
 * MinerU JSON Parser
 *
 * 解析 MinerU 精准 API 返回的 JSON 文件，构建文档结构树
 */

import { NodeHtmlMarkdown } from 'node-html-markdown';
import { countTokens } from '../core/utils';
import type { TreeNode } from '../core/types';

// ════════════════════════════════════════════════════════════════
// MinerU JSON 类型定义
// ════════════════════════════════════════════════════════════════

export interface MineruSpan {
  type: 'text' | 'table';
  content?: string;
  html?: string;
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
}

export interface PageText {
  pageNumber: number;
  text: string;
  tokenCount: number;
}

// ════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════

function extractTextFromBlock(block: MineruBlock): string {
  if (!block.lines) return '';

  const parts: string[] = [];
  for (const line of block.lines) {
    for (const span of line.spans) {
      if (span.type === 'text' && span.content) {
        parts.push(span.content);
      }
    }
  }

  return parts.join(' ');
}

function extractTableHtml(block: MineruBlock): string | null {
  if (!block.blocks) return null;

  for (const nested of block.blocks) {
    if (nested.lines) {
      for (const span of nested.lines[0]?.spans || []) {
        if (span.type === 'table' && span.html) {
          return span.html;
        }
      }
    }
  }
  return null;
}

async function htmlToMarkdown(html: string): Promise<string> {
  try {
    return await NodeHtmlMarkdown.translate(html, {
      bulletMarker: '•',
      codeBlockStyle: 'fenced',
    });
  } catch {
    return html;
  }
}

function estimateHeadingLevel(
  block: MineruBlock,
  pageHeight: number,
  text: string
): 1 | 2 | 3 {
  const y = block.bbox[1];

  if (y < pageHeight * 0.15) {
    return 1;
  }

  if (y < pageHeight * 0.35 && text.length < 80) {
    return 2;
  }

  return 3;
}

function buildTocTree(titles: {
  title: string;
  level: 1 | 2 | 3;
  pageIdx: number;
}[]): TreeNode[] {
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

function fillNodeText(
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

function extractDocTitle(titles: { title: string; level: number }[]): string {
  const firstH1 = titles.find(t => t.level === 1);
  return firstH1?.title || 'Untitled';
}

// ════════════════════════════════════════════════════════════════
// 主解析函数
// ════════════════════════════════════════════════════════════════

/**
 * 解析 MinerU JSON 文件，构建文档结构
 */
export async function parseMineruJson(json: MineruJson): Promise<MineruPdfResult> {
  const pages: PageText[] = [];
  const allTitles: {
    title: string;
    level: 1 | 2 | 3;
    pageIdx: number;
  }[] = [];

  for (const page of json.pdf_info) {
    const pageHeight = page.page_size[1];
    const pageTextParts: string[] = [];

    for (const block of page.para_blocks) {
      if (block.type === 'title') {
        const text = extractTextFromBlock(block);
        const level = estimateHeadingLevel(block, pageHeight, text);
        if (text.trim()) {
          allTitles.push({
            title: text.trim(),
            level,
            pageIdx: page.page_idx,
          });
        }
      }

      if (block.type === 'text' || block.type === 'title') {
        const text = extractTextFromBlock(block);
        if (text.trim()) {
          pageTextParts.push(text.trim());
        }
      } else if (block.type === 'table') {
        const html = extractTableHtml(block);
        if (html) {
          const md = await htmlToMarkdown(html);
          pageTextParts.push(md);
        }
      }
    }

    const pageText = pageTextParts.join('\n\n');
    pages.push({
      pageNumber: page.page_idx + 1,
      text: pageText,
      tokenCount: countTokens(pageText),
    });
  }

  const outline = buildTocTree(allTitles);

  fillNodeText(
    outline,
    pages,
    (index: number) => {
      const nextNode = outline[index];
      return nextNode?.startIndex ?? Infinity;
    }
  );

  const title = extractDocTitle(allTitles);

  return {
    title,
    totalPages: pages.length,
    pages,
    outline,
  };
}
