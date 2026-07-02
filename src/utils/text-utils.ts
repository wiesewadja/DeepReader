/**
 * Text Processing Utilities
 *
 * Shared text processing constants and functions.
 * Single source of truth for CJK stop words across the codebase.
 */

/**
 * CJK stop words used for BM25 tokenization and search filtering.
 * Extracted from analytical-pre-search.ts and bm25.ts to eliminate duplication.
 */
export const CJK_STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些', '个', '么',
  '什么', '如何', '怎么', '为', '与', '及', '等', '被', '从', '把', '让',
]);
