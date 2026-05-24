/**
 * S-Advisor: Reading Advisor Node — ReAct loop with WeRead tools
 *
 * Runs when no book is selected and WeRead API is configured.
 * Uses weread_* tools to fetch real data for book recommendations,
 * reading stats, notebooks, etc.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { runPlanExecute } from '../subgraphs/react-loop.js';
import type { AdvisorInput } from '../node-io.js';
import { createLangChainTools } from '../../tools/index.js';
import { agentLog as log } from '../../../utils/logger.js';

const ADVISOR_SYSTEM_PROMPT = `你是奚童，用户的专属 AI 伴读。当前处于阅读顾问模式——用户没有选中具体书籍，但你拥有微信读书 API 工具来获取真实数据。

核心原则：
1. 优先使用工具获取真实数据，不要凭空编造书籍信息
2. 推荐书籍时先调用 weread_recommend 获取个性化推荐
3. 讨论阅读统计时调用 weread_readdata 获取真实数据
4. 整理笔记时调用 weread_notebooks 获取笔记列表
5. 需要查找特定书籍时调用 weread_search
6. 不要生成 Obsidian wiki 链接（[[...]]），因为用户没有打开书籍
7. 自然亲切，像朋友之间聊天，不要说"亲爱的用户"
8. 书名用《》包裹`;

export async function advisorNode(
	state: CognitiveEngineState,
	config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
	const {
		rewrittenQuery: stateQuery,
		pdfName: statePdfName,
	}: AdvisorInput = state;

	const ctx = config.configurable?.sharedContext;
	const mainModel = config.configurable?.mainModel;
	const toolContext = config.configurable?.toolContext;
	const callbacks = config.configurable?.callbacks as {
		onContent?: (content: string) => void;
		onProgress?: (msg: string) => void;
	} | undefined;

	if (!mainModel || !toolContext) {
		return { analysisResult: '', toolResultsSnapshot: [] };
	}

	callbacks?.onProgress?.('正在查找阅读数据...');

	const rawShelf = ctx?.bookshelfSummary || '';
	const bookshelfSection = rawShelf
		? `\n\n<bookshelf>\n${rawShelf.slice(0, 2000)}\n</bookshelf>`
		: '';

	const query = stateQuery || ctx?.rawUserQuery || '';
	const userMessage = `<query>${query}</query>${bookshelfSection}`;

	// Create tools: WeRead tools + search_read_books
	const allTools = createLangChainTools(toolContext);
	const advisorToolNames = [
		'weread_search', 'weread_recommend', 'weread_readdata',
		'weread_notebooks', 'weread_book_info', 'search_read_books',
	];
	const advisorTools = allTools.filter(t => advisorToolNames.includes(t.name));

	const loopMessages = [
		new SystemMessage(ADVISOR_SYSTEM_PROMPT),
		new HumanMessage(userMessage),
	];

	const loopConfig = {
		tools: advisorTools,
		model: mainModel,
		maxIterations: 4,
		maxToolCalls: 3,
		onProgress: callbacks?.onProgress,
	};

	log(`[S-Advisor] 开始 PlanExecute, tools=${advisorTools.map(t => t.name)}, query="${query.slice(0, 50)}"`);
	const result = await runPlanExecute(loopMessages, loopConfig, config);

	return {
		analysisResult: result.content,
		toolResultsSnapshot: result.toolResults.map(r => ({
			toolName: r.toolName,
			args: r.args,
			result: r.result,
			originalResultLength: r.originalResultLength,
			extractedBlockIds: r.extractedBlockIds,
		})),
	};
}
