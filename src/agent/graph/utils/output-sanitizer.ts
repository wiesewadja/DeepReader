/**
 * LLM 输出清理 pipeline（OutputSanitizer）
 *
 * 所有 wiki link / block_id 幻觉清理走这里。
 * Pipeline 顺序敏感，参考 formatter.ts:495-538 注释的历史。
 *
 * T04（本 module）：抽出 formatter.ts 的内联清理函数 + 暴露段 B pipeline
 * T05：让 formatter 所有模式分支调 sanitizeOutput（统一清理标准）
 */

import { stripThinkTags } from '../../../config/thinking-models.js';
import { agentLog as log } from '../../../utils/logger.js';
import { getVaultPath } from '../../../utils/mobile-fs.js';
import type { App } from 'obsidian';
import { validateWikiLinks } from '../../utils/wiki-link-hook.js';
import type { ToolResultEntry } from './self-verification.js';

// === 单 pass 清理函数（从 formatter.ts 移过来） ===

/**
 * 修复 wiki 链接格式：补全缺失的书名前缀
 * LLM 有时会输出 [[文件名]] 而非 [[书名/文件名]]，这里强制补全
 *
 * @param crossBookMode true 时不加前缀（书单模式，跨书链接需保持各自的书名前缀或裸名）
 */
export function fixupWikiLinks(content: string, bookName: string, crossBookMode: boolean = false): string {
  if (!bookName || crossBookMode) return content;
  return content.replace(/\[\[([^/\]]+)\]\]/g, (_match: string, inner: string) => {
    return `[[${bookName}/${inner}]]`;
  });
}

/**
 * 清理空的 block_id 锚点：[[path#^|alias]] → [[path|alias]]
 * LLM 有时会为没有 block_id 的引用生成空的 #^，直接使用章节名即可。
 */
export function fixupEmptyBlockIds(content: string): string {
  return content.replace(/\[\[([^#\]]*)#\^\|([^\]]+)\]\]/g, '[[$1|$2]]')
    .replace(/\[\[([^#\]]*)#\^\]\]/g, '[[$1]]');
}

/** 清理思维标签 + 修 wiki link 基础格式 — 各模式分支共用 */
export function cleanOutput(content: string, bookName: string, crossBookMode: boolean = false): string {
  return fixupWikiLinks(fixupEmptyBlockIds(stripThinkTags(content)), bookName, crossBookMode);
}

/**
 * 移除编造的 wiki 链接（输入中不存在的链接）
 * 收集输入文本中的所有合法链接，输出中只保留这些链接
 * 编造的链接回退为纯文本（保留别名部分）
 */
export function stripFabricatedLinks(content: string, inputTexts: string[], vaultBlockIds?: Set<string>): string {
  // 预处理：降级 Calibre pagebreak 标记（calibre-pb-* 不是有效的 Obsidian block ID）
  content = content.replace(/\[\[([^\]]*?)#calibre-pb-\d+([^\]]*)\]\]/g, (_: string, before: string, after: string) => {
    const aliasMatch = after.match(/^\|([^|]+)$/);
    const pathPart = before.split('|')[0];
    const alias = aliasMatch ? aliasMatch[1] : pathPart.split('/').pop() || pathPart;
    return `[[${pathPart}|${alias}]]`;
  });

  const validFileNames = new Set<string>();
  const wikiRegex = /\[\[([^\]]+)\]\]/g;
  for (const text of inputTexts) {
    let m: RegExpExecArray | null;
    const re = new RegExp(wikiRegex.source, wikiRegex.flags);
    while ((m = re.exec(text)) !== null) {
      const inner = m[1];
      const pathPart = inner.split('#')[0].split('|')[0];
      const fileName = pathPart.split('/').pop() || pathPart;
      validFileNames.add(fileName);
      validFileNames.add(pathPart);
    }
    const fnRegex = /file_name:\s*"([^"]+)"/g;
    let fn: RegExpExecArray | null;
    while ((fn = fnRegex.exec(text)) !== null) {
      validFileNames.add(fn[1]);
    }
    const tocRegex = /'([^']+)'\(\d+\)/g;
    let toc: RegExpExecArray | null;
    while ((toc = tocRegex.exec(text)) !== null) {
      validFileNames.add(toc[1]);
    }
  }

  return content.replace(/\[\[([^\]]+)\]\]/g, (fullMatch: string, inner: string) => {
    const hashIdx = inner.indexOf('#');
    const pathPart = (hashIdx >= 0 ? inner.slice(0, hashIdx) : inner).split('|')[0];
    const fileName = pathPart.split('/').pop() || pathPart;

    if (validFileNames.size > 0) {
      let isFabricated = true;
      for (const valid of validFileNames) {
        if (valid === fileName || valid === pathPart || valid.endsWith(fileName) || fileName.endsWith(valid)) {
          isFabricated = false;
          break;
        }
        const stripNum = (s: string) => s.replace(/^\d+\s*[-–]\s*/, '');
        if (stripNum(valid) === stripNum(fileName)) {
          isFabricated = false;
          break;
        }
      }

      if (isFabricated) {
        const aliasMatch = inner.match(/[^|]+$/) ;
        const alias = aliasMatch ? aliasMatch[0] : fileName;
        return alias;
      }
    }

    if (hashIdx >= 0 && vaultBlockIds && vaultBlockIds.size > 0) {
      const hashContent = inner.slice(hashIdx + 1);
      const blockIdMatch = hashContent.match(/^\^([\w-]+)/);
      if (blockIdMatch) {
        const blockId = blockIdMatch[1];
        if (!vaultBlockIds.has(blockId)) {
          const aliasMatch = inner.match(/\|([^|]+)$/);
          const alias = aliasMatch ? aliasMatch[1] : fileName;
          return `[[${pathPart}|${alias}]]`;
        }
      }
    }

    return fullMatch;
  });
}

// === Pipeline 编排 ===

export interface SanitizeContext {
  /** 书名（用于 fixupWikiLinks 补全前缀），空字符串跳过 */
  bookName: string;
  /** 跨书模式（书单）下不加前缀 */
  crossBookMode: boolean;
  /** 用于校验编造链接的输入文本 */
  inputTextsForValidation: string[];
  /** markdownFiles map，用于构建 vaultBlockIds（验证 block_id 是否真实存在） */
  markdownFiles: Record<string, string>;
  /** Obsidian app（用于 validateWikiLinks，可选） */
  vaultApp?: App;
  /** 工具结果，传给 validateWikiLinks 用于跨校验 */
  toolResults?: ToolResultEntry[];
  /**
   * 跳过 vault 真实校验（validateWikiLinks + vaultBlockIds 构建）。
   * 短回复路径（proactive/socratic/casual）可传 true 避免 vault IO，
   * 仍走 stripFabricatedLinks（基于 inputTexts 的轻量校验）。
   */
  skipVaultVerification?: boolean;
}

/**
 * 段 B 清理 pipeline：vault 真实校验段
 *
 * 顺序（来自 formatter.ts:495-538）：
 * 0. protectEmbeds - 保护 ![[...]] 嵌入
 * 1. cleanOutput - fixupEmptyBlockIds + fixupWikiLinks + stripThinkTags
 * 2. validateWikiLinks - vault 真实校验（仅 vaultApp 存在且未 skip 时）
 * 3. stripFabricatedLinks - 兜底（变形的 file_name 白名单）
 * 4. restoreEmbeds - 恢复嵌入
 *
 * 注：段 A（validateLinkPairs + verifyAndCleanContent）跟 HITL 紧耦合，
 * 仍保留在 formatter.ts。本函数专注段 B。
 *
 * 性能：含 vault IO（validateWikiLinks 调 vault.adapter.exists）。
 * 短回复或低风险路径应传 skipVaultVerification: true。
 */
export async function sanitizeOutput(content: string, ctx: SanitizeContext): Promise<string> {
  const {
    bookName,
    crossBookMode,
    inputTextsForValidation,
    markdownFiles,
    vaultApp,
    toolResults,
    skipVaultVerification = false,
  } = ctx;

  // 构建 vault-validated block_id 集合（从 markdown 文件内容提取真实 block_id）
  // skipVaultVerification 时跳过：构建是 O(totalBytes)，短回复路径无必要
  const vaultBlockIds = new Set<string>();
  if (!skipVaultVerification && !crossBookMode && Object.keys(markdownFiles).length > 0) {
    const blockIdRegex = /\^([\w-]+)\s*$/gm;
    for (const fileContent of Object.values(markdownFiles) as string[]) {
      let m: RegExpExecArray | null;
      while ((m = blockIdRegex.exec(fileContent)) !== null) {
        vaultBlockIds.add(m[1]);
      }
    }
  }

  // 0. protectEmbeds - 保护 ![[...]] 嵌入语法（如 Excalidraw）
  const embedPlaceholders: string[] = [];
  const contentToProcess = content.replace(/!\[\[([^\]]+)\]\]/g, (match) => {
    const idx = embedPlaceholders.length;
    embedPlaceholders.push(match);
    return `%%EMBED_${idx}%%`;
  });

  // 1. cleanOutput
  let cleaned = cleanOutput(contentToProcess, bookName, crossBookMode);

  // 2. validateWikiLinks（vault 真实校验）— skipVaultVerification 时跳过避免 vault IO
  if (vaultApp && !skipVaultVerification) {
    try {
      const wikiLinkResult = await validateWikiLinks(cleaned, {
        app: vaultApp,
        bookName: crossBookMode ? '' : bookName,
        expectedBookName: crossBookMode ? '' : bookName,
        vaultPath: getVaultPath(vaultApp),
        toolResults: toolResults ?? [],
      });
      cleaned = wikiLinkResult.correctedContent;
    } catch (err) {
      log('[OutputSanitizer] validateWikiLinks 失败，使用 cleanOutput 结果:', err);
    }
  }

  // 3. stripFabricatedLinks
  let formatted = stripFabricatedLinks(cleaned, inputTextsForValidation, vaultBlockIds);

  // 4. restoreEmbeds
  for (let i = 0; i < embedPlaceholders.length; i++) {
    formatted = formatted.replace(`%%EMBED_${i}%%`, embedPlaceholders[i]);
  }

  return formatted;
}
