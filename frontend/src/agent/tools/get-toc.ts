/**
 * get_toc Tool - 获取文档目录和结构纲要
 *
 * 合并了原 get_toc 和 outline_structure 的功能
 * 通过 detail 参数控制输出详细程度
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import type { TableOfContentsFlat } from '../../api/http-client.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

const GET_TOC_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_toc',
    description: `【检视阅读】获取文档目录和结构。detail 控制详细程度：
- normal：仅包含整体架构大纲
- detailed：包含章节摘要`,
    parameters: {
      type: 'object',
      properties: {
        detail: {
          type: 'string',
          enum: [ 'normal', 'detailed'],
          description: '详细程度：simple（默认，简单列表）、brief（主要章节）、normal（含分析）、detailed（含摘要）',
        },
      },
      required: [],
    },
  },
};

/**
 * 章节信息（来自 API）
 */
interface ChapterInfo {
  title: string;
  start_page: number;
  end_page: number;
  summary?: string;  // 章节摘要（LLM 生成）
  obsidian_link?: string;  // Obsidian Markdown 文件链接
}

/**
 * 节点信息（来自 API）
 */
interface NodeInfo {
  node_id: string;
  node_name: string;
  section: string;
  page_range: string;
  text: string;
  summary?: string;  // 章节摘要（LLM 生成）
}

export const getTocTool: ToolExecutor = {
  definition: GET_TOC_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const detail = (args.detail as string) || 'simple';

    try {
      log('[get_toc] 获取目录:', { indexId: context.indexId, detail });

      // 优先使用扁平化 API（2 级结构）
      const flatToc = await deeppdfClient.getTableOfContentsFlat(context.indexId);

      if (!flatToc.toc || flatToc.toc.length === 0) {
        return `No table of contents available for "${context.pdfName}"`;
      }

      // 根据 detail 参数格式化输出
      switch (detail) {
        case 'simple':
          return formatFlatSimple(flatToc);
        case 'brief':
          return formatFlatBrief(flatToc);
        case 'normal':
          return formatFlatNormal(flatToc);
        case 'detailed':
          return formatFlatDetailed(flatToc);
        default:
          return formatFlatSimple(flatToc);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[get_toc] 获取目录失败:', errorMsg);
      return `Error getting table of contents: ${errorMsg}`;
    }
  },
};

/**
 * 生成 Obsidian wikilink
 */
function generateObsidianLink(link?: string, displayText?: string): string {
  if (!link) return '';
  if (displayText) {
    return `[[${link}|${displayText}]]`;
  }
  return `[[${link}]]`;
}

/**
 * 简单目录格式（原 get_toc）
 */
function formatSimpleToc(bookName: string, chapters: ChapterInfo[], totalPages: number): string {
  const lines: string[] = [];

  lines.push(`📖 **${bookName}** (${totalPages}页)`);
  lines.push('');

  for (const chapter of chapters) {
    const pageRange = chapter.start_page === chapter.end_page
      ? `p.${chapter.start_page}`
      : `p.${chapter.start_page}-${chapter.end_page}`;

    // 生成 Obsidian 链接
    const link = chapter.obsidian_link ? generateObsidianLink(chapter.obsidian_link, chapter.title) : chapter.title;

    const isMain = isMainChapter(chapter.title);
    if (isMain) {
      lines.push(`- ${link} (${pageRange})`);
    } else {
      lines.push(`  - ${link} (${pageRange})`);
    }
  }

  return lines.join('\n');
}

/**
 * 简要纲要格式（仅主要章节）
 */
function formatBriefOutline(bookName: string, chapters: ChapterInfo[]): string {
  const lines: string[] = [];

  lines.push(`# 《${bookName}》结构纲要`);
  lines.push('');

  const mainChapters = chapters.filter((ch) => isMainChapter(ch.title));

  lines.push(`**主要章节**: ${mainChapters.length} 个`);
  lines.push('');

  for (const chapter of mainChapters) {
    const pageRange = chapter.start_page === chapter.end_page
      ? `p.${chapter.start_page}`
      : `p.${chapter.start_page}-${chapter.end_page}`;
    // 生成 Obsidian 链接
    const link = chapter.obsidian_link ? generateObsidianLink(chapter.obsidian_link, chapter.title) : chapter.title;
    lines.push(`### ${link} (${pageRange})`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 普通纲要格式（含架构分析）
 */
function formatNormalOutline(bookName: string, chapters: ChapterInfo[], nodes: NodeInfo[]): string {
  const lines: string[] = [];

  // 书名和总览
  lines.push(`# 《${bookName}》结构纲要`);
  lines.push('');
  lines.push(`**总页数**: ${chapters[0]?.start_page || 1}-${chapters[chapters.length - 1]?.end_page || '?'}`);
  lines.push(`**章节数**: ${chapters.length}`);
  lines.push('');

  // 识别书籍类型和主题
  const bookTheme = inferBookTheme(chapters, nodes);
  lines.push(`**核心主题**: ${bookTheme}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 章节结构
  lines.push('## 篇章结构');
  lines.push('');

  for (const chapter of chapters) {
    const pageRange = chapter.start_page === chapter.end_page
      ? `p.${chapter.start_page}`
      : `p.${chapter.start_page}-${chapter.end_page}`;

    // 生成 Obsidian 链接
    const link = chapter.obsidian_link ? generateObsidianLink(chapter.obsidian_link, chapter.title) : chapter.title;

    const isMain = isMainChapter(chapter.title);
    const prefix = isMain ? '### ' : '- ';
    const indent = isMain ? '' : '  ';

    lines.push(`${indent}${prefix}${link} (${pageRange})`);
  }

  // 添加架构分析
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 架构分析');
  lines.push('');
  lines.push(generateStructureAnalysis(chapters));

  return lines.join('\n');
}

/**
 * 详细纲要格式（含章节摘要）
 */
function formatDetailedOutline(bookName: string, chapters: ChapterInfo[], nodes: NodeInfo[]): string {
  const lines: string[] = [];

  // 书名和总览
  lines.push(`# 《${bookName}》详细纲要`);
  lines.push('');
  lines.push(`**总页数**: ${chapters[0]?.start_page || 1}-${chapters[chapters.length - 1]?.end_page || '?'}`);
  lines.push(`**章节数**: ${chapters.length}`);
  lines.push('');

  // 识别书籍主题
  const bookTheme = inferBookTheme(chapters, nodes);
  lines.push(`**核心主题**: ${bookTheme}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 章节结构（含摘要）
  lines.push('## 篇章结构');
  lines.push('');

  const mainChapters = chapters.filter((ch) => isMainChapter(ch.title));

  for (const chapter of mainChapters) {
    const pageRange = chapter.start_page === chapter.end_page
      ? `p.${chapter.start_page}`
      : `p.${chapter.start_page}-${chapter.end_page}`;

    // 生成 Obsidian 链接
    const link = chapter.obsidian_link ? generateObsidianLink(chapter.obsidian_link, chapter.title) : chapter.title;

    lines.push(`### ${link} (${pageRange})`);

    // 添加章节摘要（优先从 chapters 获取，其次从 nodes）
    const summary = getChapterSummary(chapter.title, chapters, nodes);
    if (summary) {
      lines.push('');
      lines.push(`> ${summary}`);
    }

    lines.push('');
  }

  // 添加架构分析
  lines.push('---');
  lines.push('');
  lines.push('## 架构分析');
  lines.push('');
  lines.push(generateStructureAnalysis(chapters));

  return lines.join('\n');
}

/**
 * 判断是否为主要章节
 */
function isMainChapter(title: string): boolean {
  const mainPatterns = [
    /^第[一二三四五六七八九十\d]+[章部篇]/,
    /^Chapter\s*\d+/i,
    /^Part\s*\d+/i,
    /^[一二三四五六七八九十]+[、.．]/,
    /^\d+[、.．\s]/,
  ];

  return mainPatterns.some((pattern) => pattern.test(title.trim()));
}

/**
 * 推断书籍主题
 */
function inferBookTheme(chapters: ChapterInfo[], nodes: NodeInfo[]): string {
  const titles = chapters.map((c) => c.title).join(' ');
  const nodeTexts = nodes
    .slice(0, 5)
    .map((n) => n.text.slice(0, 200))
    .join(' ');

  const combinedText = titles + ' ' + nodeTexts;
  const keywords = extractKeywords(combinedText);

  if (keywords.length > 0) {
    return keywords.slice(0, 5).join('、');
  }

  return '（未能自动识别）';
}

/**
 * 简单关键词提取
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    '的', '是', '在', '和', '与', '或', '有', '被', '将', '能', '会',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  ]);

  const chineseWords = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  const englishWords = text.match(/[a-zA-Z]{4,}/gi) || [];
  const allWords = [...chineseWords, ...englishWords];

  const wordCount: Record<string, number> = {};
  for (const word of allWords) {
    const lower = word.toLowerCase();
    if (!stopWords.has(lower) && !stopWords.has(word)) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  }

  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * 获取章节摘要
 * 优先从 chapters（toc API）中获取 summary，其次从 nodes（export API）中提取
 */
function getChapterSummary(chapterTitle: string, chapters: ChapterInfo[], nodes: NodeInfo[]): string {
  // 优先从 chapters 获取 LLM 生成的 summary
  const matchingChapter = chapters.find(
    (ch) => ch.title === chapterTitle || chapterTitle.includes(ch.title)
  );
  if (matchingChapter?.summary) {
    const summary = matchingChapter.summary.trim();
    if (summary.length > 150) {
      return summary.slice(0, 150) + '...';
    }
    return summary;
  }

  // fallback: 从 nodes 中提取
  const matchingNode = nodes.find(
    (n) => n.node_name === chapterTitle || n.node_name.includes(chapterTitle)
  );

  if (!matchingNode) return '';

  // 优先使用 node 的 summary 字段
  if (matchingNode.summary && matchingNode.summary.trim()) {
    const summary = matchingNode.summary.trim();
    if (summary.length > 150) {
      return summary.slice(0, 150) + '...';
    }
    return summary;
  }

  // fallback: 从 text 中提取
  const firstParagraph = matchingNode.text.split('\n\n')[0];
  if (firstParagraph && firstParagraph.length > 50) {
    return firstParagraph.slice(0, 150) + (firstParagraph.length > 150 ? '...' : '');
  }

  return '';
}

/**
 * 生成结构分析
 */
function generateStructureAnalysis(chapters: ChapterInfo[]): string {
  const mainChapters = chapters.filter((ch) => isMainChapter(ch.title));
  const totalMain = mainChapters.length;

  if (totalMain === 0) {
    return '本书未采用传统章节划分，可能是文集或连续性文本。';
  }

  const chapterLengths = mainChapters.map((ch) => ch.end_page - ch.start_page + 1);
  const avgLength = Math.round(chapterLengths.reduce((a, b) => a + b, 0) / chapterLengths.length);

  const analysis: string[] = [];

  if (totalMain <= 3) {
    analysis.push('本书结构较为简洁，分为少量大章节，适合系统性学习。');
  } else if (totalMain <= 10) {
    analysis.push(`本书共 ${totalMain} 个主要章节，结构清晰，便于逐章阅读。`);
  } else {
    analysis.push(`本书共 ${totalMain} 个章节，内容丰富，建议先浏览目录把握整体脉络。`);
  }

  if (avgLength < 10) {
    analysis.push('各章节较短，适合碎片化阅读。');
  } else if (avgLength > 30) {
    analysis.push('各章节篇幅较长，建议预留充足阅读时间。');
  }

  return analysis.join(' ');
}

// ==================== 扁平化 TOC 格式化函数 ====================

/**
 * 简单模式：扁平化列表
 */
function formatFlatSimple(flatToc: TableOfContentsFlat): string {
  const lines: string[] = [];

  lines.push(`📖 **${flatToc.book_title}**`);
  lines.push('');

  for (const section of flatToc.toc) {
    // 一级章节
    lines.push(`### ${section.level_1}`);
    // 二级章节
    for (const sub of section.sub_chapters) {
      const link = sub.node_id ? `[[${flatToc.book_title}#${sub.node_id}|${sub.title}]]` : sub.title;
      lines.push(`- ${link}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 简要模式：仅一级章节
 */
function formatFlatBrief(flatToc: TableOfContentsFlat): string {
  const lines: string[] = [];

  lines.push(`# 《${flatToc.book_title}》结构纲要`);
  lines.push('');

  for (const section of flatToc.toc) {
    lines.push(`## ${section.level_1}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 普通模式：含子章节列表
 */
function formatFlatNormal(flatToc: TableOfContentsFlat): string {
  const lines: string[] = [];

  lines.push(`# 《${flatToc.book_title}》结构纲要`);
  lines.push('');
  lines.push(`**章节数**: ${flatToc.toc.length} 个一级章节`);
  lines.push('');

  for (const section of flatToc.toc) {
    lines.push(`## ${section.level_1}`);
    lines.push('');

    if (section.sub_chapters.length > 0) {
      for (const sub of section.sub_chapters) {
        lines.push(`- ${sub.title}`);
      }
    } else {
      lines.push('_（无子章节）_');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 详细模式：含摘要
 */
function formatFlatDetailed(flatToc: TableOfContentsFlat): string {
  const lines: string[] = [];

  lines.push(`# 《${flatToc.book_title}》详细纲要`);
  lines.push('');
  lines.push(`**章节数**: ${flatToc.toc.length} 个一级章节`);
  lines.push('');

  for (const section of flatToc.toc) {
    lines.push(`## ${section.level_1}`);

    // 添加摘要
    if (section.summary) {
      lines.push('');
      lines.push(`> ${section.summary}`);
    }

    lines.push('');

    // 子章节列表
    if (section.sub_chapters.length > 0) {
      lines.push('### 本章节目录');
      for (const sub of section.sub_chapters) {
        const link = sub.node_id ? `[[${flatToc.book_title}#${sub.node_id}|${sub.title}]]` : sub.title;
        lines.push(`- ${link}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
