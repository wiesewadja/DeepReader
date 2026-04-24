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
 * 修复 wiki 链接格式：补全缺失的书名前缀
 * LLM 有时会输出 [[文件名]] 而非 [[书名/文件名]]，这里强制补全
 */
function fixupWikiLinks(content: string, bookName: string): string {
  if (!bookName) return content;
  // 匹配 [[...]] 中不含 / 的链接，补全书名前缀
  return content.replace(/\[\[([^/\]]+)\]\]/g, (_match: string, inner: string) => {
    return `[[${bookName}/${inner}]]`;
  });
}

/**
 * 移除编造的 wiki 链接（输入中不存在的链接）
 * 收集输入文本中的所有合法链接，输出中只保留这些链接
 * 编造的链接回退为纯文本（保留别名部分）
 */
function stripFabricatedLinks(content: string, inputTexts: string[]): string {
  // 收集输入中所有合法链接的文件名（不含书名前缀）
  const validFileNames = new Set<string>();
  const wikiRegex = /\[\[([^\]]+)\]\]/g;
  for (const text of inputTexts) {
    let m: RegExpExecArray | null;
    const re = new RegExp(wikiRegex.source, wikiRegex.flags);
    while ((m = re.exec(text)) !== null) {
      const inner = m[1];
      // 提取文件名部分（去掉 #block_id 和 |alias）
      const pathPart = inner.split('#')[0].split('|')[0];
      // 去掉书名前缀，取最后一段作为文件名
      const fileName = pathPart.split('/').pop() || pathPart;
      validFileNames.add(fileName);
      // 也保留完整路径
      validFileNames.add(pathPart);
    }
  }

  if (validFileNames.size === 0) {
    // 输入中无链接，移除输出中所有链接（保留别名）
    return content.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_m: string, inner: string, aliasPart: string) => {
      const alias = aliasPart ? aliasPart.slice(1) : inner.split('/').pop() || inner;
      return alias;
    });
  }

  // 逐个检查输出中的链接，移除编造的
  return content.replace(/\[\[([^\]]+)\]\]/g, (fullMatch: string, inner: string) => {
    const pathPart = inner.split('#')[0].split('|')[0];
    const fileName = pathPart.split('/').pop() || pathPart;

    // 模糊匹配：检查文件名是否在合法集合中（去除数字前缀后的核心部分）
    let isFabricated = true;
    for (const valid of validFileNames) {
      if (valid === fileName || valid === pathPart || valid.endsWith(fileName) || fileName.endsWith(valid)) {
        isFabricated = false;
        break;
      }
      // 宽松匹配：去除编号前缀后比较标题部分
      const stripNum = (s: string) => s.replace(/^\d+\s*[-–]\s*/, '');
      if (stripNum(valid) === stripNum(fileName)) {
        isFabricated = false;
        break;
      }
    }

    if (isFabricated) {
      // 编造链接 → 回退为纯文本（保留别名）
      const aliasMatch = inner.match(/[^|]+$/) ;
      const alias = aliasMatch ? aliasMatch[0] : fileName;
      return alias;
    }
    return fullMatch;
  });
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

    return { formattedOutput: fixupWikiLinks(stripThinkTags(content), state.pdfName || '') };
  }

  // === Normal mode (depth >= 1): format with full context ===
  // 收集输入文本用于校验编造链接
  const inputTextsForValidation = [
    state.analysisResult || '',
    state.structuralAnalysis || '',
  ];
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

  return { formattedOutput: stripFabricatedLinks(
    fixupWikiLinks(stripThinkTags(content), state.pdfName || ''),
    inputTextsForValidation,
  ) };
}
