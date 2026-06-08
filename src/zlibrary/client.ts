/**
 * Z-Library EAPI 客户端
 * 使用 Obsidian requestUrl (通过 safeRequest) 发起 HTTP 请求
 */
import { safeRequest } from '../utils/safe-request';
import { DEFAULT_DOMAINS, EAPI_HEADERS } from './constants';
import { CookieJar } from './cookie-jar';
import { ZLibraryError } from './errors';
import type {
	ZLibraryBook,
	SearchOptions,
	SearchResult,
	DownloadInfo,
	UserProfile,
} from './types';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

const ALLOWED_EXTENSIONS = new Set(['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'fb2', 'txt']);


export class ZLibraryClient {
	private domain: string;
	private cookieJar: CookieJar;

	constructor(options?: { domain?: string }) {
		this.domain = options?.domain ?? DEFAULT_DOMAINS[0];
		this.cookieJar = new CookieJar();
	}

	private async request(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<any> {
		const url = `https://${this.domain}${path}`;
		const headers: Record<string, string> = { ...EAPI_HEADERS };

		if (this.cookieJar.isLoggedIn()) {
			headers['Cookie'] = this.cookieJar.toHeader();
		}

		let reqBody: string | undefined;
		if (body && method === 'POST') {
			reqBody = Object.entries(body)
				.map(([k, v]) => {
					if (Array.isArray(v)) {
						return v.map(item => `${k}[]=${encodeURIComponent(String(item))}`).join('&');
					}
					return `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
				})
				.join('&');
		}

		let lastError: Error | undefined;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const resp = await safeRequest({
					url,
					method,
					headers,
					body: reqBody,
					contentType: 'application/x-www-form-urlencoded',
				});

				if (resp.json?.errcode === 'RATE_LIMITED' || resp.status === 429) {
					throw new ZLibraryError('下载限额已用完', 'RATE_LIMITED', resp.status);
				}

				this.cookieJar.extractFromResponse(resp.headers as any);
				return resp.json;
			} catch (err) {
				if (err instanceof ZLibraryError) throw err;
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempt < MAX_RETRIES) {
					const delay = RETRY_BASE_MS * Math.pow(2, attempt);
					await new Promise(r => setTimeout(r, delay));
				}
			}
		}
		throw new ZLibraryError(`请求失败: ${lastError?.message}`, 'NETWORK_ERROR');
	}

	async login(email: string, password: string): Promise<UserProfile> {
		const data = await this.request('POST', '/eapi/user/login', { email, password });

		if (!data?.success) {
			throw new ZLibraryError('登录失败：邮箱或密码错误', 'LOGIN_FAILED');
		}

		this.cookieJar.setFromLogin(data.user.id, data.user.remix_userkey);

		return {
			userId: data.user.id,
			email: data.user.email ?? email,
			downloadsTodayLimit: data.user.downloads_limit ?? 0,
			downloadsTodayLeft: (data.user.downloads_limit ?? 0) - (data.user.downloads_today ?? 0),
			isPremium: !!data.user.isPremium,
		};
	}

	async search(query: string, options?: SearchOptions): Promise<SearchResult> {
		const body: Record<string, unknown> = {
			message: query,
			limit: options?.limit ?? 10,
			page: options?.page ?? 1,
		};

		if (options?.exact) body.exact = 1;
		if (options?.yearFrom) body.yearFrom = options.yearFrom;
		if (options?.yearTo) body.yearTo = options.yearTo;
		if (options?.languages?.length) body['languages'] = options.languages;
		if (options?.extensions?.length) body['extensions'] = options.extensions;
		if (options?.order) body.order = options.order;

		const data = await this.request('POST', '/eapi/book/search', body);

		if (!data?.success) {
			throw new ZLibraryError('搜索失败', 'NETWORK_ERROR');
		}

		const books: ZLibraryBook[] = (data.books ?? []).map((b: any) => ({
			id: b.id,
			hash: b.hash,
			title: b.title,
			author: b.author,
			extension: b.extension,
			filesize: b.filesize ?? 0,
			filesizeString: b.size ?? b.filesizeString ?? '',
			cover: b.cover,
			year: b.year,
			language: b.language,
			publisher: b.publisher,
			pages: b.pages,
			isbn: b.isbn,
			md5: b.md5,
			description: b.description,
			interestScore: b.interestScore,
			qualityScore: b.qualityScore,
		}));

		// API 返回 exactBooksCount + pagination 数组，而非 total/page/totalPages
		const pagination = Array.isArray(data.pagination) ? data.pagination : [];
		const totalPages = pagination.length > 0 ? pagination.length : 1;

		return {
			books,
			total: data.exactBooksCount ?? books.length,
			page: options?.page ?? 1,
			totalPages,
		};
	}

	async getDownloadLink(bookId: number, hash: string): Promise<DownloadInfo> {
		const data = await this.request('GET', `/eapi/book/${bookId}/${hash}/file`);

		if (!data?.file?.downloadLink) {
			throw new ZLibraryError('获取下载链接失败', 'DOWNLOAD_FAILED');
		}

		return {
			downloadLink: data.file.downloadLink,
			description: data.file.description ?? '',
			extension: data.file.extension ?? 'pdf',
		};
	}

	/** 下载书籍，返回二进制数据和文件扩展名。写入 Vault 由调用方负责。 */
	async downloadBook(
		bookId: number,
		hash: string,
	): Promise<{ data: ArrayBuffer; extension: string }> {
		const dlInfo = await this.getDownloadLink(bookId, hash);

		// C1: 扩展名白名单校验
		const ext = dlInfo.extension.toLowerCase();
		if (!ALLOWED_EXTENSIONS.has(ext)) {
			throw new ZLibraryError(`不支持的文件格式：${ext}`, 'DOWNLOAD_FAILED');
		}

		// C2: 下载链接域名校验
		this.validateDownloadUrl(dlInfo.downloadLink);

		const headers: Record<string, string> = {};
		if (this.cookieJar.isLoggedIn()) {
			headers['Cookie'] = this.cookieJar.toHeader();
		}

		const resp = await safeRequest({ url: dlInfo.downloadLink, headers });

		if (!resp.arrayBuffer || resp.arrayBuffer.byteLength === 0) {
			throw new ZLibraryError('下载文件为空', 'DOWNLOAD_FAILED');
		}

		// I5: 文件大小上限
		if (resp.arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
			throw new ZLibraryError(`文件过大（${(resp.arrayBuffer.byteLength / 1024 / 1024).toFixed(0)} MB），超出 200 MB 限制`, 'DOWNLOAD_FAILED');
		}

		return { data: resp.arrayBuffer, extension: ext };
	}

	async discoverDomain(): Promise<string> {
		for (const candidate of DEFAULT_DOMAINS) {
			try {
				const resp = await safeRequest({
					url: `https://${candidate}/eapi/info/domains`,
					headers: EAPI_HEADERS,
				});
				const data = resp.json;
				if (data?.domains?.length) {
					this.domain = data.domains[0];
					return this.domain;
				}
			} catch {
				continue;
			}
		}
		return DEFAULT_DOMAINS[0];
	}

	async getProfile(): Promise<UserProfile> {
		const data = await this.request('GET', '/eapi/user/profile');

		return {
			userId: data?.user?.id ?? 0,
			email: data?.user?.email ?? '',
			downloadsTodayLimit: data?.user?.downloads_limit ?? 0,
			downloadsTodayLeft: (data?.user?.downloads_limit ?? 0) - (data?.user?.downloads_today ?? 0),
			isPremium: !!data?.user?.isPremium,
		};
	}

	isLoggedIn(): boolean {
		return this.cookieJar.isLoggedIn();
	}

	/** I1: 从已有凭证恢复会话（替代直接访问 cookieJar） */
	restoreSession(userId: number, userKey: string): void {
		this.cookieJar.setFromLogin(userId, userKey);
	}

	/** I1: 获取可持久化的凭证（替代直接访问 cookieJar） */
	getPersistableCredentials(): { userId: string; userKey: string; domain: string } | null {
		if (!this.cookieJar.isLoggedIn()) return null;
		return {
			userId: this.cookieJar.getUserId(),
			userKey: this.cookieJar.getUserKey(),
			domain: this.domain,
		};
	}

	/** 校验下载链接格式和协议 */
	private validateDownloadUrl(url: string): void {
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== 'https:') {
				throw new ZLibraryError('下载链接必须使用 HTTPS', 'DOWNLOAD_FAILED');
			}
		} catch (err) {
			if (err instanceof ZLibraryError) throw err;
			throw new ZLibraryError('下载链接格式无效', 'DOWNLOAD_FAILED');
		}
	}
}
