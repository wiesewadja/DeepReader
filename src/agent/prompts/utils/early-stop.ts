import { preSearchPrompt } from '../core/pre-search.js';
import { buildReferenceCandidates } from '../../graph/subgraphs/plan-execute.js';
import type { ToolResultRecord } from '../../graph/subgraphs/tool-execution.js';

export function buildEarlyStopPrompt(
  systemPrompt: string,
  blockLines: string[],
  userQuery: string,
  toolResults: ToolResultRecord[],
): string {
  const refBasket = buildReferenceCandidates(toolResults);
  return `${systemPrompt}

${refBasket}

${preSearchPrompt.locales.zh.systemPrompt}

<pre_search_results>
${blockLines.join('\n\n')}
</pre_search_results>

用户问题：${userQuery}`;
}
