/**
 * search_markdown_text Tool - 弹性空间搜索
 *
 * 核心算法：滑动窗口 + 词距打分
 * - 滑动窗口：解决 Markdown 列表/换行切断关键词的问题
 * - 词距打分：关键词越紧凑，相关性越高
 *
 * 设计原则：
 * - 数组元素之间保持严格的 AND 逻辑（交集过滤）
 * - 同义词扩展由 LLM 通过正则 (A|B|C) 在单个元素内实现
 * - 底层保持极速、愚蠢、透明
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { SearchHit } from './types.js';
import { getOrBuildLocalCache, normalizeNodeId, HARD_LIMIT_HITS, TOP_N_HITS } from './utils.js';

const SEARCH_TEXT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_markdown_text',
    description: `在书中搜索关键词，返回匹配的段落位置。

【搜索逻辑】
- 数组元素之间是 AND 关系（必须同时匹配所有关键词）
- 同义词扩展：使用正则 (A|B|C) 在单个关键词内实现 OR

【返回结果】
- 返回 Top 5 最相关的片段（按词距+标题加权排序）
- 包含 distribution_map 热力图，显示各章节命中分布
- 如 total_hits > 20，建议换更精准的词重新搜索

【中文搜索技巧】
- 提取核心名词，剔除"如何"、"是什么"等修饰语
- 同义词用正则："(边界|边缘|界限)"
- 拆分复合词：不要搜"解决问题的前提"，改用 ["解决问题", "前提"]`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组，AND 逻辑。同义词请用正则 (A|B|C) 格式'
        },
        scope_node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '限定搜索范围（章节 ID 列表），留空则全局搜索'
        },
        use_regex: {
          type: 'boolean',
          description: '启用正则表达式匹配（默认 false）。开启后支持 (A|B) 同义词'
        }
      },
      required: ['keywords']
    }
  }
};

/** 滑动窗口大小（上下各取 N 段） */
const WINDOW_SIZE = 1;

/** 标题加权倍数（标题路径包含关键词 = +50000，降维打击！） */
const HEADING_BOOST_MULTIPLIER = 50000;

/** 带分数的搜索结果 */
interface ScoredHit extends SearchHit {
  _score: number;
}

/** 热力图条目 */
interface DistributionEntry {
  count: number;
  node_id: string;
  path: string;
}

export const searchMarkdownTextTool: ToolExecutor = {
  definition: SEARCH_TEXT_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const keywords = args.keywords as string[];
    const scopeNodeIds = args.scope_node_ids as string[] | undefined;
    const useRegex = (args.use_regex as boolean) || false;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!keywords || keywords.length === 0) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: 'keywords 参数不能为空'
      });
    }

    // 预编译正则表达式（如果启用）
    let compiledRegexes: RegExp[] = [];
    if (useRegex) {
      try {
        compiledRegexes = keywords.map(kw => new RegExp(kw, 'i'));
      } catch (e) {
        return JSON.stringify({
          status: 'ERROR_INVALID_REGEX',
          message: `正则表达式编译失败: ${e instanceof Error ? e.message : String(e)}`,
          hint: '检查正则语法，如括号匹配、转义字符等'
        });
      }
    }

    try {
      const cache = await getOrBuildLocalCache(context);
      const files = cache.chapterFiles || [];
      const hits: ScoredHit[] = [];

      // 构建 scope 过滤集合
      const scopeSet = scopeNodeIds && scopeNodeIds.length > 0
        ? new Set(scopeNodeIds.map(normalizeNodeId))
        : null;

      // Scope 边界检查
      if (scopeSet && scopeSet.size > 0) {
        const filesInScope = files.filter(file => {
          const fileCache = app.metadataCache.getFileCache(file);
          const rawNodeId = fileCache?.frontmatter?.node_id;
          const nodeId = normalizeNodeId(rawNodeId);
          return scopeSet.has(nodeId);
        });

        if (filesInScope.length === 0) {
          const filesWithoutNodeId = files.filter(file => {
            const fileCache = app.metadataCache.getFileCache(file);
            return !fileCache?.frontmatter?.node_id;
          });

          if (filesWithoutNodeId.length > 0) {
            return JSON.stringify({
              status: 'ERROR_SCOPE_MISMATCH',
              message: `指定的 ${scopeSet.size} 个章节 ID 在当前书籍中未找到匹配的文件`,
              hint: '可能原因：1) 章节尚未导出为 Markdown 2) node_id 不匹配 3) 尝试移除 scope 限制进行全局搜索',
              requested_scope: Array.from(scopeSet),
              available_files: files.length,
              files_without_node_id: filesWithoutNodeId.length
            });
          }

          return JSON.stringify({
            status: 'ERROR_SCOPE_MISMATCH',
            message: `指定的 ${scopeSet.size} 个章节 ID 在当前书籍中未找到`,
            hint: '请检查 scope_node_ids 是否正确，或移除 scope 限制进行全局搜索',
            requested_scope: Array.from(scopeSet),
            available_files: files.length
          });
        }
      }

      // 遍历文件
      for (const file of files) {
        const fileCache = app.metadataCache.getFileCache(file);
        const rawNodeId = fileCache?.frontmatter?.node_id;
        const nodeId = normalizeNodeId(rawNodeId);

        // Scope 过滤
        if (scopeSet && !scopeSet.has(nodeId)) {
          continue;
        }

        const content = await app.vault.cachedRead(file);
        const paragraphs = content.split(/\n\n+/);
        const section = (fileCache?.frontmatter?.section as string) || '';
        const headingPath = section.split('>').map(s => s.trim()).filter(Boolean);

        // 🧱 改进一：滑动窗口匹配
        for (let i = 0; i < paragraphs.length; i++) {
          const para = paragraphs[i];
          if (!para.trim()) continue;

          // 构建滑动窗口文本（上下各取 WINDOW_SIZE 段）
          const startIndex = Math.max(0, i - WINDOW_SIZE);
          const endIndex = Math.min(paragraphs.length - 1, i + WINDOW_SIZE);
          const windowText = paragraphs.slice(startIndex, endIndex + 1).join('\n');

          // 在整个窗口内进行 AND 匹配
          if (matchWindow(windowText, keywords, compiledRegexes, useRegex)) {
            // 📏 词距得分：关键词越紧凑，相关性越高
            const proximityScore = calculateProximityScore(windowText, keywords, compiledRegexes, useRegex);

            // 🎯 标题加权（降维打击）：整个标题路径包含关键词 → +50000
            const headingBoost = calculateHeadingBoost(headingPath, keywords, compiledRegexes, useRegex);

            // 最终得分 = 词距分 + 标题加权 * 50000
            const score = proximityScore + headingBoost * HEADING_BOOST_MULTIPLIER;

            const blockId = extractBlockId(para);

            hits.push({
              node_id: nodeId,
              location: {
                heading: headingPath[headingPath.length - 1] || file.basename,
                path: headingPath,
                file_path: file.path
              },
              snippet: extractSnippet(para, keywords, 150),
              block_id: blockId,
              _score: score
            });

            // 🛡️ 物理防爆阀：超过 200 处直接熔断
            if (hits.length > HARD_LIMIT_HITS) {
              return JSON.stringify({
                status: 'ERROR_TOO_BROAD',
                message: `严重宽泛！前置扫描已命中超过 ${HARD_LIMIT_HITS} 处，系统拒绝执行排序操作。`,
                hint: '请务必使用更罕见的专有名词，或增加定语缩小范围。',
                scope_filter: scopeSet ? `已限定在 ${scopeSet.size} 个章节` : '全局搜索',
                total_hits: hits.length
              });
            }
          }
        }
      }

      if (hits.length === 0) {
        const scopeInfo = scopeSet
          ? `（已限定在 ${scopeSet.size} 个章节内）`
          : '（全局搜索）';
        return JSON.stringify({
          status: 'ERROR_NOT_FOUND',
          message: `未找到匹配内容${scopeInfo}`,
          suggestions: generateSuggestions(keywords, useRegex),
          hint: useRegex
            ? '尝试：1) 简化正则表达式 2) 检查正则语法 3) 移除 scope 限制'
            : '尝试：1) 使用单个核心名词 2) 启用 use_regex 并用 (A|B) 匹配同义词 3) 移除 scope 限制'
        });
      }

      // 🔥 先生成热力图（用于二级排序）
      const distributionMap = buildDistributionMap(hits);

      // 📊 排序：主键=得分，次键=热力图命中次数（降维打击！）
      hits.sort((a, b) => {
        const scoreDiff = b._score - a._score;
        if (scoreDiff !== 0) return scoreDiff;

        // 得分相同时，热力图命中次数多的章节优先
        const exactHeading = a.location.heading;
        const aCount = distributionMap[exactHeading]?.count || 0;
        const bCount = distributionMap[b.location.heading]?.count || 0;
        return bCount - aCount;
      });

      // ✂️ 截断 Top N
      const topHits = hits.slice(0, TOP_N_HITS);

      // 移除内部 _score 字段后返回
      const sortedHits: SearchHit[] = topHits.map(({ _score, ...hit }) => hit);

      return JSON.stringify({
        status: 'SUCCESS',
        total_hits: hits.length,           // 总命中数
        returned_hits: sortedHits.length,  // 实际返回数
        distribution_map: distributionMap, // 热力图
        hits: sortedHits,
        scope_filter: scopeSet ? `已限定在 ${scopeSet.size} 个章节` : '全局搜索'
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({
        status: 'ERROR_FILE_READ_FAILED',
        message: `读取文件失败: ${errorMsg}`
      });
    }
  }
};

/**
 * 滑动窗口匹配
 *
 * 保持严格的 AND 逻辑：所有关键词（或正则）必须在窗口内同时出现
 */
function matchWindow(
  windowText: string,
  keywords: string[],
  compiledRegexes: RegExp[],
  useRegex: boolean
): boolean {
  const lowerText = windowText.toLowerCase();

  if (useRegex) {
    // 正则模式：所有正则都必须匹配（AND 逻辑）
    return compiledRegexes.every(regex => regex.test(windowText));
  }

  // 默认模式：所有关键词必须同时出现（AND 逻辑）
  return keywords.every(kw => lowerText.includes(kw.toLowerCase()));
}

/**
 * 📏 词距打分
 *
 * 关键词在文本中出现的距离越近，相关度越高
 * 极简实现：计算最早和最晚出现的关键词之间的字符距离
 */
function calculateProximityScore(
  text: string,
  keywords: string[],
  compiledRegexes: RegExp[],
  useRegex: boolean
): number {
  const lowerText = text.toLowerCase();
  const indices: number[] = [];

  if (useRegex) {
    // 正则模式：找每个正则的首次匹配位置
    for (const regex of compiledRegexes) {
      const match = regex.exec(text);
      if (match) {
        indices.push(match.index);
      }
    }
  } else {
    // 默认模式：找每个关键词的位置
    for (const kw of keywords) {
      const idx = lowerText.indexOf(kw.toLowerCase());
      if (idx !== -1) {
        indices.push(idx);
      }
    }
  }

  if (indices.length < 2) {
    return 10000; // 只有一个关键词，给高分
  }

  // 计算跨度：最早和最晚出现的关键词之间的距离
  const minIdx = Math.min(...indices);
  const maxIdx = Math.max(...indices);
  const span = maxIdx - minIdx;

  // 跨度越小，得分越高（紧密相连的词组大概率是核心定义）
  return Math.floor(10000 / (span + 1));
}

/**
 * 🎯 标题命中加权
 *
 * 如果关键词出现在章节标题中，说明这节就是专门讲这个的！
 * 返回匹配的关键词数量，最终乘以 10000 作为加权
 */
function calculateHeadingBoost(
  headingPath: string[],
  keywords: string[],
  compiledRegexes: RegExp[],
  useRegex: boolean
): number {
  const headingText = headingPath.join(' ').toLowerCase();
  let boost = 0;

  if (useRegex) {
    // 正则模式：每个正则在标题中匹配一次就 +1
    for (const regex of compiledRegexes) {
      if (regex.test(headingText)) {
        boost += 1;
      }
    }
  } else {
    // 默认模式：每个关键词在标题中出现就 +1
    for (const kw of keywords) {
      if (headingText.includes(kw.toLowerCase())) {
        boost += 1;
      }
    }
  }

  return boost;
}

/**
 * 📊 构建分布热力图
 *
 * 统计各章节的命中次数，帮助 LLM 找到"老巢"
 * Key 是最内层标题（可直接传给 read_markdown_section 的 heading 参数）
 */
function buildDistributionMap(hits: ScoredHit[]): Record<string, DistributionEntry> {
  const distribution: Record<string, DistributionEntry> = {};

  for (const hit of hits) {
    // 取最内层标题作为 key（可直接传给 read 工具）
    const exactHeading = hit.location.heading;
    const fullPath = hit.location.path.join(' > ');

    if (!distribution[exactHeading]) {
      distribution[exactHeading] = {
        count: 0,
        node_id: hit.node_id,
        path: fullPath
      };
    }
    distribution[exactHeading].count += 1;
  }

  // 按命中次数降序排序，只保留前 10 个
  const sorted = Object.entries(distribution)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  return Object.fromEntries(sorted);
}

/**
 * 提取段落中的 block_id（带 ^ 前缀）
 */
function extractBlockId(para: string): string {
  const match = para.match(/\^[\w-]+/);
  return match ? match[0] : '';
}

/**
 * 以关键词为中心提取 Snippet
 */
function extractSnippet(para: string, keywords: string[], maxLen: number = 150): string {
  const lowerPara = para.toLowerCase();
  const positions: number[] = [];

  for (const kw of keywords) {
    const idx = lowerPara.indexOf(kw.toLowerCase());
    if (idx !== -1) {
      positions.push(idx);
    }
  }

  // 如果没有找到任何关键词，从开头截取
  const centerIdx = positions.length > 0
    ? positions.sort((a, b) => a - b)[Math.floor(positions.length / 2)]
    : 0;

  // 如果段落很短，直接返回
  if (para.length <= maxLen) {
    return para;
  }

  // 以关键词为中心，前后各取一部分
  const halfLen = Math.floor(maxLen / 2);
  let start = Math.max(0, centerIdx - halfLen);
  let end = Math.min(para.length, centerIdx + halfLen);

  // 尝试向句边界扩展
  start = expandToSentenceBoundary(para, start, 'backward');
  end = expandToSentenceBoundary(para, end, 'forward');

  let snippet = para.slice(start, end).trim();

  // 添加省略号
  if (start > 0) snippet = '...' + snippet;
  if (end < para.length) snippet = snippet + '...';

  return snippet;
}

/**
 * 中文句子分隔符
 */
const SENTENCE_DELIMITERS = ['。', '？', '！', '；', '……'];

/**
 * 向句边界扩展
 */
function expandToSentenceBoundary(para: string, pos: number, direction: 'backward' | 'forward'): number {
  const maxOffset = 30;
  let bestPos = pos;

  for (const delim of SENTENCE_DELIMITERS) {
    if (direction === 'backward') {
      const idx = para.lastIndexOf(delim, pos);
      if (idx !== -1 && idx > pos - maxOffset && idx + 1 > bestPos) {
        bestPos = idx + 1;
      }
    } else {
      const idx = para.indexOf(delim, pos);
      if (idx !== -1 && idx < pos + maxOffset && (bestPos === pos || idx + 1 < bestPos)) {
        bestPos = idx + 1;
      }
    }
  }

  return bestPos;
}

/**
 * 生成搜索建议
 */
function generateSuggestions(keywords: string[], useRegex: boolean): string[] {
  const suggestions: string[] = [];

  if (!useRegex && keywords.length > 1) {
    // 建议使用正则处理同义词
    suggestions.push(`尝试启用 use_regex 并使用正则同义词：keywords: ["${keywords.map(kw => `(${kw}|同义词)`).join('", "')}"]`);
  }

  if (keywords.some(kw => kw.length > 4)) {
    // 建议拆分长关键词
    suggestions.push('尝试拆分长关键词为核心名词');
  }

  return suggestions;
}
