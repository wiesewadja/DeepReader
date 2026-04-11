/**
 * PDF to Obsidian 导出器
 *
 * 直接消费 PageIndexResult（TOC 树 + Markdown 正文），
 * 不再独立解析 PDF。
 *
 * 流程：
 *   PageIndex.fromPdf(addNodeText:true)
 *     → TreeNode[]，每个 node.text 已是 Markdown
 *     → 按 leaf 节点拆分为 Obsidian 笔记
 */

import { countTokens } from "../core/utils";
import { log as piLog } from "../core/logger";
import type { PageIndexResult, TreeNode } from "../core/types";
import * as path from "path";
import * as fs from "fs";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PdfObsidianExportOptions {
  /** 输出目录 */
  outputDir: string;
  /** 已有的 PageIndex 解析结果，避免重复调用 */
  parseResult: PageIndexResult;
  /** 笔记模板：支持 {{content}}, {{title}}, {{source}}, {{index}} */
  noteTemplate?: string;
  /** MOC 文件名（默认: 文档名 - MOC） */
  mocName?: string;
  /** 是否在文件名前加序号前缀（如 "01 - "） */
  includeIndex?: boolean;
  /** 原始 PDF 路径（写入 frontmatter） */
  sourcePdf?: string;
  /** 导出目录名（如不提供则使用 docName） */
  exportName?: string;
}

interface ObsidianNote {
  filePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

// ─── Tree → flat sections ───────────────────────────────────────────────────────

interface FlatSection {
  title: string;
  text: string;
  depth: number;
  startIndex?: number;
  endIndex?: number;
  nodeId?: string;
  summary?: string;
  isParent?: boolean;
  childTitles?: string[];
}

/** 收集所有节点（包括父级和叶节点），保持树结构顺序 */
function collectAllNodes(
  nodes: TreeNode[],
  depth: number,
): FlatSection[] {
  const result: FlatSection[] = [];

  for (const node of nodes) {
    const hasChildren = node.nodes && node.nodes.length > 0;

    result.push({
      title: node.title,
      text: node.text || "",
      depth,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      nodeId: node.nodeId,
      summary: node.summary,
      isParent: hasChildren,
      childTitles: hasChildren ? node.nodes!.map(n => n.title) : undefined,
    });

    if (hasChildren) {
      result.push(...collectAllNodes(node.nodes!, depth + 1));
    }
  }

  return result;
}

// ─── Block ID ────────────────────────────────────────────────────────────────────

let blockCounter = 0;

function resetBlockCounter(): void {
  blockCounter = 0;
}

function generateBlockId(sectionIndex: number): string {
  blockCounter++;
  return `s${sectionIndex}-${String(blockCounter).padStart(3, "0")}`;
}

function addBlockIds(content: string, sectionIndex: number): string {
  resetBlockCounter();
  if (!content.trim()) return content;

  const lines = content.split("\n");
  const result: string[] = [];
  let paragraphBuf: string[] = [];
  let hasContent = false;

  const flush = () => {
    if (hasContent && paragraphBuf.length > 0) {
      const blockId = generateBlockId(sectionIndex);
      result.push(...paragraphBuf);
      const last = result[result.length - 1];
      if (last !== undefined) result[result.length - 1] = `${last} ^${blockId}`;
      paragraphBuf = [];
      hasContent = false;
    } else if (paragraphBuf.length > 0) {
      result.push(...paragraphBuf);
      paragraphBuf = [];
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); result.push(""); continue; }
    if (/^#{1,6}\s+/.test(t)) { flush(); result.push(line); continue; }
    if (/^[-*+]\s/.test(t) || /^\d+\.\s/.test(t)) {
      flush();
      const bid = generateBlockId(sectionIndex);
      result.push(`${line} ^${bid}`);
      continue;
    }
    if (t.startsWith("```") || /^<!--/.test(t) || /^---+\s*$/.test(t)) {
      flush(); result.push(line); continue;
    }
    paragraphBuf.push(line);
    hasContent = true;
  }
  flush();
  return result.join("\n");
}

// ─── Frontmatter / helpers ──────────────────────────────────────────────────────

function generateFrontmatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${key}: |`);
      for (const l of value.split("\n")) lines.push(`  ${l}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim().substring(0, 100);
}

function sanitizeTag(tag: string): string {
  return tag.replace(/[<>:"/\\|?*#,\[\]]/g, "").replace(/\s+/g, "-").toLowerCase();
}

// ─── Main export ─────────────────────────────────────────────────────────────────

/**
 * 导出 PDF 为 Obsidian 笔记结构
 *
 * 直接使用已有的 PageIndex 解析结果，避免重复调用 LLM。
 * 1. 从 parseResult 中收集叶节点 → 每个叶节点 → 一篇 Obsidian 笔记
 * 2. 生成 MOC、frontmatter、block ID、导航链接
 */
export async function exportPdfToObsidian(
  options: PdfObsidianExportOptions
): Promise<{ mocPath: string; notes: ObsidianNote[]; nodeFileMap: Record<string, string> }> {
  const result = options.parseResult;
  const docName = result.docName;

  // 2. 收集所有节点（包括父级章节和叶子节点）
  const sections = collectAllNodes(result.structure, 0);

  if (sections.length === 0) {
    // 无结构 → 整个文档一个笔记
    const fullText = result.structure.map((n) => n.text || "").join("\n\n");
    sections.push({ title: docName, text: fullText, depth: 0 });
  }

  // Build fileName lookup for navigation and cross-references
  const sectionFileNames = sections.map((s, i) => {
    const idx = options.includeIndex ? `${String(i + 1).padStart(2, "0")} - ` : "";
    return sanitizeFileName(`${idx}${s.title}`);
  });

  // 3. 输出目录（使用 exportName 统一命名）
  const dirName = options.exportName || sanitizeFileName(docName);
  const bookDir = path.join(options.outputDir, dirName);
  fs.mkdirSync(bookDir, { recursive: true });

  // 4. 生成笔记
  piLog(`[pdf-to-obsidian] Step 2: 生成 ${sections.length} 个笔记...`);
  const notes: ObsidianNote[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const fileName = sectionFileNames[i];
    const filePath = path.join(bookDir, `${fileName}.md`);

    let content: string;

    if (section.isParent) {
      // Parent node: summary + child links (no full text to avoid duplication)
      const parts: string[] = [];

      if (section.summary) {
        const summaryLines = section.summary.split('\n').map((line: string) => `> ${line}`).join('\n');
        parts.push(`> [!summary]\n${summaryLines}\n`);
      }

      // List child sections as links
      const childLinks: string[] = [];
      for (let j = i + 1; j < sections.length; j++) {
        if (sections[j].depth <= section.depth) break;
        if (sections[j].depth === section.depth + 1) {
          childLinks.push(`- [[${sectionFileNames[j]}|${sections[j].title}]]`);
        }
      }
      if (childLinks.length > 0) {
        parts.push(childLinks.join('\n'));
      }

      content = parts.join('\n\n');
    } else {
      // Leaf node: full text with block IDs
      content = addBlockIds(section.text, i);

      if (section.summary) {
        const summaryLines = section.summary.split('\n').map((line: string) => `> ${line}`).join('\n');
        content = `> [!summary]\n${summaryLines}\n\n${content}`;
      }
    }

    // Navigation: find previous and next nodes at the same depth level
    let prevIdx = -1;
    let nextIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (sections[j].depth === section.depth) { prevIdx = j; break; }
    }
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].depth === section.depth) { nextIdx = j; break; }
    }
    if (prevIdx >= 0 || nextIdx >= 0) {
      content += "\n\n---\n\n";
      if (prevIdx >= 0) {
        content += `← 上一节: [[${sectionFileNames[prevIdx]}|${sections[prevIdx].title}]]`;
      }
      if (prevIdx >= 0 && nextIdx >= 0) content += " | ";
      if (nextIdx >= 0) {
        content += `下一节: [[${sectionFileNames[nextIdx]}|${sections[nextIdx].title}]] →`;
      }
    }

    // Frontmatter
    const frontmatter: Record<string, unknown> = {
      title: section.title,
      source: dirName,
      type: "pdf",
      tags: ["pdf", "document", sanitizeTag(dirName)],
    };
    if (section.startIndex) frontmatter.page_range = `${section.startIndex}-${section.endIndex}`;

    // Template
    if (options.noteTemplate) {
      content = options.noteTemplate
        .replace(/\{\{content\}\}/g, content)
        .replace(/\{\{title\}\}/g, section.title)
        .replace(/\{\{source\}\}/g, docName)
        .replace(/\{\{index\}\}/g, String(i + 1));
    }

    notes.push({ filePath, content, frontmatter });
  }

  // 5. MOC
  const mocName = options.mocName || `${dirName} - MOC`;
  const mocPath = path.join(bookDir, `${mocName}.md`);

  // MOC frontmatter
  const mocFrontmatter: Record<string, unknown> = {
    title: docName,
    type: "pdf-moc",
    created: new Date().toISOString(),
  };
  if (options.sourcePdf) mocFrontmatter.source = options.sourcePdf;

  let moc = generateFrontmatter(mocFrontmatter) + "\n\n";
  moc += `# ${docName}\n\n`;
  if (result.docDescription) moc += `> ${result.docDescription}\n\n`;
  moc += `**来源:** PDF 文档\n`;
  moc += `**章节数:** ${sections.length}\n`;
  moc += `**总 Tokens:** ${notes.reduce((s, n) => s + (n.frontmatter.token_count as number), 0).toLocaleString()}\n\n`;
  moc += `---\n\n## 目录\n\n`;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const indent = "  ".repeat(Math.max(0, s.depth));
    moc += `${indent}- [[${sectionFileNames[i]}|${s.title}]]\n`;
  }
  moc += `\n---\n\n*由 PageIndex 自动生成*\n`;

  // 6. 写入
  fs.writeFileSync(mocPath, moc);
  for (const note of notes) {
    fs.writeFileSync(note.filePath, `${generateFrontmatter(note.frontmatter)}\n${note.content}`);
  }

  // 7. 构建 nodeFileMap（不再写入 tree.json，由 book-indexer 统一写到 .pageindex/）
  const nodeFileMap: Record<string, string> = {};
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.nodeId) {
      nodeFileMap[s.nodeId] = `${sectionFileNames[i]}.md`;
    }
  }

  piLog(`[pdf-to-obsidian] 完成！MOC: ${mocPath}, 笔记: ${notes.length}`);
  return { mocPath, notes, nodeFileMap };
}
