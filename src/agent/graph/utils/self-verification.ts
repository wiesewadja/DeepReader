/**
 * Self-Verification Utilities
 *
 * 验证 LLM 输出中的 block_id 引用是否真实存在于工具调用结果中，
 * 移除幽灵引用（Ghost References），并在必要时触发 LLM 修正调用。
 *
 * Migrated from cognitive-engine/utils/self-verification.ts
 * Removed Langfuse tracing (LangSmith handles tracing via LangGraph automatically)
 */

const MAX_TOOL_RESULT_LENGTH = 8000;

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
 */
export function extractBlockIds(content: string): string[] {
  const regex = /\[\[[^\]]*#\^+([^|\]]+)\|[^\]]*\]\]/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * 检查 block_id 是否存在于 toolResults 中
 *
 * 使用正则精确匹配 block ID 边界，避免子串匹配问题
 * （例如 `p1` 不应匹配到 `p10`、`p11` 等）
 */
export function checkBlockIdExists(
  blockId: string,
  toolResults: ToolResultEntry[]
): 'found' | 'ghost' | 'truncated-invisible' {
  let hasTruncated = false;

  // block_id 在 Markdown 中出现时，前面是 `^`，后面是非单词字符或行尾
  const blockIdWithoutCaret = blockId.startsWith('^') ? blockId.slice(1) : blockId;
  // 匹配 ^blockId 后跟非单词字符或字符串末尾（避免 p1 匹配 p10）
  const pattern = new RegExp(`\\^${escapeRegExp(blockIdWithoutCaret)}(?=\\W|$)`);

  for (const entry of toolResults) {
    if (pattern.test(entry.result)) {
      return 'found';
    }
    if (entry.originalResultLength > MAX_TOOL_RESULT_LENGTH) {
      hasTruncated = true;
    }
  }

  return hasTruncated ? 'truncated-invisible' : 'ghost';
}

/**
 * 转义正则特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 移除幽灵引用，保留别名文本
 */
export function removeGhostLinks(content: string, ghostIds: Set<string>): string {
  if (ghostIds.size === 0) return content;

  return content.replace(/\[\[[^\]]*#\^([^|\]]+)\|([^\]]*)\]\]/g, (match, blockId, alias) => {
    if (ghostIds.has(blockId)) {
      return alias;
    }
    return match;
  });
}

/**
 * 验证并清理内容中的 block_id 引用
 */
export async function verifyAndCleanContent(
  content: string,
  toolResults: ToolResultEntry[],
  options?: {
    llmClient?: { chat: Function };
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

  return {
    content: cleanedContent,
    totalRefs,
    ghostRefs: ghostCount,
    truncatedRefs,
    llmCorrectionTriggered,
  };
}
