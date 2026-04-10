/**
 * S2 Analytical Reading System Prompt
 *
 * Core objective: Cold logic dissection, Exploration-Exploitation-Synthesis workflow
 */

export interface AnalyticalPromptContext {
  scopeNodeIds?: string[];
  tocSummary?: string;
  betterQuestion?: string;
}

export function buildAnalyticalPrompt(_ctx: AnalyticalPromptContext): string {
  // 注意：scopeText 不再在此处显示，而是在 buildAnalyticalSystemPrompt 中
  // 通过 <locked_scope> 块动态添加，确保显示实际的搜索范围

  return `<role>
你是艾德勒学派的阅读分析师。忠于原著，执行分析阅读方式，深度解构作者思想。
</role>

<constraints>
1. 搜索范围由 <locked_scope> 指定，不可跨界。
2. 遵守"智慧礼节"：此阶段不对作者观点提出批评或赞同，只负责"懂他"。
3. 总共只有 5 次工具调用机会，合理分配。
4. 达到工具调用次数后，若你觉得还是不足以回复，请你结合书籍大纲引导用户进一步阅读，并给出相关 wiki 链接
</constraints>

<workflow>
0. 若给定的搜索范围少于 3 个，则直接通过 read_book_section 的 node_ids 参数批量读取完整内容，跳到步骤 3
1. **探索** (不多于2次): 用 search_book 搜索关键词
   - 优先使用 search_hints 中建议的关键词
   - 可同时搜索多个候选关键词（并行调用，最多3个）
   - 搜索结果中的 matched_blocks 已包含精确段落和 block_id，**优先直接利用**，节省工具调用次数
   - 只有 matched_blocks 信息不足以回答问题时，才需要调用 read_book_section
   - ERROR_TOO_BROAD → 换更精准的词
   - ERROR_NOT_FOUND → 尝试同义词

2. **精读** (仅在搜索结果不够详细时): 用 read_book_section 读取完整内容
   - 推荐使用 node_ids 批量读取多个章节（一次调用读取 2-3 个章节）
   - 参数优先级: node_ids (批量) > node_id+block_id > heading

3. **合成**: 提取逻辑骨架
   - 【定义】核心概念的精确定义
   - 【主旨】关键句子的核心论点
   - 【论述】结合原文梳理：前提 → 推论 → 结论
</workflow>

<keyword_tips>
【中文关键字提取法则】：
1. **核心名词优先**：只提取最罕见、最硬核的专有名词（如"MECE"、"熵增"）。剔除动词和修饰语（如"如何"、"的作用"、"是什么"）。
2. **拆分复合词**：作者可能在词语中间加了字。不要搜"解决问题的前提"，应该拆成 keywords: ["解决问题", "前提"] 进行 AND 匹配。
3. **数组是 AND 逻辑**：keywords 数组元素之间是严格的 AND（必须同时出现）。
</keyword_tips>

<output_rules>
1. 输出纯粹的"逻辑骨架"，不掺杂个人知识。
2. 搜索结果的 matched_blocks 包含精确的段落内容和 block_id，直接引用最相关的 block_id。
3. 块引用格式：[[{{书名}}/{{文件名}}#^{{block_id}}|自然语言别名]]，别名必须融入句子语法，不要裸链接。
</output_rules>
`;
}

// 保持向后兼容
export const PROMPT_S2_ANALYTICAL_TEMPLATE = buildAnalyticalPrompt({});

/**
 * Build system prompt for analytical state with scope
 */
export function buildAnalyticalSystemPrompt(ctx: {
  scopeNodeIds: string[];
  tocSummary?: string;
}): string {
  // 如果 scopeNodeIds 为空，显示全局搜索提示
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
 * 从 markdownFiles 键名中提取文件名，与 scopeNodeIds 匹配
 */
export function buildScopedChaptersBlock(
  scopeNodeIds: string[],
  markdownFiles: Record<string, string>
): string {
  if (scopeNodeIds.length === 0) return '';

  const lines: string[] = [];

  for (const nodeId of scopeNodeIds) {
    // 从 nodeId 中提取数字部分（如 "0003" → "03" 或 "3"）
    const numericPart = nodeId.replace(/^0+/, ''); // 去掉前导零

    // 在 markdownFiles 键名中查找匹配的文件
    const matchedKey = Object.keys(markdownFiles).find(key => {
      const fileName = key.split('/').pop() ?? '';
      // 匹配文件名中的数字前缀（如 "03 - " 或 "3 - "）
      const fileNumMatch = fileName.match(/^(\d+)\s*-\s*/);
      if (fileNumMatch) {
        const fileNum = fileNumMatch[1].replace(/^0+/, '');
        return fileNum === numericPart;
      }
      return false;
    });

    if (matchedKey) {
      const fileName = matchedKey.split('/').pop() ?? '';
      // 去掉 .md 后缀和 "NN - " 数字前缀，提取标题
      const title = fileName
        .replace(/\.md$/, '')
        .replace(/^\d+\s*-\s*/, '');
      lines.push(`- node_id: ${nodeId} | ${title} | ${fileName}`);
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
  betterQuestion?: string
): string {
  if (betterQuestion && betterQuestion !== standaloneQuery) {
    return `<original_query>${standaloneQuery}</original_query>
<refined_query>${betterQuestion}</refined_query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  }
  return `<query>
${standaloneQuery}
</query>

在限定范围内分析，提取关键内容并附带 block_id。`;
}