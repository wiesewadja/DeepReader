/**
 * Shared helpers for cognitive engine nodes.
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';

/**
 * Resolve current chapter name from toolContext.markdownFiles.
 */
export function resolveCurrentChapterName(
  currentNodeId: string | undefined,
  markdownFiles: Record<string, string> | undefined,
): string | undefined {
  if (!currentNodeId || !markdownFiles) return undefined;
  for (const [path] of Object.entries(markdownFiles)) {
    const fileName = path.split('/').pop() ?? '';
    if (fileName.startsWith(currentNodeId.replace(/^0+/, ''))) {
      return fileName.replace(/\.md$/, '');
    }
  }
  return undefined;
}

/**
 * Extract the string content of all HumanMessages from a messages array.
 *
 * Used by nodes that need to scan the conversation for explicit user
 * citations (e.g. `[[24 - xxx]]` wiki links). Some messages may have
 * non-string content (multi-modal arrays, tool calls, etc.) — those
 * are silently skipped, since citations only appear in plain text.
 *
 * @param messages - the state.messages array (BaseMessage[])
 * @returns the verbatim string content of each HumanMessage (may include empty strings)
 */
export function extractHumanMessageContents(messages: BaseMessage[] | undefined): string[] {
  if (!messages) return [];
  const out: string[] = [];
  for (const m of messages) {
    if (m.getType?.() === 'human' && typeof m.content === 'string') {
      out.push(m.content);
    }
  }
  return out;
}

