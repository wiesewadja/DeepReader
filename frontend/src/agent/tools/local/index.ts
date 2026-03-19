/**
 * 本地 Markdown 工具统一导出
 *
 * 这些工具直接操作 Obsidian Vault 中的 Markdown 文件，
 * 无需后端 API 支持，实现零外部依赖的本地化智能阅读。
 */

// 工具执行器
export { getDocumentOutlineTool } from './get-outline.js';
export { searchMarkdownTextTool } from './search-text.js';
export { readMarkdownSectionTool } from './read-section.js';

// 类型定义
export type { LocalToolCache, ChapterMetadata, SearchHit, OutlineNode } from './types.js';

// 工具函数
export {
  buildLocalCache,
  extractChapterMetadata,
  estimateTokens,
  parseSectionPath,
  extractHeadingFromPath,
  normalizeHeading,
  MAX_TOKENS,
  MAX_SEARCH_HITS
} from './utils.js';
