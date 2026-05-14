/**
 * 用户画像维度事实 — 数据结构 + 解析 + 合并
 */

/** 内置维度定义 */
export const DEFAULT_DIMENSIONS: ProfileFactDimension[] = [
	{ key: 'identity', label: '身份与阶段' },
	{ key: 'family', label: '家庭与关系' },
	{ key: 'work', label: '工作与事业' },
	{ key: 'interests', label: '兴趣与投入' },
	{ key: 'personality', label: '性格与思维' },
	{ key: 'emotions', label: '情绪与状态' },
	{ key: 'values', label: '价值观与信念' },
];

export interface ProfileFactDimension {
	key: string;
	label: string;
}

export interface ProfileFacts {
	version: 1;
	sourceDir: string;
	lastExtractTime: string;
	dimensions: Record<string, string[]>;
}

/** 构建完整维度列表（默认 + 自定义） */
export function buildDimensionList(
	custom: { key: string; label: string }[],
): ProfileFactDimension[] {
	return [...DEFAULT_DIMENSIONS, ...custom];
}

/**
 * 从 Stage 1 LLM 输出文本中解析维度事实
 *
 * 输入格式：
 *   [身份与阶段] 技术负责人；开始考虑创业
 *   [家庭与关系] 女儿3岁
 */
export function parseFactsText(
	text: string,
	dimensions: ProfileFactDimension[],
): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const d of dimensions) {
		result[d.key] = [];
	}

	const lines = text.split('\n');
	for (const line of lines) {
		const match = line.match(/^\[(.+?)\]\s*(.*)/);
		if (!match) continue;

		const [, label, content] = match;
		const trimmed = content.trim();
		if (!trimmed) continue;

		const dim = dimensions.find(d => d.label === label);
		if (!dim) continue;

		// 按 ；或 ; 分割多个事实
		const parts = trimmed.split(/[；;]/).map(s => s.trim()).filter(Boolean);
		result[dim.key].push(...parts);
	}

	return result;
}

/** 合并新旧事实（追加 + 去重） */
export function mergeFacts(
	existing: Record<string, string[]>,
	incoming: Record<string, string[]>,
): Record<string, string[]> {
	const result: Record<string, string[]> = {};

	const allKeys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
	for (const key of allKeys) {
		const existingFacts = existing[key] || [];
		const incomingFacts = incoming[key] || [];
		const seen = new Set(existingFacts);
		const merged = [...existingFacts];
		for (const f of incomingFacts) {
			if (!seen.has(f)) {
				merged.push(f);
				seen.add(f);
			}
		}
		result[key] = merged;
	}

	return result;
}

/** 构建空的 ProfileFacts */
export function createEmptyFacts(sourceDir: string): ProfileFacts {
	const dimensions: Record<string, string[]> = {};
	for (const d of DEFAULT_DIMENSIONS) {
		dimensions[d.key] = [];
	}
	return {
		version: 1,
		sourceDir,
		lastExtractTime: new Date().toISOString(),
		dimensions,
	};
}
