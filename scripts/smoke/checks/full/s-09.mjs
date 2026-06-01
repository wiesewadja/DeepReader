/**
 * S-09: 分析阅读 ReAct 元素
 *
 * 锚定: F-09 分析阅读（depth=2）
 * SKIP: 需触发 LLM 调用才能产生 ReAct 工具调用元素，超出冒烟范围
 */

export default {
	id: 'S-09',
	name: '分析阅读 ReAct 元素',
	level: 'full',
	feature: 'F-09',
	timeout: 1_000,

	async run() {
		return {
			status: 'skip',
			reason: 'ReAct 工具调用元素需触发 LLM 对话，超出冒烟可达性范围',
		};
	},
};
