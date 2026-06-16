import type { TreeNode } from "./types.js";

export interface FlattenNode {
  nodeId: string;
  level: number; // 0-based
  originalTitle: string;
  text?: string;
  summary?: string;
  parentTitle?: string;
  siblingTitles: string[];
  childTitles: string[];
  physicalIndex?: number;
  path: number[]; // index path in the original tree hierarchy
}

export interface LayerQuality {
  level: number;
  totalNodes: number;
  duplicateCount: number;
  truncatedCount: number;
  abnormallyLongCount: number;
  bookNamePlaceholderCount: number;
  isBroken: boolean;
  reason: "duplicates" | "truncations" | "placeholders" | "ok";
}

/**
 * Normalizes text by converting to lowercase and stripping punctuation/whitespace
 */
export function normalizeForComparison(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, ""); // Remove spacing and punctuation (unicode-aware)
}

/**
 * Checks if a title is truncated based on ellipses
 */
export function isTruncated(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.endsWith("...") || trimmed.endsWith("…");
}

/**
 * Detects dominant language based on Chinese character presence
 */
export function detectLanguage(text: string): "zh" | "en" {
  if (/[\u4e00-\u9fa5]/.test(text)) {
    return "zh";
  }
  return "en";
}

/**
 * Checks if a title is abnormally long (potential paragraph parser error)
 */
export function isAbnormallyLong(title: string): boolean {
  const lang = detectLanguage(title);
  return lang === "zh" ? title.length > 50 : title.length > 100;
}

/**
 * Checks if a title is exactly the book name (placeholder)
 */
export function isBookNamePlaceholder(title: string, bookTitle: string): boolean {
  if (!bookTitle) return false;
  return normalizeForComparison(title) === normalizeForComparison(bookTitle);
}

/**
 * Recursively flattens a TreeNode tree structure into a flat array of FlattenNodes
 */
export function flattenStructure(structure: TreeNode[], bookTitle: string): FlattenNode[] {
  const result: FlattenNode[] = [];

  function traverse(nodes: TreeNode[], parentTitle?: string, currentPath: number[] = [], level = 0) {
    const siblingTitles = nodes.map((n) => n.title || "");

    nodes.forEach((node, index) => {
      const nodeId = node.nodeId || "";
      const childTitles = (node.nodes || []).map((n) => n.title || "");
      const path = [...currentPath, index];

      const flattenNode: FlattenNode = {
        nodeId,
        level,
        originalTitle: node.title || "",
        text: node.text,
        summary: node.summary,
        parentTitle,
        siblingTitles: siblingTitles.filter((_, i) => i !== index),
        childTitles,
        path,
      };

      result.push(flattenNode);

      if (node.nodes && node.nodes.length > 0) {
        traverse(node.nodes, node.title, path, level + 1);
      }
    });
  }

  traverse(structure);
  return result;
}

/**
 * Analyzes flatten nodes layer-by-layer (by depth level) to assess quality metrics
 */
export function assessByLevel(flattenNodes: FlattenNode[], bookTitle: string): LayerQuality[] {
  const nodesByLevel = new Map<number, FlattenNode[]>();
  flattenNodes.forEach((node) => {
    const list = nodesByLevel.get(node.level) || [];
    list.push(node);
    nodesByLevel.set(node.level, list);
  });

  const qualities: LayerQuality[] = [];
  const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);

  for (const level of sortedLevels) {
    const nodes = nodesByLevel.get(level)!;
    const totalNodes = nodes.length;
    if (totalNodes === 0) continue;

    // 1. Duplicates
    const titleCounts = new Map<string, number>();
    nodes.forEach((n) => {
      const val = n.originalTitle.trim().toLowerCase();
      titleCounts.set(val, (titleCounts.get(val) || 0) + 1);
    });
    let duplicateCount = 0;
    nodes.forEach((n) => {
      const val = n.originalTitle.trim().toLowerCase();
      if ((titleCounts.get(val) || 0) >= 2) {
        duplicateCount++;
      }
    });

    // 2. Truncation and Overflow
    let truncatedCount = 0;
    let abnormallyLongCount = 0;
    nodes.forEach((n) => {
      if (isTruncated(n.originalTitle)) {
        truncatedCount++;
      }
      if (isAbnormallyLong(n.originalTitle)) {
        abnormallyLongCount++;
      }
    });

    // 3. Book Name Placeholder
    let bookNamePlaceholderCount = 0;
    nodes.forEach((n) => {
      if (isBookNamePlaceholder(n.originalTitle, bookTitle)) {
        bookNamePlaceholderCount++;
      }
    });

    // Ratio thresholds
    const dupRatio = duplicateCount / totalNodes;
    const truncRatio = (truncatedCount + abnormallyLongCount) / totalNodes;
    const placeholderRatio = bookNamePlaceholderCount / totalNodes;

    let isBroken = false;
    let reason: LayerQuality["reason"] = "ok";

    if (placeholderRatio >= 0.3) {
      isBroken = true;
      reason = "placeholders";
    } else if (truncRatio >= 0.3) {
      isBroken = true;
      reason = "truncations";
    } else if (dupRatio >= 0.3) {
      isBroken = true;
      reason = "duplicates";
    }

    qualities.push({
      level,
      totalNodes,
      duplicateCount,
      truncatedCount,
      abnormallyLongCount,
      bookNamePlaceholderCount,
      isBroken,
      reason,
    });
  }

  return qualities;
}
