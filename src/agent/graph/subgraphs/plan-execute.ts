/**
 * Plan-Execute-Replan: iterative planning with bounded rounds.
 *
 * Round 1: Plan → Execute in parallel
 * Round 2 (optional): Replan based on results → Execute again
 * Final: Synthesize all gathered information
 *
 * Total: 2-3 LLM calls (vs ReAct's 4-6).
 */

import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { verifyAndCleanContent } from '../utils/self-verification.js';
import type { ReactLoopConfig, ReactLoopResult, ToolResultRecord } from './tool-execution.js';
import { compressMessagesForLLM, executeToolBatch, reportPlan } from './tool-execution.js';

function buildSynthesisPrompt(config: ReactLoopConfig): string {
  let prompt = `现在请基于你请求的所有工具执行结果，输出完整的分析结论。

要求：
1. 综合所有工具返回的信息
2. 不要再次调用任何工具
3. 如果某些结果不完整，基于已有信息给出尽可能完整的回答
4. 严格遵守 <output_rules> 中的 wiki 链接格式
5. 提取逻辑骨架：定义 → 主旨 → 论述 → 结论`;

  if (config.forcedConclusionContext) {
    const { pdfName, scopeNodeIds } = config.forcedConclusionContext;
    if (pdfName) {
      prompt += `\n\n书名：${pdfName}
请确保所有 wiki 链接格式为 [[${pdfName}/章节文件名#^block_id|自然语言别名]]`;
    }
  }

  return prompt;
}

/**
 * Plan-Execute-Replan: iterative planning with bounded rounds.
 *
 * Default maxPlanRounds=2 allows one follow-up round:
 *   Round 1: Plan(1 LLM) → Execute(parallel tools)
 *   Round 2: Replan(1 LLM, sees Round 1 results) → Execute(parallel tools)
 *   Final:   Synthesize(1 LLM) → output
 *
 * Total: 3 LLM calls for 2 rounds (vs ReAct's 4-6 calls).
 * If a round produces no tool calls, synthesize immediately.
 */
export async function runPlanExecute(
  messages: BaseMessage[],
  config: ReactLoopConfig,
  runnableConfig?: RunnableConfig,
): Promise<ReactLoopResult> {
  const { tools, model } = config;
  const modelWithTools = model.bindTools(tools);
  const maxPlanRounds = Math.max(1, Math.min(config.maxToolCalls, 2));

  const allToolResults: ToolResultRecord[] = [];
  const conversationHistory: BaseMessage[] = [...messages];
  let totalIterations = 0;

  for (let round = 0; round < maxPlanRounds; round++) {
    const compressedHistory = round > 0 ? compressMessagesForLLM(conversationHistory) : conversationHistory;

    const historyWithHint = round > 0
      ? [...compressedHistory, new HumanMessage(`基于上一轮检索结果，如有必要请补充检索更多信息。如果已足够，直接回答问题。`)]
      : compressedHistory;

    const planResponse = await modelWithTools.invoke(historyWithHint, runnableConfig);
    totalIterations++;

    if (!planResponse?.tool_calls?.length) {
      let content = typeof planResponse?.content === 'string'
        ? planResponse.content : JSON.stringify(planResponse?.content ?? '');

      // Clean up XML tool call residue — LLM sometimes outputs <function>...</function>
      // instead of structured tool_calls. Strip it to avoid polluting analysisResult.
      content = content.replace(/<function>[\s\S]*?<\/function>/g, '').replace(/<parameter>[\s\S]*?<\/parameter>/g, '').trim();

      if (round === 0 && !content) {
        // LLM produced only XML tool calls with no text — treat as empty
        return { content: '', toolResults: [], iterations: totalIterations, finishReason: 'stop' };
      }
      if (round === 0) {
        return { content, toolResults: [], iterations: totalIterations, finishReason: 'stop' };
      }
      if (allToolResults.length > 0) {
        const verifyResult = await verifyAndCleanContent(content, allToolResults);
        return { content: verifyResult.content, toolResults: allToolResults, iterations: totalIterations, finishReason: 'stop' };
      }
      return { content, toolResults: allToolResults, iterations: totalIterations, finishReason: 'stop' };
    }

    reportPlan(config, planResponse.tool_calls, round, maxPlanRounds);

    const { messages: toolMsgs, records } = await executeToolBatch(
      planResponse.tool_calls, tools, config, runnableConfig,
    );
    allToolResults.push(...records);

    conversationHistory.push(planResponse);
    conversationHistory.push(...toolMsgs);
  }

  // Final: Synthesize
  const synthesisMessages = compressMessagesForLLM(conversationHistory);
  const synthesisPrompt = buildSynthesisPrompt(config);

  const synthesisResponse = await model.invoke([
    ...synthesisMessages,
    new HumanMessage(synthesisPrompt),
  ], runnableConfig);

  let content = typeof synthesisResponse.content === 'string'
    ? synthesisResponse.content
    : JSON.stringify(synthesisResponse.content);

  if (allToolResults.length > 0) {
    const verifyResult = await verifyAndCleanContent(content, allToolResults);
    content = verifyResult.content;
  }

  return {
    content,
    toolResults: allToolResults,
    iterations: totalIterations + 1,
    finishReason: 'stop',
  };
}
