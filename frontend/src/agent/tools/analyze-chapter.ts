/**
 * analyze_chapter Tool - 分析章节内容
 *
 * 合并了原 find_key_terms 和 extract_propositions 的功能
 * 通过 type 参数控制分析类型
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

const ANALYZE_CHAPTER_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'analyze_chapter',
    description: `【分析阅读】分析章节内容。type 控制分析类型：
- terms：识别关键术语
- propositions：提取核心论点
- both（默认）：两者都做`,
    parameters: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: '要分析的章节 ID',
        },
        type: {
          type: 'string',
          enum: ['terms', 'propositions', 'both'],
          description: '分析类型：terms（术语）、propositions（论点）、both（默认，两者都做）',
        },
        max_items: {
          type: 'number',
          description: '每类最多返回的条目数（默认 5）',
        },
      },
      required: ['node_id'],
    },
  },
};

/**
 * 术语信息
 */
interface TermInfo {
  term: string;
  frequency: number;
  contexts: string[];
  likelyType: '专业术语' | '关键概念' | '人名/地名' | '缩写';
}

/**
 * 主旨信息
 */
interface PropositionInfo {
  type: 'claim' | 'argument' | 'definition';
  sentence: string;
  importance: number;
  indicators: string[];
}

export const analyzeChapterTool: ToolExecutor = {
  definition: ANALYZE_CHAPTER_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const nodeId = args.node_id as string;
    const analysisType = (args.type as string) || 'both';
    const maxItems = (args.max_items as number) || 5;

    if (!nodeId) {
      return 'Error: node_id 参数是必需的';
    }

    try {
      log('[analyze_chapter] 分析章节:', { nodeId, analysisType, maxItems, indexId: context.indexId });

      // 获取章节内容
      const exportData = await deeppdfClient.exportIndex(context.indexId);
      const node = exportData.nodes.find((n) => n.node_id === nodeId);

      if (!node) {
        return `Error: 未找到章节 "${nodeId}"`;
      }

      const lines: string[] = [];
      lines.push(`# 「${node.node_name}」分析`);
      lines.push('');

      // 根据类型执行分析
      if (analysisType === 'terms' || analysisType === 'both') {
        const terms = extractKeyTerms(node.text, maxItems);
        const termsOutput = formatTermsOutput(terms, maxItems);
        lines.push(termsOutput);
      }

      if (analysisType === 'propositions' || analysisType === 'both') {
        const propositions = extractPropositions(node.text, 'all', maxItems);
        const propsOutput = formatPropositionsOutput(propositions);
        lines.push(propsOutput);
      }

      log('[analyze_chapter] 分析完成');
      return lines.join('\n');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[analyze_chapter] 分析失败:', errorMsg);
      return `Error analyzing chapter: ${errorMsg}`;
    }
  },
};

// ============================================================================
// 术语提取（来自原 find_key_terms）
// ============================================================================

function extractKeyTerms(text: string, maxTerms: number): TermInfo[] {
  const stopWords = new Set([
    '的', '是', '在', '和', '与', '或', '有', '被', '将', '能', '会', '了', '着', '过',
    '这', '那', '个', '之', '以', '为', '于', '也', '都', '就', '而', '及', '等', '中',
    '上', '下', '不', '又', '很', '但', '如', '要', '可', '对', '到', '从', '把', '比',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'as', 'if', 'when', 'where', 'which', 'who', 'what', 'how', 'why', 'all', 'each',
  ]);

  const candidates: Map<string, { count: number; contexts: string[] }> = new Map();

  // 提取引号内的词
  const quotedTerms = text.match(/["「『]([^"「』」』]+)["」』]/g) || [];
  for (const match of quotedTerms) {
    const term = match.slice(1, -1).trim();
    if (term.length >= 2 && term.length <= 10 && !stopWords.has(term)) {
      const existing = candidates.get(term) || { count: 0, contexts: [] };
      existing.count += 2;
      existing.contexts.push(extractContext(text, term));
      candidates.set(term, existing);
    }
  }

  // 提取带定义的术语
  const definitionPatterns = [
    /([^\s，。！？]{2,8})(?:是指|即|指的是|定义为|称为)/g,
    /(?:所谓|定义的)([^\s，。！？]{2,8})(?:，|：|是)/g,
  ];

  for (const pattern of definitionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1].trim();
      if (!stopWords.has(term) && term.length >= 2) {
        const existing = candidates.get(term) || { count: 0, contexts: [] };
        existing.count += 3;
        existing.contexts.push(extractContext(text, term));
        candidates.set(term, existing);
      }
    }
  }

  // 提取高频专业词汇
  const technicalTerms = text.match(/[A-Z][A-Z0-9]{2,}/g) || [];
  const mixedCaseTerms = text.match(/[a-z]+[A-Z][a-zA-Z]*/g) || [];

  for (const term of [...technicalTerms, ...mixedCaseTerms]) {
    if (!stopWords.has(term.toLowerCase())) {
      const existing = candidates.get(term) || { count: 0, contexts: [] };
      existing.count += 1;
      existing.contexts.push(extractContext(text, term));
      candidates.set(term, existing);
    }
  }

  // 提取重复出现的多字词组
  const chinesePhrases = text.match(/[\u4e00-\u9fa5]{3,6}/g) || [];
  const phraseCount: Map<string, number> = new Map();
  for (const phrase of chinesePhrases) {
    if (!stopWords.has(phrase)) {
      phraseCount.set(phrase, (phraseCount.get(phrase) || 0) + 1);
    }
  }

  for (const [phrase, count] of phraseCount) {
    if (count >= 3) {
      const existing = candidates.get(phrase) || { count: 0, contexts: [] };
      existing.count += count;
      existing.contexts.push(extractContext(text, phrase));
      candidates.set(phrase, existing);
    }
  }

  const sortedTerms = Array.from(candidates.entries())
    .filter(([term]) => term.length >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxTerms);

  return sortedTerms.map(([term, info]) => ({
    term,
    frequency: info.count,
    contexts: info.contexts.slice(0, 2),
    likelyType: classifyTerm(term),
  }));
}

function extractContext(text: string, term: string): string {
  const index = text.indexOf(term);
  if (index === -1) return '';

  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + term.length + 30);

  let context = text.slice(start, end);
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';

  return context.replace(/\n/g, ' ').trim();
}

function classifyTerm(term: string): TermInfo['likelyType'] {
  if (/^[A-Z0-9]+$/.test(term) || /[A-Z]{2,}/.test(term)) {
    return '缩写';
  }
  if (/[a-z][A-Z]/.test(term)) {
    return '专业术语';
  }
  if (/[\u4e00-\u9fa5]/.test(term)) {
    return term.length <= 3 ? '关键概念' : '专业术语';
  }
  return '关键概念';
}

function formatTermsOutput(terms: TermInfo[], maxItems: number): string {
  const lines: string[] = [];

  lines.push(`## 关键术语 (${terms.length}/${maxItems})`);
  lines.push('');

  if (terms.length === 0) {
    lines.push('未能识别到明显的专业术语。');
    lines.push('');
    return lines.join('\n');
  }

  for (const term of terms.slice(0, 5)) {
    lines.push(`- **${term.term}** (${term.likelyType})`);
    if (term.contexts.length > 0) {
      lines.push(`  > "${term.contexts[0]}"`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ============================================================================
// 论点提取（来自原 extract_propositions）
// ============================================================================

function extractPropositions(
  text: string,
  focusType: string,
  maxPropositions: number
): PropositionInfo[] {
  const sentences = splitIntoSentences(text);
  const candidates: PropositionInfo[] = [];

  const claimIndicators = [
    '因此', '所以', '由此可见', '这表明', '这证明',
    '我认为', '作者认为', '本书认为', '可以说',
    '结论是', '结果是', '关键在于',
    'therefore', 'thus', 'hence', 'so', 'consequently',
  ];

  const argumentIndicators = [
    '因为', '由于', '鉴于', '基于', '根据',
    '首先', '其次', '再次', '最后', '第一', '第二',
    '例如', '比如', '譬如',
    'because', 'since', 'as', 'for', 'due to',
    'first', 'second', 'finally',
  ];

  const definitionIndicators = [
    '是指', '即', '指的是', '定义为', '称为',
    '所谓', '意思是', '可以理解为',
    'means', 'refers to', 'is defined as',
  ];

  for (const sentence of sentences) {
    if (sentence.length < 15 || sentence.length > 500) continue;

    const foundIndicators: string[] = [];
    let type: PropositionInfo['type'] = 'claim';
    let importance = 1;

    for (const indicator of claimIndicators) {
      if (sentence.includes(indicator)) {
        foundIndicators.push(indicator);
        type = 'claim';
        importance = Math.max(importance, 4);
      }
    }

    for (const indicator of argumentIndicators) {
      if (sentence.includes(indicator)) {
        foundIndicators.push(indicator);
        if (type !== 'claim') type = 'argument';
        importance = Math.max(importance, 3);
      }
    }

    for (const indicator of definitionIndicators) {
      if (sentence.includes(indicator)) {
        foundIndicators.push(indicator);
        if (type !== 'claim') type = 'definition';
        importance = Math.max(importance, 2);
      }
    }

    if (isImportantSentence(sentence)) {
      importance = Math.max(importance, 3);
    }

    if (foundIndicators.length > 0 || importance >= 3) {
      if (focusType !== 'all' && focusType !== type + 's') {
        continue;
      }

      candidates.push({
        type,
        sentence,
        importance,
        indicators: [...new Set(foundIndicators)],
      });
    }
  }

  const sorted = candidates
    .sort((a, b) => b.importance - a.importance || b.indicators.length - a.indicators.length)
    .slice(0, maxPropositions * 2);

  const unique: PropositionInfo[] = [];
  for (const prop of sorted) {
    if (unique.length >= maxPropositions) break;
    if (!unique.some((u) => similarity(u.sentence, prop.sentence) > 0.5)) {
      unique.push(prop);
    }
  }

  return unique;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？.!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isImportantSentence(sentence: string): boolean {
  const keyVerbs = [
    '证明', '表明', '说明', '揭示', '发现',
    '认为', '主张', '提出', '强调', '指出',
    'must', 'should', 'essential', 'important',
  ];

  for (const verb of keyVerbs) {
    if (sentence.toLowerCase().includes(verb)) {
      return true;
    }
  }

  return false;
}

function similarity(s1: string, s2: string): number {
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

function formatPropositionsOutput(propositions: PropositionInfo[]): string {
  const lines: string[] = [];

  const typeLabel: Record<string, string> = {
    claim: '核心论点',
    argument: '论证过程',
    definition: '定义说明',
  };

  lines.push(`## 核心主旨 (${propositions.length})`);
  lines.push('');

  if (propositions.length === 0) {
    lines.push('未能识别到明显的论点。');
    lines.push('');
    return lines.join('\n');
  }

  // 按类型分组
  const grouped: Record<string, PropositionInfo[]> = {
    claim: [],
    argument: [],
    definition: [],
  };

  for (const prop of propositions) {
    grouped[prop.type].push(prop);
  }

  for (const [type, typeProps] of Object.entries(grouped)) {
    if (typeProps.length === 0) continue;

    lines.push(`### ${typeLabel[type]}`);
    lines.push('');

    for (let i = 0; i < typeProps.length; i++) {
      const prop = typeProps[i];
      const indicator = prop.indicators.length > 0 ? ` [${prop.indicators[0]}]` : '';
      lines.push(`${i + 1}. ${indicator} ${prop.sentence.slice(0, 100)}${prop.sentence.length > 100 ? '...' : ''}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
