/**
 * 本地 Markdown 工具类型定义
 */

import type { TFile } from 'obsidian';

/**
 * 本地工具缓存（存储在 ToolContext 中）
 */
export interface LocalToolCache {
  /** 文件列表缓存 */
  chapterFiles?: TFile[];

  /** block_id → 文件路径 映射（如 ^ch2-p1 → DeepReader/书名/04-第一章.md） */
  blockIdIndex?: Map<string, string>;

  /** node_id → 文件路径 映射（如 0006 → DeepReader/书名/06-第三章.md） */
  nodeIdIndex?: Map<string, string>;

  /** 标题 → 文件路径 映射（如 "MECE原则" → DeepReader/书名/08-MECE原则.md） */
  headingIndex?: Map<string, string>;
}

/**
 * 章节元数据（从 frontmatter 提取）
 */
export interface ChapterMetadata {
  node_id: string;
  section: string;
  level: number;
  summary?: string;
  page_range?: string;
  part?: string;
}

/**
 * 搜索命中结果
 */
export interface SearchHit {
  location: {
    heading: string;
    path: string[];
    file_path: string;
  };
  line_number: number;
  snippet: string;
  block_id: string;
}

/**
 * 大纲节点
 */
export interface OutlineNode {
  heading: string;
  line: number;
  summary?: string;
  block_id?: string;
  children?: OutlineNode[];
}
