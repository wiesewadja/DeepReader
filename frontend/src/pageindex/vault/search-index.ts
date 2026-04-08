/**
 * bun-pageindex: Obsidian Vault Search Index (Keyword)
 * Builds inverted index and node map for fast keyword search
 */

import type { FileMeta, SearchIndex } from "./types";

export function buildSearchIndex(
  files: Record<string, FileMeta>
): SearchIndex {
  const invertedIndex: Record<string, string[]> = {};
  const nodeMap: Record<string, { file: string; lineNum?: number; localNodeId?: string }> = {};

  // Global counter for unique node IDs across all files
  let globalCounter = 0;
  function nextGlobalId(): string {
    return String(globalCounter++).padStart(6, "0");
  }

  for (const [filePath, fileMeta] of Object.entries(files)) {
    for (const node of fileMeta.result.structure) {
      indexNode(node, filePath, invertedIndex, nodeMap, nextGlobalId);
    }
  }

  return { invertedIndex, nodeMap };
}

function indexNode(
  node: { title: string; nodeId?: string; summary?: string; lineNum?: number; nodes?: unknown[] },
  filePath: string,
  invertedIndex: Record<string, string[]>,
  nodeMap: Record<string, { file: string; lineNum?: number; localNodeId?: string }>,
  nextGlobalId: () => string
): string {
  const gid = nextGlobalId();

  const text = `${node.title} ${node.summary || ""}`.toLowerCase();
  const tokens = tokenize(text);

  for (const token of tokens) {
    if (!invertedIndex[token]) {
      invertedIndex[token] = [];
    }
    if (!invertedIndex[token].includes(gid)) {
      invertedIndex[token].push(gid);
    }
  }

  nodeMap[gid] = {
    file: filePath,
    lineNum: node.lineNum,
    localNodeId: node.nodeId,
  };

  if (node.nodes && (node.nodes as unknown[]).length > 0) {
    for (const child of node.nodes as typeof node[]) {
      indexNode(child, filePath, invertedIndex, nodeMap, nextGlobalId);
    }
  }

  return gid;
}

function tokenize(text: string): string[] {
  // Simple tokenization: split on non-alphanumeric, keep CJK characters
  const tokens = text
    .replace(/([^\w\s\u4e00-\u9fff])/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // Also keep n-grams for CJK text
  const cjkParts = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const cjk of cjkParts) {
    if (cjk.length >= 2) {
      tokens.push(cjk);
      // Bigrams
      for (let i = 0; i < cjk.length - 1; i++) {
        tokens.push(cjk.slice(i, i + 2));
      }
    }
  }

  return [...new Set(tokens)];
}
