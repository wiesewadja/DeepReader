/**
 * S0: Router Node — LangGraph wrapper
 *
 * Wraps the existing RouterState.execute() into a LangGraph node.
 * Calls the fast model to classify depth and rewrite query.
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { agentLog as log } from '../../../utils/logger.js';
import { IntentRouter } from '../../router/intent-router.js';
import { inheritDepthOnContinuity } from '../../router/continuity-guard.js';
import { upgradeToSyntopical } from '../../router/booklist-resolver.js';
import { verifyExistence } from '../../router/existence-verifier.js';
import type { RouterInput } from '../node-io.js';
import { PROMPT_S0_ROUTER, buildRouterUserMessage } from '../prompts/router-prompt';
import type { SharedContext } from '../shared-context.js';
import type { CognitiveEngineState } from '../state';
import { ReadingDepth } from '../state';
import { detectCorrection, correctionReason } from '../utils/correction-detector.js';
import { extractJSON } from '../utils/parse.js';

interface LLMRouterResponse {
  depth: number;
  standalone_query?: string;
  visualize?: boolean;
  reason?: string;
}

function extractLastHumanMessage(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.getType() === 'human' && typeof m.content === 'string') {
      return m.content;
    }
  }
  return '';
}

/**
 * Merge two allowedTools arrays into a union.
 */
function mergeTools(a: string[], b: string[]): string[] {
  const set = new Set([...a, ...b]);
  return Array.from(set);
}

const intentRouter = new IntentRouter();

export async function routerNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const { messages, allowedTools: prevTools = [], pdfName }: RouterInput = state;
  const fastModel = config.configurable?.fastModel;
  const chatHistory = config.configurable?.chatHistory ?? [];
  const rawQuery = extractLastHumanMessage(messages);

  // Step 1: IntentRouter on raw query (fast, regex-based)
  const rawIntent = intentRouter.analyze(rawQuery);
  log(`[S0 Router] IntentRouter(raw): intents=${rawIntent.detectedIntents.join(',')}, tools=${rawIntent.allowedTools.join(',')}`);

  // Step 1.5: Correction detection — if the user is pushing back on a
  // previous answer, force ANALYTICAL depth regardless of the LLM's
  // depth classification. The LLM tends to inherit the previous
  // (wrong) depth when history already says "未出现".
  const isCorrection = detectCorrection(rawQuery);
  if (isCorrection) {
    log(`[S0 Router] 纠错信号检测: reason="${correctionReason(rawQuery)}", 强制 depth=2 (ANALYTICAL)`);
  }

  // Step 2: Inherit previous intent if this is a follow-up
  const hasNewIntent = rawIntent.detectedIntents.length > 0
    && !rawIntent.detectedIntents.every(i => i === 'general_qa' || i === '闲聊');
  const inheritedTools = (prevTools.length > 0 && !hasNewIntent) ? prevTools : [];

  // Fallback when model is not available (e.g. testing)
  if (!fastModel) {
    return {
      depth: ReadingDepth.ANALYTICAL,
      rewrittenQuery: rawQuery,
      allowedTools: mergeTools(mergeTools(rawIntent.allowedTools, inheritedTools), []),
      correctionDetected: isCorrection,
    };
  }

  try {
    const sharedContext = config.configurable?.sharedContext as SharedContext | undefined;
    const docDescription = sharedContext?.toolContext?.book.docDescription;
    const userMessage = buildRouterUserMessage(rawQuery, chatHistory, pdfName || undefined, docDescription);

    const response = await fastModel.invoke([
      { role: 'system', content: PROMPT_S0_ROUTER },
      { role: 'user', content: userMessage },
    ], config);

    const text = typeof response.content === 'string' ? response.content : '';
    const parsed = extractJSON(text);

    const rawDepth = parsed?.depth;
    const validDepths = Object.values(ReadingDepth) as number[];
    let depth: ReadingDepth = validDepths.includes(rawDepth)
      ? rawDepth : ReadingDepth.ANALYTICAL;

    // Correction-signal override: force ANALYTICAL even if LLM said CASUAL
    if (isCorrection && depth < ReadingDepth.ANALYTICAL) {
      log(`[S0 Router] 纠错信号覆盖 LLM depth=${depth} → 2 (ANALYTICAL)`);
      depth = ReadingDepth.ANALYTICAL;
    }
    const standaloneQuery = parsed?.standalone_query || rawQuery;
    log(`[S0 Router] LLM response: depth=${rawDepth}, reason="${parsed?.reason || '(none)'}", query="${standaloneQuery.slice(0, 80)}"`);
    // Existence verification（独立 module）：BM25 反查"书中有没有提到 X" 类问题
    const existence = await verifyExistence({
      rawQuery,
      standaloneQuery,
      depth,
      bookId: sharedContext?.toolContext?.book.indexId,
      app: sharedContext?.toolContext?.vault.app,
    });
    depth = existence.depth;
    const antiHallucinationQuery = existence.antiHallucinationQuery;

    // Continuity guard: 短回复延续性检测（纯函数策略）
    const continuity = inheritDepthOnContinuity(depth, rawQuery, chatHistory);
    if (continuity.didUpgrade) {
      log(`[S0 Router] 延续性对话检测: "${rawQuery}" 在深度讨论中，升级 depth 0→2`);
      depth = continuity.depth;
    }

    // Step 3: IntentRouter on rewritten query (catches intent missed by raw query)
    const rewrittenIntent = intentRouter.analyze(standaloneQuery);

    // Booklist resolver: 仅当用户显式选择书单时升级到 SYNTOPICAL（纯函数策略）
    const hasBooklist = (sharedContext?.toolContext?.crossBook?.booklistBookIds?.length ?? 0) > 0;
    log(`[S0 Router] hasBooklist=${hasBooklist}, booklistBookIds=${JSON.stringify(sharedContext?.toolContext?.crossBook?.booklistBookIds)}`);
    const syntopical = upgradeToSyntopical(depth, hasBooklist);
    const effectiveDepth = syntopical.depth;

    // Step 4: Merge all tool sources: raw + rewritten + inherited
    const finalTools = mergeTools(
      mergeTools(rawIntent.allowedTools, rewrittenIntent.allowedTools),
      inheritedTools,
    );

    log(`[S0 Router] depth=${effectiveDepth}, tools(raw)=${rawIntent.allowedTools.join(',')}, tools(rewritten)=${rewrittenIntent.allowedTools.join(',')}, tools(inherited)=${inheritedTools.join(',')}, tools(final)=${finalTools.join(',')}`);

    // When BM25 found nothing, rewrite query to guide Formatter to say "not in book"
    // Otherwise strip the [ANTI_HALLUCINATION] prefix (if present) from the output
    let finalQuery: string;
    if (antiHallucinationQuery) {
      finalQuery = `请直接回答：经检索确认，这本书中并未提及"${antiHallucinationQuery}"相关内容。请简洁回复，说明书中未提及该内容，不要展开讨论或用书中概念去分析它。`;
    } else if (standaloneQuery.startsWith('[ANTI_HALLUCINATION]')) {
      // BM25 hit — strip prefix and proceed normally at depth=2
      finalQuery = standaloneQuery.replace('[ANTI_HALLUCINATION]', '').trim();
    } else {
      finalQuery = standaloneQuery;
    }

    // Visualize 判断：router LLM 自主决定是否配图（不限于用户明说）。
    // depth=0（闲聊/存在性验证）一律不画图；其余按 LLM 判断。
    const shouldVisualize = effectiveDepth !== ReadingDepth.CASUAL && parsed?.visualize === true;
    log(`[S0 Router] visualize=${parsed?.visualize} → shouldVisualize=${shouldVisualize} (depth=${effectiveDepth})`);

    return {
      depth: effectiveDepth,
      rewrittenQuery: finalQuery,
      allowedTools: finalTools,
      correctionDetected: isCorrection,
      shouldVisualize,
    };
  } catch (err) {
    // Graceful degradation: default to analytical reading
    log('[S0 Router] LLM 调用失败，降级到 depth=2:', err instanceof Error ? err.message : String(err));
    return {
      depth: ReadingDepth.ANALYTICAL,
      rewrittenQuery: rawQuery,
      allowedTools: mergeTools(rawIntent.allowedTools, inheritedTools),
      correctionDetected: isCorrection,
    };
  }
}
