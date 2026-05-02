/**
 * History Summarizer Utilities
 *
 * Migrated from cognitive-engine/utils/history-summarizer.ts
 */

import type { ChatMessage } from '../../types';

export interface HistorySummary {
  topic: string;
  conclusion: string;
  blockIds: string[];
}

const BLOCK_ID_REGEX = /\[\[[^\]]*#\^([^|\]]+)/g;

export function extractBlockIds(content: string): string[] {
  const matches = [...content.matchAll(BLOCK_ID_REGEX)];
  return matches.map(m => m[1]).filter(id => id.length > 0);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headLen = Math.ceil(maxChars * 0.6);
  const tailLen = maxChars - headLen - 5;
  return text.slice(0, headLen) + ' ... ' + text.slice(-tailLen);
}

function inferTopic(userMessage: string): string {
  const cleanQuery = userMessage
    .replace(/^(什么是|如何理解|请问|帮我|解释一下|讲讲|详细说说)/i, '')
    .replace(/[？?。.!！，,]/g, '')
    .trim();

  return truncate(cleanQuery, 150);
}

export function summarizeRound(
  userMessage: ChatMessage,
  assistantMessage: ChatMessage
): HistorySummary {
  const userContent = typeof userMessage.content === 'string'
    ? userMessage.content
    : '';
  const assistantContent = typeof assistantMessage.content === 'string'
    ? assistantMessage.content
    : '';

  return {
    topic: inferTopic(userContent),
    conclusion: truncate(assistantContent.replace(/\n/g, ' '), 800),
    blockIds: extractBlockIds(assistantContent),
  };
}

export function summarizeRecentHistory(
  history: ChatMessage[],
  maxRounds: number = 3
): HistorySummary[] {
  const rounds: Array<[ChatMessage, ChatMessage]> = [];

  for (let i = history.length - 1; i >= 1; i--) {
    if (history[i].role === 'assistant' && history[i - 1]?.role === 'user') {
      rounds.push([history[i - 1], history[i]]);
      if (rounds.length >= maxRounds) break;
      i--;
    }
  }

  rounds.reverse();

  return rounds.map(([user, assistant]) => summarizeRound(user, assistant));
}

export function extractPrevBlockIds(history: ChatMessage[]): string[] {
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant || typeof lastAssistant.content !== 'string') {
    return [];
  }

  return extractBlockIds(lastAssistant.content);
}

export function formatHistoryBlock(summaries: HistorySummary[]): string {
  if (summaries.length === 0) return '';

  const lines = summaries.map((s, i) =>
    `[第${i + 1}轮] 用户问"${s.topic}"，分析发现${truncate(s.conclusion, 600)}`
  );

  return `<history>
${lines.join('\n')}
</history>`;
}

export function formatPrevSearchedBlock(blockIds: string[], maxIds: number = 10): string {
  if (blockIds.length === 0) return '';

  const displayIds = blockIds.slice(0, maxIds);
  return `<prev_searched>
已搜索的段落（避免重复）：${displayIds.join(', ')}
</prev_searched>`;
}
