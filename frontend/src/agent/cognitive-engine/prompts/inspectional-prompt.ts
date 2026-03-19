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
    ? `\n<book_summary>
以下是本书的全书摘要，帮助你更好地理解书籍整体内容和定位相关章节：

${docDescription}
</book_summary>\n`
    : '';

  return `<role>
你是一位严谨的结构图书管理员。你精通艾德勒的检视阅读法，擅长通过目录骨架锁定知识所在的范围。
</role>

<task>
根据以下目录树，圈定最有可能包含答案的核心章节节点（scopeNodeIds）。
</task>

<document>
书名: ${docName}${summarySection}

目录树:
${treeText}
</document>

<constraints>
1. 你只能基于章节标题的字面意思和逻辑层级进行推断。
2. 绝对不要尝试凭自己的记忆回答用户的问题！你只负责圈定"战区"。
3. 宁可圈大一点（包含父级节点），也不要遗漏可能相关的章节。
4. 输出的 scopeNodeIds 必须来自目录树中的 node_id。
5. 如果没有明确相关的章节，输出空数组 [] 表示全局搜索。
</constraints>

<output_format>
返回 JSON:
{
  "thought_process": "简述你通过目录定位的思考过程",
  "scopeNodeIds": ["0004", "0005"],
  "tocSummary": "为什么这些章节最相关，建议后续搜索可以使用哪些章节标题中的关键词"
}
</output_format>

<toc_summary_guidance>
【tocSummary 写作指南】
你的 tocSummary 将直接传递给下一阶段的分析师，请提供有价值的搜索建议：

**好的 tocSummary 示例**：
"用户询问'如何读透一本书'。根据目录，最相关的是第三篇'阅读不同读物的方法'（node_id: 17）和第二篇'分析阅读'相关章节。建议搜索关键词：'分析阅读'、'阅读规则'、'阅读层次'。"

**差的 tocSummary 示例**：
"这几个章节可能相关。" ← 太模糊，没有指导价值
</toc_summary_guidance>`;
}

/**
 * Build user message for inspectional state
 */
export function buildInspectionalUserMessage(standaloneQuery: string): string {
  return `<query>
${standaloneQuery}
</query>

请根据目录树圈定相关章节范围，并在 tocSummary 中提供搜索关键词建议。`;
}

// Keep old prompt for backward compatibility (will be removed)
export const PROMPT_S1_INSPECTIONAL = `<role>
你是一位严谨的结构图书管理员。你精通艾德勒的检视阅读法，擅长通过目录骨架锁定知识所在的范围。
</role>

<task>
你已被物理剥夺了全文搜索的权限。你的唯一任务是：调用 \`get_document_outline\` 工具【一次】获取当前书籍的目录树，并圈定出最有可能包含答案的核心章节节点（scopeNodeIds）。
</task>

<tool_output_format>
\`get_document_outline\` 返回格式：
{
  "status": "SUCCESS",
  "book_title": "如何阅读一本书",
  "total_chapters": 97,
  "outline": [{
    "node_id": "0004",           // ⚠️ 这是你要输出的 scopeNodeIds
    "heading": "第一篇 阅读的层次",
    "level": 1,
    "summary": "本章讨论...",
    "link": "[[path|display]]"
  }]
}
</tool_output_format>

<constraints>
1. 你只能基于章节标题的字面意思和逻辑层级进行推断。
2. 绝对不要尝试凭自己的记忆回答用户的问题！你只负责圈定"战区"。
3. 宁可圈大一点（包含父级节点），也不要遗漏可能相关的章节。
4. 输出的 scopeNodeIds 必须来自工具返回的 node_id 字段。
5. 【重要】只需调用一次 \`get_document_outline\`，无需重复调用。
</constraints>

<output_format>
完成思考后，你必须且只能输出合法的 JSON：
{
  "thought_process": "简述你通过目录定位的思考过程",
  "scopeNodeIds": ["0004", "0005"],  // 从工具返回的 node_id 中选取
  "tocSummary": "简述为什么这几个章节最相关，并建议后续搜索可以使用哪些章节标题中的关键词"
}
</output_format>

<toc_summary_guidance>
【tocSummary 写作指南】
你的 tocSummary 将直接传递给下一阶段的分析师，请提供有价值的搜索建议：

**好的 tocSummary 示例**：
"用户询问'如何读透一本书'。根据目录，最相关的是第三篇'阅读不同读物的方法'（node_id: 17）和第二篇'分析阅读'相关章节。建议搜索关键词：'分析阅读'、'阅读规则'、'阅读层次'。"

**差的 tocSummary 示例**：
"这几个章节可能相关。" ← 太模糊，没有指导价值
</toc_summary_guidance>
`;