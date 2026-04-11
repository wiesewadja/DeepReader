/**
 * Self-Verification Utilities
 *
 * 验证 LLM 输出中的 block_id 引用是否真实存在于工具调用结果中，
 * 移除幽灵引用（Ghost References），并在必要时触发 LLM 修正调用。
 */

import type { ITraceContext } from '../../tracing/types';

const MAX_TOOL_RESULT_LENGTH = 8000; // 与 run-state-loop.ts 保持一致

export interface ToolResultEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
}

export interface VerificationResult {
  content: string;
  totalRefs: number;
  ghostRefs: number;
  truncatedRefs: number;
  llmCorrectionTriggered: boolean;
}

/**
 * 从内容中提取所有 Obsidian block_id 引用
 * 匹配格式：[[书名/章节#^block_id|别名]]
 * 返回去重后的 block_id 数组
 */
export function extractBlockIds(content: string): string[] {
  // 匹配 [[任意内容#^block_id|任意别名]] 格式，提取 ^ 后到 | 前的 block_id
  const regex = /\[\[[^\]]*#\^([^|\]]+)\|[^\]]*\]\]/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * 检查 block_id 是否存在于 toolResults 中
 * - 'found'：在某条工具结果中找到
 * - 'truncated-invisible'：未找到，但对应工具结果被截断（可能存在于原始结果中）
 * - 'ghost'：确认不存在（幽灵引用）
 */
export function checkBlockIdExists(
  blockId: string,
  toolResults: ToolResultEntry[]
): 'found' | 'ghost' | 'truncated-invisible' {
  let hasTruncated = false;

  for (const entry of toolResults) {
    if (entry.result.includes(blockId)) {
      return 'found';
    }
    if (entry.originalResultLength > MAX_TOOL_RESULT_LENGTH) {
      hasTruncated = true;
    }
  }

  return hasTruncated ? 'truncated-invisible' : 'ghost';
}

/**
 * 移除幽灵引用，保留别名文本
 * [[书名/章节#^ghost_id|文字]] → 文字
 */
export function removeGhostLinks(content: string, ghostIds: Set<string>): string {
  if (ghostIds.size === 0) return content;

  // 全局替换所有 [[...#^ghost_id|别名]] 为 别名
  return content.replace(/\[\[[^\]]*#\^([^|\]]+)\|([^\]]*)\]\]/g, (match, blockId, alias) => {
    if (ghostIds.has(blockId)) {
      return alias;
    }
    return match;
  });
}

/**
 * 验证并清理内容中的 block_id 引用
 * - 提取所有 block_id
 * - 分类为 found / ghost / truncated-invisible
 * - 移除确认的幽灵引用（保留别名文本）
 * - 若幽灵引用数 > 总引用数 50% 且提供了 llmClient，触发一次 LLM 修正调用
 * - 通过 traceContext 记录 self-verification span
 */
export async function verifyAndCleanContent(
  content: string,
  toolResults: ToolResultEntry[],
  options?: {
    llmClient?: { chat: Function };
    traceContext?: ITraceContext;
  }
): Promise<VerificationResult> {
  const blockIds = extractBlockIds(content);

  if (blockIds.length === 0) {
    return {
      content,
      totalRefs: 0,
      ghostRefs: 0,
      truncatedRefs: 0,
      llmCorrectionTriggered: false,
    };
  }

  const ghostIds = new Set<string>();
  let truncatedRefs = 0;

  for (const id of blockIds) {
    const status = checkBlockIdExists(id, toolResults);
    if (status === 'ghost') {
      ghostIds.add(id);
    } else if (status === 'truncated-invisible') {
      truncatedRefs++;
    }
  }

  const totalRefs = blockIds.length;
  const ghostCount = ghostIds.size;

  let cleanedContent = removeGhostLinks(content, ghostIds);
  let llmCorrectionTriggered = false;

  // 若幽灵引用数超过总引用数的 50%，且提供了 llmClient，触发一次 LLM 修正调用
  if (ghostCount > totalRefs * 0.5 && options?.llmClient) {
    try {
      const correctionMessage = `你的回答中有 ${ghostCount}/${totalRefs} 个 block_id 引用无法在工具调用结果中找到（幽灵引用）。` +
        `请重新生成回答，只引用实际存在于工具返回内容中的 block_id，` +
        `或者直接使用文字描述而不使用 wiki 链接格式。\n\n当前内容：\n${cleanedContent}`;

      const corrected = await options.llmClient.chat(correctionMessage);
      if (corrected && typeof corrected === 'string' && corrected.trim().length > 0) {
        cleanedContent = corrected;
      }
      llmCorrectionTriggered = true;
    } catch {
      // LLM 修正调用失败时静默使用已清理内容
    }
  }

  const result: VerificationResult = {
    content: cleanedContent,
    totalRefs,
    ghostRefs: ghostCount,
    truncatedRefs,
    llmCorrectionTriggered,
  };

  // 通过 traceContext 记录 self-verification span（若存在）
  if (options?.traceContext?.withSpan) {
    options.traceContext.withSpan('self-verification', {
      input: {
        contentLength: content.length,
        blockIdsCount: blockIds.length,
      },
      metadata: {
        totalRefs,
        ghostRefs: ghostCount,
        truncatedRefs,
        llmCorrectionTriggered,
      },
    })?.end({
      output: {
        cleanedLength: cleanedContent.length,
        removedGhostLinks: ghostCount,
      },
    });
  }

  return result;
}
