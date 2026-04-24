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
 * 从内容中提取所有 Obsidian wiki 链接（支持两种格式）
 * 
 * 格式1: [[书名/file_name#^block_id|别名]] - 带 block_id
 * 格式2: [[书名/file_name|别名]] 或 [[file_name|别名]] - 无 block_id
 */
export function extractWikiLinks(content: string): WikiLinkValidation[] {
  const links: WikiLinkValidation[] = [];
  
  // 匹配带 block_id 的链接：[[...#^block_id|...]]
  const blockIdRegex = /\[\[[^\]]*#\^+([^|\]]+)\|[^\]]*\]\]/g;
  let match: RegExpExecArray | null;
  
  while ((match = blockIdRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const blockId = match[1];
    
    const pathMatch = fullMatch.match(/\[\[([^#]+)#/);
    const fileName = pathMatch ? pathMatch[1].split('/').pop()?.replace(/\.md$/, '') : undefined;
    
    const bookMatch = fullMatch.match(/\[\[([^/]+)\/[^#]+#/);
    const bookName = bookMatch ? bookMatch[1] : undefined;
    
    links.push({
      blockId,
      fileName,
      bookName,
      status: 'valid',
    });
  }
  
  // 匹配不带 block_id 的链接：[[file_name|别名]] 或 [[书名/file_name|别名]]
  // 注意：排除已匹配的带 block_id 链接
  const noBlockRegex = /\[\[([^#|]+)\|([^\]]+)\]\]/g;
  while ((match = noBlockRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const pathPart = match[1];
    const alias = match[2];
    
    // 检查是否已被 blockIdRegex 匹配（避免重复）
    if (fullMatch.includes('#^')) continue;
    
    // 提取 file_name 和 book_name
    const parts = pathPart.split('/');
    const fileName = parts.length > 1 ? parts[parts.length - 1].replace(/\.md$/, '') : parts[0].replace(/\.md$/, '');
    const bookName = parts.length > 1 ? parts[0] : undefined;
    
    links.push({
      blockId: '',
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
  let fileFound = false;

  const fileNamePattern = fileName ? new RegExp(escapeRegExp(fileName), 'i') : null;

  // 如果没有 block_id，只验证 file_name 是否存在
  if (!blockId) {
    for (const entry of toolResults) {
      if (entry.toolName === 'search_book' || entry.toolName === 'read_book_section' || entry.toolName === 'inspect_toc' || entry.toolName === 'pre_search') {
        if (fileNamePattern && fileNamePattern.test(entry.result)) {
          return 'valid';
        }
      }
      if (entry.originalResultLength > MAX_TOOL_RESULT_LENGTH) {
        hasTruncated = true;
      }
    }
    return hasTruncated ? 'truncated-invisible' : 'ghost';
  }

  // 有 block_id：验证 block_id 和 file_name
  const blockIdWithoutCaret = blockId.startsWith('^') ? blockId.slice(1) : blockId;
  const blockPattern = new RegExp(`\\^${escapeRegExp(blockIdWithoutCaret)}(?=\\W|$)`);

  for (const entry of toolResults) {
    if (entry.toolName === 'search_book' || entry.toolName === 'read_book_section' || entry.toolName === 'pre_search') {
      if (fileNamePattern && fileNamePattern.test(entry.result)) {
        fileFound = true;
      }

      if (blockPattern.test(entry.result) || 
          (entry.extractedBlockIds && entry.extractedBlockIds.includes(blockIdWithoutCaret))) {
        if (fileName && !fileFound) {
          return 'invalid-file';
        }
        return fileFound || !fileName ? 'valid' : 'invalid-file';
      }
    }

    if (entry.originalResultLength > MAX_TOOL_RESULT_LENGTH) {
      hasTruncated = true;
    }
  }

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
 * 降级幽灵 block_id 引用：去掉 #^block_id，保留文件级链接
 * [[书名/文件名#^ghost_block|别名]] → [[书名/文件名|别名]]
 */
export function removeGhostLinks(content: string, ghostIds: Set<string>): string {
  if (ghostIds.size === 0) return content;

  return content.replace(/\[\[([^\]]*)#\^([^|\]]+)\|([^\]]*)\]\]/g, (match, path, blockId, alias) => {
    if (ghostIds.has(blockId)) {
      // 降级为文件级链接，不删除
      return `[[${path}|${alias}]]`;
    }
    return match;
  });
}

/**
 * 保留幽灵文件引用的完整链接（不删除）
 * 即使文件名无法验证，链接仍然指向可能存在的文件
 */
export function removeGhostFileLinks(content: string, ghostFiles: Set<string>): string {
  // 不再删除，直接返回原内容
  return content;
}

/**
 * 验证并清理内容中的 wiki 链接（包含 file_name 验证）
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
  const ghostFiles = new Set<string>();
  let truncatedRefs = 0;
  let invalidFileRefs = 0;

  const validateFileName = options?.validateFileName ?? true;

  for (const link of wikiLinks) {
    const status = checkWikiLinkValid(link.blockId, link.fileName, toolResults);
    if (status === 'ghost') {
      if (link.blockId) {
        ghostIds.add(link.blockId);
      } else if (link.fileName) {
        ghostFiles.add(link.fileName);
      }
    } else if (status === 'invalid-file') {
      ghostFiles.add(link.fileName || '');
      invalidFileRefs++;
    } else if (status === 'truncated-invisible') {
      truncatedRefs++;
    }
  }

  const totalRefs = wikiLinks.length;
  const ghostCount = ghostIds.size + ghostFiles.size;

  let cleanedContent = removeGhostLinks(content, ghostIds);
  cleanedContent = removeGhostFileLinks(cleanedContent, ghostFiles);
  let llmCorrectionTriggered = false;

  if ((ghostCount + invalidFileRefs) > totalRefs * 0.5 && options?.llmClient) {
    try {
      const correctionMessage = `你的回答中有 ${ghostCount}/${totalRefs} 个引用无法在工具调用结果中找到（幽灵引用），${invalidFileRefs} 个引用的文件名不匹配。` +
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
