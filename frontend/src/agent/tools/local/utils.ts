/**
 * 本地 Markdown 工具共享函数
 */

import type { App, TFile } from 'obsidian';
import type { LocalToolCache, ChapterMetadata } from './types.js';

/**
 * Token 上限常量
 */
export const MAX_TOKENS = 4000;
export const MAX_SEARCH_HITS = 10;

/**
 * 构建本地工具缓存
 *
 * 扫描 DeepReader/{bookName}/ 目录下的 Markdown 文件，
 * 构建三种索引：node_id、block_id、heading
 */
export async function buildLocalCache(
  app: App,
  bookName: string
): Promise<LocalToolCache> {
  const files = app.vault.getMarkdownFiles()
    .filter(f => f.path.startsWith(`DeepReader/${bookName}/`))
    .filter(f => !f.path.endsWith(`${bookName}.md`)); // 排除主文件

  const nodeIdIndex = new Map<string, string>();
  const blockIdIndex = new Map<string, string>();
  const headingIndex = new Map<string, string>();

  for (const file of files) {
    // 构建 node_id 索引
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.node_id) {
      nodeIdIndex.set(String(cache.frontmatter.node_id), file.path);
    }

    // 构建 heading 索引（从 section 提取）
    if (cache?.frontmatter?.section) {
      const sectionPath = String(cache.frontmatter.section);
      const heading = sectionPath.split('>').pop()?.trim();
      if (heading) {
        headingIndex.set(heading, file.path);
      }
    }

    // 构建 block_id 索引（扫描文件内容）
    const content = await app.vault.cachedRead(file);
    const blockMatches = content.matchAll(/\^[\w-]+/g);
    for (const match of blockMatches) {
      blockIdIndex.set(match[0], file.path);
    }
  }

  return { chapterFiles: files, nodeIdIndex, blockIdIndex, headingIndex };
}

/**
 * 从 frontmatter 提取章节元数据
 */
export function extractChapterMetadata(
  frontmatter: Record<string, unknown>
): ChapterMetadata {
  return {
    node_id: String(frontmatter.node_id || ''),
    section: String(frontmatter.section || ''),
    level: Number(frontmatter.level ?? 0),
    summary: frontmatter.summary ? String(frontmatter.summary) : undefined,
    page_range: frontmatter.page_range ? String(frontmatter.page_range) : undefined,
    part: frontmatter.part ? String(frontmatter.part) : undefined,
  };
}

/**
 * 估算 Token 数量
 * - 中文: 字数 / 2
 * - 英文: 单词数
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;

  return Math.ceil(chineseChars / 2) + englishWords;
}

/**
 * 解析标题路径（从 section 字段）
 * "第一篇 > 第一章 > MECE" => ["第一篇", "第一章", "MECE"]
 */
export function parseSectionPath(section: string): string[] {
  return section.split('>').map(s => s.trim()).filter(Boolean);
}

/**
 * 从文件名提取章节标题
 * "04-第一章 阅读的活力与艺术.md" => "第一章 阅读的活力与艺术"
 */
export function extractHeadingFromPath(path: string): string {
  const fileName = path.split('/').pop() || '';
  return fileName.replace(/^\d+-/, '').replace('.md', '');
}

/**
 * 规范化标题（去除空格、标点差异）
 */
export function normalizeHeading(heading: string): string {
  return heading
    .replace(/[#\s]/g, '')
    .replace(/[：:]/g, ':')
    .replace(/[，,]/g, ',')
    .toLowerCase();
}
