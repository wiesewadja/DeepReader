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
}

/** 收集所有叶节点（有 text 的节点） */
function collectLeafNodes(
  nodes: TreeNode[],
  depth: number,
  _parentTitle?: string,
): FlatSection[] {
  const result: FlatSection[] = [];

  for (const node of nodes) {
    if (node.nodes && node.nodes.length > 0) {
      // 有子节点 → 递归
      result.push(...collectLeafNodes(node.nodes, depth + 1, node.title));
    } else if (node.text) {
      // 叶节点 → 有内容
      result.push({
        title: node.title,
        text: node.text,
        depth,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        nodeId: node.nodeId,
        summary: node.summary,
      });
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
): Promise<{ mocPath: string; notes: ObsidianNote[] }> {
  const result = options.parseResult;
  const docName = result.docName;

  // 2. 收集叶节点
  const sections = collectLeafNodes(result.structure, 0);

  if (sections.length === 0) {
    // 无结构 → 整个文档一个笔记
    const fullText = result.structure.map((n) => n.text || "").join("\n\n");
    sections.push({ title: docName, text: fullText, depth: 0 });
  }

  // 3. 输出目录
  const bookDir = path.join(options.outputDir, sanitizeFileName(docName));
  fs.mkdirSync(bookDir, { recursive: true });

  // 4. 生成笔记
  piLog(`[pdf-to-obsidian] Step 2: 生成 ${sections.length} 个笔记...`);
  const notes: ObsidianNote[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const idx = options.includeIndex ? `${String(i + 1).padStart(2, "0")} - ` : "";
    const fileName = sanitizeFileName(`${idx}${section.title}`);
    const filePath = path.join(bookDir, `${fileName}.md`);

    // 正文 + block IDs
    let content = addBlockIds(section.text, i);

    // 摘要 callout
    if (section.summary) {
      const summaryLines = section.summary.split('\n').map((line: string) => `> ${line}`).join('\n');
      content = `> [!summary]\n${summaryLines}\n\n${content}`;
    }

    // 导航
    const prev = i > 0 ? sections[i - 1] : null;
    const next = i < sections.length - 1 ? sections[i + 1] : null;
    if (prev || next) {
      content += "\n\n---\n\n";
      if (prev) {
        const pn = sanitizeFileName(`${options.includeIndex ? String(i).padStart(2, "0") + " - " : ""}${prev.title}`);
        content += `← 上一节: [[${pn}|${prev.title}]]`;
      }
      if (prev && next) content += " | ";
      if (next) {
        const nn = sanitizeFileName(`${options.includeIndex ? String(i + 2).padStart(2, "0") + " - " : ""}${next.title}`);
        content += `下一节: [[${nn}|${next.title}]] →`;
      }
    }

    // Frontmatter (v2: only user-visible metadata)
    const frontmatter: Record<string, unknown> = {
      title: section.title,
      source: sanitizeFileName(docName),
      type: "pdf",
      tags: ["pdf", "document", sanitizeTag(docName)],
    };
    if (section.startIndex) frontmatter.page_range = `${section.startIndex}-${section.endIndex}`;

    // 模板
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
  const mocName = options.mocName || `${sanitizeFileName(docName)} - MOC`;
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
    const fn = sanitizeFileName(`${options.includeIndex ? String(i + 1).padStart(2, "0") + " - " : ""}${s.title}`);
    moc += `${indent}- [[${fn}|${s.title}]]\n`;
  }
  moc += `\n---\n\n*由 PageIndex 自动生成*\n`;

  // 6. 写入
  fs.writeFileSync(mocPath, moc);
  for (const note of notes) {
    fs.writeFileSync(note.filePath, `${generateFrontmatter(note.frontmatter)}\n${note.content}`);
  }

  // 7. 写入 tree.json（直接使用 PageIndex 的 TreeNode 结构，附加文件路径映射）
  const nodeFileMap: Record<string, string> = {};
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.nodeId) {
      const fn = sanitizeFileName(`${options.includeIndex ? String(i + 1).padStart(2, "0") + " - " : ""}${s.title}`);
      nodeFileMap[s.nodeId] = `${fn}.md`;
    }
  }
  const treeData = {
    title: docName,
    docDescription: result.docDescription,
    source: options.sourcePdf,
    nodeFileMap,
    structure: result.structure,
  };
  fs.writeFileSync(path.join(bookDir, "tree.json"), JSON.stringify(treeData, null, 2));

  piLog(`[pdf-to-obsidian] 完成！MOC: ${mocPath}, 笔记: ${notes.length}`);
  return { mocPath, notes };
}
