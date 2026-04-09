/**
 * 本地 Markdown 工具共享函数
 */

import type { App, TFile } from 'obsidian';
import type { LocalToolCache, ChapterMetadata } from './types.js';
import type { ToolContext } from '../types.js';

/**
 * Token 上限常量
 */
export const MAX_TOKENS = 4000;

/**
 * 搜索相关常量
 */
export const HARD_LIMIT_HITS = 200;  // 物理防爆阀：超过此数量直接报错
export const TOP_N_HITS = 5;         // 返回给 LLM 的 Top N 结果

// 保留旧常量名以兼容旧代码（已废弃，使用 HARD_LIMIT_HITS）
export const MAX_SEARCH_HITS = HARD_LIMIT_HITS;

/**
 * 获取或构建本地工具缓存
 *
 * 优先从 ToolContext 中获取已构建的缓存，避免重复扫描文件。
 * 如果缓存不存在，则构建新缓存并存储到 ToolContext 中。
 *
 * @param context - 工具上下文
 * @returns 本地工具缓存
 */
export async function getOrBuildLocalCache(
  context: ToolContext
): Promise<LocalToolCache> {
  const { app, pdfName, localCache } = context;

  // 如果已有缓存，直接返回
  if (localCache?.chapterFiles && localCache.nodeIdIndex) {
    return localCache;
  }

  // 构建新缓存
  const cache = await buildLocalCache(app!, pdfName);

  // 存储到 context 中供后续复用
  context.localCache = cache;

  return cache;
}

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
    // 构建 node_id 索引（规范化：去除前导零）
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.node_id) {
      const normalizedId = normalizeNodeId(cache.frontmatter.node_id);
      if (normalizedId) {
        nodeIdIndex.set(normalizedId, file.path);
      }
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

/**
 * 规范化 node_id（去除前导零）
 *
 * YAML 解析器可能将 "0010" 解析为数字 10，
 * 所以需要统一规范化，确保 "0010"、"010"、"10" 都能匹配。
 *
 * @param id - 原始 node_id（可能是字符串或数字）
 * @returns 规范化后的 node_id
 */
export function normalizeNodeId(id: string | number | undefined | null): string {
  if (id === undefined || id === null) return '';
  return String(id).replace(/^0+/, '') || '0';
}
