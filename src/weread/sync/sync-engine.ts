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
import { renderNotebook } from '../render/markdown-renderer';
import { extractCoverExt, toHighResCoverUrl } from '../utils/cover';
import { sanitizeFileName } from '../utils/file';
import type { WereadChapter, WereadHighlight, WereadReview } from '../types';
import type {
	WereadBook,
	WereadNotebook,
	WereadChapterDetail,
	WereadBookmark,
	WereadReviewItem,
	WereadSyncState,
	SyncResult,
	SyncProgress,
} from '../types';
import { safeRequest } from '../../utils/safe-request';
import { htmlToMarkdown } from '../utils/html-to-md';
import { serviceLog as logger } from '../../utils/logger';


const DEFAULT_BATCH_SIZE = 3;

export interface SyncEngineHost {
	settings: {
		wereadApiKey: string;
		wereadExcludeArticles: boolean;
		wereadNoteCountThreshold: number;
	};
	adapter: VaultAdapter;
}

export class WereadSyncEngine {
	private readonly client: WereadApiClient;
	private readonly settings: SyncEngineHost['settings'];
	private readonly adapter: VaultAdapter;

	private callbacks: {
		onProgress: (p: SyncProgress) => void;
	} = { onProgress: () => {} };

	constructor(private readonly host: SyncEngineHost) {
		if (!host.settings.wereadApiKey) throw new Error('未配置微信读书 API Key');
		this.client = new WereadApiClient(host.settings.wereadApiKey);
		this.settings = host.settings;
		this.adapter = host.adapter;
	}

	onProgress(cb: (p: SyncProgress) => void) {
		this.callbacks.onProgress = cb;
	}

	private emitProgress(p: SyncProgress) {
		try { this.callbacks.onProgress(p); } catch { /* callback 可能操作已销毁的 DOM */ }
	}

	async sync(forceFullSync = false): Promise<SyncResult> {
		const result: SyncResult = {
			added: 0,
			updated: 0,
			unchanged: 0,
			matched: 0,
			unmatched: 0,
			errors: [],
		};

		// ── Phase 1: 拉取书架 ──────────────────────────────
		this.emitProgress({
			phase: 'fetching-shelf',
			current: 0,
			total: 0,
			currentBook: '',
		});

		let remoteBooks: WereadBook[];
		try {
			const notebookResp = await this.client.getNotebook();
			const nb = Array.isArray(notebookResp.books) ? notebookResp.books : [];

			// shelf/sync 网关也可能不可用，降级为只用 notebook
			try {
				const shelfResp = await this.client.getShelf();
				remoteBooks = mergeShelfBooks(nb, shelfResp.books ?? []);
			} catch {
				logger.info('shelf/sync API 不可用，仅使用 notebook 数据');
				remoteBooks = mergeShelfBooks(nb, []);
			}
		} catch (err) {
			const msg = `拉取书架失败: ${err instanceof Error ? err.message : String(err)}`;
			logger.error(msg);
			result.errors.push(msg);
			return result;
		}

		// 过滤没有标题的书籍
		remoteBooks = remoteBooks.filter((b) => b.title);

		// 过滤公众号文章（type=3 或 extra_type 特殊值）
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

		logger.info(`拉取到 ${remoteBooks.length} 本书籍`);

		// ── Phase 2: 差异检测 ──────────────────────────────
		const stateManager = new SyncStateManager(this.adapter);
		await stateManager.ensureDir();
		const syncState = await stateManager.loadSyncState();
		const toSync = forceFullSync
			? remoteBooks
			: filterBooksToSync(remoteBooks, syncState);

		logger.info(`需要同步 ${toSync.length} 本（全量=${forceFullSync}）`);

		// ── Phase 3: 逐本同步 ──────────────────────────────
		this.emitProgress({
			phase: 'fetching-books',
			current: 0,
			total: toSync.length,
			currentBook: '',
		});

		let completed = 0;
		const batchSize = DEFAULT_BATCH_SIZE;

		for (let i = 0; i < toSync.length; i += batchSize) {
			const batch = toSync.slice(i, i + batchSize);
			const results = await Promise.allSettled(
				batch.map((book) => this.syncSingleBook(book, syncState)),
			);

			for (let j = 0; j < results.length; j++) {
				const r = results[j];
				completed++;

				if (r.status === 'fulfilled') {
					if (r.value.success) {
						if (r.value.isNew) result.added++;
						else result.updated++;
					} else {
						result.errors.push(r.value.error);
					}
				} else {
					const book = batch[j];
					const msg = `同步《${book.title}》失败: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
					logger.error(msg);
					result.errors.push(msg);
				}
			}

			this.emitProgress({
				phase: 'fetching-books',
				current: completed,
				total: toSync.length,
				currentBook: batch[batch.length - 1]?.title ?? '',
			});
		}

		// ── Phase 4: 匹配关联 ──────────────────────────────
		this.emitProgress({
			phase: 'matching',
			current: 0,
			total: 0,
			currentBook: '',
		});

		// 保存同步状态
		syncState.lastSyncTime = Date.now();
		await stateManager.saveSyncState(syncState);

		this.emitProgress({
			phase: 'completed',
			current: toSync.length,
			total: toSync.length,
			currentBook: '',
		});

		return result;
	}

	/**
	 * 同步单本书籍：
	 * 1. 并行拉取 highlights / reviews / chapters / progress
	 * 2. 用 highlightResp.book 和 progressResp.book 补充元数据
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
		const [highlightResp, reviewResp, chapterResp, progressResp] =
			await Promise.all([
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
					return { chapters: [] as WereadChapterDetail[] };
				}),
				this.client.getProgress(bookId).catch((err) => {
					logger.warn(`获取进度失败 ${bookId}: ${err}`);
					return null;
				}),
			]);

		// 用 highlightResp.book 补充 meta
		if (highlightResp.book) {
			if (highlightResp.book.title) book.title = highlightResp.book.title;
			if (highlightResp.book.author) book.author = highlightResp.book.author;
			if (highlightResp.book.cover) book.cover = highlightResp.book.cover;
		}

		// 用 progress 补充 meta — 网关使用 recordReadingTime
		if (progressResp?.book) {
			book.progress = progressResp.book.progress ?? book.progress;
			book.readingTime = progressResp.book.recordReadingTime ?? book.readingTime;
			if (progressResp.book.isStartReading) {
				book.readingStatus = 'reading';
			}
		}

		// 构建章节 uid → 标题映射 — 网关直接返回 chapters 数组
		const chapterTitleMap = buildChapterTitleMap(chapterResp.chapters);

		// 解析高亮
		const highlights: WereadHighlight[] = (highlightResp.updated ?? []).map(
			(bm: WereadBookmark) => ({
				bookmarkId: bm.bookmarkId,
				markText: bm.markText,
				chapterUid: bm.chapterUid,
				chapterTitle: chapterTitleMap.get(bm.chapterUid) ?? bm.chapterName ?? '',
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

		// 解析章节 — 网关返回直接的 chapters 数组
		const chapters: WereadChapter[] = (chapterResp.chapters ?? []).map((ch: WereadChapterDetail) => ({
			chapterUid: ch.chapterUid,
			chapterIdx: ch.chapterIdx,
			title: ch.title,
			level: ch.level ?? 1,
			isMPChapter: !!ch.isMPChapter,
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
		const md = renderNotebook(notebook);

		// 写入文件
		const outputPath = this.resolveNotePath(book);
		await this.ensureDirForFile(outputPath);
		await this.adapter.write(outputPath, md);

		// 更新 syncState
		const isNew = !syncState.syncedBooks[bookId];
		syncState.syncedBooks[bookId] = {
			bookId,
			title: book.title,
			author: book.author,
			noteCount: book.noteCount,
			reviewCount: book.reviewCount,
			lastSyncTime: Date.now(),
			filePath: outputPath,
		};

		return { success: true, isNew };
	}

	/** 下载封面图片 */
	private async downloadCover(book: WereadBook): Promise<void> {
		if (!book.cover) {
			console.log('[WereadSync] no cover URL for:', book.title);
			return;
		}

		const ext = extractCoverExt(book.cover);
		const hiresUrl = toHighResCoverUrl(book.cover);
		const coverPath = `DeepReader/covers/${sanitizeFileName(book.title)}.${ext}`;

		if (await this.adapter.exists(coverPath)) return;

		console.log('[WereadSync] downloading cover:', book.title, 'hiresUrl:', hiresUrl);
		try {
			const resp = await safeRequest({ url: hiresUrl });
			console.log('[WereadSync] cover response status:', resp.status, 'arrayBuffer:', !!resp.arrayBuffer, 'size:', resp.arrayBuffer?.byteLength);
			if (resp.arrayBuffer && resp.arrayBuffer.byteLength > 0) {
				await this.ensureDirForFile(coverPath);
				await this.adapter.writeBinary(coverPath, resp.arrayBuffer);
				console.log('[WereadSync] cover saved:', coverPath);
			} else {
				console.warn('[WereadSync] cover response has no arrayBuffer, text length:', resp.text?.length);
			}
		} catch (err) {
			console.error('[WereadSync] cover download error:', err);
			throw err;
		}
	}

	/** 根据设置生成笔记文件路径 */
	private resolveNotePath(book: WereadBook): string {
		const safeName = sanitizeFileName(book.title);
		const bookDir = join('书籍摘录', safeName);
		return join(bookDir, safeName + '.md');
	}

	/** 确保文件所在目录存在 */
	private async ensureDirForFile(filePath: string): Promise<void> {
		const dir = dirname(filePath);
		if (dir && !(await this.adapter.exists(dir))) {
			await this.adapter.mkdir(dir);
		}
	}
}


// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/** 构建章节 uid → 标题映射 — 网关直接返回 chapters 数组 */
function buildChapterTitleMap(
	chapters: WereadChapterDetail[] | undefined,
): Map<number, string> {
	const map = new Map<number, string>();
	if (!chapters || !Array.isArray(chapters)) return map;

	for (const ch of chapters) {
		map.set(ch.chapterUid, ch.title);
	}
	return map;
}
