/**
 * 思考模型工具模块
 *
 * 提供思考模型检测、禁用参数生成和 think 标签清理的共享工具。
 * 被 Agent Loop、LangGraph、PageIndex 三条 API 调用路径共同使用。
 */

/** 已知的思考模型关键词（小写匹配） */
const THINKING_MODEL_PATTERNS = [
	'mimo',
	'deepseek-reasoner',
	'deepseek-r1',
	'qwq',
	'qwen-qwq',
	'qwen3',
	'o1-',
	'o3-',
	'o4-mini',
	'reasoner',
	'-thinking',
];

/** OpenAI 推理模型前缀 */
const OPENAI_REASONING_PREFIXES = ['o1-', 'o3-', 'o4-mini'];

/**
 * 检测模型是否为思考模型
 *
 * 通过模型名称的模式匹配来识别已知的思考模型。
 * 未来新增的思考模型只需在此处添加模式即可。
 */
export function isThinkingModel(model: string): boolean {
	const lower = model.toLowerCase();
	return THINKING_MODEL_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * 获取禁用思考过程的 API 请求参数
 *
 * @param model 模型名称
 * @returns 需要注入到请求体的参数对象，非思考模型返回 null
 */
export function getDisableThinkingParams(model: string): Record<string, unknown> | null {
	if (!isThinkingModel(model)) return null;

	const lower = model.toLowerCase();

	// OpenAI o1/o3/o4 使用 reasoning_effort 参数
	if (OPENAI_REASONING_PREFIXES.some(p => lower.includes(p))) {
		return { reasoning_effort: 'none' };
	}

	// 其他思考模型（Mimo、DeepSeek R1、QwQ 等）使用通用参数
	return { thinking: { type: 'disabled' } };
}

/**
 * 移除响应中的 <think ...>...</think 标签
 *
 * 部分思考模型即使发送了禁用参数，仍可能在 content 中输出 think 标签。
 * 此函数用于最终输出的清理。
 */
export function stripThinkTags(text: string): string {
	return text.replace(/<think[\s\S]*?<\/think>/g, '').trim();
}
