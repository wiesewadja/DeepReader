/**
 * EPUB to Obsidian 导出器
 * 将 EPUB 解析为 Obsidian 兼容的笔记结构
 */

import { parseEpub, type EpubInfo, type EpubChapter } from "../parsers/epub";
import { log as piLog } from "../core/logger";
import { cleanTitle } from "../core/utils";
import { DEFAULT_ASSETS_PATH, DEFAULT_INCLUDE_INDEX } from "../defaults.js";
import * as path from "path";
import * as fs from "fs";
import AdmZip from "adm-zip";

export interface ObsidianExportOptions {
  /** 输出目录 */
  outputDir: string;
  /** 笔记模板 */
  noteTemplate?: string;
  /** MOC 文件名 (默认: + Map of Content) */
  mocName?: string;
  /** 是否包含章节序号前缀 */
  includeIndex?: boolean;
  /** 图片保存路径 */
  assetsPath?: string;
  /** 最大章节层级 (0=全部合并, 1=一级章节, 2=二级...) */
  maxDepth?: number;
  /** 文档级描述（写入 MOC 文件） */
  docDescription?: string;
  /** 章节摘要映射 (title → summary) */
  nodeSummaries?: Record<string, string>;
  /** 导出目录名（如不提供则使用 bookInfo.title） */
  exportName?: string;
  /** 封面图片相对路径（用于 Base 查询） */
  coverPath?: string;
}

interface ObsidianNote {
  filePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

/**
 * 导出 EPUB 为 Obsidian 笔记结构
 * @param epubPath - EPUB 文件路径
 * @param options - 导出选项
 * @param epubInfo - 可选的预解析 EPUB 信息（用于适配器传递处理后的章节）
 */
export async function exportToObsidian(
  epubPath: string,
  options: ObsidianExportOptions,
  epubInfo?: EpubInfo
): Promise<{ mocPath: string; notes: ObsidianNote[]; nodeFileMap: Record<string, string> }> {
  // 使用传入的 epubInfo 或重新解析
  const bookInfo = epubInfo || await parseEpub(epubPath);
  const bookName = options.exportName || sanitizeFileName(bookInfo.title);

  // 创建书籍目录
  const bookDir = path.join(options.outputDir, bookName);
  if (!fs.existsSync(bookDir)) {
    fs.mkdirSync(bookDir, { recursive: true });
  }

  // 提取图片
  const assetsDir = path.join(bookDir, options.assetsPath || DEFAULT_ASSETS_PATH);
  fs.mkdirSync(assetsDir, { recursive: true });
  const imageMap = extractImagesFromEpub(epubPath, assetsDir);

  // 生成章节笔记
  const notes: ObsidianNote[] = [];
  const tocEntries: Array<{ title: string; fileName: string; level: number; originalHref: string; nodeId: string }> = [];

  // 计算章节层级
  const chaptersWithLevel = calculateLevels(bookInfo.chapters);

  // 先构建映射表
  const hrefToFileName = new Map<string, string>();
  const fileNameToChapter = new Map<string, EpubChapter & { level: number }>();

  for (let i = 0; i < chaptersWithLevel.length; i++) {
    const chapter = chaptersWithLevel[i];
    const indexPrefix = options.includeIndex ? `${String(i + 1).padStart(2, "0")} - ` : "";
    const fileName = sanitizeFileName(`${indexPrefix}${chapter.title}`);

    // 记录原始 href (去掉路径和扩展名)
    const originalBase = path.basename(chapter.href).replace(/\.(html|xhtml|htm)$/i, "");
    hrefToFileName.set(originalBase, fileName);
    hrefToFileName.set(chapter.href.replace(/\.(html|xhtml|htm)$/i, ""), fileName);

    // 记录文件名到章节的映射（用于查找 blockMap）
    fileNameToChapter.set(fileName, chapter);
  }

  for (let i = 0; i < chaptersWithLevel.length; i++) {
    const chapter = chaptersWithLevel[i];

    // 根据 maxDepth 合并子章节
    if (options.maxDepth && options.maxDepth > 0 && chapter.level > options.maxDepth) {
      continue; // 跳过过深层级，内容已合并到父章节
    }

    const note = await createChapterNote(
      chapter,
      i,
      chaptersWithLevel,
      bookDir,
      bookName,
      options,
      imageMap,
      bookInfo // 传递 bookInfo
    );

    notes.push(note);
    const nodeId = String(i + 1).padStart(4, "0");
    // Inject nodeId into frontmatter for unified nodeId tracking
    note.frontmatter.node_id = nodeId;
    tocEntries.push({
      title: chapter.title,
      fileName: path.basename(note.filePath, ".md"),
      level: chapter.level,
      originalHref: chapter.href,
      nodeId,
    });
  }

  // 保存封面图
  let coverRelativePath: string | undefined;
  if (bookInfo.coverImage) {
    const coverDir = path.join(bookDir, options.assetsPath || DEFAULT_ASSETS_PATH);
    if (!fs.existsSync(coverDir)) {
      fs.mkdirSync(coverDir, { recursive: true });
    }
    const coverPath = path.join(coverDir, bookInfo.coverImage.name);
    fs.writeFileSync(coverPath, bookInfo.coverImage.data);
    coverRelativePath = `${options.assetsPath || DEFAULT_ASSETS_PATH}/${bookInfo.coverImage.name}`;
    piLog(`[epub-to-obsidian] Cover saved: ${coverRelativePath}`);
  }

  // 生成 MOC (Map of Content)
  const mocPath = path.join(bookDir, `${options.mocName || bookName + " - MOC"}.md`);
  const mocContent = generateMOC(bookName, bookInfo, tocEntries, options, coverRelativePath);
  fs.writeFileSync(mocPath, mocContent);

  // 保存所有笔记 (在保存前统一修复内部链接)
  for (const note of notes) {
    let fixedContent = note.content;
    // Step 1: 修复 [[原始文件名#锚点|文本]] -> [[新文件名#^blockId|文本]]
    for (const [originalBase, newFileName] of hrefToFileName.entries()) {
      // 匹配 [[originalBase#^anchor|text]] 或 [[originalBase#anchor|text]] 或 [[originalBase|text]]
      // 锚点部分可能包含 ^ 符号
      const pattern = new RegExp(
        `\\[\\[${escapeRegExp(originalBase)}(#[^\\|]*)?((?:\\|[^\\]]*)?)\\]\\]`,
        "g"
      );
      fixedContent = fixedContent.replace(pattern, (match, anchor, displayPart) => {
        // 如果有锚点，查找对应的 block ID
        if (anchor) {
          // 移除 # 和 ^ 获取纯锚点ID
          const anchorId = anchor.replace(/^#\^?/, "");
          const targetChapter = fileNameToChapter.get(newFileName);

          if (targetChapter?.blockMap?.has(anchorId)) {
            const blockId = targetChapter.blockMap.get(anchorId);
            return `[[${newFileName}#^${blockId}${displayPart}]]`;
          }
          // 有锚点但无映射，保留锚点但更新文件名
          return `[[${newFileName}#^${anchorId}${displayPart}]]`;
        }
        // 无锚点，仅更新文件名
        return `[[${newFileName}${displayPart}]]`;
      });
    }

    // Step 2: 修复同文件内的锚点链接 [[#^anchor|text]]
    const currentFileName = path.basename(note.filePath, ".md");
    const currentChapter = fileNameToChapter.get(currentFileName);

    if (currentChapter?.blockMap) {
      const sameFilePattern = /\[\[#\^([^\]|]+)((?:\|[^\]]*)?)\]\]/g;
      fixedContent = fixedContent.replace(sameFilePattern, (match, anchorId, displayPart) => {
        const blockId = currentChapter.blockMap?.get(anchorId);
        if (blockId) {
          return `[[${currentFileName}#^${blockId}${displayPart}]]`;
        }
        return match;
      });
    }

    const fm = generateFrontmatter(note.frontmatter);
    fs.writeFileSync(note.filePath, `${fm}\n${fixedContent}`);
  }

  // 写入索引树 JSON（使用 TreeNode 层级结构 + nodeFileMap）
  const nodeFileMap: Record<string, string> = {};
  for (const entry of tocEntries) {
    if (entry.nodeId) nodeFileMap[entry.nodeId] = `${entry.fileName}.md`;
  }
  const treeNodes = buildEpubTree(chaptersWithLevel, notes, options);
  // 不再写入 tree.json，由 book-indexer 统一写到 .pageindex/
  return { mocPath, notes, nodeFileMap };
}

/**
 * 创建单个章节笔记
 */
async function createChapterNote(
  chapter: EpubChapter & { level: number },
  index: number,
  allChapters: Array<EpubChapter & { level: number }>,
  bookDir: string,
  bookName: string,
  options: ObsidianExportOptions,
  imageMap: Map<string, string>,
  bookInfo: EpubInfo
): Promise<ObsidianNote> {
  const indexPrefix = options.includeIndex ? `${String(index + 1).padStart(2, "0")} - ` : "";
  const fileName = sanitizeFileName(`${indexPrefix}${chapter.title}`) + ".md";
  const filePath = path.join(bookDir, fileName);

  // 处理图片链接
  let content = chapter.content;
  for (const [originalPath, newPath] of imageMap.entries()) {
    const relativePath = path.relative(bookDir, newPath).replace(/\\/g, "/");
    // 获取图片文件名（用于多种路径匹配）
    const fileName = path.basename(originalPath);

    // 替换各种可能的路径格式
    const patterns = [
      `!\\[([^\\]]*)\\]\\(${escapeRegExp(originalPath)}\\)`,  // 完整路径
      `!\\[([^\\]]*)\\]\\(${escapeRegExp(fileName)}\\)`,     // 仅文件名
      `!\\[([^\\]]*)\\]\\(../${escapeRegExp(originalPath)}\\)`, // 相对路径 ../
      `!\\[([^\\]]*)\\]\\(./${escapeRegExp(originalPath)}\\)`,  // 相对路径 ./
    ];

    for (const pattern of patterns) {
      content = content.replace(
        new RegExp(pattern, "g"),
        `![$1](${relativePath})`
      );
    }

    // 替换任何包含该文件名的 ../xxx/yyy 形式路径
    // Turndown 可能将 EPUB 相对路径转为 ../images/xxx.jpg
    content = content.replace(
      new RegExp(`!\\[([^\\]]*)\\]\\([^)]*${escapeRegExp(fileName)}\\)`, "g"),
      `![$1](${relativePath})`
    );

    // 同时替换 Obsidian 格式的图片链接
    content = content.replace(
      new RegExp(`!\\[\\[${escapeRegExp(fileName)}\\]\\]`, "g"),
      `![[${relativePath}]]`
    );
  }

  // Clean Markdown heading lines: remove stray * and excessive -
  // e.g. "#**第****2****章**" → "# 第2章"
  // e.g. "## --第----1----章--" → "## 第1章"
  content = content.replace(/^(#{1,6})\s*(.+)$/gm, (_match, hashes: string, text: string) => {
    const cleaned = text
      .replace(/\*+/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^[\s-]+|[\s-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return `${hashes} ${cleaned}`;
  });

  // Summary callout — 放在正文最前面
  const nodeSummary = options.nodeSummaries?.[chapter.title];
  if (nodeSummary) {
    // 将多行 summary 转为 Obsidian callout 格式（每行都需要 > 前缀）
    const summaryLines = nodeSummary.split('\n').map((line: string) => `> ${line}`).join('\n');
    content = `> [!summary]\n${summaryLines}\n\n${content}`;
  }

  // 添加导航链接
  const prev = index > 0 ? allChapters[index - 1] : null;
  const next = index < allChapters.length - 1 ? allChapters[index + 1] : null;

  if (prev || next) {
    content += "\n\n---\n\n";
    if (prev) {
      const prevFileName = sanitizeFileName(`${options.includeIndex ? String(index).padStart(2, "0") + " - " : ""}${prev.title}`) + ".md";
      content += `← 上一章: [[${prevFileName}|${prev.title}]]`;
    }
    if (prev && next) content += " | ";
    if (next) {
      const nextFileName = sanitizeFileName(`${options.includeIndex ? String(index + 2).padStart(2, "0") + " - " : ""}${next.title}`) + ".md";
      content += `下一章: [[${nextFileName}|${next.title}]] →`;
    }
  }

  // Frontmatter (v2: only user-visible metadata)
  const frontmatter: Record<string, unknown> = {
    title: chapter.title,
    source: bookName,
    type: "epub",
    tags: ["epub", "book", sanitizeTag(bookName)],
  };
  if (bookInfo.author) frontmatter.author = bookInfo.author;
  // Base 查询字段
  frontmatter.book_name = bookInfo.title || bookName;
  if (options.coverPath) frontmatter.cover = options.coverPath;

  // 应用自定义模板
  if (options.noteTemplate) {
    content = options.noteTemplate
      .replace(/\{\{content\}\}/g, content)
      .replace(/\{\{title\}\}/g, chapter.title)
      .replace(/\{\{book\}\}/g, bookName)
      .replace(/\{\{author\}\}/g, bookInfo.author || "")
      .replace(/\{\{index\}\}/g, String(index + 1))
      .replace(/\{\{level\}\}/g, String(chapter.level));
  }

  return { filePath, content, frontmatter };
}

/**
 * 生成 MOC (Map of Content)
 */
function generateMOC(
  bookName: string,
  epubInfo: EpubInfo,
  tocEntries: Array<{ title: string; fileName: string; level: number; originalHref: string }>,
  options: ObsidianExportOptions,
  coverPath?: string
): string {
  // Build frontmatter
  const frontmatter: Record<string, unknown> = {
    title: bookName,
    author: epubInfo.author,
    type: "epub-moc",
    created: new Date().toISOString(),
  };
  if (coverPath) frontmatter.cover = coverPath;

  let content = generateFrontmatter(frontmatter) + "\n\n";
  content += `# ${bookName}\n\n`;

  if (epubInfo.author) {
    content += `**作者:** ${epubInfo.author}\n\n`;
  }

  // 文档描述（LLM 生成的概要）
  if (options.docDescription) {
    content += `> [!info] 书籍概要\n> ${options.docDescription}\n\n`;
  }

  content += `**章节数:** ${tocEntries.length}\n`;
  content += `**总 Tokens:** ${epubInfo.chapters.reduce((s, c) => s + c.tokenCount, 0).toLocaleString()}\n\n`;
  content += `---\n\n`;
  content += `## 目录\n\n`;

  // 生成树形目录
  for (const entry of tocEntries) {
    const indent = "  ".repeat(entry.level);
    const link = `[[${entry.fileName}|${entry.title}]]`;
    content += `${indent}- ${link}\n`;
  }

  content += `\n---\n\n`;
  content += `*由 PageIndex 自动生成*\n`;

  return content;
}

/**
 * 生成 YAML Frontmatter
 */
function generateFrontmatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${yamlString(item)}`);
      }
    } else if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${key}: |`);
      for (const line of value.split("\n")) {
        lines.push(`  ${line}`);
      }
    } else if (typeof value === "string") {
      lines.push(`${key}: ${yamlString(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/** Quote a YAML string value if it contains special characters */
function yamlString(value: unknown): string {
  if (typeof value !== "string") return String(value);
  const s = value as string;
  if (/[:{}\[\],&*#?|<>=!%@`\n\r"'"]/.test(s) || s === "" || s === "true" || s === "false" || s === "null") {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * 章节标题分类
 */
type TitleKind = "part" | "chapter" | "section" | "special" | "other";

function classifyTitle(title: string): TitleKind {
  // 篇级: "上篇", "下篇", "第X篇", "Part X"
  if (/^(上篇|下篇|篇[一二三四五六七八九十\d]+|第[一二三四五六七八九十\d]+篇|Part\s+\d+)/i.test(title)) {
    return "part";
  }
  // 章级: "第一章", "Chapter 1"
  if (/^(第[一二三四五六七八九十百千\d]+章|Chapter\s+\d+|第\d+章)/i.test(title)) {
    return "chapter";
  }
  // 节级: "第一节", "Section 1.1"
  if (/^(第[一二三四五六七八九十\d]+节|Section\s+\d+|\d+\.\d+)/i.test(title)) {
    return "section";
  }
  // 特殊: "前言", "结语", "结束语", "扩展阅读", "参考文献"
  if (/^(前言|序[言章]?|引言|导言|结语|结束语|后记|附录|扩展阅读|参考文献|参考书目|致谢)/.test(title)) {
    return "special";
  }
  return "other";
}

/**
 * 计算章节层级
 * 层级定义:
 *   0 = 顶级 (篇、前言、结束语、参考文献、封面等噪声)
 *   1 = 章级 (第X章) — 在篇内则为篇的子节点
 *   2 = 节级 (第X节、结语、扩展阅读) — 章的子节点
 */
function calculateLevels(chapters: EpubChapter[]): Array<EpubChapter & { level: number }> {
  let insidePart = false; // 是否在"篇"内部（上篇/下篇之间）

  return chapters.map((ch, i) => {
    const kind = classifyTitle(ch.title);

    switch (kind) {
      case "part":
        insidePart = true;
        return { ...ch, level: 0 };

      case "chapter":
        // 章级：如果在"篇"内则为 level 1，否则 level 0
        return { ...ch, level: insidePart ? 1 : 0 };

      case "section":
        // 节级：始终在章下面
        return { ...ch, level: 2 };

      case "special": {
        // 顶级特殊章节
        if (/^(前言|序[言章]?|引言|导言|结束语|后记|参考文献|参考书目|致谢)$/.test(ch.title)) {
          insidePart = false; // 参考文献等通常在篇外
          return { ...ch, level: 0 };
        }
        // 章级附属 (结语、扩展阅读) — 跟随所属章
        if (/^(结语|扩展阅读|附录)$/.test(ch.title)) {
          return { ...ch, level: 2 };
        }
        return { ...ch, level: insidePart ? 1 : 0 };
      }

      case "other":
        // 未识别标题：内容极少的可能是封面/版权页（顶级噪声）
        if (ch.tokenCount < 50) {
          return { ...ch, level: 0 };
        }
        return { ...ch, level: insidePart ? 1 : 0 };
    }
  });
}

interface EpubTreeNode {
  title: string;
  nodeId: string;
  filePath?: string;
  startIndex: number;
  endIndex: number;
  tokenCount: number;
  nodes?: EpubTreeNode[];
}

/**
 * 从层级化的章节列表构建树形结构
 */
function buildEpubTree(
  chaptersWithLevel: Array<EpubChapter & { level: number }>,
  notes: ObsidianNote[],
  options: ObsidianExportOptions
): EpubTreeNode[] {

  // 每个章节创建一个节点，带文件路径
  // nodeId 使用和 tocEntries 一致的格式（0001, 0002, ...）
  const allNodes: Array<EpubTreeNode & { level: number }> = chaptersWithLevel.map((ch, i) => {
    const indexPrefix = options.includeIndex ? `${String(i + 1).padStart(2, "0")} - ` : "";
    const fileName = sanitizeFileName(`${indexPrefix}${ch.title}`) + ".md";

    return {
      title: ch.title,
      nodeId: String(i + 1).padStart(4, "0"),
      filePath: notes[i] ? path.basename(notes[i].filePath) : fileName,
      startIndex: i,
      endIndex: i,
      tokenCount: ch.tokenCount,
      level: ch.level,
    };
  });

  // 构建父子关系：每个节点找最近的更小 level 的前驱作为父节点
  const roots: EpubTreeNode[] = [];
  const stack: Array<EpubTreeNode & { level: number }> = [];

  for (const node of allNodes) {
    // 弹出栈中 level >= 当前节点的元素
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      if (!parent.nodes) parent.nodes = [];
      parent.endIndex = node.endIndex; // 扩展父节点的 endIndex
      parent.tokenCount += node.tokenCount; // 累加 token
      parent.nodes.push(node);
    }

    stack.push(node);
  }

  // 清理空 nodes 数组
  const cleanTree = (nodes: EpubTreeNode[]): EpubTreeNode[] => {
    return nodes.map(n => {
      if (n.nodes && n.nodes.length === 0) {
        const { nodes: _, ...rest } = n;
        return rest;
      }
      if (n.nodes) {
        return { ...n, nodes: cleanTree(n.nodes) };
      }
      return n;
    });
  };

  return cleanTree(roots);
}

/**
 * 清理文件名
 */
function sanitizeFileName(name: string): string {
  return cleanTitle(name)
    .replace(/[<>:"/\\|?*#]/g, "")
    .substring(0, 100);
}

/**
 * 清理标签
 */
function sanitizeTag(tag: string): string {
  return tag
    .replace(/[<>:"/\\|?*#,\[\]]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/**
 * 转义正则
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a nested TreeNode[] from flat tocEntries with level info.
 */
function buildTreeFromTocEntries(
  entries: Array<{ title: string; fileName: string; level: number; nodeId?: string }>,
  _bookName: string
): Array<{ title: string; file: string; nodeId?: string; nodes?: Array<{ title: string; file: string; nodeId?: string }> }> {
  type TreeNode = { title: string; file: string; nodeId?: string; nodes?: TreeNode[] };
  const root: TreeNode[] = [];
  const stack: TreeNode[] = []; // tracks current ancestry at each level

  for (const entry of entries) {
    const node: TreeNode = { title: entry.title, file: entry.fileName, nodeId: entry.nodeId };

    // Pop stack until we find the parent level
    while (stack.length > 0 && stack.length > entry.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      const parent = stack[stack.length - 1];
      if (!parent.nodes) parent.nodes = [];
      parent.nodes.push(node);
    }

    stack.push(node);
  }

  return root;
}

/**
 * 从 EPUB 提取图片
 */
function extractImagesFromEpub(epubPath: string, outputDir: string): Map<string, string> {
  const imageMap = new Map<string, string>();
  const zip = new AdmZip(epubPath);

  const imageEntries = zip.getEntries().filter(entry => {
    const ext = path.extname(entry.entryName).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp"].includes(ext);
  });

  for (const entry of imageEntries) {
    const fileName = path.basename(entry.entryName);
    const outputPath = path.join(outputDir, fileName);

    // 保存图片
    fs.writeFileSync(outputPath, entry.getData());

    // 记录原始路径到新路径的映射
    // EPUB 中的路径通常是相对 OEBPS 的
    const epubPathVariants = [
      entry.entryName,
      path.basename(entry.entryName),
      entry.entryName.replace(/^OEBPS\//, ""),
      entry.entryName.replace(/^OPS\//, ""),
    ];

    for (const variant of epubPathVariants) {
      imageMap.set(variant, outputPath);
    }
  }

  return imageMap;
}
