/**
 * Shared helpers for cognitive engine nodes.
 */

import type { CognitiveEngineState, EngineMode } from '../state';

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
 * Resolve engine mode from state.
 */
export function resolveMode(state: CognitiveEngineState): EngineMode {
  return state.mode || 'normal';
}
