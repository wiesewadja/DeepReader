/**
 * S4: Formatter Node — Placeholder-based link protection
 *
 * 链接保护策略：
 * Formatter LLM 无法可靠地保留 wiki 链接的路径和 block_id。
 * 无论 prompt 如何强调，LLM 都会把链接当作语义内容来"理解"和"重构"。
 *
 * 因此在传给 LLM 之前，用不透明占位符 §REF_n§ 替换所有 wiki 链接。
 * LLM 只需原样搬运占位符，输出后再还原为真实链接。
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
 * 将文本中的 wiki 链接替换为不透明占位符。
 * 返回替换后的文本和占位符→原始链接的映射。
 */
function replaceLinksByPlaceholders(text: string): {
  text: string;
  placeholderMap: Map<string, string>;
} {
  const placeholderMap = new Map<string, string>();
  let counter = 0;

  const replaced = text.replace(/\[\[[^\]]+?\|[^\]]+\]\]/g, (match) => {
    const placeholder = `\u00A7REF_${counter}\u00A7`;
    placeholderMap.set(placeholder, match);
    counter++;
    return placeholder;
  });

  return { text: replaced, placeholderMap };
}

/**
 * 将占位符还原为真实 wiki 链接。
 */
function restorePlaceholders(text: string, placeholderMap: Map<string, string>): string {
  for (const [placeholder, originalLink] of placeholderMap) {
    text = text.replaceAll(placeholder, originalLink);
  }
  return text;
}

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

  // 核心步骤：用占位符替换 analysisResult 中的 wiki 链接
  // Formatter LLM 只看到不透明的 §REF_n§ token，无法篡改路径和 block_id
  const rawAnalysis = state.analysisResult || '';
  const { text: safeAnalysis, placeholderMap } = replaceLinksByPlaceholders(rawAnalysis);

  // Build user message with placeholder-protected analysis
  const chatHistory = ctx?.chatHistory ?? [];
  const markdownFiles = ctx?.markdownFiles ?? {};
  const scopeNodeIds = state.scopeNodeIds ?? [];
  const coveredScope = scopeNodeIds.length > 0
    ? buildScopedChaptersBlock(scopeNodeIds, markdownFiles)
    : '';
  const userMessage = buildFormatterUserMessage(
    state.rewrittenQuery,
    safeAnalysis,
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
      // 流式推送给 UI 时也还原占位符，避免用户看到 §REF_n§
      if (placeholderMap.size > 0) {
        callbacks?.onContent?.(restorePlaceholders(content, placeholderMap));
      } else {
        callbacks?.onContent?.(content);
      }
    }
  }

  // 还原：用真实 wiki 链接替换占位符
  if (placeholderMap.size > 0) {
    content = restorePlaceholders(content, placeholderMap);
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

      if (placeholderMap.size > 0) {
        refinedContent = restorePlaceholders(refinedContent, placeholderMap);
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
