/**
 * S4: Formatter Node — Style transformation with wiki link preservation
 *
 * S4 只做风格转换（奚童语气），wiki 链接由 S2 生成，通过 prompt
 * 引导 S4 保留原始链接。self-verification 作为安全网移除幽灵引用。
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import type { CognitiveEngineState, NodeError, ToolResultSnapshot } from '../state';
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
import { validateWikiLinks } from '../../utils/wiki-link-hook.js';
import { validateLinkPairs } from '../../utils/wiki-link-pair-validator.js';
import { getVaultPath } from '../../../utils/mobile-fs.js';
import { agentLog as log } from '../../../utils/logger.js';
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
 * 修复 wiki 链接格式：补全缺失的书名前缀
 * LLM 有时会输出 [[文件名]] 而非 [[书名/文件名]]，这里强制补全
 *
 * @param crossBookMode true 时不加前缀（书单模式，跨书链接需保持各自的书名前缀或裸名）
 */
export function fixupWikiLinks(content: string, bookName: string, crossBookMode: boolean = false): string {
  if (!bookName || crossBookMode) return content;
  // 匹配 [[...]] 中不含 / 的链接，补全书名前缀
  return content.replace(/\[\[([^/\]]+)\]\]/g, (_match: string, inner: string) => {
    return `[[${bookName}/${inner}]]`;
  });
}

/**
 * 清理空的 block_id 锚点：[[path#^|alias]] → [[path|alias]]
 * LLM 有时会为没有 block_id 的引用生成空的 #^，直接使用章节名即可。
 *
 * 全模式执行：proactive/socratic/casual 等 LLM 同样可能产生此幻觉模式，
 * 对无 wiki 链接的内容该函数无副作用（正则无匹配即跳过）。
 * 正则中 [^#\]]* 不允许 # 出现在路径中是正确的——Obsidian 用 # 分隔标题锚点，
 * 文件名本身不能包含 #。
 */
export function fixupEmptyBlockIds(content: string): string {
  return content.replace(/\[\[([^#\]]*)#\^\|([^\]]+)\]\]/g, '[[$1|$2]]')
    .replace(/\[\[([^#\]]*)#\^\]\]/g, '[[$1]]');
}

/** 清理思维标签并修复 wiki 链接 — 多个模式分支共用 */
function cleanOutput(content: string, pdfName: string, crossBookMode: boolean = false): string {
  return fixupWikiLinks(fixupEmptyBlockIds(stripThinkTags(content)), pdfName, crossBookMode);
}

/**
 * 移除编造的 wiki 链接（输入中不存在的链接）
 * 收集输入文本中的所有合法链接，输出中只保留这些链接
 * 编造的链接回退为纯文本（保留别名部分）
 */
export function stripFabricatedLinks(content: string, inputTexts: string[], vaultBlockIds?: Set<string>): string {
  // 预处理：降级 Calibre pagebreak 标记（calibre-pb-* 不是有效的 Obsidian block ID）
  content = content.replace(/\[\[([^\]]*?)#calibre-pb-\d+([^\]]*)\]\]/g, (_: string, before: string, after: string) => {
    const aliasMatch = after.match(/^\|([^|]+)$/);
    const pathPart = before.split('|')[0];
    const alias = aliasMatch ? aliasMatch[1] : pathPart.split('/').pop() || pathPart;
    return `[[${pathPart}|${alias}]]`;
  });

  const validFileNames = new Set<string>();
  // 1. 从 [[...]] wiki 链接中提取
  const wikiRegex = /\[\[([^\]]+)\]\]/g;
  for (const text of inputTexts) {
    let m: RegExpExecArray | null;
    const re = new RegExp(wikiRegex.source, wikiRegex.flags);
    while ((m = re.exec(text)) !== null) {
      const inner = m[1];
      const pathPart = inner.split('#')[0].split('|')[0];
      const fileName = pathPart.split('/').pop() || pathPart;
      validFileNames.add(fileName);
      validFileNames.add(pathPart);
    }
    // 2. 从 scoped_chapters 的 file_name 字段提取
    const fnRegex = /file_name:\s*"([^"]+)"/g;
    let fn: RegExpExecArray | null;
    while ((fn = fnRegex.exec(text)) !== null) {
      validFileNames.add(fn[1]);
    }
    // 3. 从 tocSummary 的章节标题提取（格式：'标题'(nodeId)）
    const tocRegex = /'([^']+)'\(\d+\)/g;
    let toc: RegExpExecArray | null;
    while ((toc = tocRegex.exec(text)) !== null) {
      validFileNames.add(toc[1]);
    }
  }

  // T1.4 修复：移除宽松分支，统一走严格分支
  // 严格分支：file_name 检查仅在 validFileNames 非空时执行
  //           block_id 检查仅在 vaultBlockIds 非空时执行
  return content.replace(/\[\[([^\]]+)\]\]/g, (fullMatch: string, inner: string) => {
    const hashIdx = inner.indexOf('#');
    const pathPart = (hashIdx >= 0 ? inner.slice(0, hashIdx) : inner).split('|')[0];
    const fileName = pathPart.split('/').pop() || pathPart;

    // 1. file_name 检查（仅在 validFileNames 非空时执行）
    if (validFileNames.size > 0) {
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
    }

    // 2. block_id 检查（仅在 vaultBlockIds 非空时执行）
    if (hashIdx >= 0 && vaultBlockIds && vaultBlockIds.size > 0) {
      const hashContent = inner.slice(hashIdx + 1);
      const blockIdMatch = hashContent.match(/^\^([\w-]+)/);
      if (blockIdMatch) {
        const blockId = blockIdMatch[1];
        if (!vaultBlockIds.has(blockId)) {
          // block_id 在 vault 中不存在 → 降级为标题链接
          const aliasMatch = inner.match(/\|([^|]+)$/);
          const alias = aliasMatch ? aliasMatch[1] : fileName;
          return `[[${pathPart}|${alias}]]`;
        }
      }
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
    crossBookMode,
    nodeFileMap,
  }: FormatterInput = state;
  const mode = resolveMode(state);
  const mainModel = config.configurable?.mainModel;
  const callbacks = config.configurable?.callbacks as {
    onContent?: (content: string) => void;
    onProgress?: (msg: string) => void;
  } | undefined;
  const ctx = config.configurable?.sharedContext;

  // Detect and clean XML tool call residue in analysisResult
  const _rawAR = analysisResult || '';
  const _hasXmlResidue = /<function>[\s\S]*?<\/function>/.test(_rawAR);
  const effectiveAR = _hasXmlResidue ? _rawAR.replace(/<function>[\s\S]*?<\/function>/g, '').replace(/<parameter>[\s\S]*?<\/parameter>/g, '').trim() : _rawAR;

  if (!mainModel) {
    return { formattedOutput: effectiveAR || rewrittenQuery || '' };
  }

  // === Proactive mode: ask a question, don't answer ===
  if (mode === 'proactive') {
    const trigger = (proactiveTrigger || 'inspectional') as 'inspectional' | 'highlight' | 'chapter';
    const ar = analysisResult || '';
    const hasDiagram = false; // 图表生成已迁移到 Hermes
    callbacks?.onProgress?.('思考引导问题...');
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

    return { formattedOutput: cleanOutput(content, pdfName || '', crossBookMode) };
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

    return { formattedOutput: cleanOutput(content, pdfName || '', crossBookMode) };
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

    return { formattedOutput: cleanOutput(content, pdfName || '', crossBookMode) };
  }


  // === Normal mode (depth >= 1): format with full context ===
  const systemPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary);

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

  // Build vault-validated block_id set from actual file contents
  const vaultBlockIds = new Set<string>();
  if (!crossBookMode && Object.keys(markdownFiles).length > 0) {
    const blockIdRegex = /\^([\w-]+)\s*$/gm;
    for (const fileContent of Object.values(markdownFiles) as string[]) {
      let m: RegExpExecArray | null;
      while ((m = blockIdRegex.exec(fileContent)) !== null) {
        vaultBlockIds.add(m[1]);
      }
    }
  }

  // T2.2: 正式处理顺序
  // 1. cleanOutput - 修格式（fixupWikiLinks, fixupEmptyBlockIds, stripThinkTags）
  // 2. validateWikiLinks - 基于 vault.exists 真实校验（仅在有 app 时）
  // 3. stripFabricatedLinks - 兜底（变形的 file_name 白名单）
  let cleanedContent = cleanOutput(content, effectivePdfName, crossBookMode);

  const vaultApp = ctx?.toolContext?.vault?.app;
  if (vaultApp) {
    try {
      const wikiLinkResult = await validateWikiLinks(cleanedContent, {
        app: vaultApp,
        bookName: crossBookMode ? '' : (pdfName || ''),
        expectedBookName: crossBookMode ? '' : (pdfName || ''),
        vaultPath: getVaultPath(vaultApp),
        toolResults,
      });
      cleanedContent = wikiLinkResult.correctedContent;
    } catch (err) {
      // 校验失败时静默使用 cleanOutput 的结果（不阻塞 S4 输出）
      log('[Formatter] validateWikiLinks 失败，使用 cleanOutput 结果:', err);
    }
  }

  const formatted = stripFabricatedLinks(
    cleanedContent,
    inputTextsForValidation,
    vaultBlockIds,
  );
  const errorHints = appendErrorHints(state.nodeErrors);

  return { formattedOutput: errorHints ? `${formatted}\n\n> [!hint] ${errorHints}` : formatted };
}
