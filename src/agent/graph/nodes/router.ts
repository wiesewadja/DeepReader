/**
 * S0: Router Node — LangGraph wrapper
 *
 * Wraps the existing RouterState.execute() into a LangGraph node.
 * Calls the fast model to classify depth and rewrite query.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { ReadingDepth } from '../state';
import { searchBookV2 } from '../../../pageindex/book-search-v2.js';
import type { RouterInput } from '../node-io.js';
import type { SharedContext } from '../shared-context.js';
import { PROMPT_S0_ROUTER, buildRouterUserMessage } from '../prompts/router-prompt';
import { extractJSON } from '../utils/parse.js';
import { agentLog as log } from '../../../utils/logger.js';
import { hasSyntopicalKeywords } from '../../utils/syntopical-search.js';
import { IntentRouter } from '../../router/intent-router.js';

interface LLMRouterResponse {
  depth: number;
  standalone_query?: string;
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

/** BM25 score threshold for anti-hallucination: below this = not in book */
const ANTI_HALLUCINATION_SCORE_THRESHOLD = 0.3;

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
    const standaloneQuery = parsed?.standalone_query || rawQuery;

    // Anti-hallucination guard: "书中有没有提到X" → BM25 verification
    let antiHallucinationQuery = '';
    if (standaloneQuery.startsWith('[ANTI_HALLUCINATION]')) {
      const cleanQuery = standaloneQuery.replace('[ANTI_HALLUCINATION]', '').trim();
      const bookId = sharedContext?.toolContext?.book.indexId;
      const app = sharedContext?.toolContext?.vault.app;
      if (bookId && app) {
        try {
          const results = await searchBookV2({ query: cleanQuery, bookId, app, topK: 3, filePath: '' });
          if (results.length > 0 && results.some(r => (r.score ?? 0) > ANTI_HALLUCINATION_SCORE_THRESHOLD)) {
            log(`[S0 Router] ANTI_HALLUCINATION: "${cleanQuery}" 命中 ${results.length} 条结果，升级 depth→2`);
            depth = ReadingDepth.ANALYTICAL;
          } else {
            log(`[S0 Router] ANTI_HALLUCINATION: "${cleanQuery}" 未命中，保持 depth=0`);
            antiHallucinationQuery = cleanQuery;
          }
        } catch (e) {
          log(`[S0 Router] ANTI_HALLUCINATION BM25 搜索失败: ${e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e)}`);
        }
      }
    }

    // Continuity guard: short replies ("ok", "继续", "嗯") during an ongoing
    // deep discussion should inherit the previous depth, not be treated as casual.
    const CONTINUITY_THRESHOLD = 5;
    if (depth === ReadingDepth.CASUAL && rawQuery.trim().length <= CONTINUITY_THRESHOLD && chatHistory.length >= 2) {
      const lastAi = [...chatHistory].reverse().find(m => m.role === 'assistant');
      if (lastAi && lastAi.content.length > 200) {
        log(`[S0 Router] 延续性对话检测: "${rawQuery}" 在深度讨论中，升级 depth 0→2`);
        depth = ReadingDepth.ANALYTICAL;
      }
    }

    // Step 3: IntentRouter on rewritten query (catches intent missed by raw query)
    const rewrittenIntent = intentRouter.analyze(standaloneQuery);

    // Hybrid trigger: keywords pre-check + LLM classification + booklist mode
    // Only upgrade to SYNTOPICAL when LLM already classified depth >= ANALYTICAL
    const hasBooklist = (sharedContext?.toolContext?.crossBook?.booklistBookIds?.length ?? 0) > 0;
    const candidateSyntopical = hasSyntopicalKeywords(rawQuery) || hasBooklist;
    log(`[S0 Router] hasBooklist=${hasBooklist}, hasKeywords=${hasSyntopicalKeywords(rawQuery)}, booklistBookIds=${JSON.stringify(sharedContext?.toolContext?.crossBook?.booklistBookIds)}`);
    const effectiveDepth = (candidateSyntopical && depth >= ReadingDepth.ANALYTICAL)
      ? ReadingDepth.SYNTOPICAL
      : depth;

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

    return {
      depth: effectiveDepth,
      rewrittenQuery: finalQuery,
      allowedTools: finalTools,
    };
  } catch (err) {
    // Graceful degradation: default to analytical reading
    log('[S0 Router] LLM 调用失败，降级到 depth=2:', err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err));
    return {
      depth: ReadingDepth.ANALYTICAL,
      rewrittenQuery: rawQuery,
      allowedTools: mergeTools(rawIntent.allowedTools, inheritedTools),
    };
  }
}
