/**
 * search_journal LangChain tool — 搜索用户个人笔记
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';
import { JournalSearchService, getJournalIndexDir } from '../../../services/journal-search.js';

const searchJournalSchema = z.object({
	query: z.string().describe('搜索关键词，用于在用户个人笔记中查找相关内容'),
	topK: z.number().optional().describe('返回结果数量，默认 3'),
});

export const createSearchJournalTool: ToolFactory = (ctx: ToolContext) => {
	const journalDir = (ctx as any).journalDir as string | undefined;
	const settings = ctx.plugin?.settings;
	const searchService = (journalDir && settings)
		? new JournalSearchService(ctx.app!, settings, getJournalIndexDir(journalDir))
		: null;

	return tool(
		async (args) => {
			const { query, topK = 3 } = args;
			if (!searchService) {
				return JSON.stringify({ status: 'SKIP', message: '未配置笔记目录' });
			}

			try {
				const results = await searchService.search(query, topK);
				if (results.length === 0) {
					return JSON.stringify({ status: 'SUCCESS', message: '未找到相关笔记', results: [] });
				}
				return JSON.stringify({ status: 'SUCCESS', results });
			} catch (e: any) {
				return JSON.stringify({ status: 'ERROR', message: e.message });
			}
		},
		{
			name: 'search_journal',
			description: `搜索用户的个人笔记和随手记，查找与当前话题相关的个人经历、感悟或记录。
使用场景：当你想了解用户是否有与当前书籍话题相关的个人经历时，可以用这个工具搜索。
例如：用户在读关于"焦虑"的章节，你可以搜索用户笔记中关于焦虑的记录。`,
			schema: searchJournalSchema,
		},
	);
};
