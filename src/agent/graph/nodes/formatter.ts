/**
 * S4: Formatter Node — Native LangChain streaming implementation
 *
 * Transforms raw analysis into formatted Obsidian notes.
 * Uses ChatOpenAI streaming + self-verification instead of old runStateLoop.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { interrupt } from '@langchain/langgraph';
import {
  buildFormatterSystemPrompt,
  buildFormatterUserMessage,
  MAX_HISTORY_MESSAGES,
} from '../prompts/formatter-prompt';
import { verifyAndCleanContent, type ToolResultEntry } from '../utils/self-verification';

/**
 * S4 Formatter node: transforms analysis into Obsidian-formatted output.
 *
 * Flow:
 * 1. Casual mode (depth=0): generate direct response
 * 2. Build formatter system/user messages with memory context
 * 3. Stream main model output, pushing to UI via callbacks
 * 4. Self-verify block_id references (remove ghost links)
 * 5. Optional HITL interrupt
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

  // No main model available — return raw analysis
  if (!mainModel) {
    return { formattedOutput: state.analysisResult || state.rewrittenQuery || '' };
  }

  // === Casual mode (depth=0): simple direct response ===
  if (state.depth === 0) {
    callbacks?.onProgress?.('正在生成回复...');

    const casualPrompt = buildFormatterSystemPrompt(ctx?.memoryContext);
    const stream = await mainModel.stream([
      new SystemMessage(casualPrompt),
      new HumanMessage(state.rewrittenQuery || ''),
    ]);

    let content = '';
    for await (const chunk of stream) {
      if (typeof chunk.content === 'string') {
        content += chunk.content;
        callbacks?.onContent?.(content);
      }
    }

    return { formattedOutput: content };
  }

  // === Normal mode (depth >= 1): format with full context ===
  callbacks?.onProgress?.('正在格式化输出...');

  // Build system prompt with memory context
  const systemPrompt = buildFormatterSystemPrompt(ctx?.memoryContext);

  // Build user message with all context
  const chatHistory = ctx?.chatHistory ?? [];
  const recentHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES);
  const userMessage = buildFormatterUserMessage(
    state.rewrittenQuery,
    state.analysisResult || '',
    state.pdfName || '',
    recentHistory,
    state.tocSummary || undefined,
    state.structuralAnalysis || undefined,
    state.betterQuestion || undefined,
  );

  // Construct messages array
  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ];

  // Stream output
  const stream = await mainModel.stream(messages);
  let content = '';
  for await (const chunk of stream) {
    if (typeof chunk.content === 'string') {
      content += chunk.content;
      callbacks?.onContent?.(content);
    }
  }

  // Self-verification: remove ghost block_id references
  const toolResults: ToolResultEntry[] = (state.toolResultsSnapshot || []).map(r => ({
    toolName: r.toolName,
    args: r.args as Record<string, unknown>,
    result: r.result,
    originalResultLength: r.originalResultLength,
  }));

  if (toolResults.length > 0) {
    const verificationResult = await verifyAndCleanContent(content, toolResults);
    content = verificationResult.content;
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
      // User rejected: regenerate with feedback
      const feedbackMessages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
        new AIMessage(content),
        new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈修正格式化输出。`),
      ];

      const feedbackStream = await mainModel.stream(feedbackMessages);
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

  return { formattedOutput: content };
}
