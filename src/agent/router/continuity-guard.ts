/**
 * Continuity Guard — 短回复延续性检测
 *
 * 短回复（"ok"、"继续"、"嗯"）发生在深度讨论中途时，
 * 应该继承上一轮的深度，而不是被分类为闲聊。
 */

import { ReadingDepth } from '../graph/state.js';

/** 短回复字符数阈值，<= 视为短回复 */
export const CONTINUITY_THRESHOLD = 5;
/** chatHistory 最少轮数，< 此值不触发 */
export const MIN_HISTORY_LENGTH = 2;
/** 上一轮 assistant 内容至少 N 字符才算"深度讨论" */
export const DEEP_REPLY_MIN_LENGTH = 200;

interface ChatMessageLike {
	role: string;
	content: string;
}

/**
 * 检测短回复是否发生在深度讨论中途。
 *
 * @returns 升级后的 depth（如触发）+ 是否升级的标志
 */
export function inheritDepthOnContinuity(
	depth: ReadingDepth,
	rawQuery: string,
	chatHistory: ChatMessageLike[],
): { depth: ReadingDepth; didUpgrade: boolean } {
	if (depth !== ReadingDepth.CASUAL) return { depth, didUpgrade: false };
	if (rawQuery.trim().length > CONTINUITY_THRESHOLD) return { depth, didUpgrade: false };
	if (chatHistory.length < MIN_HISTORY_LENGTH) return { depth, didUpgrade: false };

	const lastAi = [...chatHistory].reverse().find(m => m.role === 'assistant');
	if (!lastAi || lastAi.content.length <= DEEP_REPLY_MIN_LENGTH) {
		return { depth, didUpgrade: false };
	}

	return { depth: ReadingDepth.ANALYTICAL, didUpgrade: true };
}
