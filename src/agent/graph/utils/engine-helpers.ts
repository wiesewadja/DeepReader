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
 * Prefers `mode` field; falls back to deprecated boolean pair for backward compat.
 */
export function resolveMode(state: CognitiveEngineState): EngineMode {
  // 显式 mode 优先（包括 'normal' 以外的值）
  if (state.mode) return state.mode;
  // 向后兼容：旧的布尔标记
  if (state.isProactive) return 'proactive';
  if (state.isSocratic) return 'socratic';
  return 'normal';
}
