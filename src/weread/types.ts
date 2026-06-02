/**
 * 微信读书集成 — 类型定义
 * 基于网关 API (i.weread.qq.com/api/agent/gateway) 响应结构
 */

// ═══════════════════════════════════════════════════════════════
// API 原始响应类型（网关透传）
// ═══════════════════════════════════════════════════════════════

/** /user/notebooks 响应 */
export interface WereadNotebookResponse {
	synckey?: number;
	totalBookCount?: number;
	totalNoteCount?: number;
	hasMore?: number;
	books: WereadBookItem[];
}

/** notebook 响应中的书籍条目 — 书籍详情在 book 子对象中 */
export interface WereadBookItem {
	bookId: string;
	book: WereadBookDetail;
	reviewCount: number;
	reviewLikeCount: number;
	reviewCommentCount: number;
	noteCount: number;
	bookmarkCount: number;
	/**
	 * @deprecated 由 WeRead 网关 API 返回，但内部已统一规范化为 `WereadBook.progress` 字段（line 189）。
	 * 保留仅为记录 API 契约，c0da03bc 后前端无任何消费方（见 docs/test-strategies/reading-progress-anti-regression.md §5.3）。
	 * 新代码不应读取此字段；如有需要请从 `WereadBook.progress` 取值。
	 */
	readingProgress?: number;
	markedStatus?: number;
	sort: number;
}

/** notebook.books[].book 子对象 — 包含书籍元数据 */
export interface WereadBookDetail {
	bookId: string;
	title: string;
	author: string;
	cover: string;
	version?: number;
	format?: string;
	type?: number;
	price?: number;
	originalPrice?: number;
	soldout?: number;
	payType?: number;
	categories?: unknown[];
	finished?: number;
	extra_type?: number;
	cpid?: number;
	publishTime?: number;
	lastChapterIdx?: number;
}

/** /shelf/sync 响应 */
export interface WereadShelfResponse {
	books: WereadShelfBook[];
	albums?: unknown[];
	bookCount?: number;
}

/** shelf 响应中的书籍条目 */
export interface WereadShelfBook {
	bookId?: string;
	title?: string;
	author?: string;
	cover?: string;
	category?: string;
	readUpdateTime?: number;
	finishReading?: number;
	bookType?: number;
	noteCount?: number;
	reviewCount?: number;
}

/** /book/bookmarklist 响应 */
export interface WereadHighlightResponse {
	synckey?: number;
	updated: WereadBookmark[];
	removed?: unknown[];
	chapters: { chapterUid: number; chapterIdx: number; title: string }[];
	book: { bookId: string; title: string; author: string; cover: string };
}

/** 高亮原始条目 */
export interface WereadBookmark {
	bookId: string;
	bookmarkId: string;
	markText: string;
	chapterUid: number;
	chapterName?: string;
	range: string;
	style: number;
	colorStyle: number;
	createTime: number;
	type?: number;
	bookVersion?: number;
	reviewContent?: string;
}

/** /review/list/mine 响应 */
export interface WereadReviewResponse {
	totalCount?: number;
	reviews: WereadReviewItem[];
	removed?: unknown[];
	hasMore?: number;
	synckey?: number;
}

/** 评论原始条目 — 网关返回嵌套结构 reviews[].review.{content,...} */
export interface WereadReviewItem {
	reviewId: string;
	review: {
		reviewId?: string;
		type?: number;
		content?: string;
		htmlContent?: string;
		chapterUid?: number;
		chapterIdx?: number;
		chapterName?: string;
		chapterTitle?: string;
		range?: string;
		createTime?: number;
		abstract?: string;
	};
}

/** /book/chapterinfo 响应 — 网关返回顶层 chapters 数组 */
export interface WereadChapterResponse {
	bookId: string;
	synckey?: number;
	chapterUpdateTime?: number;
	chapters: WereadChapterDetail[];
}

/** 章节详情 */
export interface WereadChapterDetail {
	chapterUid: number;
	chapterIdx: number;
	title: string;
	wordCount?: number;
	updateTime?: number;
	price?: number;
	paid?: number;
	isMPChapter?: number;
	level?: number;
}

/** /book/getprogress 响应 — 网关字段名 */
export interface WereadProgressResponse {
	bookId?: string;
	book: WereadProgressBook;
	timestamp?: number;
}

/** 进度子对象 */
export interface WereadProgressBook {
	progress: number;
	recordReadingTime: number;
	finishTime?: number;
	updateTime?: number;
	chapterUid?: number;
	chapterIdx?: number;
	chapterOffset?: number;
	isStartReading?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 内部模型
// ═══════════════════════════════════════════════════════════════

/** 标准化的书籍模型 */
export interface WereadBook {
	bookId: string;
	title: string;
	author: string;
	cover: string;
	isbn: string;
	publisher: string;
	category: string;
	intro: string;
	totalWords: number;
	rating: number;
	publishTime: string;
	bookType: number;
	noteCount: number;
	reviewCount: number;
	lastReadDate: string;
	readingStatus: 'unread' | 'reading' | 'finished';
	progress: number;
	readingTime: number;
}

/** 标准化的高亮模型 */
export interface WereadHighlight {
	bookmarkId: string;
	markText: string;
	chapterUid: number;
	chapterTitle: string;
	style: number;
	colorStyle: number;
	range: string;
	createTime: number;
	reviewContent?: string;
}

/** 标准化的评论模型 */
export interface WereadReview {
	reviewId: string;
	content: string;
	mdContent: string;
	chapterUid: number;
	chapterTitle: string;
	createTime: number;
	type: 1 | 4;
	abstract?: string;
	range?: string;
}

/** 标准化的章节模型 */
export interface WereadChapter {
	chapterUid: number;
	chapterIdx: number;
	title: string;
	level: number;
	isMPChapter: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 聚合模型
// ═══════════════════════════════════════════════════════════════

/** 一本书的完整同步数据 */
export interface WereadNotebook {
	meta: WereadBook;
	chapters: WereadChapter[];
	highlights: WereadHighlight[];
	reviews: WereadReview[];
}

// ═══════════════════════════════════════════════════════════════
// 同步状态
// ═══════════════════════════════════════════════════════════════

/** 同步状态存储 */
export interface WereadSyncState {
	lastSyncTime: number;
	syncedBooks: Record<string, WereadSyncedBookEntry>;
	/** 已手动删除的书籍 ID，同步时跳过 */
	excludedBooks: string[];
}

/** 已同步书籍条目 */
export interface WereadSyncedBookEntry {
	bookId: string;
	title: string;
	author: string;
	noteCount: number;
	reviewCount: number;
	lastSyncTime: number;
	filePath: string;
	/** Phase 2 扩展：进度和阅读时长（可选，向后兼容） */
	progress?: number;
	readingTime?: number;
	/** 封面 URL（同步时保存，用于封面缺失时重新下载） */
	cover?: string;
}

// ═══════════════════════════════════════════════════════════════
// 关联映射
// ═══════════════════════════════════════════════════════════════

/** 微信读书↔DeepReader 书籍关联映射 */
export interface WereadMapping {
	mappings: Record<string, WereadMappingEntry>;
}

/** 单条映射记录 */
export interface WereadMappingEntry {
	wereadBookId: string;
	wereadTitle: string;
	deepReaderBookId: string;
	deepReaderTitle: string;
	matchMethod: 'title-author';
	matchedAt: number;
	confirmed: boolean;
	/** Phase 2：统计信息缓存（同步时更新） */
	stats?: MappingStats;
}

/** 映射条目的统计信息 */
export interface MappingStats {
	noteCount: number;
	reviewCount: number;
	progress: number;        // 0-100
	readingTime: string;     // 格式化后的阅读时长
	lastReadDate: string;    // YYYY-MM-DD
}

// ═══════════════════════════════════════════════════════════════
// 同步进度
// ═══════════════════════════════════════════════════════════════

/** /store/search 响应 */
export interface WereadSearchResponse {
	sid?: string;
	hasMore?: number;
	results?: WereadSearchGroup[];
}

export interface WereadSearchGroup {
	title?: string;
	scope?: number;
	scopeCount?: number;
	currentCount?: number;
	books?: WereadSearchBook[];
}

export interface WereadSearchBook {
	searchIdx?: string;
	bookInfo?: WereadSearchBookInfo;
}

export interface WereadSearchBookInfo {
	bookId: string;
	title: string;
	author: string;
	cover?: string;
	intro?: string;
	publisher?: string;
	category?: string;
	payType?: number;
	price?: number;
	soldout?: number;
	readingCount?: number;
	newRating?: number;
	newRatingCount?: number;
	newRatingDetail?: { title?: string };
}

/** /book/recommend 响应 */
export interface WereadRecommendResponse {
	books?: WereadRecommendBook[];
}

export interface WereadRecommendBook {
	bookId: string;
	title: string;
	author: string;
	cover?: string;
	intro?: string;
	category?: string;
	reason?: string;
	readingCount?: number;
	searchIdx?: string;
	newRating?: number;
	newRatingCount?: number;
	newRatingDetail?: { title?: string };
	price?: number;
	payType?: number;
	type?: number;
}

/** /book/info 响应 */
export interface WereadBookInfoResponse {
	bookId: string;
	title: string;
	author: string;
	translator?: string;
	cover?: string;
	intro?: string;
	category?: string;
	publisher?: string;
	publishTime?: string;
	isbn?: string;
	wordCount?: number;
	newRating?: number;
	newRatingCount?: number;
	newRatingDetail?: unknown;
}

/** /readdata/detail 响应 */
export interface WereadReadDataResponse {
	baseTime?: number;
	readTimes?: Record<string, number>;
	readDays?: number;
	totalReadTime?: number;
	dayAverageReadTime?: number;
	compare?: number;
	readLongest?: WereadReadLongestItem[];
	readStat?: { stat: string; counts: string }[];
	preferCategory?: { title: string; count: number }[];
	preferCategoryWord?: string;
	preferTime?: number[];
	preferTimeWord?: string;
	preferAuthor?: { author: string; count: number }[];
	authorCount?: number;
	readRate?: number;
	wrReadTime?: number;
	wrListenTime?: number;
	registTime?: number;
}

export interface WereadReadLongestItem {
	book?: { bookId: string; title: string; author: string; cover?: string };
	albumInfo?: unknown;
	readTime: number;
	tags?: string[];
}

/** 同步进度回调 */
export interface SyncProgress {
	current: number;
	total: number;
	currentBook: string;
	phase: 'fetching-shelf' | 'fetching-books' | 'rendering' | 'matching' | 'completed';
}

/** 同步结果 */
export interface SyncResult {
	added: number;
	updated: number;
	unchanged: number;
	matched: number;
	unmatched: number;
	errors: string[];
}
