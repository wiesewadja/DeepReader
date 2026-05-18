/**
 * MinerU JSON → 真实 Document Tree 解析脚本
 *
 * 输入: /Users/lizhao/workspace/DeepReader/MinerU_69fe2a55b93bb0732b1fe33c_The-Founders-Playbook-05062026_v3 (1)__20260518054415.json
 * 输出: playground/output/tree.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const INPUT_JSON = '/Users/lizhao/workspace/DeepReader/MinerU_69fe2a55b93bb0732b1fe33c_The-Founders-Playbook-05062026_v3 (1)__20260518054415.json';
const OUTPUT_DIR = '/Users/lizhao/workspace/DeepReader/.claude/worktrees/worktree-mineru-parser/playground/output';
const OUTPUT_TREE = `${OUTPUT_DIR}/tree.json`;
const OUTPUT_PAGES = `${OUTPUT_DIR}/pages.json`;
const OUTPUT_MD = `${OUTPUT_DIR}/output.md`;

interface Span {
  type: 'text' | 'table';
  content?: string;
  html?: string;
  bbox: number[];
  score?: number;
}

interface Line {
  bbox: number[];
  spans: Span[];
}

interface Block {
  bbox: number[];
  type: string;
  angle: number;
  index: number;
  lines: Line[];
  merge_prev?: boolean;
  blocks?: Block[];
}

interface MineruPage {
  preproc_blocks: Block[];
  para_blocks: Block[];
  page_size: [number, number];
  page_idx: number;
}

interface MineruJson {
  pdf_info: MineruPage[];
}

interface TocItem {
  title: string;
  level: 1 | 2 | 3;
  pageNumber: number;
  children: TocItem[];
  text: string;
}

interface PageText {
  pageNumber: number;
  text: string;
}

function extractTextFromBlock(block: Block): string {
  if (!block.lines) return '';

  return block.lines
    .map(line =>
      line.spans
        .filter(s => s.type === 'text')
        .map(s => s.content || '')
        .join(' ')
    )
    .join('\n');
}

function extractTableHtml(block: Block): string | null {
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
  block: Block,
  pageHeight: number,
  text: string
): 1 | 2 | 3 {
  const y = block.bbox[1];

  // 页面顶部区域 → h1
  if (y < pageHeight * 0.15) {
    return 1;
  }

  // 页面上部区域 且文本较短 → h2
  if (y < pageHeight * 0.35 && text.length < 80) {
    return 2;
  }

  return 3;
}

function buildTocTree(titles: {
  title: string;
  level: 1 | 2 | 3;
  pageIdx: number;
}[]): TocItem[] {
  const root: TocItem[] = [];
  const stack: { level: number; item: TocItem }[] = [];

  for (const t of titles) {
    const item: TocItem = {
      title: t.title,
      level: t.level,
      pageNumber: t.pageIdx + 1,
      children: [],
      text: '',
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= t.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(item);
    } else {
      stack[stack.length - 1].item.children.push(item);
    }

    stack.push({ level: t.level, item });
  }

  return root;
}

function extractDocTitle(titles: { title: string; level: number }[]): string {
  const firstH1 = titles.find(t => t.level === 1);
  return firstH1?.title || 'Untitled';
}

function fillNodeText(nodes: TocItem[], pages: PageText[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextPage = nodes[i + 1]?.pageNumber || Infinity;

    const textParts: string[] = [];
    for (const page of pages) {
      if (page.pageNumber >= node.pageNumber && page.pageNumber < nextPage) {
        if (page.text.trim()) {
          textParts.push(page.text);
        }
      }
    }
    node.text = textParts.join('\n\n');

    if (node.children.length > 0) {
      fillNodeText(node.children, pages);
    }
  }
}

function tocToMarkdown(nodes: TocItem[], depth: number = 0): string {
  let md = '';

  for (const node of nodes) {
    const prefix = '#'.repeat(node.level);
    md += `${prefix} ${node.title}\n\n`;
    md += node.text + '\n\n';

    if (node.children.length > 0) {
      md += tocToMarkdown(node.children, depth + 1);
    }
  }

  return md;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('📖 读取 MinerU JSON 文件...');
  const raw = readFileSync(INPUT_JSON, 'utf-8');
  const json: MineruJson = JSON.parse(raw);

  console.log(`📊 检测到 ${json.pdf_info.length} 页\n`);

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

    pages.push({
      pageNumber: page.page_idx + 1,
      text: pageTextParts.join('\n\n'),
    });
  }

  const outline = buildTocTree(allTitles);
  fillNodeText(outline, pages);

  const docTitle = extractDocTitle(allTitles);

  const result = {
    title: docTitle,
    totalPages: pages.length,
    totalTitles: allTitles.length,
    outline,
  };

  console.log('📝 文档结构:');
  console.log(`   标题: ${docTitle}`);
  console.log(`   总页数: ${pages.length}`);
  console.log(`   标题数: ${allTitles.length}`);
  console.log(`   一级章节: ${outline.filter(n => n.level === 1).length}`);
  console.log(`   二级章节: ${outline.filter(n => n.level === 2).length}`);
  console.log(`   三级章节: ${outline.filter(n => n.level === 3).length}`);

  console.log('\n📑 树结构预览:');
  console.log('─'.repeat(50));

  function printTree(nodes: TocItem[], depth: number = 0) {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      const icon = node.level === 1 ? '📖' : node.level === 2 ? '📌' : '•';
      const preview = node.text.slice(0, 40).replace(/\n/g, ' ') + (node.text.length > 40 ? '...' : '');
      console.log(`${indent}${icon} [p.${node.pageNumber}] ${node.title}`);
      if (node.children.length > 0) {
        printTree(node.children, depth + 1);
      }
    }
  }
  printTree(outline);

  console.log('\n💾 写入文件...');
  writeFileSync(OUTPUT_TREE, JSON.stringify(result, null, 2), 'utf-8');
  writeFileSync(OUTPUT_PAGES, JSON.stringify(pages, null, 2), 'utf-8');

  const fullMd = `# ${docTitle}\n\n` + tocToMarkdown(outline);
  writeFileSync(OUTPUT_MD, fullMd, 'utf-8');

  console.log(`✅ tree.json     → ${OUTPUT_TREE}`);
  console.log(`✅ pages.json    → ${OUTPUT_PAGES}`);
  console.log(`✅ output.md     → ${OUTPUT_MD}`);
}

main().catch(console.error);
