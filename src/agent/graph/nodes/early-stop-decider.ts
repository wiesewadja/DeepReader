/**
 * EarlyStopDecider — wScore + substantive score + LLM response generation
 *
 * Encapsulates the early-stop decision logic extracted from analytical-pre-search.ts.
 * Responsibilities:
 *   1. Compute wScore (weighted score from top-3 hits)
 *   2. Compute substantive quality score (block_id presence + content length)
 *   3. Decide early_stop vs continue based on thresholds
 *   4. On early_stop: invoke LLM + verifyAndCleanContent
 *   5. Return decision, content, records, and scoring data
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { ChatOpenAI } from '@langchain/openai';
import { agentLog as log } from '../../../utils/logger.js';
import { computeSubstantiveScore, type ScoredHit } from '../utils/scoring-utils.js';
import { buildEarlyStopPrompt } from '../../prompts/utils/index.js';
import { verifyAndCleanContent } from '../utils/self-verification.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EarlyStopHit {
  node_id?: string;
  nodeId?: string;
  score: number;
  matched_blocks?: Array<{ block_id: string; content: string }>;
  matchedBlocks?: Array<{ blockId: string; content: string }>;
}

export interface EarlyStopDeciderParams {
  hits: EarlyStopHit[];
  threshold: number;
  mainModel: ChatOpenAI;
  config: RunnableConfig;
  fullSystemPrompt: string;
  userQuery: string;
  l5ForcesAnalytical?: boolean;
  /** Literal instant kill from PreSearchEngine — bypasses wScore threshold check. */
  earlyStopCandidate?: boolean;
}

export interface EarlyStopDeciderResult {
  decision: 'early_stop' | 'continue';
  content?: string;
  records?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    originalResultLength: number;
    extractedBlockIds: string[];
  }>;
  wScore: number;
  substantiveScore: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Normalized block type that handles both snake_case and camelCase variants */
interface NormalizedBlock {
  block_id?: string;
  blockId?: string;
  content: string;
}

function normalizeHits(hits: EarlyStopHit[]): ScoredHit[] {
  return hits.flatMap(h => {
    const blocks = h.matched_blocks || h.matchedBlocks || [];
    return blocks.map((b: NormalizedBlock) => ({
      block_id: b.block_id || b.blockId || '',
      content: b.content || '',
    }));
  });
}

// ─── Main decider ──────────────────────────────────────────────────────────

export async function earlyStopDecider(
  params: EarlyStopDeciderParams,
): Promise<EarlyStopDeciderResult> {
  const { hits, threshold, mainModel, config, fullSystemPrompt, userQuery, l5ForcesAnalytical } = params;

  // Need at least 2 hits for wScore calculation
  if (hits.length < 2) {
    return { decision: 'continue', wScore: 0, substantiveScore: 0 };
  }

  // 1. Compute wScore
  const wScore = hits[0].score * 0.6
    + (hits[1]?.score ?? 0) * 0.3
    + (hits[2]?.score ?? 0) * 0.1;

  // 2. Compute substantive score
  const normalizedHits = normalizeHits(params.hits);
  const substantiveScore = computeSubstantiveScore(normalizedHits);

  // 3. Decision
  const SUBSTANTIVE_THRESHOLD = 40;
  const { earlyStopCandidate } = params;
  const shouldEarlyStop = (earlyStopCandidate && !l5ForcesAnalytical)
    || (wScore >= threshold
      && hits.length >= 2
      && substantiveScore >= SUBSTANTIVE_THRESHOLD
      && !l5ForcesAnalytical);

  if (!shouldEarlyStop) {
    if (l5ForcesAnalytical) {
      log(`[EarlyStopDecider] Skipped: L5 forces analytical`);
    } else if (earlyStopCandidate) {
      // literal instant kill but blocked by L5 — should not happen, but log it
      log(`[EarlyStopDecider] Literal instant kill blocked by L5`);
    } else if (wScore >= threshold && substantiveScore < SUBSTANTIVE_THRESHOLD) {
      log(`[EarlyStopDecider] Quality guard: wScore=${wScore.toFixed(2)} but substantive=${substantiveScore}/${SUBSTANTIVE_THRESHOLD}`);
    }
    return { decision: 'continue', wScore, substantiveScore };
  }

  // 4. Early stop path — invoke LLM
  log(`[EarlyStopDecider] Early stop: wScore=${wScore.toFixed(2)} >= ${threshold}, substantive=${substantiveScore}`);

  const blockLines = hits.flatMap(h => {
    const blocks = h.matched_blocks || h.matchedBlocks || [];
    return blocks.map((b: NormalizedBlock) => {
      const blockId = (b.block_id || b.blockId || '').replace(/^\^/, '');
      const content = b.content || '';
      const nodeId = h.node_id || h.nodeId || '';
      return `【${nodeId}#^${blockId}】\n${content}`;
    });
  });

  const preSearchRecords = hits.flatMap(h => {
    const blocks = h.matched_blocks || h.matchedBlocks || [];
    return blocks.map((b: NormalizedBlock) => {
      const blockId = (b.block_id || b.blockId || '').replace(/^\^/, '');
      return {
        toolName: 'pre_search' as const,
        args: { query: 'auto', node_id: h.node_id || h.nodeId || '' },
        result: b.content || '',
        originalResultLength: (b.content || '').length,
        extractedBlockIds: [blockId],
      };
    });
  });

  const directPrompt = buildEarlyStopPrompt(fullSystemPrompt, blockLines, userQuery, preSearchRecords);

  const directResponse = await mainModel.invoke([
    new SystemMessage(directPrompt),
    new HumanMessage(userQuery),
  ], config);

  const directContent = typeof directResponse.content === 'string'
    ? directResponse.content
    : Array.isArray(directResponse.content)
      ? (directResponse.content as { type: string; text: string }[])
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('')
      : '';

  // 5. Self-verification
  const verifyResult = await verifyAndCleanContent(directContent, preSearchRecords, {
    llmClient: {
      chat: async (promptText: string) => {
        const resp = await mainModel.invoke([
          new HumanMessage(promptText),
        ], config);
        return typeof resp.content === 'string'
          ? resp.content
          : Array.isArray(resp.content)
            ? (resp.content as { type: string; text: string }[])
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('')
            : '';
      },
    },
  });

  return {
    decision: 'early_stop',
    content: verifyResult.content,
    records: preSearchRecords,
    wScore,
    substantiveScore,
  };
}
