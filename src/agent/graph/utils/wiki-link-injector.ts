/**
 * Wiki Link Injector — 修正并内嵌 wiki 链接（blockId 按上下文择优）
 *
 * Step 1 升级现有链接：修死链（4位 node_id → 真实2位文件名）+ 补 alias + blockId 择优。
 * Step 2 主题词内嵌：章节主题词第一次有效出现位置就地内嵌，blockId 择优。
 *   跨书模式跳过 Step2（nodeFileMap 文件名不含书名前缀，内嵌会死链）。
 *
 * "择优"：一个章节命中多个 block 时，取链接/主题词所在句子的上下文，与各 block
 * 原文摘要做 bigram 相似度，选最匹配的 blockId。
 *
 * 注：bigramOverlap 有意不复用 wiki-link-hook.ts 的 calculateSimilarity —— 后者是
 * char-set 包含率，对中文短文本区分度低；bigram（连续两字）对中文择优更精确。
 */

import { agentLog as log } from '../../../utils/logger.js';
import type { ToolResultSnapshot } from '../state.js';

export interface InjectionContext {
  toolResultsSnapshot?: ToolResultSnapshot[];
  nodeFileMap?: Record<string, string>;
  pdfName: string;
  crossBookMode: boolean;
}

interface BlockCand {
  blockId: string;
  excerpt: string;
}
interface FileCand {
  realFile: string;
  blocks: BlockCand[];
}

/** 去 .md + 去前导零：`0033 - foo` / `33 - foo` → `33 - foo`（归一化匹配 key） */
function normalizeFileKey(name: string): string {
  return name.replace(/\.md$/, '').replace(/^0+(\d)/, '$1').trim();
}

/** 文件名 → 主题词/别名：去 .md 与前导序号（兼容 `-` 与 en-dash `–`） */
function fileNameToAlias(fileName: string): string {
  return fileName.replace(/\.md$/, '').replace(/^\d+\s*[-–]\s*/, '').trim();
}

/** nodeFileMap → {归一化key → 真实文件名}（全书，修死链用） */
function buildFileNameMap(ctx: InjectionContext): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawFile of Object.values(ctx.nodeFileMap ?? {})) {
    const fn = rawFile.replace(/\.md$/, '');
    map.set(normalizeFileKey(fn), fn);
  }
  return map;
}

/** toolResults → {归一化文件名 → {真实文件名, 该文件命中的所有 block[]}} */
function buildCandidates(ctx: InjectionContext): Map<string, FileCand> {
  const map = new Map<string, FileCand>();
  const nfm = ctx.nodeFileMap ?? {};
  for (const rec of ctx.toolResultsSnapshot ?? []) {
    const blockIds = rec.extractedBlockIds ?? [];
    const nodeId = rec.args?.node_id;
    const excerpt = rec.result || '';
    if (blockIds.length === 0 || typeof nodeId !== 'string' || !excerpt) continue;
    const rawFile = nfm[nodeId];
    if (!rawFile) continue;
    const realFile = rawFile.replace(/\.md$/, '');
    const key = normalizeFileKey(realFile);
    if (!map.has(key)) map.set(key, { realFile, blocks: [] });
    // 全量入池：search_book 一条结果可能含多个 blockId（extractBlockIdsFromResult）
    // 同条记录的 blockId 共用 excerpt，按 block 精确切分是后续优化
    for (const blockId of blockIds) {
      map.get(key)!.blocks.push({ blockId, excerpt });
    }
  }
  return map;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** offset 是否落在 [[...]] 内部 */
function isInsideLink(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  return before.lastIndexOf('[[') > before.lastIndexOf(']]');
}

/** bigram 重叠率（中文连续两字匹配，比单字 char-set 精确） */
function bigramOverlap(a: string, b: string): number {
  const ca = a.replace(/\s/g, '');
  const cb = b.replace(/\s/g, '');
  if (ca.length < 2 || cb.length < 2) return 0;
  const setA = new Set<string>();
  for (let i = 0; i < ca.length - 1; i++) setA.add(ca.slice(i, i + 2));
  let common = 0;
  let total = 0;
  for (let i = 0; i < cb.length - 1; i++) {
    total++;
    if (setA.has(cb.slice(i, i + 2))) common++;
  }
  return total > 0 ? common / total : 0;
}

/** 从 blocks 里选与 [offset, offset+len) 周围上下文最相似的 blockId；无重叠返回 null */
function chooseBest(text: string, offset: number, len: number, blocks: BlockCand[]): string | null {
  const context = text.slice(Math.max(0, offset - 60), Math.min(text.length, offset + len + 60));
  let best: string | null = null;
  let bestScore = 0;
  for (const b of blocks) {
    const score = bigramOverlap(context, b.excerpt);
    if (score > bestScore) { bestScore = score; best = b.blockId; }
  }
  return bestScore > 0 ? best : null;
}

export function upgradeInlineWikiLinks(content: string, ctx: InjectionContext): string {
  if (!content) return content;
  // Epic #9 修补：LLM 偶发漏 # 的 block 链接 [[文件^block|别名]] → [[文件#^block|别名]]
  // （路径 [^\]\[^|#]+ 不含 #，故已正确的 [[文件#^block]] 不被误改成 double #）
  let fixedHash = 0;
  content = content.replace(/\[\[([^\]\[^|#]+)\^([a-zA-Z0-9_-]+)(\|[^\]]*)?\]\]/g, (_m, p, bid, alias) => {
    fixedHash++;
    return `[[${p}#^${bid}${alias || ''}]]`;
  });
  if (fixedHash) log(`[WikiLinkInjector] 补 # 修复 ${fixedHash} 条漏 # 的 block 链接`);
  const fileNameMap = buildFileNameMap(ctx);
  if (fileNameMap.size === 0) return content;
  const candidates = buildCandidates(ctx);
  const used = new Set([...content.matchAll(/#\^([\w-]+)/g)].map(m => m[1]));
  const prefix = ctx.crossBookMode ? '' : `${ctx.pdfName}/`;

  // Step 1: 升级现有章节链接（修死链 + alias + blockId 择优）
  let upgraded = 0;
  let result = content.replace(/\[\[([^\]]+)\]\]/g, (full: string, inner: string, offset: number) => {
    if (content[offset - 1] === '!') return full;
    if (inner.includes('#')) return full;
    const pipeIdx = inner.indexOf('|');
    const rawPath = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
    const alias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : '';
    if (!rawPath) return full;
    const parts = rawPath.split('/');
    const lastIdx = parts.length - 1;
    const key = normalizeFileKey(parts[lastIdx]);
    const cand = candidates.get(key);
    const realFile = cand?.realFile ?? fileNameMap.get(key);
    if (!realFile) return full;
    parts[lastIdx] = realFile;
    const realPath = parts.join('/');
    const finalAlias = alias || fileNameToAlias(realFile);
    const blocks = (cand?.blocks ?? []).filter(b => !used.has(b.blockId));
    const blockId = blocks.length > 0 ? chooseBest(content, offset, full.length, blocks) : null;
    if (blockId) used.add(blockId);
    upgraded++;
    return blockId ? `[[${realPath}#^${blockId}|${finalAlias}]]` : `[[${realPath}|${finalAlias}]]`;
  });
  if (upgraded > 0) log(`[WikiLinkInjector] 修正/升级 ${upgraded} 条 wiki 链接`);

  // Step 2: 主题词内嵌（跨书模式跳过 —— nodeFileMap 文件名不含书名前缀，内嵌会死链）
  if (ctx.crossBookMode) return result;

  let embedded = 0;
  for (const { realFile, blocks: allBlocks } of candidates.values()) {
    // Epic #9：LLM 已为该文件原生引用了 block 级链接 → 跳过主题词内嵌（避免重复）
    if (result.includes(`[[${prefix}${realFile}#^`)) continue;
    const topic = fileNameToAlias(realFile);
    if (!topic || topic.length < 2) continue;
    const avail = allBlocks.filter(b => !used.has(b.blockId));
    if (avail.length === 0) continue;

    // 找第一个"不在链接内 + 上下文有匹配 block"的出现位置，就地内嵌后跳出
    const re = new RegExp(escapeRegex(topic), 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(result)) !== null) {
      const offset = m.index;
      if (isInsideLink(result, offset)) continue;     // 已在链接内，找下一个出现
      const blockId = chooseBest(result, offset, m[0].length, avail);
      if (!blockId) continue;                          // 该位置无匹配 block，找下一个出现（不锁死）
      const link = `[[${prefix}${realFile}#^${blockId}|${topic}]]`;
      result = result.slice(0, offset) + link + result.slice(offset + m[0].length);
      used.add(blockId);
      embedded++;
      break;                                           // 每文件只内嵌第一次有效出现
    }
  }
  if (embedded > 0) log(`[WikiLinkInjector] 主题词内嵌 ${embedded} 条（按上下文择优 block）`);

  return result;
}
