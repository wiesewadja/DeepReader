/**
 * Socratic Filter Node — Split S2 analysis into facts+question, hide conclusion
 *
 * Inserted between S2 (analytical) and S4 (formatter) when isSocratic is true.
 * Uses fast model to split analysisResult into "facts + question" (output)
 * and "conclusion" (discarded — simplified approach, no second round).
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { SOCRATIC_SPLIT_PROMPT } from '../prompts/socratic-prompt';
import { agentLog as log } from '../../../utils/logger.js';

export async function socraticFilterNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const analysisResult = state.analysisResult || '';
  const fastModel = config.configurable?.fastModel;

  if (!fastModel) {
    log('[SocraticFilter] No fastModel available, socratic mode disabled');
    return {};
  }
  if (!analysisResult) {
    return {};
  }

  const callbacks = config.configurable?.callbacks as {
    onProgress?: (msg: string) => void;
  } | undefined;
  callbacks?.onProgress?.('正在拆分分析...');

  try {
    const splitResult = await fastModel.invoke([
      new SystemMessage(SOCRATIC_SPLIT_PROMPT),
      new HumanMessage(`分析内容：\n${analysisResult}`),
    ]);

    const raw = typeof splitResult.content === 'string' ? splitResult.content : '';
    // Extract JSON from response (may have markdown fences)
    // Try fenced JSON first, then greedy fallback
    const fenceMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    const greedyMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = (fenceMatch?.[1] || greedyMatch?.[0]) ?? '';
    if (!jsonStr) {
      log('[SocraticFilter] No JSON found in LLM output, passing through');
      return {};
    }

    const parsed = JSON.parse(jsonStr);
    if (typeof parsed.facts !== 'string' || typeof parsed.question !== 'string') {
      log('[SocraticFilter] Invalid fields in JSON, passing through');
      return {};
    }
    const filteredOutput = `${parsed.facts}\n\n${parsed.question}`;

    return { analysisResult: filteredOutput };
  } catch (err) {
    log(`[SocraticFilter] Error: ${err instanceof Error ? err.message : String(err)}`);
    // Fallback: pass through unchanged
    return {};
  }
}
