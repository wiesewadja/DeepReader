/**
 * 微信读书 API 客户端
 * 封装 safeRequest，硬编码所有 URL
 */

import { safeRequest } from '../../utils/safe-request';
import type {
	WereadCookie,
	WereadNotebookResponse,
	WereadShelfResponse,
	WereadHighlightResponse,
	WereadReviewResponse,
	WereadChapterResponse,
	WereadProgressResponse,
} from '../types';

export class WereadApiClient {
	private cookie: WereadCookie;

	constructor(cookie: WereadCookie) {
		this.cookie = cookie;
	}

	private get headers(): Record<string, string> {
		return {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
			'Accept': 'application/json, text/plain, */*',
			'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			'Content-Type': 'application/json',
			'Cookie': `wr_vid=${this.cookie.wr_vid}; wr_skey=${this.cookie.wr_skey}`,
			'x-vid': this.cookie.wr_vid,
			'x-skey': this.cookie.wr_skey,
		};
	}

	private async get<T>(url: string): Promise<T> {
		const resp = await safeRequest({ url, headers: this.headers });
		return resp.json as T;
	}

	private async post<T>(url: string, body: unknown): Promise<T> {
		const resp = await safeRequest({
			url,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});
		return resp.json as T;
	}

	/** 获取有笔记的书籍列表 */
	async getNotebook(): Promise<WereadNotebookResponse> {
		return this.get<WereadNotebookResponse>('https://weread.qq.com/api/user/notebook');
	}

	/** 获取完整书架 */
	async getShelf(): Promise<WereadShelfResponse> {
		return this.get<WereadShelfResponse>(
			'https://i.weread.qq.com/shelf/sync?synckey=0&teenmode=0&album=1'
		);
	}

	/** 获取书籍详情 */
	async getBookInfo(bookId: string): Promise<Record<string, unknown>> {
		return this.get(`https://i.weread.qq.com/book/info?bookId=${bookId}`);
	}

	/** 获取高亮列表 */
	async getHighlights(bookId: string): Promise<WereadHighlightResponse> {
		return this.get<WereadHighlightResponse>(
			`https://weread.qq.com/web/book/bookmarklist?bookId=${bookId}`
		);
	}

	/** 获取评论列表 */
	async getReviews(bookId: string): Promise<WereadReviewResponse> {
		return this.get<WereadReviewResponse>(
			`https://weread.qq.com/web/review/list?bookId=${bookId}&listType=11&mine=1&synckey=0`
		);
	}

	/** 获取章节结构 */
	async getChapters(bookId: string): Promise<WereadChapterResponse> {
		return this.post<WereadChapterResponse>(
			'https://weread.qq.com/web/book/chapterInfos',
			{ bookIds: [bookId] }
		);
	}

	/** 获取阅读进度 */
	async getProgress(bookId: string): Promise<WereadProgressResponse> {
		return this.get<WereadProgressResponse>(
			`https://weread.qq.com/web/book/getProgress?bookId=${bookId}`
		);
	}

	/** 验证 Cookie 有效性 */
	async validateCookie(): Promise<boolean> {
		try {
			const resp = await this.getNotebook();
			return Array.isArray(resp.books) && resp.books.length >= 0;
		} catch {
			return false;
		}
	}

	/** 刷新 Cookie（HEAD 请求） */
	async refreshCookie(): Promise<Record<string, string>> {
		const resp = await safeRequest({
			url: 'https://weread.qq.com/',
			method: 'HEAD',
			headers: this.headers,
		});
		return resp.headers;
	}
}
