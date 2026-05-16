/**
 * 同步引擎 — 微信读书同步的主编排器
 *
 * 流程：拉取书架 → 差异检测 → 逐本同步（并发控制）→ 匹配关联 → 持久化状态
 */

import { join, dirname } from 'path';
import { WereadApiClient } from '../api/client';
import { mergeShelfBooks } from '../api/shelf';
import { filterBooksToSync } from './diff';
import { SyncStateManager } from './state';
import type { VaultAdapter } from './state';
import { matchBooks, type IndexedBook, type WereadBookSummary, type MatchResult } from './matcher';
import { loadIndexedBooks } from '../utils/indexed-books';
import { renderNotebook } from '../render/markdown-renderer';
import type {
	WereadBook,
	WereadNotebook,
	WereadHighlight,
	WereadReview,
	WereadChapter,
	WereadSyncState,
	WereadSyncedBookEntry,
	WereadMapping,
	WereadMappingEntry,
	WereadBookmark,
	WereadReviewItem,
	WereadChapterDetail,
	SyncProgress,
	SyncResult,
} from '../types';
import { htmlToMarkdown } from '../utils/html-to-md';
import { extractCoverExt } from '../utils/cover';
import { serviceLog as logger } from '../../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 回调接口
// ═══════════════════════════════════════════════════════════════

export interface SyncEngineCallbacks {
	onProgress: (progress: SyncProgress) => void;
	onNotice: (message: string) => void;
}

/** 同步引擎设置（从 DeepPDFSettings 中提取的子集） */
export interface SyncEngineSettings {
	wereadNoteLocation: string;
	wereadSubFolder: string;
	wereadFileName: string;
	wereadExcludeArticles: boolean;
	wereadNoteCountThreshold: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步引擎
// ═══════════════════════════════════════════════════════════════

export class SyncEngine {
	constructor(
		private client: WereadApiClient,
		private stateManager: SyncStateManager,
		private adapter: VaultAdapter,
		private vaultPath: string,
		private settings: SyncEngineSettings,
		private callbacks: SyncEngineCallbacks,
	) {}

	/**
	 * 执行同步
	 *
	 * @param options.force 强制全量同步（忽略差异检测）
	 */
	async sync(options?: { force?: boolean }): Promise<SyncResult> {
		const result: SyncResult = {
			added: 0,
			updated: 0,
			unchanged: 0,
			matched: 0,
			unmatched: 0,
			errors: [],
		};

		// ── Phase 1: 拉取书架 ──────────────────────────────
		this.callbacks.onProgress({
			phase: 'fetching-shelf',
			current: 0,
			total: 0,
			currentBook: '',
		});

		let remoteBooks: WereadBook[];
		try {
			const [notebookResp, shelfResp] = await Promise.all([
				this.client.getNotebook(),
				this.client.getShelf(),
			]);
			remoteBooks = mergeShelfBooks(notebookResp.books, shelfResp.books);
		} catch (err) {
			const msg = `拉取书架失败: ${err instanceof Error ? err.message : String(err)}`;
			logger.error(msg);
			result.errors.push(msg);
			return result;
		}

		// 过滤公众号文章（bookType 3 = 公众号文章）
		if (this.settings.wereadExcludeArticles) {
			remoteBooks = remoteBooks.filter((b) => b.bookType !== 3);
		}

		// 过滤笔记数量阈值
		const threshold = this.settings.wereadNoteCountThreshold ?? 0;
		if (threshold > 0) {
			remoteBooks = remoteBooks.filter(
				(b) => (b.noteCount + b.reviewCount) >= threshold,
			);
		}

		// ── Phase 2: 差异检测 ──────────────────────────────
		await this.stateManager.ensureDir();
		const syncState = await this.stateManager.loadSyncState();
		const booksToSync = filterBooksToSync(remoteBooks, syncState, options);
		const unchangedCount = remoteBooks.length - booksToSync.length;
		result.unchanged = unchangedCount;

		this.callbacks.onNotice(
			`共 ${remoteBooks.length} 本书，需要同步 ${booksToSync.length} 本`,
		);

		if (booksToSync.length === 0) {
			this.callbacks.onProgress({
				phase: 'completed',
				current: 0,
				total: 0,
				currentBook: '',
			});
			this.callbacks.onNotice('所有书籍已是最新，无需同步');
			return result;
		}

		// ── Phase 3: 逐本同步（并发度 3） ──────────────────────
		this.callbacks.onProgress({
			phase: 'fetching-books',
			current: 0,
			total: booksToSync.length,
			currentBook: '',
		});

		const syncResults = await this.runWithConcurrency(
			booksToSync,
			3,
			async (book, index) => {
				this.callbacks.onProgress({
					phase: 'fetching-books',
					current: index,
					total: booksToSync.length,
					currentBook: book.title,
				});

				try {
					return await this.syncSingleBook(book, syncState);
				} catch (err) {
					const msg = `同步《${book.title}》失败: ${err instanceof Error ? err.message : String(err)}`;
					logger.error(msg);
					return { success: false as const, error: msg };
				}
			},
		);

		// 统计结果
		for (const r of syncResults) {
			if (r.success) {
				if (r.isNew) {
					result.added++;
				} else {
					result.updated++;
				}
			} else {
				result.errors.push(r.error);
			}
		}

		// ── Phase 4: 匹配关联 ──────────────────────────────
		this.callbacks.onProgress({
			phase: 'matching',
			current: 0,
			total: remoteBooks.length,
			currentBook: '',
		});

		let matchResults: MatchResult[] = [];
		try {
			const indexedBooks = await loadIndexedBooks(this.vaultPath);
			const wereadSummaries: WereadBookSummary[] = remoteBooks.map((b) => ({
				bookId: b.bookId,
				title: b.title,
				author: b.author,
			}));
			matchResults = matchBooks(wereadSummaries, indexedBooks);
		} catch (err) {
			logger.error(`加载索引书籍失败: ${err instanceof Error ? err.message : String(err)}`);
		}

		// 统计匹配结果
		for (const mr of matchResults) {
			if (mr.matched) {
				result.matched++;
			} else {
				result.unmatched++;
			}
		}

		// ── Phase 5: 持久化状态 ──────────────────────────────
		const now = Date.now();
		syncState.lastSyncTime = now;

		// 更新 mapping
		const mapping = await this.stateManager.loadMapping();
		for (const mr of matchResults) {
			if (mr.matched) {
				mapping.mappings[mr.wereadBookId] = {
					wereadBookId: mr.wereadBookId,
					wereadTitle: mr.wereadTitle,
					deepReaderBookId: mr.deepReaderBookId,
					deepReaderTitle: mr.deepReaderTitle,
					matchMethod: 'title-author',
					matchedAt: now,
					confirmed: false,
				};
			}
		}

		await this.stateManager.saveSyncState(syncState);
		await this.stateManager.saveMapping(mapping);

		this.callbacks.onProgress({
			phase: 'completed',
			current: booksToSync.length,
			total: booksToSync.length,
			currentBook: '',
		});

		this.callbacks.onNotice(
			`同步完成：新增 ${result.added}，更新 ${result.updated}，匹配 ${result.matched}，错误 ${result.errors.length}`,
		);

		return result;
	}

	// ═══════════════════════════════════════════════════════════════
	// 内部方法
	// ═══════════════════════════════════════════════════════════════

	/**
	 * 同步单本书籍：
	 * 1. 并行拉取 bookInfo / highlights / reviews / chapters / progress
	 * 2. 组装 WereadNotebook
	 * 3. 下载封面
	 * 4. 渲染 Markdown 并写入文件
	 * 5. 更新 syncState
	 */
	private async syncSingleBook(
		book: WereadBook,
		syncState: WereadSyncState,
	): Promise<{ success: true; isNew: boolean } | { success: false; error: string }> {
		const bookId = book.bookId;

		// 并行拉取所有数据
		const [bookInfo, highlightResp, reviewResp, chapterResp, progressResp] =
			await Promise.all([
				this.client.getBookInfo(bookId).catch((err) => {
					logger.warn(`获取书籍详情失败 ${bookId}: ${err}`);
					return null as Record<string, unknown> | null;
				}),
				this.client.getHighlights(bookId).catch((err) => {
					logger.warn(`获取高亮失败 ${bookId}: ${err}`);
					return { updated: [], chapters: [], book: { title: '', author: '', cover: '' } };
				}),
				this.client.getReviews(bookId).catch((err) => {
					logger.warn(`获取评论失败 ${bookId}: ${err}`);
					return { reviews: [] };
				}),
				this.client.getChapters(bookId).catch((err) => {
					logger.warn(`获取章节失败 ${bookId}: ${err}`);
					return { data: {} };
				}),
				this.client.getProgress(bookId).catch((err) => {
					logger.warn(`获取进度失败 ${bookId}: ${err}`);
					return null as { progress: number; readingTime: number; startReadingTime: string; finishTime: string } | null;
				}),
			]);

		// 用 bookInfo 补充 meta 字段
		if (bookInfo) {
			book.isbn = (bookInfo.isbn as string) || book.isbn;
			book.publisher = (bookInfo.publisher as string) || book.publisher;
			book.intro = (bookInfo.intro as string) || book.intro;
			book.totalWords = (bookInfo.totalWords as number) || book.totalWords;
			book.rating = (bookInfo.newRating as number) || book.rating;
			book.publishTime = (bookInfo.publishTime as string) || book.publishTime;
			if (bookInfo.title) book.title = bookInfo.title as string;
			if (bookInfo.author) book.author = bookInfo.author as string;
			if (bookInfo.cover) book.cover = bookInfo.cover as string;
			if (bookInfo.category) book.category = bookInfo.category as string;
		}

		// 用 progress 补充 meta
		if (progressResp) {
			book.progress = progressResp.progress ?? book.progress;
			book.readingTime = progressResp.readingTime ?? book.readingTime;
			if (progressResp.finishTime) {
				book.readingStatus = 'finished';
			}
		}

		// 解析高亮
		const chapterTitleMap = buildChapterTitleMap(chapterResp.data);
		const highlights: WereadHighlight[] = (highlightResp.updated ?? []).map(
			(bm: WereadBookmark) => ({
				bookmarkId: bm.bookmarkId,
				markText: bm.markText,
				chapterUid: bm.chapterUid,
				chapterTitle: chapterTitleMap.get(bm.chapterUid) ?? '',
				style: bm.style,
				colorStyle: bm.colorStyle,
				range: bm.range,
				createTime: bm.createTime,
				reviewContent: bm.reviewContent,
			}),
		);

		// 解析评论
		const reviews: WereadReview[] = (reviewResp.reviews ?? []).map(
			(rv: WereadReviewItem) => ({
				reviewId: rv.reviewId,
				content: rv.content || '',
				mdContent: rv.htmlContent ? htmlToMarkdown(rv.htmlContent) : (rv.content || ''),
				chapterUid: rv.chapterUid ?? 0,
				chapterTitle: rv.chapterName ?? '',
				createTime: rv.createTime,
				type: rv.type as 1 | 4,
				abstract: rv.abstract,
				range: rv.range,
			}),
		);

		// 解析章节
		const chapterData: WereadChapterDetail[] = (chapterResp.data as Record<string, WereadChapterDetail[]>)?.[bookId] ?? [];
		const chapters: WereadChapter[] = chapterData.map((ch: WereadChapterDetail) => ({
			chapterUid: ch.chapterUid,
			chapterIdx: ch.chapterIdx,
			title: ch.title,
			level: ch.level,
			isMPChapter: ch.isMPChapter ?? false,
		}));

		// 更新 noteCount / reviewCount
		book.noteCount = highlights.length;
		book.reviewCount = reviews.length;

		// 组装 Notebook
		const notebook: WereadNotebook = {
			meta: book,
			chapters,
			highlights,
			reviews,
		};

		// 下载封面
		await this.downloadCover(book).catch((err) => {
			logger.warn(`下载封面失败 ${bookId}: ${err}`);
		});

		// 渲染 Markdown
		const markdown = renderNotebook(notebook);

		// 写入文件
		const filePath = this.resolveNotePath(book);
		await this.ensureDirForFile(filePath);
		await this.adapter.write(filePath, markdown);

		// 更新 syncState
		const isNew = !syncState.syncedBooks[bookId];
		syncState.syncedBooks[bookId] = {
			bookId,
			title: book.title,
			author: book.author,
			noteCount: book.noteCount,
			reviewCount: book.reviewCount,
			lastSyncTime: Date.now(),
			filePath,
		};

		return { success: true, isNew };
	}

	/**
	 * 下载封面图片到 assets 目录
	 */
	private async downloadCover(book: WereadBook): Promise<void> {
		if (!book.cover) return;

		const assetsDir = 'DeepReader/微信读书/assets';
		const ext = extractCoverExt(book.cover);
		const coverRelPath = join(assetsDir, `${book.bookId}.${ext}`);

		// 已存在则跳过
		try {
			if (await this.adapter.exists(coverRelPath)) return;
		} catch {
			// 继续下载
		}

		try {
			const { safeRequest } = await import('../../utils/safe-request');
			const resp = await safeRequest({ url: book.cover });
			if (resp.status === 200 && resp.arrayBuffer) {
				await this.adapter.mkdir(assetsDir);
				await this.adapter.writeBinary(coverRelPath, resp.arrayBuffer);
			}
		} catch (err) {
			logger.warn(`封面下载失败 ${book.bookId}: ${err}`);
		}
	}

	/**
	 * 根据设置解析笔记文件路径
	 *
	 * 支持模板变量：
	 * - {{title}} — 书名
	 * - {{author}} — 作者
	 * - {{bookId}} — 微信读书 bookId
	 */
	private resolveNotePath(book: WereadBook): string {
		const sub = this.settings.wereadSubFolder;
		const folder = (sub && sub !== 'none')
			? join(this.settings.wereadNoteLocation, sub)
			: this.settings.wereadNoteLocation;

		const fileName = resolveFileName(this.settings.wereadFileName, book);
		return join(folder, fileName);
	}

	/**
	 * 确保文件所在目录存在
	 */
	private async ensureDirForFile(filePath: string): Promise<void> {
		const dir = dirname(filePath);
		if (dir && !(await this.adapter.exists(dir))) {
			await this.adapter.mkdir(dir);
		}
	}


	/**
	 * 简易并发池：限制同时执行的任务数
	 */
	private async runWithConcurrency<T, R>(
		items: T[],
		concurrency: number,
		handler: (item: T, index: number) => Promise<R>,
	): Promise<R[]> {
		const results: R[] = new Array(items.length);
		let nextIndex = 0;

		const worker = async (): Promise<void> => {
			while (nextIndex < items.length) {
				const idx = nextIndex++;
				results[idx] = await handler(items[idx], idx);
			}
		};

		const workers = Array.from(
			{ length: Math.min(concurrency, items.length) },
			() => worker(),
		);

		await Promise.all(workers);
		return results;
	}
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/** 构建章节 uid → 标题映射 */
function buildChapterTitleMap(
	data: Record<string, WereadChapterDetail[]> | undefined,
): Map<number, string> {
	const map = new Map<number, string>();
	if (!data) return map;

	for (const chapters of Object.values(data)) {
		for (const ch of chapters) {
			map.set(ch.chapterUid, ch.title);
		}
	}
	return map;
}


/** 文件名清理：移除不合法字符 */
function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}

/** 将设置中的文件名格式映射为实际文件名 */
const FILE_NAME_PATTERNS: Record<string, string> = {
	'title': '{{title}}.md',
	'title-author': '{{title}} - {{author}}.md',
	'title-bookId': '{{title}} - {{bookId}}.md',
};

function resolveFileName(format: string, book: WereadBook): string {
	const pattern = FILE_NAME_PATTERNS[format] || '{{title}}.md';
	return pattern
		.replace(/\{\{title\}\}/g, sanitizeFileName(book.title))
		.replace(/\{\{author\}\}/g, sanitizeFileName(book.author))
		.replace(/\{\{bookId\}\}/g, book.bookId);
}
