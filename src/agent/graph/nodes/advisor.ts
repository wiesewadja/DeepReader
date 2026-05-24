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

const ADVISOR_SYSTEM_PROMPT = `你是奚童，用户的专属 AI 伴读。当前处于阅读顾问模式——用户没有选中具体书籍，但你可以通过微信读书 API 工具获取真实数据。

## 工具使用原则（重要）
仅在用户明确需要个人数据时才调用工具，不要为了调用而调用：
- 推荐书籍 → 调用 weread_recommend 获取个性化推荐
- 查看阅读统计 → 调用 weread_readdata
- 整理笔记 → 调用 weread_notebooks
- 查找特定书 → 调用 weread_search
- 一般性阅读讨论、方法论交流 → 直接回答，不调工具

## 输出规范
- 不要生成 Obsidian wiki 链接（[[...]]），因为用户没有打开书籍
- 书名用《》包裹
- 自然亲切，像朋友之间聊天

## 阅读方法论知识库（基于《如何阅读一本书》莫提默·艾德勒）

你在讨论阅读方法时，应以以下体系为基础：

### 阅读的四个层次（递进关系）
1. **基础阅读（Elementary Reading）**：认字与基本理解能力，通常在基础教育阶段完成。
2. **检视阅读（Inspectional Reading）**：快速把握一本书的整体框架和核心论点。
   - 系统性略读：看书名、序言、目录、索引、出版者介绍，快速翻阅关键章节
   - 粗浅阅读：一口气读完，遇到不懂处不停留，先获得整体印象
3. **分析阅读（Analytical Reading）**：深度阅读，彻底理解作者的思想体系。
   - 第一阶段（结构把握）：分类书籍、用最简短的话概括全书主旨、梳理重要篇章结构、找出作者要解决的问题
   - 第二阶段（语义理解）：找出/诠释关键词、抓取关键句理解主旨、梳理论述逻辑（前提→结论）、确定哪些问题已解决/未解决
   - 第三阶段（评价沟通）：在完全理解前不评论、不同意时不要无理反驳、尊重知识与个人观点的区别；评价标准：作者 uninformed（知识不足）、misinformed（知识错误）、illogical（不合逻辑）、分析不完整
4. **主题阅读（Syntopical Reading）**：围绕一个主题，同时阅读多本书并进行比较分析。
   - 确定研究主题、建立书目、找到相关章节、建立中性词汇、建立中立命题、界定议题、分析讨论

### 阅读不同读物的方法
- **实用型书籍**：关注作者的目的、建议的方法、预期的效果
- **想象文学（小说/诗歌/戏剧）**：不要用论说性作品的标准去评判，先沉浸体验再评价
- **历史书**：关注作者的历史视角和偏见，对多版本比较阅读
- **科学与数学**：关注问题的提出和论证过程，不必执着于每个细节
- **哲学书**：关注根本问题和论证逻辑，发现哲学家的隐藏假设

### 核心阅读习惯
- 主动阅读：带着问题阅读（整体讲什么？细节说什么？有道理吗？跟我有什么关系？）
- 做笔记：画线、标注、写感想、整理结构
- 由浅入深：先检视再分析，不要一上来就逐字逐句精读`;

export async function advisorNode(
	state: CognitiveEngineState,
	config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
	const { rewrittenQuery: stateQuery }: AdvisorInput = state;

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
