/**
 * MinerU JSON → Document Tree 解析器 (Playground)
 *
 * 数据来源: MinerU_69fe2a55b93bb0732b1fe33c_The-Founders-Playbook-05062026_v3 (1)__20260518054415.json
 * 36页 PDF, MinerU 精准 API JSON 输出
 */

import { NodeHtmlMarkdown } from 'node-html-markdown';

// ════════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════════

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
}

interface TableBlock extends Block {
  type: 'table';
  blocks: Block[]; // nested table_body
}

interface MineruPage {
  preproc_blocks: Block[];
  para_blocks: Block[];
  page_size: [number, number]; // [width, height]
  page_idx: number;
}

interface MineruJson {
  pdf_info: MineruPage[];
}

// ════════════════════════════════════════════════════════════════
// 2. 工具函数
// ════════════════════════════════════════════════════════════════

function extractTextFromLines(lines: Line[]): string {
  return lines
    .map(line =>
      line.spans
        .filter(s => s.type === 'text')
        .map(s => s.content || '')
        .join(' ')
    )
    .join('\n');
}

function extractTableHtml(lines: Line[]): string | null {
  for (const span of lines[0]?.spans || []) {
    if (span.type === 'table' && span.html) {
      return span.html;
    }
  }
  return null;
}

async function htmlToMarkdown(html: string): Promise<string> {
  return NodeHtmlMarkdown.translate(html, {
    bulletMarker: '•',
    codeBlockStyle: 'fenced',
  });
}

// 估算标题层级 (h1/h2/h3)
// 基于 bbox Y 坐标位置和文本长度启发式
function estimateHeadingLevel(
  block: Block,
  pageHeight: number
): 1 | 2 | 3 {
  const y = block.bbox[1]; // top Y coordinate
  const textLength = extractTextFromLines(block.lines).length;

  // 页面顶部区域 (y < 15% of height) → h1
  if (y < pageHeight * 0.15) {
    return 1;
  }

  // 页面上部区域 (y < 30% of height) 且文本较短 → h2
  if (y < pageHeight * 0.30 && textLength < 60) {
    return 2;
  }

  // 其他情况 → h3
  return 3;
}

// ════════════════════════════════════════════════════════════════
// 3. 核心解析
// ════════════════════════════════════════════════════════════════

interface TocItem {
  title: string;
  level: 1 | 2 | 3;
  pageNumber: number;
  children: TocItem[];
  text: string; // 该章节下的完整文本
}

interface PageText {
  pageNumber: number;
  text: string;
}

/**
 * 从 MinerU JSON 解析出文档结构树
 */
async function parseMineruJsonToTree(json: MineruJson): Promise<{
  title: string;
  pages: PageText[];
  outline: TocItem[];
  totalPages: number;
}> {
  const pages: PageText[] = [];
  const allTitles: {
    title: string;
    level: 1 | 2 | 3;
    pageIdx: number;
    startY: number;
    blockIndex: number;
  }[] = [];

  // Step 1: 收集所有页面文本和标题
  for (const page of json.pdf_info) {
    const pageHeight = page.page_size[1];
    const pageTextParts: string[] = [];

    for (const block of page.para_blocks) {
      const text = extractTextFromLines(block.lines);

      if (block.type === 'title') {
        const level = estimateHeadingLevel(block, pageHeight);
        allTitles.push({
          title: text,
          level,
          pageIdx: page.page_idx,
          startY: block.bbox[1],
          blockIndex: block.index,
        });
      }

      if (block.type === 'text' || block.type === 'title') {
        if (text.trim()) {
          pageTextParts.push(text);
        }
      } else if (block.type === 'table') {
        const html = extractTableHtml(block.lines);
        if (html) {
          const md = await htmlToMarkdown(html);
          pageTextParts.push(md);
        }
      }
    }

    pages.push({
      pageNumber: page.page_idx + 1, // 转为 1-based
      text: pageTextParts.join('\n\n'),
    });
  }

  // Step 2: 构建树形结构
  const outline = buildTocTree(allTitles);

  // Step 3: 为每个标题节点填充其下的文本
  fillNodeText(outline, pages);

  return {
    title: extractDocTitle(allTitles),
    pages,
    outline,
    totalPages: pages.length,
  };
}

/**
 * 根据标题构建树
 */
function buildTocTree(titles: {
  title: string;
  level: 1 | 2 | 3;
  pageIdx: number;
  startY: number;
  blockIndex: number;
}[]): TocItem[] {
  const root: TocItem[] = [];
  const stack: { level: number; item: TocItem }[] = [];

  for (const t of titles) {
    const item: TocItem = {
      title: t.title,
      level: t.level,
      pageNumber: t.pageIdx + 1, // 1-based
      children: [],
      text: '',
    };

    // 弹出比当前级别更深或相同的节点
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

/**
 * 提取文档标题 (第一个 h1)
 */
function extractDocTitle(titles: { title: string; level: number }[]): string {
  const firstH1 = titles.find(t => t.level === 1);
  return firstH1?.title || 'Untitled';
}

/**
 * 为每个节点填充文本内容 (该章节到下一个同级标题之间的所有文本)
 */
function fillNodeText(nodes: TocItem[], pages: PageText[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextPage = nodes[i + 1]?.pageNumber || Infinity;

    const textParts: string[] = [];
    for (const page of pages) {
      if (page.pageNumber >= node.pageNumber && page.pageNumber < nextPage) {
        textParts.push(page.text);
      }
    }
    node.text = textParts.join('\n\n');

    if (node.children.length > 0) {
      fillNodeText(node.children, pages);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 4. Markdown 输出
// ════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════
// 5. 示例输出展示
// ════════════════════════════════════════════════════════════════

async function showPlayground() {
  console.log('═══════════════════════════════════════════════════');
  console.log('MinerU JSON → Document Tree Playground');
  console.log('═══════════════════════════════════════════════════\n');

  // 模拟解析结果 (基于实际 JSON 结构)
  const mockResult = {
    title: "The Founder's Playbook: Building an AI-Native Startup",
    totalPages: 36,
    outline: [
      {
        title: "The Founder's Playbook:",
        level: 1 as const,
        pageNumber: 1,
        children: [],
        text: "Building an AI-Native Startup...",
      },
      {
        title: "Contents",
        level: 1 as const,
        pageNumber: 2,
        children: [],
        text: "The startup lifecycle... 3\nIdea Stage... 8\n...",
      },
      {
        title: "The startup lifecycle, rebooted for 2026",
        level: 1 as const,
        pageNumber: 3,
        children: [
          {
            title: "AI tool capabilities for lean startups",
            level: 2 as const,
            pageNumber: 3,
            children: [],
            text: "...",
          },
          {
            title: "Conversational intelligence and research",
            level: 3 as const,
            pageNumber: 4,
            children: [],
            text: "...",
          },
        ],
        text: "AI is reshaping how startups are built...",
      },
      {
        title: "What it means to be a founder is changing",
        level: 1 as const,
        pageNumber: 5,
        children: [],
        text: "...",
      },
      {
        title: "Idea Stage",
        level: 1 as const,
        pageNumber: 8,
        children: [
          {
            title: "Idea stage goal",
            level: 2 as const,
            pageNumber: 8,
            children: [],
            text: "...",
          },
          {
            title: "Idea stage exit criteria",
            level: 2 as const,
            pageNumber: 9,
            children: [],
            text: "...",
          },
          {
            title: "Idea stage challenges",
            level: 2 as const,
            pageNumber: 10,
            children: [],
            text: "...",
          },
        ],
        text: "Every startup founder starts from the same place...",
      },
      {
        title: "MVP stage",
        level: 1 as const,
        pageNumber: 15,
        children: [],
        text: "...",
      },
      {
        title: "Launch stage",
        level: 1 as const,
        pageNumber: 21,
        children: [],
        text: "...",
      },
      {
        title: "Scale stage",
        level: 1 as const,
        pageNumber: 25,
        children: [],
        text: "...",
      },
      {
        title: "Same job, new rules",
        level: 1 as const,
        pageNumber: 31,
        children: [],
        text: "...",
      },
    ],
  };

  console.log('📊 解析结果概览:');
  console.log(`   文档标题: ${mockResult.title}`);
  console.log(`   总页数: ${mockResult.totalPages}`);
  console.log(`   一级章节数: ${mockResult.outline.filter(n => n.level === 1).length}`);
  console.log(`   二级章节数: ${mockResult.outline.filter(n => n.level === 2).length}`);
  console.log(`   三级章节数: ${mockResult.outline.filter(n => n.level === 3).length}`);

  console.log('\n📑 文档结构 (Tree):');
  console.log('─'.repeat(50));

  function printTree(nodes: TocItem[], depth: number = 0) {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      const icon = node.level === 1 ? '📖' : node.level === 2 ? '📌' : '•';
      console.log(`${indent}${icon} [p.${node.pageNumber}] ${node.title}`);
      if (node.children.length > 0) {
        printTree(node.children, depth + 1);
      }
    }
  }
  printTree(mockResult.outline);

  console.log('\n📄 生成的 Markdown 片段:');
  console.log('─'.repeat(50));
  console.log(`# ${mockResult.title}`);
  console.log();
  console.log(`# Contents`);
  console.log(`# The startup lifecycle, rebooted for 2026`);
  console.log(`## AI tool capabilities for lean startups`);
  console.log(`### Conversational intelligence and research`);
  console.log(`## Conversational intelligence...`);
  console.log(`# What it means to be a founder is changing`);
  console.log(`# Idea Stage`);
  console.log(`## Idea stage goal`);
  console.log(`## Idea stage exit criteria`);
  console.log(`# MVP stage`);
  console.log(`# Launch stage`);
  console.log(`# Scale stage`);
  console.log(`# Same job, new rules`);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Tree JSON 结构:');
  console.log('═══════════════════════════════════════════════════');
  console.log(JSON.stringify(mockResult.outline[2], null, 2));
}

showPlayground().catch(console.error);
