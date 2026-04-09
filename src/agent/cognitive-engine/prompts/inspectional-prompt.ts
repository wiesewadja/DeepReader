/**
 * S1 Inspectional Reading System Prompt
 *
 * Core objective: Context-aware inspectional reading.
 * - Depth 1: Generate structural analysis (独立作答)
 * - Depth 2/3: Lock scope for analytical reading (打辅助)
 *
 * LLM directly reasons on the formatted tree structure (no tool call needed).
 */

import type { OutlineNode } from '../../tools/local/types';
import type { ReadingDepth } from '../types';

/**
 * Format tree structure for LLM prompt
 * Similar to backend's format_tree_structure in llm_tree_search.py
 *
 * Output example:
 * ├── 第一章 投资入门 (node_id: 0001, link: [[书名/01-第一章]])
 * │   摘要: 介绍投资的基本概念...
 * │   ├── 1.1 什么是投资 (node_id: 0002, link: [[书名/01-第一章#1.1]])
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
 * Build system prompt for inspectional state with depth-aware branching
 */
export function buildInspectionalSystemPrompt(
  treeText: string,
  docName: string,
  depth: ReadingDepth,
  docDescription?: string
): string {
  const summarySection = docDescription
    ? `\n<book_summary>\n${docDescription}\n</book_summary>\n`
    : '';

  // 根据深度生成分支指令
  const taskBranch = depth === 1
    ? `<task_branch name="宏观检视">
用户的意图是了解全书结构、核心主题或主要脉络。

你的任务：
1. 仔细阅读目录树和章节摘要
2. 直接生成一份详细的《全书结构检视报告》(structural_analysis)
3. 解答用户的宏观问题，基于目录信息组织回答
4. 引用章节时，直接使用目录树中每个节点的 link 字段值，不要自己组装链接
5. scopeNodeIds 可以留空 []，因为不需要锁定局部范围
</task_branch>`
    : `<task_branch name="圈定战区">
用户的意图是探究某个具体的细节、概念或推演逻辑。

1. 基于目录树和章节摘要，推断最有可能包含答案的核心章节，将他们的 nodeid 按相关性排序，将其 nodeid 填入 scopeNodeIds
2. 绝对不要尝试回答用户的具体问题！把答题的任务留给下一阶段
3. better_question 根据全书摘要重新推断出更能体现用户提问意图的下一阶段问题
4. structural_analysis 记录一句话简述为什么圈定这几个章节和提问意图改写,

</task_branch>`;

  return `<role>
你是一位严谨的结构图书管理员。你精通艾德勒的检视阅读法，擅长通过提取和分析目录大纲（骨架），来把握全书的宏观脉络。
</role>

<document>
书名: ${docName}${summarySection}
目录树:
${treeText}
</document>

<depth_context>
当前用户的阅读深度诉求为：【深度 ${depth}】
</depth_context>

${taskBranch}

<constraints>
1. 只基于章节标题和摘要推断，不凭记忆回答问题。
3. scopeNodeIds 必须来自目录树中的 node_id。
4. 无相关章节时输出空数组 []。
5. 必须输出合法的 JSON 格式。
</constraints>

<output_format>
返回 JSON:
{
  "thought_process": "定位思考过程",
  "scopeNodeIds": ["0004", "0005"],
  "better_question":"改写的更符合书籍内容的提问",
  "tocSummary": "为什么这些章节相关，建议搜索哪些关键词",
  "structural_analysis": "如果是深度 1，在这里写下基于大纲总结带 obsidian 链接的详细全书脉络/解答；如果是深度 2/3，只需写一句话简述圈定理由"
}
</output_format>`;
}

/**
 * Build user message for inspectional state
 */
export function buildInspectionalUserMessage(standaloneQuery: string, depth: ReadingDepth): string {
  const depthHint = depth === 1
    ? '请基于目录树生成详细的结构检视报告，解答用户的宏观问题。'
    : '请根据目录树圈定相关章节范围，在 tocSummary 中提供搜索关键词建议。';

  return `<query>
${standaloneQuery}
</query>

${depthHint}`;
}
