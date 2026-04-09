/**
 * 本地工具类型定义 (v2)
 *
 * tree.json 为唯一数据源，不再依赖 frontmatter 扫描
 */

/**
 * 本地工具缓存（存储在 ToolContext 中）
 */
export interface LocalToolCache {
  /** tree.json 数据（从 .pageindex/{bookId}/tree.json 加载） */
  treeData?: any;

  /** 从 tree.json structure 构建的 nodeId → title 映射 */
  nodeTitleMap?: Map<string, string>;
}

export interface SearchHit {
  node_id: string;
  title: string;
  path: string[];
  matched_blocks: Array<{
    block_id: string;
    content: string;
  }>;
  score: number;
}

export interface OutlineNode {
  node_id: string;
  heading: string;
  level: number;
  summary?: string;
  children?: OutlineNode[];
}
