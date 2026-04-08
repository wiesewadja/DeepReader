/**
 * Wiki 链接校验器
 *
 * 功能：
 * 1. 校验 AI 回复中的 wiki 链接是否指向真实文件
 * 2. 如果文件不存在，尝试模糊匹配找到正确文件
 * 3. 记录 AI 引用的章节，用于熟悉度更新
 */

import type { App } from 'obsidian';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

/**
 * Wiki 链接解析结果
 */
export interface ParsedWikiLink {
  fullPath: string;      // 完整路径，如 "西方史纲/08-八、抗议.md"
  displayText: string;   // 显示文本，如 "八、抗议"
  folder: string;        // 文件夹，如 "西方史纲"
  filename: string;      // 文件名（含扩展名），如 "08-八、抗议.md"
}

/**
 * 校验后的链接信息
 */
export interface ValidatedLink {
  original: string;           // 原始链接
  corrected: string;          // 纠正后的链接（如果需要）
  isCorrected: boolean;       // 是否被纠正
  existsPath: string | null;  // 实际存在的路径
  chapterIndex: number | null; // 章节索引（如果能提取）
}

/**
 * 从 nodeId 提取章节索引
 * 格式如 "0006" -> 6
 */
function extractChapterIndexFromNodeId(nodeId: string): number | null {
  const num = parseInt(nodeId, 10);
  return isNaN(num) ? null : num;
}

/**
 * 从文件名提取章节索引
 * 格式如 "08-八、抗议.md" -> 8
 * 或者 "11-八、抗议.md" -> 11
 */
function extractChapterIndexFromFilename(filename: string): number | null {
  const match = filename.match(/^(\d+)-/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * 解析 wiki 链接
 * 格式: [[路径|显示文本]] 或 [[路径]]
 */
export function parseWikiLink(linkText: string): ParsedWikiLink | null {
  // 匹配 [[路径|显示文本]] 或 [[路径]]
  const match = linkText.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!match) {
    return null;
  }

  const fullPath = match[1].trim();
  const displayText = (match[2] || fullPath.split('/').pop() || '').trim();

  // 分离文件夹和文件名
  const parts = fullPath.split('/');
  const filename = parts.pop() || '';
  const folder = parts.join('/');

  return {
    fullPath,
    displayText,
    folder,
    filename,
  };
}

/**
 * 模糊匹配文件名
 * 在指定目录下查找最相似的文件
 *
 * 策略：
 * 1. 先尝试完全匹配
 * 2. 如果失败，提取章节标题（去除编号）进行模糊匹配
 * 3. 返回最相似的文件
 */
export async function fuzzyMatchFile(
  app: App,
  folder: string,
  targetFilename: string
): Promise<string | null> {
  const folderPath = `DeepReader/${folder}`;

  try {
    // 检查文件夹是否存在
    const folderExists = await app.vault.adapter.exists(folderPath);
    if (!folderExists) {
      log('[LinkValidator] 文件夹不存在:', folderPath);
      return null;
    }

    // 获取文件夹下所有 .md 文件
    const files = await app.vault.adapter.list(folderPath);
    const mdFiles = files.files.filter((f: string) => f.endsWith('.md'));

    // 1. 完全匹配
    const exactMatch = mdFiles.find((f: string) => f.endsWith(`/${targetFilename}`));
    if (exactMatch) {
      return exactMatch;
    }

    // 2. 提取章节标题进行模糊匹配
    // 例如: "08-八、抗议.md" -> "八、抗议"
    const targetTitle = targetFilename
      .replace('.md', '')
      .replace(/^\d+-/, '')  // 移除开头的数字和连字符
      .trim();

    if (!targetTitle) {
      return null;
    }

    // 计算每个文件的相似度
    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const file of mdFiles) {
      const filename = file.split('/').pop() || '';
      const fileTitle = filename
        .replace('.md', '')
        .replace(/^\d+-/, '')
        .trim();

      // 计算相似度（简单的包含匹配）
      const score = calculateSimilarity(targetTitle, fileTitle);

      if (score > bestScore && score > 0.5) {  // 阈值 0.5
        bestScore = score;
        bestMatch = file;
      }
    }

    if (bestMatch) {
      log('[LinkValidator] 模糊匹配成功:', targetFilename, '->', bestMatch, '分数:', bestScore);
    }

    return bestMatch;
  } catch (err) {
    logError('[LinkValidator] 模糊匹配失败:', err);
    return null;
  }
}

/**
 * 计算两个字符串的相似度 (0-1)
 * 使用简单的字符重叠比例
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;

  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);

  if (maxLen === 0) return 1;

  // 计算编辑距离的简化版本
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  // 检查是否一个包含另一个
  if (s1.includes(s2) || s2.includes(s1)) {
    return Math.min(len1, len2) / maxLen;
  }

  // 计算共同字符数
  let commonChars = 0;
  const s2Chars = new Set(s2);

  for (const char of s1) {
    if (s2Chars.has(char)) {
      commonChars++;
    }
  }

  return commonChars / maxLen;
}

/**
 * 校验并纠正 AI 回复中的所有 wiki 链接
 *
 * @param app Obsidian App 实例
 * @param content AI 回复内容
 * @returns { correctedContent: 纠正后的内容, validatedLinks: 校验结果列表 }
 */
export async function validateAndCorrectLinks(
  app: App,
  content: string
): Promise<{
  correctedContent: string;
  validatedLinks: ValidatedLink[];
}> {
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const validatedLinks: ValidatedLink[] = [];
  let correctedContent = content;
  const corrections: Array<{ original: string; corrected: string }> = [];

  // 收集所有链接
  const matches = Array.from(content.matchAll(wikiLinkRegex));

  // 批量处理所有链接
  for (const match of matches) {
    const fullMatch = match[0];
    const parsed = parseWikiLink(fullMatch);

    if (!parsed) continue;

    const { folder, filename, fullPath, displayText } = parsed;

    // 检查文件是否存在
    const fullPathInVault = `DeepReader/${fullPath}`;
    const exists = await app.vault.adapter.exists(fullPathInVault);

    if (exists) {
      // 文件存在，记录引用
      const chapterIndex = extractChapterIndexFromFilename(filename);
      validatedLinks.push({
        original: fullMatch,
        corrected: fullMatch,
        isCorrected: false,
        existsPath: fullPathInVault,
        chapterIndex,
      });
    } else {
      // 文件不存在，尝试模糊匹配
      const matchedPath = await fuzzyMatchFile(app, folder, filename);

      if (matchedPath) {
        // 找到匹配，生成纠正后的链接
        const correctedFilename = matchedPath.split('/').pop() || filename;
        const correctedFullPath = `${folder}/${correctedFilename}`;
        const correctedLink = `[[${correctedFullPath}|${displayText}]]`;

        corrections.push({
          original: fullMatch,
          corrected: correctedLink,
        });

        const chapterIndex = extractChapterIndexFromFilename(correctedFilename);
        validatedLinks.push({
          original: fullMatch,
          corrected: correctedLink,
          isCorrected: true,
          existsPath: matchedPath,
          chapterIndex,
        });

        log('[LinkValidator] 链接纠正:', fullPath, '->', correctedFullPath);
      } else {
        // 没找到匹配，保留原链接
        validatedLinks.push({
          original: fullMatch,
          corrected: fullMatch,
          isCorrected: false,
          existsPath: null,
          chapterIndex: null,
        });

        log('[LinkValidator] 无法找到匹配:', fullPath);
      }
    }
  }

  // 应用所有纠正
  for (const { original, corrected } of corrections) {
    correctedContent = correctedContent.replace(original, corrected);
  }

  return { correctedContent, validatedLinks };
}

/**
 * 从校验结果中提取所有成功引用的章节索引
 */
export function extractReferencedChapters(validatedLinks: ValidatedLink[]): number[] {
  return validatedLinks
    .filter(link => link.existsPath !== null && link.chapterIndex !== null)
    .map(link => link.chapterIndex!)
    .filter((index, i, arr) => arr.indexOf(index) === i); // 去重
}
