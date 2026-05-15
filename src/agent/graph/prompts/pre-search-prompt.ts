/**
 * S2-Pre: Pre-search early-stop prompt
 *
 * When pre-search results are high-quality, skip ReAct loop and generate
 * a direct answer with wiki link citations.
 */

/**
 * Build the direct-response prompt for early-stop path.
 */
export function buildEarlyStopPrompt(
  systemPrompt: string,
  blockLines: string[],
  userQuery: string,
  pdfName: string,
): string {
  return `${systemPrompt}\n\n基于以下检索结果回答用户问题。你必须从检索结果中引用原文，并使用 wiki 链接标注来源。即使信息不完整，也要基于已有内容给出尽可能充分的回答。

<pre_search_results>
${blockLines.join('\n\n')}
</pre_search_results>

用户问题：${userQuery}

输出格式要求：
- 引用来源用 [[${pdfName}/file_name#^block_id|短别名]] 格式，别名 2-6 字核心词
- file_name 和 block_id 必须来自上方检索结果中标注的值，禁止编造
- 链接必须嵌入句子内部替代关键词，不要孤立在句尾
- 必须在回答中包含至少一个 wiki 链接
- 如果检索结果部分覆盖了问题，先基于已有内容回答，再简要说明哪些方面需要更多探索`;
}
