/**
 * 本地 Markdown 工具统一导出 (v2)
 *
 * v2: search_book + read_book_section，移除 get_document_outline
 */

// 工具执行器
export { searchBookTool } from './search-text.js';
export { readBookSectionTool } from './read-section.js';

// 类型定义
export type { LocalToolCache, SearchHit, OutlineNode } from './types.js';

// 工具函数
export {
  getOrBuildLocalCache,
  estimateTokens,
  normalizeHeading,
  MAX_TOKENS,
} from './utils.js';
