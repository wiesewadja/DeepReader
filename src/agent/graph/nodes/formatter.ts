/**
 * S4: Formatter Node — Style transformation with wiki link preservation
 *
 * S4 只做风格转换（奚童语气），wiki 链接由 S2 生成，通过 prompt
 * 引导 S4 保留原始链接。self-verification 作为安全网移除幽灵引用。
 */

import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { interrupt } from '@langchain/langgraph';
import type { ChatOpenAI } from '@langchain/openai';
import { agentLog as log } from '../../../utils/logger.js';
import { validateLinkPairs } from '../../utils/wiki-link-pair-validator.js';
import {
  cleanOutput,
  sanitizeOutput,
} from '../utils/output-sanitizer.js';
import { upgradeInlineWikiLinks } from '../utils/wiki-link-injector.js';
import type { FormatterInput } from '../node-io.js';
import {
  buildFormatterSystemPrompt,
  buildFormatterUserMessage,
  buildScopedChaptersBlock,
  extractRetrievedBlocks,
} from '../../prompts/utils/index.js';
import { vaultExists, vaultList, vaultRead, joinPath } from '../../../utils/mobile-fs.js';
import { bookExcerptDir } from '../../../utils/book-paths.js';
import { ReadingDepth, NODE_ERROR_HINTS, type CognitiveEngineState, type NodeError, type ToolResultSnapshot } from '../state';
import { getGraphConfigurable } from '../configurable.js';
import { summarizeRecentHistory, formatHistoryBlock } from '../utils/history-summarizer';
import { verifyAndCleanContent, type ToolResultEntry } from '../utils/self-verification';

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
 * Build retrieval-coverage metadata for the formatter prompt.
 *
 * Returns undefined when there is no signal worth reporting (no current chapter
 * AND no searches performed), keeping the prompt lean.
 */
function buildRetrievalCoverage(
  toolResultsSnapshot: ToolResultSnapshot[] | undefined,
  currentNodeId: string | undefined,
):
  | { searchedNodeIds: string[]; currentNodeId: string | undefined; isCoverageGap: boolean }
  | undefined {
  const searchedNodeIds = (toolResultsSnapshot || [])
    .map(r => r.args?.node_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const uniqueSearched = Array.from(new Set(searchedNodeIds));
  if (!currentNodeId && uniqueSearched.length === 0) return undefined;
  return {
    searchedNodeIds: uniqueSearched,
    currentNodeId,
    isCoverageGap: currentNodeId ? !uniqueSearched.includes(currentNodeId) : false,
  };
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
    depth,
    tocSummary,
    betterQuestion,
    scopeNodeIds,
    toolResultsSnapshot,
    highlightContext,
    crossBookMode,
    nodeFileMap,
  }: FormatterInput = state;
  const cfg = getGraphConfigurable(config);
  const mainModel = cfg.mainModel;
  const callbacks = cfg.callbacks;
  const ctx = cfg.sharedContext;

  // Detect and clean XML tool call residue in analysisResult
  const _rawAR = analysisResult || '';
  const _hasXmlResidue = /<function>[\s\S]*?<\/function>/.test(_rawAR);
  const effectiveAR = _hasXmlResidue ? _rawAR.replace(/<function>[\s\S]*?<\/function>/g, '').replace(/<parameter>[\s\S]*?<\/parameter>/g, '').trim() : _rawAR;

  if (!mainModel) {
    return { formattedOutput: effectiveAR || rewrittenQuery || '' };
  }



  // === ADVISOR node passthrough: already produced formatted response via ReAct ===
  if (!pdfName && !crossBookMode && effectiveAR) {
    return { formattedOutput: cleanOutput(effectiveAR, '', crossBookMode) };
  }

  // === Casual mode (depth=CASUAL): simple direct response ===
  if (depth === ReadingDepth.CASUAL) {
    callbacks?.onProgress?.('正在思考...');
    const isReadingAdvisor = !pdfName;
    const casualPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary, isReadingAdvisor);
    const chatHistory = ctx?.chatHistory ?? [];
    const historyText = chatHistory.length > 0
      ? formatHistoryBlock(summarizeRecentHistory(chatHistory, 3))
      : '';
    const bookshelfSection = (isReadingAdvisor && ctx?.toolContext?.crossBook?.bookshelfSummary)
      ? `\n<bookshelf>\n${ctx?.toolContext?.crossBook?.bookshelfSummary}\n</bookshelf>`
      : '';
    const userMsg = historyText
      ? `<history>\n${historyText}\n</history>\n\n<query>${rewrittenQuery || ''}</query>\n<book>${pdfName || ''}</book>${bookshelfSection}`
      : `<query>${rewrittenQuery || ''}</query>\n<book>${pdfName || ''}</book>${bookshelfSection}`;
    const content = await streamToContent(
      mainModel,
      [new SystemMessage(casualPrompt), new HumanMessage(userMsg)],
      config,
      callbacks?.onContent,
    );

    const formatted = await sanitizeOutput(content, {
      bookName: pdfName || '',
      crossBookMode,
      inputTextsForValidation: [content],
      markdownFiles: ctx?.toolContext?.book.markdownFiles ?? {},
      vaultApp: ctx?.toolContext?.vault?.app,
      toolResults: [],
      skipVaultVerification: true,
    });
    // CASUAL 也接入死链修复（toolResults 通常空，仅 Step1 修 LLM 写的章节死链）
    const injected = upgradeInlineWikiLinks(formatted, {
      toolResultsSnapshot,
      nodeFileMap: nodeFileMap ?? {},
      pdfName: pdfName || '',
      crossBookMode,
    });
    return { formattedOutput: injected };
  }


  // === Normal mode (depth >= 1): format with full context ===
  const enableFollowUp = depth >= ReadingDepth.INSPECTIONAL;
  const systemPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary, false, enableFollowUp);

  const chatHistory = ctx?.chatHistory ?? [];
  const markdownFiles = ctx?.toolContext?.book.markdownFiles ?? {};
  const effectiveScopeNodeIds = scopeNodeIds ?? [];
  const coveredScope = effectiveScopeNodeIds.length > 0
    ? buildScopedChaptersBlock(effectiveScopeNodeIds, markdownFiles, nodeFileMap)
    : '';

  // === Retrieval coverage transparency ===
  // 把"实际检索了哪些章节"+"用户当前章节是否被覆盖"显式注入 prompt
  // 防止 LLM 拿"未出现"搪塞用户，掩盖真实检索失败
  const retrievalCoverage = buildRetrievalCoverage(
    toolResultsSnapshot,
    ctx?.toolContext?.book?.currentNodeId,
  );

  // 收集输入文本用于校验编造链接。
  // === Extract Current Chapter Highlights & Excerpts (Scheme A) ===
  let userNotesContext = '';
  const vaultApp = ctx?.toolContext?.vault?.app;
  const currentNodeId = ctx?.toolContext?.book?.currentNodeId;
  if (vaultApp && pdfName && currentNodeId) {
    try {
      const excerptDir = bookExcerptDir(pdfName);
      if (await vaultExists(vaultApp, excerptDir)) {
        const { files } = await vaultList(vaultApp, excerptDir);
        const mdFiles = files.filter(f => f.endsWith('.md') && !f.endsWith(`${pdfName}.md`));
        const matchedNotes: { content: string; mtime: number }[] = [];

        for (const filePath of mdFiles) {
          const fileContent = await vaultRead(vaultApp, filePath);
          const stat = await vaultApp.vault.adapter.stat(filePath);
          const mtime = stat?.mtime || 0;

          // Parse markdown callouts
          // Callout pattern: > [!type]+ Title\n(> body lines...)
          const calloutRegex = />\s*\[\!(warning|quote|note|info|tip|success|example)\]\+?([^\n]*)\n((?:>\s*[^\n]*\n*)*)/g;
          let match;
          while ((match = calloutRegex.exec(fileContent)) !== null) {
            const fullCallout = match[0];
            // Check if callout mentions currentNodeId (e.g. [[chapterPath#^blockId]])
            // chapterPath filenames usually start with currentNodeId (like 01, 02) or contain it.
            // We match the node ID number sequence or clean ID
            const cleanNodeId = currentNodeId.replace(/^0+/, '');
            const nodeMatchRegex = new RegExp(`\\[\\[[^\\]]*?\\b${cleanNodeId}\\b[^\\]]*?\\]\\]`);
            if (nodeMatchRegex.test(fullCallout)) {
              matchedNotes.push({
                content: fullCallout.trim(),
                mtime
              });
            }
          }
        }

        if (matchedNotes.length > 0) {
          // Sort by mtime descending (most recent first)
          matchedNotes.sort((a, b) => b.mtime - a.mtime);
          const topNotes = matchedNotes.slice(0, 10);
          let cumulativeLength = 0;
          const selectedNotes: string[] = [];

          for (const note of topNotes) {
            if (cumulativeLength + note.content.length > 1200) {
              // Truncate to avoid context overflow
              const budgetLeft = 1200 - cumulativeLength;
              if (budgetLeft > 50) {
                selectedNotes.push(note.content.substring(0, budgetLeft) + '... (已截断)');
              }
              break;
            }
            selectedNotes.push(note.content);
            cumulativeLength += note.content.length;
          }

          if (selectedNotes.length > 0) {
            userNotesContext = selectedNotes.join('\n\n');
            log('[DeepPDF] Extracted current chapter user notes:', selectedNotes.length, 'items');
          }
        }
      }
    } catch (err) {
      log('[DeepPDF] Failed to extract current chapter notes:', err);
    }
  }

  // 收集输入文本用于校验编造链接。
  // coveredScope 包含 tree.json 中验证过的 file_name（vault 真实文件），
  // 纳入校验是为了让早停路径已引用的链接在 formatter 输出中不被误删。
  // 当 effectiveScopeNodeIds 为空时 coveredScope 为 ''，对校验无影响。
  // 当 analysisResult 无效时使用 effectiveAR（空字符串），避免 XML 残留污染校验。
  const inputTextsForValidation = [
    effectiveAR,
    structuralAnalysis || '',
    coveredScope,
    tocSummary || '',
  ];
  callbacks?.onProgress?.('正在整理笔记...');
  // Booklist mode: avoid single-book link fixup; pdfName is meaningless for multi-book analysis
  const effectivePdfName = crossBookMode ? '' : (pdfName || '');
  // Epic #9：提取检索命中的 block 原文，喂进 formatter prompt 供 LLM 就地引用
  const retrievedBlocks = extractRetrievedBlocks(toolResultsSnapshot ?? [], nodeFileMap ?? {});
  const userMessage = buildFormatterUserMessage(
    rewrittenQuery,
    effectiveAR,
    effectivePdfName,
    chatHistory,
    tocSummary || undefined,
    structuralAnalysis || undefined,
    betterQuestion || undefined,
    coveredScope || undefined,
    !!crossBookMode,
    retrievalCoverage,
    userNotesContext || undefined,
    retrievedBlocks,
  );

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ];

  // Stream output
  let content = await streamToContent(mainModel, messages, config, callbacks?.onContent);

  // T3.2: 流式截断修复 — 在做工具结果校验前先把单边 [[ / ]] 残片修了
  // 顺序关键：流式残片必须先修，否则 verifyAndCleanContent 看到的就是坏数据
  const linkPairResult = validateLinkPairs(content);
  if (linkPairResult.fixedUnpaired > 0) {
    log(`[Formatter] Fixed ${linkPairResult.fixedUnpaired} unpaired [[ or ]]`);
  }
  content = linkPairResult.content;

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

    if (cfg._langsmithTracer) {
      try {
        const client = cfg._langsmithTracer.client;
        await client.createRun({
          name: 'wiki_link_verification',
          run_type: 'tool',
          inputs: { content_length: content.length },
          outputs: verificationResult,
          parent_run_id: config.runId,
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
  const enableHumanReview = cfg.enableHumanReview;
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

  // 段 B 清理 pipeline（vault 真实校验）：委派给 OutputSanitizer
  // 顺序：protectEmbeds → cleanOutput → validateWikiLinks → stripFabricatedLinks → restoreEmbeds
  const formatted = await sanitizeOutput(content, {
    bookName: effectivePdfName,
    crossBookMode,
    inputTextsForValidation,
    markdownFiles,
    vaultApp: ctx?.toolContext?.vault?.app,
    toolResults,
  });

  // Phase 1.5: 把正文已有的章节级链接 [[书/文件]] 就地升级为 block 级 [[书/文件#^blockId|别名]]，
  // 用 pre_search 命中的 blockId（toolResultsSnapshot.extractedBlockIds）补全，链接位置不变、精度到段
  const injected = upgradeInlineWikiLinks(formatted, {
    toolResultsSnapshot,
    nodeFileMap: nodeFileMap ?? {},
    pdfName: effectivePdfName,
    crossBookMode,
  });

  const errorHints = appendErrorHints(state.nodeErrors);

  return { formattedOutput: errorHints ? `${injected}\n\n> [!hint] ${errorHints}` : injected };
}
