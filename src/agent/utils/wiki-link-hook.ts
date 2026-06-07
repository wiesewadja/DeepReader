/**
 * Wiki Link Post-Processing Hook
 *
 * Comprehensive validation and correction of wiki links in LLM output:
 * 1. Parse various wiki link styles (correct, malformed, missing components)
 * 2. Validate file path and blockId existence
 * 3. Find closest matching document and blockId for invalid links
 * 4. Apply corrections to output
 */

import type { App } from 'obsidian';
import * as path from 'path';
import { agentLog as log } from '../../utils/logger.js';
import type { ToolResultEntry } from '../graph/utils/self-verification.js';

export interface WikiLinkIssue {
  original: string;
  issueType: 'file_not_found' | 'block_not_found' | 'malformed_format' | 'missing_caret' | 'wrong_book';
  parsed: ParsedWikiLink;
  suggestedCorrection: string | null;
  confidence: number;
}

export interface ParsedWikiLink {
  bookName: string;
  fileName: string;
  heading?: string;
  blockId?: string;
  displayText: string;
  rawPath: string;
}

export interface LinkCorrectionContext {
  app: App;
  bookName: string;
  vaultPath: string;
  toolResults: ToolResultEntry[];
  /**
   * 跨书模式：传 true 时，链接 bookName 与 context.bookName 不一致不会
   * 触发 wrong_book issue（书单模式下允许跨书引用）
   */
  expectedBookName?: string;
}

export interface WikiLinkMetrics {
  totalLinks: number;
  validLinks: number;
  deadLinksRemoved: number;
  autoCorrectedLinks: number;
}

export interface WikiLinkValidationResult {
  correctedContent: string;
  issues: WikiLinkIssue[];
  correctionsApplied: number;
  metrics: WikiLinkMetrics;
}

const WIKI_LINK_PATTERN = /\[\[([^\]]+)\]\]/g;

function parseWikiLinkInternal(linkContent: string): ParsedWikiLink | null {
  const parts = linkContent.split('|');
  const rawPath = parts[0].trim();
  const displayText = parts.length > 1 ? parts[1].trim() : rawPath.split('/').pop() || rawPath;

  const pathParts = rawPath.split('/');
  if (pathParts.length < 2) {
    return {
      bookName: '',
      fileName: pathParts[0] || '',
      displayText,
      rawPath,
    };
  }

  const bookName = pathParts[0];
  const filePart = pathParts.slice(1).join('/');

  const hashMatch = filePart.match(/#([^#]+)$/);
  const fileName = hashMatch ? filePart.slice(0, filePart.length - hashMatch[0].length) : filePart;
  const hashPart = hashMatch ? hashMatch[1] : undefined;

  const blockIdMatch = hashPart?.match(/\^([a-zA-Z0-9_-]+)/);
  const blockId = blockIdMatch ? blockIdMatch[1] : undefined;
  const heading = hashPart && !blockIdMatch ? hashPart : undefined;

  return {
    bookName,
    fileName: fileName.replace(/\.md$/, ''),
    heading,
    blockId,
    displayText,
    rawPath,
  };
}

function detectLinkIssues(parsed: ParsedWikiLink, expectedBookName: string): WikiLinkIssue['issueType'][] {
  const issues: WikiLinkIssue['issueType'][] = [];

  // 跨书模式（expectedBookName 为空）：禁用 wrong_book 检查
  if (expectedBookName === '') {
    return issues;
  }

  if (!parsed.bookName || parsed.bookName !== expectedBookName) {
    issues.push('wrong_book');
  }

  if (!parsed.fileName) {
    issues.push('malformed_format');
  }

  if (parsed.rawPath.includes('#') && !parsed.rawPath.includes('#^') && !parsed.heading) {
    issues.push('missing_caret');
  }

  return issues;
}

async function findClosestFile(
  app: App,
  vaultPath: string,
  bookName: string,
  targetFileName: string
): Promise<string | null> {
  const bookDir = path.join(vaultPath, 'DeepReader', bookName);

  try {
    const exists = await app.vault.adapter.exists(bookDir);
    if (!exists) return null;

    const files = await app.vault.adapter.list(bookDir);
    const mdFiles = files.files.filter((f: string) => f.endsWith('.md'));

    const exactMatch = mdFiles.find((f: string) => {
      const basename = path.basename(f, '.md');
      return basename === targetFileName || basename === `${targetFileName}.md`;
    });
    if (exactMatch) return path.basename(exactMatch, '.md');

    const targetTitle = targetFileName.replace(/^\d+-/, '').trim();
    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const file of mdFiles) {
      const basename = path.basename(file, '.md');
      const fileTitle = basename.replace(/^\d+-/, '').trim();
      const score = calculateSimilarity(targetTitle, fileTitle);

      if (score > bestScore && score > 0.4) {
        bestScore = score;
        bestMatch = basename;
      }
    }

    return bestMatch;
  } catch {
    return null;
  }
}

function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1.includes(s2) || s2.includes(s1)) {
    return Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
  }

  let common = 0;
  const s2Set = new Set(s2);
  for (const c of s1) {
    if (s2Set.has(c)) common++;
  }
  return common / Math.max(s1.length, s2.length);
}

function findClosestFileInCachedList(
  cachedFiles: string[],
  targetFileName: string
): string | null {
  // 先去除 .md 后缀
  const targetBase = targetFileName.replace(/\.md$/, '');
  const targetTitle = targetBase.replace(/^\d+-/, '').trim();

  // 完全匹配
  for (const file of cachedFiles) {
    const basename = path.basename(file, '.md');
    if (basename === targetBase || basename === `${targetBase}.md`) {
      return basename;
    }
  }

  if (!targetTitle) return null;

  // 模糊匹配
  let bestMatch: string | null = null;
  let bestScore = 0;
  for (const file of cachedFiles) {
    const basename = path.basename(file, '.md');
    const fileTitle = basename.replace(/^\d+-/, '').trim();
    const score = calculateSimilarity(targetTitle, fileTitle);
    if (score > bestScore && score > 0.4) {
      bestScore = score;
      bestMatch = basename;
    }
  }
  return bestMatch;
}

function findClosestBlockId(
  targetBlockId: string | undefined,
  toolResults: ToolResultEntry[]
): string | null {
  if (!targetBlockId) return null;

  const allBlockIds: string[] = [];
  for (const entry of toolResults) {
    if (entry.toolName === 'search_book' || entry.toolName === 'read_book_section') {
      const blockPattern = /\^([a-zA-Z0-9_-]+)/g;
      let match;
      while ((match = blockPattern.exec(entry.result)) !== null) {
        allBlockIds.push(match[1]);
      }
    }
  }

  if (allBlockIds.length === 0) return null;

  if (allBlockIds.includes(targetBlockId)) return targetBlockId;

  const cleanTarget = targetBlockId.replace(/^p/, '');
  const prefixMatch = allBlockIds.find(id => id.startsWith(cleanTarget) || cleanTarget.startsWith(id.replace(/^p/, '')));
  if (prefixMatch) return prefixMatch;

  const numMatch = targetBlockId.match(/\d+/);
  if (numMatch) {
    const targetNum = parseInt(numMatch[0], 10);
    const closest = allBlockIds.reduce<string | null>((best, id) => {
      const idMatch = id.match(/\d+/);
      if (!idMatch) return best;
      const idNum = parseInt(idMatch[0], 10);
      const diff = Math.abs(idNum - targetNum);
      const bestMatch = best?.match(/\d+/);
      const bestDiff = bestMatch ? Math.abs(parseInt(bestMatch[0], 10) - targetNum) : Infinity;
      return diff < bestDiff ? id : best;
    }, null);
    if (closest) return closest;
  }

  return null;
}

function buildCorrectedLink(
  parsed: ParsedWikiLink,
  correctedFile: string | null,
  correctedBlockId: string | null,
  expectedBookName: string
): string | null {
  if (!correctedFile && !parsed.fileName) return null;

  const bookName = parsed.bookName === expectedBookName ? parsed.bookName : expectedBookName;
  const fileName = correctedFile || parsed.fileName;

  if (correctedBlockId || parsed.blockId) {
    const blockId = correctedBlockId || parsed.blockId;
    return `[[${bookName}/${fileName}#^${blockId}|${parsed.displayText}]]`;
  }

  if (parsed.heading) {
    return `[[${bookName}/${fileName}#${parsed.heading}|${parsed.displayText}]]`;
  }

  return `[[${bookName}/${fileName}|${parsed.displayText}]]`;
}

export async function validateWikiLinks(
  content: string,
  context: LinkCorrectionContext
): Promise<WikiLinkValidationResult> {
  const issues: WikiLinkIssue[] = [];
  const corrections: Map<string, string> = new Map();
  const deadLinksRemoved = new Set<string>();
  const autoCorrectedLinks = new Set<string>();

  const matches = Array.from(content.matchAll(WIKI_LINK_PATTERN));
  const totalLinks = matches.length;

  // 批量缓存：每本书的 list 结果只取一次
  const bookDirCache = new Map<string, string[]>();
  const getCachedBookFiles = async (bookName: string): Promise<string[] | null> => {
    if (bookDirCache.has(bookName)) return bookDirCache.get(bookName)!;
    const bookDir = path.join(context.vaultPath, 'DeepReader', bookName);
    try {
      const exists = await context.app.vault.adapter.exists(bookDir);
      if (!exists) {
        bookDirCache.set(bookName, []);
        return null;
      }
      const files = await context.app.vault.adapter.list(bookDir);
      const mdFiles = files.files.filter((f: string) => f.endsWith('.md'));
      bookDirCache.set(bookName, mdFiles);
      return mdFiles;
    } catch {
      bookDirCache.set(bookName, []);
      return null;
    }
  };

  for (const match of matches) {
    const fullMatch = match[0];
    const linkContent = match[1];
    const parsed = parseWikiLinkInternal(linkContent);

    if (!parsed) continue;

    // T1.2: expectedBookName 优先于 context.bookName
    const expectedBookName = context.expectedBookName !== undefined
      ? context.expectedBookName
      : context.bookName;
    const detectedIssues = detectLinkIssues(parsed, expectedBookName);

    // T1.1: 文件存在性检查前置 - 即使 detectedIssues 为空也校验
    let fileExists = false;
    if (parsed.fileName) {
      const filePath = path.join(context.vaultPath, 'DeepReader', parsed.bookName, `${parsed.fileName}.md`);
      fileExists = await context.app.vault.adapter.exists(filePath);

      if (fileExists && parsed.blockId) {
        const blockExists = findClosestBlockId(parsed.blockId, context.toolResults);
        if (blockExists !== parsed.blockId) {
          detectedIssues.push('block_not_found');
        }
      } else if (!fileExists) {
        detectedIssues.push('file_not_found');
      }
    }

    if (detectedIssues.length === 0) {
      // 有效链接
      continue;
    }

    let correctedFile: string | null = null;
    let correctedBlockId: string | null = null;
    let confidence = 0;

    if (detectedIssues.includes('file_not_found') || detectedIssues.includes('wrong_book')) {
      // T1.2: wrong_book 时在 expectedBookName 目录下找
      const bookToUse = detectedIssues.includes('wrong_book') ? expectedBookName : parsed.bookName;
      const cachedFiles = await getCachedBookFiles(bookToUse);
      if (cachedFiles) {
        // 直接使用缓存的列表做模糊匹配
        correctedFile = findClosestFileInCachedList(cachedFiles, parsed.fileName);
      }
      confidence = correctedFile ? 0.7 : 0;
    }

    if (detectedIssues.includes('block_not_found') || parsed.blockId) {
      correctedBlockId = findClosestBlockId(parsed.blockId, context.toolResults);
      if (correctedBlockId === parsed.blockId) correctedBlockId = null;
      confidence = Math.max(confidence, correctedBlockId ? 0.8 : 0);
    }

    const suggestedCorrection = buildCorrectedLink(
      parsed,
      correctedFile,
      correctedBlockId,
      expectedBookName
    );

    issues.push({
      original: fullMatch,
      issueType: detectedIssues[0],
      parsed,
      suggestedCorrection,
      confidence,
    });

    if (suggestedCorrection && confidence > 0.5) {
      corrections.set(fullMatch, suggestedCorrection);
      autoCorrectedLinks.add(fullMatch);
    } else {
      // 无可信纠正 → 记录为死链
      deadLinksRemoved.add(fullMatch);
    }
  }

  let correctedContent = content;
  for (const [original, corrected] of corrections) {
    correctedContent = correctedContent.replace(original, corrected);
    log('[WikiLinkHook] Corrected:', original, '->', corrected);
  }

  return {
    correctedContent,
    issues,
    correctionsApplied: corrections.size,
    metrics: {
      totalLinks,
      validLinks: totalLinks - issues.length,
      deadLinksRemoved: deadLinksRemoved.size,
      autoCorrectedLinks: autoCorrectedLinks.size,
    },
  };
}

export async function wikiLinkPostProcessingHook(
  content: string,
  context: LinkCorrectionContext
): Promise<string> {
  const result = await validateWikiLinks(content, context);

  if (result.correctionsApplied > 0) {
    log(`[WikiLinkHook] Applied ${result.correctionsApplied} corrections`);
  }

  return result.correctedContent;
}