/**
 * Token 估算工具
 *
 * 粗略估算消息历史的 token 数。
 * 公式: 1 token ≈ 1.5 中文字符 或 4 英文字符（取平均 /2）
 */

import type { ChatMessage } from '../types';

export function estimateTokens(messages: ChatMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    }
    if (msg.tool_calls) {
      totalChars += JSON.stringify(msg.tool_calls).length;
    }
  }
  return Math.round(totalChars / 2);
}
