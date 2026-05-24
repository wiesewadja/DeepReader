/**
 * 微信读书 API 客户端 — 网关代理模式
 * 统一 POST https://i.weread.qq.com/api/agent/gateway
 */

import { safeRequest } from '../../utils/safe-request';
import { apiLog as log } from '../../utils/logger.js';
import type {
	WereadNotebookResponse,
	WereadShelfResponse,
	WereadHighlightResponse,
	WereadReviewResponse,
	WereadChapterResponse,
	WereadProgressResponse,
	WereadSearchResponse,
	WereadRecommendResponse,
	WereadBookInfoResponse,
	WereadReadDataResponse,
} from '../types';

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.3';

/** 网关响应外层 */
interface GatewayResponse {
	errcode: number;
	errmsg?: string;
	[key: string]: unknown;
}

export class WereadApiClient {
	private apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	private async gatewayCall<T>(apiName: string, params?: Record<string, unknown>): Promise<T> {
		const body: Record<string, unknown> = {
			api_name: apiName,
			skill_version: SKILL_VERSION,
			...params,
		};

		const reqBody = JSON.stringify(body);
		log('[WereadApiClient]', apiName);

		const resp = await safeRequest({
			url: GATEWAY_URL,
			method: 'POST',
			contentType: 'application/json',
			headers: {
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: reqBody,
		});

		log('[WereadApiClient]', apiName, 'status:', resp.status);

		const data = resp.json as GatewayResponse;
		if (data.errcode != null && data.errcode !== 0) {
			throw new Error(data.errmsg || `Gateway error: errcode=${data.errcode}`);
		}

		return data as unknown as T;
	}

	async getNotebook(): Promise<WereadNotebookResponse> {
		const allBooks = [] as WereadNotebookResponse['books'];
		let lastSort: number | undefined;
		let pages = 0;
		const MAX_PAGES = 50;

		do {
			const params: Record<string, unknown> = {};
			if (lastSort !== undefined) {
				params.lastSort = lastSort;
			}

			const resp = await this.gatewayCall<WereadNotebookResponse>('/user/notebooks', params);

			if (Array.isArray(resp.books)) {
				allBooks.push(...resp.books);
			}

			if (resp.hasMore !== 1 || !resp.books?.length) break;

			const sorts = resp.books.map(b => b.sort).filter((s): s is number => s !== undefined);
			if (sorts.length === 0) break;
			const newSort = Math.min(...sorts);
			if (newSort === lastSort) break; // 游标未变，防止无限循环
			lastSort = newSort;
		} while (++pages < MAX_PAGES);

		return { books: allBooks, hasMore: 0 };
	}

	async getShelf(): Promise<WereadShelfResponse> {
		return this.gatewayCall<WereadShelfResponse>('/shelf/sync');
	}

	async getHighlights(bookId: string): Promise<WereadHighlightResponse> {
		return this.gatewayCall<WereadHighlightResponse>('/book/bookmarklist', { bookId });
	}

	async getReviews(bookId: string): Promise<WereadReviewResponse> {
		return this.gatewayCall<WereadReviewResponse>('/review/list/mine', { bookid: bookId });
	}

	async getChapters(bookId: string): Promise<WereadChapterResponse> {
		return this.gatewayCall<WereadChapterResponse>('/book/chapterinfo', { bookId });
	}

	async getProgress(bookId: string): Promise<WereadProgressResponse> {
		return this.gatewayCall<WereadProgressResponse>('/book/getprogress', { bookId });
	}


	async searchBooks(keyword: string, scope: number = 10, count: number = 10): Promise<WereadSearchResponse> {
		return this.gatewayCall<WereadSearchResponse>('/store/search', { keyword, scope, count });
	}

	async recommendBooks(count: number = 6): Promise<WereadRecommendResponse> {
		return this.gatewayCall<WereadRecommendResponse>('/book/recommend', { count });
	}

	async getReadingData(mode: string = 'monthly'): Promise<WereadReadDataResponse> {
		return this.gatewayCall<WereadReadDataResponse>('/readdata/detail', { mode });
	}

	async getBookInfo(bookId: string): Promise<WereadBookInfoResponse> {
		return this.gatewayCall<WereadBookInfoResponse>('/book/info', { bookId });
	}

	async validateApiKey(): Promise<boolean> {
		try {
			await this.gatewayCall<WereadNotebookResponse>('/user/notebooks');
			return true;
		} catch (err) {
			log('[WereadApiClient] validateApiKey failed:', err);
			return false;
		}
	}
}
