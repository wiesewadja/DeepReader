/**
 * MinerU JSON Parser
 *
 * 解析 MinerU 精准 API 返回的 JSON 文件，构建文档结构树
 */

import { NodeHtmlMarkdown } from 'node-html-markdown';
import {
  countTokens,
  buildTocTree,
  fillNodeText,
  extractImageExt,
  type MineruBlock,
  type MineruImage,
  type MineruJson,
  type MineruPdfResult,
  type PageText,
} from './mineru-types';

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
      for (const line of nested.lines) {
        for (const span of line.spans) {
          if (span.type === 'table' && span.html) {
            return span.html;
          }
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

/** 根据 Y 坐标位置和 bbox 高度差估算标题级别 */
function estimateHeadingLevel(
  block: MineruBlock,
  pageHeight: number,
  text: string
): 1 | 2 | 3 {
  const y = block.bbox[1];
  const blockHeight = block.bbox[3] - block.bbox[1];

  // 页面上方 15% → h1
  if (y < pageHeight * 0.15) return 1;

  // 页面 15%-35% 且文字较短 → h2
  if (y < pageHeight * 0.35 && text.length < 80) return 2;

  // 辅助：bbox 高度差较大（大字号）→ 提升级别
  const avgLineHeight = pageHeight / 50;
  if (blockHeight > avgLineHeight * 2.5) return 1;
  if (blockHeight > avgLineHeight * 1.5) return 2;

  return 3;
}

function extractDocTitle(titles: { title: string; level: number }[]): string {
  const firstH1 = titles.find(t => t.level === 1);
  return firstH1?.title || 'Untitled';
}

/** 从 image block 提取图片信息（去重、生成文件名） */
function extractImageFromBlock(
  block: MineruBlock,
  pageIdx: number,
  seqInPage: number,
  seenUrls: Set<string>,
): MineruImage | null {
  if (!block.lines) return null;

  for (const line of block.lines) {
    for (const span of line.spans) {
      if (span.type === 'image' && span.image_path) {
        const url = span.image_path;
        if (seenUrls.has(url)) return null;
        seenUrls.add(url);

        const ext = extractImageExt(url);
        const fileName = `p${pageIdx + 1}-${seqInPage}${ext}`;

        return {
          url,
          fileName,
          caption: span.content || undefined,
        };
      }
    }
  }
  return null;
}

function extractImageUrlFromBlock(block: MineruBlock): string | null {
  if (!block.lines) return null;
  for (const line of block.lines) {
    for (const span of line.spans) {
      if (span.type === 'image' && span.image_path) return span.image_path;
    }
  }
  return null;
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
  const images: MineruImage[] = [];
  const seenUrls = new Set<string>();

  for (const page of json.pdf_info) {
    const pageHeight = page.page_size[1];
    const pageTextParts: string[] = [];
    let imageSeqInPage = 0;

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
      } else if (block.type === 'image') {
        imageSeqInPage++;
        const img = extractImageFromBlock(block, page.page_idx, imageSeqInPage, seenUrls);
        if (img) {
          images.push(img);
          pageTextParts.push(`![[images/${img.fileName}]]`);
        } else {
          // Duplicate URL: still insert wiki reference using cached filename
          const url = extractImageUrlFromBlock(block);
          const existing = url ? images.find(i => i.url === url) : undefined;
          if (existing) {
            pageTextParts.push(`![[images/${existing.fileName}]]`);
          }
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
    images,
  };
}

// Re-export types for backward compatibility
export type { MineruJson, MineruPdfResult, MineruImage, PageText, MineruBlock, MineruSpan, MineruLine, MineruPage } from './mineru-types';
