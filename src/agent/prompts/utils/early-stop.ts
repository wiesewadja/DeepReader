import { preSearchPrompt } from '../core/pre-search.js';

export function buildEarlyStopPrompt(
  systemPrompt: string,
  blockLines: string[],
  userQuery: string,
): string {
  return `${systemPrompt}\n\n${preSearchPrompt.locales.zh.systemPrompt}

<pre_search_results>
${blockLines.join('\n\n')}
</pre_search_results>

用户问题：${userQuery}`;
}
