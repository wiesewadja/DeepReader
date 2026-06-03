/**
 * WeRead (微信读书) LangChain tool wrappers
 *
 * 5 tools for the reading advisor mode:
 * - weread_search: 搜索书籍
 * - weread_recommend: 个性化推荐
 * - weread_readdata: 阅读统计
 * - weread_notebooks: 笔记概览
 * - weread_book_info: 书籍详情
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { WereadApiClient } from '../../../weread/api/client.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

function getClient(ctx: ToolContext): WereadApiClient | null {
	if (ctx.weread?.wereadClient) return ctx.weread.wereadClient;
	const apiKey = ctx.vault?.plugin?.settings?.wereadApiKey;
	if (!apiKey) return null;
	const client = new WereadApiClient(apiKey);
	if (!ctx.weread) ctx.weread = {};
	ctx.weread.wereadClient = client;
	return client;
}

/** 搜索书籍 */
export const createWereadSearchTool: ToolFactory = (ctx: ToolContext) =>
	tool(
		async (args) => {
			const client = getClient(ctx);
			if (!client) return '微信读书 API Key 未配置，请在设置中配置后再试。';
			try {
				const resp = await client.searchBooks(args.keyword, args.scope, args.count);
				if (!resp.results?.length) return `未找到与"${args.keyword}"相关的书籍。`;
				const lines: string[] = [];
				for (const group of resp.results) {
					if (!group.books?.length) continue;
					for (const item of group.books) {
						const b = item.bookInfo;
						if (!b) continue;
						const rating = b.newRating ? ` 评分:${(b.newRating / 10).toFixed(1)}` : '';
						lines.push(`《${b.title}》 ${b.author}${rating} [bookId:${b.bookId}]`);
						if (b.intro && (args.count ?? 10) <= 5) {
							lines.push(`  简介: ${b.intro.slice(0, 100)}`);
						}
					}
				}
				return lines.join('\n') || '未找到相关书籍。';
			} catch (e: unknown) {
				return `搜索失败: ${(e instanceof Error ? e.message : String(e))}`;
			}
		},
		{
			name: 'weread_search',
			description: '搜索微信读书书籍库，查找特定书名、作者或关键词的书籍',
			schema: z.object({
				keyword: z.string().describe('搜索关键词（书名、作者等）'),
				scope: z.number().optional().describe('搜索类型: 10=电子书(默认), 0=全部, 6=作者'),
				count: z.number().optional().describe('返回数量，默认10'),
			}),
		},
	);

/** 个性化推荐 */
export const createWereadRecommendTool: ToolFactory = (ctx: ToolContext) =>
	tool(
		async (args) => {
			const client = getClient(ctx);
			if (!client) return '微信读书 API Key 未配置，请在设置中配置后再试。';
			try {
				const resp = await client.recommendBooks(args.count);
				if (!resp.books?.length) return '暂无个性化推荐。';
				const lines: string[] = [];
				for (const b of resp.books) {
					const rating = b.newRating ? ` 评分:${(b.newRating / 10).toFixed(1)}` : '';
					const reason = b.reason ? `\n  推荐理由: ${b.reason}` : '';
					lines.push(`《${b.title}》 ${b.author}${rating}${reason} [bookId:${b.bookId}]`);
				}
				return lines.join('\n');
			} catch (e: unknown) {
				return `获取推荐失败: ${(e instanceof Error ? e.message : String(e))}`;
			}
		},
		{
			name: 'weread_recommend',
			description: '获取微信读书个性化推荐书籍，基于用户阅读记录推荐',
			schema: z.object({
				count: z.number().optional().describe('推荐数量，默认6'),
			}),
		},
	);

/** 阅读统计 */
export const createWereadReadDataTool: ToolFactory = (ctx: ToolContext) =>
	tool(
		async (args) => {
			const client = getClient(ctx);
			if (!client) return '微信读书 API Key 未配置，请在设置中配置后再试。';
			try {
				const resp = await client.getReadingData(args.mode);
				const lines: string[] = [];
				const hours = Math.floor((resp.totalReadTime || 0) / 3600);
				const mins = Math.floor(((resp.totalReadTime || 0) % 3600) / 60);
				lines.push(`总阅读时长: ${hours}小时${mins}分钟`);
				lines.push(`阅读天数: ${resp.readDays || 0}天`);
				if (resp.readStat?.length) {
					lines.push('统计概览:');
					for (const s of resp.readStat) {
						lines.push(`  ${s.stat}: ${s.counts}`);
					}
				}
				if (resp.readLongest?.length) {
					lines.push('读得最多的书:');
					for (const item of resp.readLongest.slice(0, 5)) {
						if (item.book) {
							const h = Math.floor(item.readTime / 3600);
							const m = Math.floor((item.readTime % 3600) / 60);
							lines.push(`  《${item.book.title}》 ${item.book.author} — ${h}小时${m}分钟`);
						}
					}
				}
				if (resp.preferCategoryWord) {
					lines.push(`偏好分类: ${resp.preferCategoryWord}`);
				}
				return lines.join('\n') || '暂无阅读统计数据。';
			} catch (e: unknown) {
				return `获取阅读统计失败: ${(e instanceof Error ? e.message : String(e))}`;
			}
		},
		{
			name: 'weread_readdata',
			description: '获取微信读书阅读统计数据（时长、天数、偏好分类等）',
			schema: z.object({
				mode: z.enum(['weekly', 'monthly', 'annually', 'overall']).optional().describe('统计维度: weekly=本周, monthly=本月(默认), annually=本年, overall=总计'),
			}),
		},
	);

/** 笔记概览 */
export const createWereadNotebooksTool: ToolFactory = (ctx: ToolContext) =>
	tool(
		async (args) => {
			const client = getClient(ctx);
			if (!client) return '微信读书 API Key 未配置，请在设置中配置后再试。';
			try {
				const resp = await client.getNotebook();
				if (!resp.books?.length) return '暂无笔记数据。';
				const lines: string[] = [`共 ${resp.totalBookCount || resp.books.length} 本有笔记的书，${resp.totalNoteCount || 0} 条笔记`];
				for (const item of resp.books.slice(0, args.count ?? 20)) {
					const b = item.book;
					const status = item.markedStatus === 1 ? '已读完' : '在读';
					const noteCount = (item.noteCount || 0) + (item.reviewCount || 0) + (item.bookmarkCount || 0);
					lines.push(`《${b.title}》 ${b.author} — ${status} 笔记${noteCount}条 [bookId:${b.bookId}]`);
				}
				return lines.join('\n');
			} catch (e: unknown) {
				return `获取笔记数据失败: ${(e instanceof Error ? e.message : String(e))}`;
			}
		},
		{
			name: 'weread_notebooks',
			description: '获取微信读书中所有有笔记的书籍列表（含笔记数量、阅读进度）',
			schema: z.object({
				count: z.number().optional().describe('返回数量，默认20'),
			}),
		},
	);

/** 书籍详情 */
export const createWereadBookInfoTool: ToolFactory = (ctx: ToolContext) =>
	tool(
		async (args) => {
			const client = getClient(ctx);
			if (!client) return '微信读书 API Key 未配置，请在设置中配置后再试。';
			try {
				const resp = await client.getBookInfo(args.bookId);
				const lines: string[] = [];
				lines.push(`《${resp.title}》 ${resp.author}`);
				if (resp.translator) lines.push(`译者: ${resp.translator}`);
				if (resp.publisher) lines.push(`出版社: ${resp.publisher}`);
				if (resp.publishTime) lines.push(`出版时间: ${resp.publishTime}`);
				if (resp.isbn) lines.push(`ISBN: ${resp.isbn}`);
				if (resp.wordCount) lines.push(`字数: ${resp.wordCount}`);
				if (resp.newRating) lines.push(`评分: ${(resp.newRating / 10).toFixed(1)}`);
				if (resp.category) lines.push(`分类: ${resp.category}`);
				if (resp.intro) lines.push(`简介: ${resp.intro}`);
				return lines.join('\n');
			} catch (e: unknown) {
				return `获取书籍详情失败: ${(e instanceof Error ? e.message : String(e))}`;
			}
		},
		{
			name: 'weread_book_info',
			description: '获取微信读书中某本书的详细信息（简介、评分、出版信息等）',
			schema: z.object({
				bookId: z.string().describe('书籍 ID（可从搜索或推荐结果中获取）'),
			}),
		},
	);
