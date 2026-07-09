/**
 * 各认知节点允许暴露给 LLM 工具循环的工具白名单——单一事实来源。
 *
 * 设计：工具门禁集中在此处，替代 advisor.ts / analytical.ts 内散落的硬编码数组。
 * 节点用 `allTools.filter(t => NODE_TOOL_WHITELIST.<node>.includes(t.name))` 取作用域内工具，
 * 过滤结果经 config 传入 runPlanExecute，由 plan-execute.ts 的 model.bindTools 绑定。
 *
 * direct-call-only：excalidraw 不走 LLM 工具循环，由 graph/utils/diagram-helper.ts
 * 在 S1/S3 直接 .execute() 调用（见 diagram-helper.ts:16 直接 import v1 实现 excalidrawTool）。
 * 因此 analytical 节点白名单不含 excalidraw——即便 createLangChainTools 注册了它，
 * model 也不会经 tool_calls 触发。如需让某节点经 LLM 调 excalidraw，把对应数组加上即可。
 *
 * 旁路（非工具）：跨书检索走 syntopicalSearch()，记忆/画像/笔记分别走 memory service /
 * profileBuilder / note writer（见 P0-1 摘注册说明），故 inspectional/presearch/syntopical 为空。
 */

export type CognitiveNode =
	| 'inspectional'
	| 'presearch'
	| 'analytical'
	| 'syntopical'
	| 'advisor';

export const NODE_TOOL_WHITELIST: Record<CognitiveNode, readonly string[]> = {
	// S-Advisor：阅读顾问，WeRead 真实数据 + 用户日志检索
	advisor: [
		'weread_search',
		'weread_recommend',
		'weread_readdata',
		'weread_notebooks',
		'weread_book_info',
		'search_journal',
	],
	// S2 Analytical：分析阅读，书本内容检索
	analytical: ['search_book', 'read_book_section'],
	// S1 Inspectional：检视阅读，经 diagram-helper 直调 excalidraw，无 LLM 工具
	inspectional: [],
	// S2-Pre：预检索，无 LLM 工具
	presearch: [],
	// S3 Syntopical：跨书检索走 syntopicalSearch() 旁路
	syntopical: [],
};
