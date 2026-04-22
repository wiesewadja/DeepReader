/**
 * S2 Analytical Reading System Prompt
 */

import type { HistorySummary } from '../utils/history-summarizer';
import { formatHistoryBlock, formatPrevSearchedBlock } from '../utils/history-summarizer';

export interface AnalyticalPromptContext {
  scopeNodeIds?: string[];
  tocSummary?: string;
  betterQuestion?: string;
}

export function buildAnalyticalPrompt(_ctx: AnalyticalPromptContext): string {
  return `<role>
你是艾德勒学派的阅读分析师。忠于原著，执行分析阅读方式，深度解构作者思想。
</role>

<constraints>
1. 搜索范围由 <locked_scope> 指定，不可跨界。
2. 遵守"智慧礼节"：此阶段不对作者观点提出批评或赞同，只负责"懂他"。
3. 一次性规划所有需要的工具调用（搜索+读取），工具会并行执行。
4. 如果信息仍不足，结合已有信息给出尽可能完整的回答和相关 wiki 链接
</constraints>

<workflow>
0. **优先利用预检索结果**：如果消息开头有 <pre_search_results>，直接基于其中的段落进行分析。只有预检索结果不足时才调用工具。
1. 若给定的搜索范围少于 3 个，则直接通过 read_book_section 的 node_ids 参数批量读取完整内容，跳到步骤 3
2. **一次性规划检索**: 用 search_book 一次性搜索多个关键词
   - 将你所有想探索的概念合并为一个 keywords 数组（如 ["财富", "杠杆", "专长"]）
   - search_book 会对每个关键词独立检索并融合排序，返回 Top 10 结果
   - 搜索结果中的 matched_blocks 已包含精确段落和 block_id，**优先直接利用**

3. **精读**: 用 read_book_section 读取完整内容
   - 推荐使用 node_ids 批量读取多个章节（一次调用读取 2-3 个章节）
   - 参数优先级: node_ids (批量) > node_id+block_id > heading

4. **合成**: 提取逻辑骨架
   - 【定义】核心概念的精确定义
   - 【主旨】关键句子的核心论点
   - 【论述】结合原文梳理：前提 → 推论 → 结论
</workflow>

<keyword_tips>
【中文关键字提取法则】：
1. **核心名词优先**：只提取最罕见、最硬核的专有名词（如"MECE"、"熵增"）。剔除动词和修饰语（如"如何"、"的作用"、"是什么"）。
2. **拆分复合词**：作者可能在词语中间加了字。不要搜"解决问题的前提"，应该拆成 keywords: ["解决问题", "前提"]。
3. **数组是 OR 逻辑**：keywords 数组元素独立检索后融合排序（RRF），出现任一关键词的结果都会返回，多关键词匹配的结果排名更高。
</keyword_tips>

<output_rules>
1. 输出纯粹的"逻辑骨架"，不掺杂个人知识。
2. 块引用格式（强制标准）：
   [[{{书名}}/{{file_name}}#^{{block_id}}|短别名]]

   【三大铁律】：
   a) **必须有书名**：链接第一部分必须是书名（来自 <book> 标签或上下文）
   b) **短别名**：| 后面是 2-6 个字的核心词，能直接替换正文中对应词语
   c) **内联嵌入**：链接替换正文中的关键词，而不是挂在句尾当注释

   - **file_name 必须来自 matched_blocks.file_name 或 read 结果中的 file_name 字段**
   - file_name 包含数字前缀，如 "14 - 存钱 第10章"
   - ❌ 禁止使用 title（不含数字前缀），如 "存钱 第10章"
   - block_id 来自 matched_blocks.block_id 字段（已去掉 ^ 前缀），拼接时加 #^ 即可

   【正确示例】（链接替换关键词，自然嵌入正文）：
   纳瓦尔将[[纳瓦尔宝典/26 - 判断力#^s25-001|判断力]]定义为"知道行为的长期后果"的能力。
   真正的聪明是"[[纳瓦尔宝典/27 - 如何清晰地思考？#^s26-001|思路清晰]]"，而非知识堆砌。
   最好的[[纳瓦尔宝典/30 - 发现好的心智模型#^s29-001|心智模型]]来自进化论、博弈论和查理·芒格。

   【错误示例】：
   ❌ [[纳瓦尔宝典/14 - 认识财富创造的原理]] ← 缺少别名（裸链接）
   ❌ [[纳瓦尔宝典/14#^p003|引文]] ← 别名太短太笼统
   ❌ [[纳瓦尔宝典/26 - 判断力#^s25-001|判断力的核心定义]] ← 别名太长，是总结而非核心词
   ❌ 纳瓦尔将**判断力**定义为...的能力。[[纳瓦尔宝典/26 - 判断力#^s25-001|判断力]] ← 链接孤立在句尾

3. 每个链接必须嵌入在句子内部，替代一个关键词。禁止链接孤立跟随在句号后面。
</output_rules>
`;
}

export const PROMPT_S2_ANALYTICAL_TEMPLATE = buildAnalyticalPrompt({});

/**
 * Build system prompt for analytical state with scope
 */
export function buildAnalyticalSystemPrompt(ctx: {
  scopeNodeIds: string[];
  tocSummary?: string;
}): string {
  const scopeList = ctx.scopeNodeIds.length > 0
    ? ctx.scopeNodeIds.map(id => `- ${id}`).join('\n')
    : '- (全局搜索，无范围限制)';

  const searchHints = ctx.tocSummary
    ? `\n<search_hints>\n${ctx.tocSummary}\n</search_hints>`
    : '';

  return `${PROMPT_S2_ANALYTICAL_TEMPLATE}
${searchHints}
<locked_scope>
搜索范围限定：
${scopeList}
</locked_scope>`;
}

/**
 * 构建 <scoped_chapters> 块，注入 scope 内章节的结构化信息
 */
export function buildScopedChaptersBlock(
  scopeNodeIds: string[],
  markdownFiles: Record<string, string>
): string {
  if (scopeNodeIds.length === 0) return '';

  const lines: string[] = [];

  for (const nodeId of scopeNodeIds) {
    const numericPart = nodeId.replace(/^0+/, '');

    const matchedKey = Object.keys(markdownFiles).find(key => {
      const fileName = key.split('/').pop() ?? '';
      const fileNumMatch = fileName.match(/^(\d+)\s*-\s*/);
      if (fileNumMatch) {
        const fileNum = fileNumMatch[1].replace(/^0+/, '');
        return fileNum === numericPart;
      }
      return false;
    });

    if (matchedKey) {
      const fileName = matchedKey.split('/').pop() ?? '';
      const fileNameForLink = fileName.replace(/\.md$/, '');
      lines.push(`- node_id: ${nodeId}, file_name: "${fileNameForLink}"`);
    } else {
      lines.push(`- node_id: ${nodeId}`);
    }
  }

  const inner = lines.join('\n');
  const full = `<scoped_chapters>\n${inner}\n</scoped_chapters>`;

  if (full.length > 1500) {
    const truncated = full.slice(0, 1500 - '...[已截断]'.length);
    return `${truncated}...[已截断]`;
  }

  return full;
}

/**
 * Build user message for analytical state
 */
export function buildAnalyticalUserMessage(
  standaloneQuery: string,
  betterQuestion?: string,
  recentHistory?: HistorySummary[],
  prevSearchedBlockIds?: string[]
): string {
  const historyBlock = recentHistory && recentHistory.length > 0
    ? formatHistoryBlock(recentHistory) + '\n'
    : '';

  const prevBlock = prevSearchedBlockIds && prevSearchedBlockIds.length > 0
    ? formatPrevSearchedBlock(prevSearchedBlockIds) + '\n'
    : '';

  if (betterQuestion && betterQuestion !== standaloneQuery) {
    return `${historyBlock}${prevBlock}<original_query>${standaloneQuery}</original_query>
<refined_query>${betterQuestion}</refined_query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  }
  return `${historyBlock}${prevBlock}<query>
${standaloneQuery}
</query>

在限定范围内分析，提取关键内容并附带 block_id。`;
}
