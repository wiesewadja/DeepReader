/**
 * Self-Verification Utilities
 *
 * 验证 LLM 输出中的 block_id 引用是否真实存在于工具调用结果中，
 * 移除幽灵引用（Ghost References），并在必要时触发 LLM 修正调用。
 *
 * Extended to also validate file_name in wiki links.
 *
 * Migrated from cognitive-engine/utils/self-verification.ts
 * Removed Langfuse tracing (LangSmith handles tracing via LangGraph automatically)
 */

const MAX_TOOL_RESULT_LENGTH = 4000;

export interface ToolResultEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
  /** Block_ids extracted before compression (for accurate verification) */
  extractedBlockIds?: string[];
}

export interface VerificationResult {
  content: string;
  totalRefs: number;
  ghostRefs: number;
  truncatedRefs: number;
  invalidFileRefs: number;
  llmCorrectionTriggered: boolean;
}

export interface WikiLinkValidation {
  blockId: string;
  fileName?: string;
  bookName?: string;
  status: 'valid' | 'invalid-block' | 'invalid-file' | 'truncated-invisible' | 'ghost';
}

/**
 * 从内容中提取所有 Obsidian block_id 引用（简单版本，只返回 ID 列表）
 */
export function extractBlockIds(content: string): string[] {
  const links = extractWikiLinks(content);
  return links.map(l => l.blockId);
}

/**
 * 从内容中提取所有 Obsidian block_id 引用（包含 file_name）
 */
export function extractWikiLinks(content: string): WikiLinkValidation[] {
  const regex = /\[\[[^\]]*#\^+([^|\]]+)\|[^\]]*\]\]/g;
  const links: WikiLinkValidation[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const fullMatch = match[0];
    const blockId = match[1];

    // Extract file_name from wiki link
    const pathMatch = fullMatch.match(/\[\[([^#]+)#/);
    const fileName = pathMatch ? pathMatch[1].split('/').pop()?.replace(/\.md$/, '') : undefined;

    // Extract book_name from wiki link
    const bookMatch = fullMatch.match(/\[\[([^/]+)\/[^#]+#/);
    const bookName = bookMatch ? bookMatch[1] : undefined;

    links.push({
      blockId,
      fileName,
      bookName,
      status: 'valid',
    });
  }

  return links;
}

/**
 * 检查 wiki link 的完整有效性（block_id + file_name）
 *
 * @returns 'valid' | 'invalid-block' | 'invalid-file' | 'truncated-invisible' | 'ghost'
 */
export function checkWikiLinkValid(
  blockId: string,
  fileName: string | undefined,
  toolResults: ToolResultEntry[]
): WikiLinkValidation['status'] {
  let hasTruncated = false;
  let hasInvalidFile = false;
  let fileFound = false;

  const blockIdWithoutCaret = blockId.startsWith('^') ? blockId.slice(1) : blockId;
  const blockPattern = new RegExp(`\\^${escapeRegExp(blockIdWithoutCaret)}(?=\\W|$)`);
  const fileNamePattern = fileName ? new RegExp(escapeRegExp(fileName), 'i') : null;

  for (const entry of toolResults) {
    if (entry.toolName === 'search_book' || entry.toolName === 'read_book_section') {
      if (fileNamePattern && fileNamePattern.test(entry.result)) {
        fileFound = true;
      }

      if (blockPattern.test(entry.result) || 
          (entry.extractedBlockIds && entry.extractedBlockIds.includes(blockIdWithoutCaret))) {
        if (fileName && !fileFound) {
          hasInvalidFile = true;
        }
        return fileFound || !fileName ? 'valid' : 'invalid-file';
      }
    }

    if (entry.originalResultLength > MAX_TOOL_RESULT_LENGTH) {
      hasTruncated = true;
    }
  }

  if (hasInvalidFile) return 'invalid-file';
  if (hasTruncated) return 'truncated-invisible';
  return 'ghost';
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

  const blockIdWithoutCaret = blockId.startsWith('^') ? blockId.slice(1) : blockId;
  const pattern = new RegExp(`\\^${escapeRegExp(blockIdWithoutCaret)}(?=\\W|$)`);

  for (const entry of toolResults) {
    if (pattern.test(entry.result)) {
      return 'found';
    }
    if (entry.extractedBlockIds && entry.extractedBlockIds.includes(blockIdWithoutCaret)) {
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
 * 验证并清理内容中的 block_id 引用（包含 file_name 验证）
 */
export async function verifyAndCleanContent(
  content: string,
  toolResults: ToolResultEntry[],
  options?: {
    llmClient?: { chat: Function };
    validateFileName?: boolean;
  }
): Promise<VerificationResult> {
  const wikiLinks = extractWikiLinks(content);

  if (wikiLinks.length === 0) {
    return {
      content,
      totalRefs: 0,
      ghostRefs: 0,
      truncatedRefs: 0,
      invalidFileRefs: 0,
      llmCorrectionTriggered: false,
    };
  }

  const ghostIds = new Set<string>();
  const invalidFileIds = new Set<string>();
  let truncatedRefs = 0;
  let invalidFileRefs = 0;

  const validateFileName = options?.validateFileName ?? false;

  for (const link of wikiLinks) {
    if (validateFileName) {
      const status = checkWikiLinkValid(link.blockId, link.fileName, toolResults);
      if (status === 'ghost') {
        ghostIds.add(link.blockId);
      } else if (status === 'invalid-file') {
        invalidFileIds.add(link.blockId);
        invalidFileRefs++;
      } else if (status === 'truncated-invisible') {
        truncatedRefs++;
      }
    } else {
      const status = checkBlockIdExists(link.blockId, toolResults);
      if (status === 'ghost') {
        ghostIds.add(link.blockId);
      } else if (status === 'truncated-invisible') {
        truncatedRefs++;
      }
    }
  }

  const totalRefs = wikiLinks.length;
  const ghostCount = ghostIds.size;

  let cleanedContent = removeGhostLinks(content, ghostIds);
  let llmCorrectionTriggered = false;

  if ((ghostCount + invalidFileRefs) > totalRefs * 0.5 && options?.llmClient) {
    try {
      const correctionMessage = `你的回答中有 ${ghostCount}/${totalRefs} 个 block_id 引用无法在工具调用结果中找到（幽灵引用），${invalidFileRefs} 个引用的文件名不匹配。` +
        `请重新生成回答，只引用实际存在于工具返回内容中的 block_id 和正确的文件名，` +
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
    invalidFileRefs,
    llmCorrectionTriggered,
  };
}
