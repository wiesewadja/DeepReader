/**
 * S4: Formatter Node — Style transformation with wiki link preservation
 *
 * S4 只做风格转换（奚童语气），wiki 链接由 S2 生成，通过 prompt
 * 引导 S4 保留原始链接。self-verification 作为安全网移除幽灵引用。
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { interrupt } from '@langchain/langgraph';
import {
  buildFormatterSystemPrompt,
  buildFormatterUserMessage,
} from '../prompts/formatter-prompt';
import { buildScopedChaptersBlock } from '../prompts/analytical-prompt.js';
import { verifyAndCleanContent, type ToolResultEntry } from '../utils/self-verification';
import { stripThinkTags } from '../../../config/thinking-models.js';

/**
 * S4 Formatter node
 */
export async function formatterNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const mainModel = config.configurable?.mainModel;
  const callbacks = config.configurable?.callbacks as {
    onContent?: (content: string) => void;
    onProgress?: (msg: string) => void;
  } | undefined;
  const ctx = config.configurable?.sharedContext;

  if (!mainModel) {
    return { formattedOutput: state.analysisResult || state.rewrittenQuery || '' };
  }

  // === Casual mode (depth=0): simple direct response ===
  if (state.depth === 0) {
    callbacks?.onProgress?.('正在思考...');
    const casualPrompt = buildFormatterSystemPrompt(ctx?.memoryContext);
    const stream = await mainModel.stream([
      new SystemMessage(casualPrompt),
      new HumanMessage(state.rewrittenQuery || ''),
    ], config);

    let content = '';
    for await (const chunk of stream) {
      if (typeof chunk.content === 'string') {
        content += chunk.content;
        callbacks?.onContent?.(content);
      }
    }

    return { formattedOutput: stripThinkTags(content) };
  }

  // === Normal mode (depth >= 1): format with full context ===
  callbacks?.onProgress?.('正在整理笔记...');

  const systemPrompt = buildFormatterSystemPrompt(ctx?.memoryContext);

  const chatHistory = ctx?.chatHistory ?? [];
  const markdownFiles = ctx?.markdownFiles ?? {};
  const scopeNodeIds = state.scopeNodeIds ?? [];
  const coveredScope = scopeNodeIds.length > 0
    ? buildScopedChaptersBlock(scopeNodeIds, markdownFiles)
    : '';
  const userMessage = buildFormatterUserMessage(
    state.rewrittenQuery,
    state.analysisResult || '',
    state.analysisResult || '',
    state.pdfName || '',
    chatHistory,
    state.tocSummary || undefined,
    state.structuralAnalysis || undefined,
    state.betterQuestion || undefined,
    coveredScope || undefined,
  );

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ];

  // Stream output
  const stream = await mainModel.stream(messages, config);
  let content = '';
  for await (const chunk of stream) {
    if (typeof chunk.content === 'string') {
      content += chunk.content;
      callbacks?.onContent?.(content);
    }
  }

  // Self-verification: remove ghost block_id references (safety net)
  const toolResults: ToolResultEntry[] = (state.toolResultsSnapshot || []).map(r => ({
    toolName: r.toolName,
    args: r.args as Record<string, unknown>,
    result: r.result,
    originalResultLength: r.originalResultLength,
    extractedBlockIds: r.extractedBlockIds,
  }));

  if (toolResults.length > 0) {
    const verificationResult = await verifyAndCleanContent(content, toolResults);
    content = verificationResult.content;

    if (config.configurable?.langsmithTracer) {
      try {
        const client = config.configurable.langsmithTracer.client;
        await client.createRun({
          name: 'wiki_link_verification',
          run_type: 'tool',
          inputs: { content_length: content.length },
          outputs: verificationResult,
          parent_run_id: config.configurable?.parentRunId,
          extra: { metadata: {
            tool_results_count: toolResults.length,
            wiki_links_before: verificationResult.totalRefs,
            wiki_links_after: verificationResult.totalRefs - verificationResult.ghostRefs,
            ghost_refs_removed: verificationResult.ghostRefs,
          } },
        });
      } catch {
        // 静默失败
      }
    }
  }

  // HITL interrupt (if enabled)
  const enableHumanReview = config.configurable?.enableHumanReview as boolean | undefined;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'formatter',
      question: 'S4 格式化完成，确认输出内容？',
      content,
    }) as { approved: boolean; feedback: string } | undefined;

    if (resumeValue?.approved === false && resumeValue.feedback) {
      const feedbackMessages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
        new AIMessage(content),
        new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈修正格式化输出。`),
      ];

      const feedbackStream = await mainModel.stream(feedbackMessages, config);
      let refinedContent = '';
      for await (const chunk of feedbackStream) {
        if (typeof chunk.content === 'string') {
          refinedContent += chunk.content;
          callbacks?.onContent?.(refinedContent);
        }
      }

      if (toolResults.length > 0) {
        const vResult = await verifyAndCleanContent(refinedContent, toolResults);
        refinedContent = vResult.content;
      }

      content = refinedContent;
    }
  }

  return { formattedOutput: stripThinkTags(content) };
}
