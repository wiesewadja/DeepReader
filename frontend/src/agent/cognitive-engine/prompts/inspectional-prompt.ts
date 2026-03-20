/**
 * S1 Inspectional Reading System Prompt
 *
 * Core objective: Only check TOC, lock the scope.
 * LLM directly reasons on the formatted tree structure (no tool call needed).
 */

import type { OutlineNode } from '../../tools/local/types';

/**
 * Format tree structure for LLM prompt
 * Similar to backend's format_tree_structure in llm_tree_search.py
 *
 * Output example:
 * ├── 第一章 投资入门 (node_id: 0001)
 * │   摘要: 介绍投资的基本概念...
 * │   ├── 1.1 什么是投资 (node_id: 0002)
 * │   │   摘要: 投资的定义和分类...
 */
export function formatTreeStructure(
  nodes: OutlineNode[],
  indent: number = 0,
  maxTextLength: number = 100,
  maxDepth: number = 4
): string {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;

    // Build prefix
    const prefix = '    '.repeat(indent) + (isLast ? '└── ' : '├── ');

    // Title line with node_id
    const titleLine = `${prefix}${node.heading} (node_id: ${node.node_id})`;
    lines.push(titleLine);

    // Add summary if available and within depth limit
    if (node.summary && indent < maxDepth) {
      const truncatedSummary = node.summary.length > maxTextLength
        ? node.summary.slice(0, maxTextLength) + '...'
        : node.summary;
      const summaryPrefix = '    '.repeat(indent + 1) + '摘要: ';
      lines.push(`${summaryPrefix}${truncatedSummary}`);
    }

    // Recursively process children
    if (node.children && node.children.length > 0 && indent < maxDepth) {
      const childText = formatTreeStructure(node.children, indent + 1, maxTextLength, maxDepth);
      lines.push(childText);
    }
  }

  return lines.join('\n');
}

/**
 * Build system prompt for inspectional state with formatted tree
 */
export function buildInspectionalSystemPrompt(
  treeText: string,
  docName: string,
  docDescription?: string
): string {
  const summarySection = docDescription
    ? `\n<book_summary>\n${docDescription}\n</book_summary>\n`
    : '';

  return `<role>
结构图书管理员。通过目录骨架圈定知识范围。
</role>

<document>
书名: ${docName}${summarySection}
目录树:
${treeText}
</document>

<task>
根据目录树圈定最相关的章节节点（scopeNodeIds）。
</task>

<constraints>
1. 只基于章节标题和摘要推断，不凭记忆回答问题。
2. 宁可圈大一点，也不要遗漏相关章节。
3. scopeNodeIds 必须来自目录树中的 node_id。
4. 无相关章节时输出空数组 []。
</constraints>

<output_format>
返回 JSON:
{
  "thought_process": "定位思考过程",
  "scopeNodeIds": ["0004", "0005"],
  "tocSummary": "为什么这些章节相关，建议搜索哪些关键词"
}
</output_format>`;
}

/**
 * Build user message for inspectional state
 */
export function buildInspectionalUserMessage(standaloneQuery: string): string {
  return `<query>
${standaloneQuery}
</query>

根据目录树圈定相关章节范围，在 tocSummary 中提供搜索关键词建议。`;
}