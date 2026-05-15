/**
 * S4: Formatter Node — Style transformation with wiki link preservation
 *
 * S4 只做风格转换（奚童语气），wiki 链接由 S2 生成，通过 prompt
 * 引导 S4 保留原始链接。self-verification 作为安全网移除幽灵引用。
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import type { CognitiveEngineState, NodeError } from '../state';
import { ReadingDepth, NODE_ERROR_HINTS } from '../state';
import { resolveMode } from '../utils/engine-helpers';
import type { FormatterInput } from '../node-io.js';
import { interrupt } from '@langchain/langgraph';
import {
  buildFormatterSystemPrompt,
  buildFormatterUserMessage,
} from '../prompts/formatter-prompt';
import { summarizeRecentHistory, formatHistoryBlock } from '../utils/history-summarizer';
import { buildScopedChaptersBlock } from '../prompts/analytical-prompt.js';
import { verifyAndCleanContent, type ToolResultEntry } from '../utils/self-verification';
import { stripThinkTags } from '../../../config/thinking-models.js';
import {
  buildProactiveSystemPrompt,
  buildProactiveUserMessage,
  buildSocraticDialoguePrompt,
  buildSocraticDialogueUserMessage,
} from '../prompts/proactive-formatter-prompt';

/**
 * Extract text from a streaming chunk (handles string, array, and null content).
 */
function extractChunkText(chunk: { content: unknown }): string {
  const { content } = chunk;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as { type: string; text: string }[])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
  }
  return '';
}

/**
 * Stream LLM response and call back with accumulated content.
 * Source: @langchain/openai ChatOpenAI.stream() — returns AsyncIterable of AIMessageChunk.
 *
 * @throws Error with context if streaming fails, allowing callers to provide meaningful feedback.
 */
async function streamToContent(
  model: ChatOpenAI,
  messages: BaseMessage[],
  config: RunnableConfig,
  onContent?: (content: string) => void,
): Promise<string> {
  let stream: AsyncIterable<Awaited<ReturnType<ChatOpenAI['stream']>> extends AsyncIterable<infer T> ? T : never>;
  try {
    stream = await model.stream(messages, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM 流式请求失败: ${msg}`);
  }
  let content = '';
  for await (const chunk of stream) {
    const text = extractChunkText(chunk);
    if (text) {
      content += text;
      onContent?.(content);
    }
  }
  return content;
}

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

/** 清理思维标签并修复 wiki 链接 — 多个模式分支共用 */
function cleanOutput(content: string, pdfName: string): string {
  return fixupWikiLinks(stripThinkTags(content), pdfName);
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
 * Generate user-facing error hints from nodeErrors.
 */
function appendErrorHints(nodeErrors?: Record<string, NodeError | string>): string {
  if (!nodeErrors) return '';
  const hints: string[] = [];
  for (const [node, err] of Object.entries(nodeErrors)) {
    const isRecoverable = typeof err === 'object' ? err.recoverable : true;
    if (isRecoverable && NODE_ERROR_HINTS[node]) {
      hints.push(NODE_ERROR_HINTS[node]);
    }
  }
  return hints.join('\n');
}

/**
 * S4 Formatter node
 */
export async function formatterNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const {
    analysisResult,
    structuralAnalysis,
    rewrittenQuery,
    pdfName,
    proactiveTrigger,
    depth,
    tocSummary,
    betterQuestion,
    scopeNodeIds,
    toolResultsSnapshot,
    highlightContext,
  }: FormatterInput = state;
  const mode = resolveMode(state);
  const mainModel = config.configurable?.mainModel;
  const callbacks = config.configurable?.callbacks as {
    onContent?: (content: string) => void;
    onProgress?: (msg: string) => void;
  } | undefined;
  const ctx = config.configurable?.sharedContext;

  if (!mainModel) {
    return { formattedOutput: analysisResult || rewrittenQuery || '' };
  }

  // === Proactive mode: ask a question, don't answer ===
  if (mode === 'proactive') {
    const trigger = (proactiveTrigger || 'inspectional') as 'inspectional' | 'highlight' | 'chapter';
    const ar = analysisResult || '';
    const hasDiagram = ar.startsWith('已生成 Excalidraw 图表：') || ar.startsWith('已生成信息图：');
    const progressLabel = hasDiagram ? '图表已生成，准备引导...' : '思考引导问题...';
    callbacks?.onProgress?.(progressLabel);
    const proactivePrompt = buildProactiveSystemPrompt(trigger, hasDiagram);
    let proactiveUserMsg = buildProactiveUserMessage({
      structuralAnalysis: structuralAnalysis || undefined,
      tocSummary: tocSummary || undefined,
      highlightContext: highlightContext || undefined,
      bookName: pdfName || '',
    });
    if (hasDiagram) {
      proactiveUserMsg += `\n\n<diagram_result>\n${ar}\n</diagram_result>`;
    }
    const content = await streamToContent(
      mainModel,
      [new SystemMessage(proactivePrompt), new HumanMessage(proactiveUserMsg)],
      config,
      callbacks?.onContent,
    );

    return { formattedOutput: cleanOutput(content, pdfName || '') };
  }

  // === Socratic dialogue: respond + follow-up using chatHistory ===
  if (mode === 'socratic') {
    callbacks?.onProgress?.('正在思考...');
    const chatHistory = ctx?.chatHistory ?? [];
    const socraticPrompt = buildSocraticDialoguePrompt();
    const socraticUserMsg = buildSocraticDialogueUserMessage(
      rewrittenQuery || '',
      chatHistory,
    );
    const content = await streamToContent(
      mainModel,
      [new SystemMessage(socraticPrompt), new HumanMessage(socraticUserMsg)],
      config,
      callbacks?.onContent,
    );

    return { formattedOutput: cleanOutput(content, pdfName || '') };
  }

  // === Casual mode (depth=CASUAL): simple direct response ===
  if (depth === ReadingDepth.CASUAL) {
    callbacks?.onProgress?.('正在思考...');
    const casualPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary);
    const chatHistory = ctx?.chatHistory ?? [];
    const historyText = chatHistory.length > 0
      ? formatHistoryBlock(summarizeRecentHistory(chatHistory, 3))
      : '';
    const userMsg = historyText
      ? `<history>\n${historyText}\n</history>\n\n<query>${rewrittenQuery || ''}</query>\n<book>${pdfName || ''}</book>`
      : rewrittenQuery || '';
    const content = await streamToContent(
      mainModel,
      [new SystemMessage(casualPrompt), new HumanMessage(userMsg)],
      config,
      callbacks?.onContent,
    );

    return { formattedOutput: cleanOutput(content, pdfName || '') };
  }

  // === Diagram shortcut: brief in-character response, skip full formatting ===
  const ar = analysisResult || '';
  const diagramSuccess = ar.startsWith('已生成 Excalidraw 图表：') || ar.startsWith('已生成信息图：');
  const diagramFailed = ar.startsWith('图表生成失败:');
  if (diagramSuccess || diagramFailed) {
    callbacks?.onProgress?.(diagramSuccess ? '图表已生成' : '图表生成遇到问题');
    const diagramPrompt = `你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。
你刚帮用户${diagramSuccess ? '生成了一张可视化图表' : '尝试生成图表但遇到了问题'}。用 1-2 句话简短告诉用户结果，自然亲切，像朋友之间说话。
${diagramSuccess ? '提一下图表大致涵盖了哪些内容。' : '说明遇到了什么情况，建议用户检查是否安装了 Excalidraw 插件或在设置中配置信息图 API。'}
不要用列表、不要用加粗、不要说"亲爱的用户"之类的称呼。`

    let content = stripThinkTags(await streamToContent(
      mainModel,
      [new SystemMessage(diagramPrompt), new HumanMessage(`用户请求：${rewrittenQuery || ''}\n\n图表结果：${ar}`)],
      config,
      callbacks?.onContent,
    ));

    // Ensure the chart/infographic link is in the output (LLM may omit it)
    if (diagramSuccess) {
      const hasLink = content.includes('[[') || content.includes('![');
      if (!hasLink) {
        const wikiMatch = ar.match(/\[\[[^\]]+\]\]/);
        const imgMatch = ar.match(/!\[[^\]]*\]\([^)]+\)/);
        const link = wikiMatch?.[0] || imgMatch?.[0];
        if (link) {
          content = `${content}\n\n${link}`;
        }
      }
    }

    return { formattedOutput: content };
  }

  // === Normal mode (depth >= 1): format with full context ===
  // 收集输入文本用于校验编造链接
  const inputTextsForValidation = [
    analysisResult || '',
    structuralAnalysis || '',
  ];
  callbacks?.onProgress?.('正在整理笔记...');

  const systemPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary);

  const chatHistory = ctx?.chatHistory ?? [];
  const markdownFiles = ctx?.markdownFiles ?? {};
  const effectiveScopeNodeIds = scopeNodeIds ?? [];
  const coveredScope = effectiveScopeNodeIds.length > 0
    ? buildScopedChaptersBlock(effectiveScopeNodeIds, markdownFiles)
    : '';
  const userMessage = buildFormatterUserMessage(
    rewrittenQuery,
    analysisResult || '',
    pdfName || '',
    chatHistory,
    tocSummary || undefined,
    structuralAnalysis || undefined,
    betterQuestion || undefined,
    coveredScope || undefined,
  );

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ];

  // Stream output
  let content = await streamToContent(mainModel, messages, config, callbacks?.onContent);

  // Self-verification: remove ghost block_id references (safety net)
  const toolResults: ToolResultEntry[] = (toolResultsSnapshot || []).map(r => ({
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

      let refinedContent = await streamToContent(mainModel, feedbackMessages, config, callbacks?.onContent);

      if (toolResults.length > 0) {
        const vResult = await verifyAndCleanContent(refinedContent, toolResults);
        refinedContent = vResult.content;
      }

      content = refinedContent;
    }
  }

  // Append degradation hints for recoverable node errors
  const formatted = stripFabricatedLinks(
    cleanOutput(content, pdfName || ''),
    inputTextsForValidation,
  );
  const errorHints = appendErrorHints(state.nodeErrors);

  return { formattedOutput: errorHints ? `${formatted}\n\n> [!hint] ${errorHints}` : formatted };
}
