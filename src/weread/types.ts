/**
 * 微信读书集成 — 类型定义
 */

// ═══════════════════════════════════════════════════════════════
// API 原始响应类型
// ═══════════════════════════════════════════════════════════════

/** /api/user/notebook 响应 */
export interface WereadNotebookResponse {
	books: WereadBookItem[];
}

/** notebook 响应中的书籍条目（字段名不统一） */
export interface WereadBookItem {
	bookId?: string;
	bookid?: string;
	docId?: string;
	docid?: string;
	title?: string;
	author?: string;
	cover?: string;
	isbn?: string;
	publisher?: string;
	category?: string;
	intro?: string;
	totalWords?: number;
	newRating?: number;
	price?: number;
	publishTime?: string;
	bookType?: number;
	noteCount?: number;
	reviewCount?: number;
	lastReadDate?: string;
	finishedDate?: string;
	readUpdateTime?: number;
}

/** /shelf/sync 响应 */
export interface WereadShelfResponse {
	books: WereadShelfBook[];
	archives?: unknown[];
}

/** shelf 响应中的书籍条目 */
export interface WereadShelfBook {
	bookId?: string;
	bookid?: string;
	docId?: string;
	docid?: string;
	title?: string;
	author?: string;
	cover?: string;
	isbn?: string;
	category?: string;
	bookType?: number;
	noteCount?: number;
	reviewCount?: number;
	readUpdateTime?: number;
}

/** /web/book/bookmarklist 响应 */
export interface WereadHighlightResponse {
	updated: WereadBookmark[];
	chapters: { chapterUid: number; title: string }[];
	book: { title: string; author: string; cover: string };
	refMpInfos?: unknown[];
}

/** 高亮原始条目 */
export interface WereadBookmark {
	bookmarkId: string;
	markText: string;
	chapterUid: number;
	range: string;
	style: number;
	colorStyle: number;
	createTime: number;
	reviewContent?: string;
}

/** /web/review/list 响应 */
export interface WereadReviewResponse {
	reviews: WereadReviewItem[];
}

/** 评论原始条目 */
export interface WereadReviewItem {
	reviewId: string;
	content: string;
	htmlContent?: string;
	chapterUid?: number;
	chapterName?: string;
	range?: string;
	createTime: number;
	type: number;  // 1=章节评论, 4=全书评论
	abstract?: string;
}

/** /web/book/chapterInfos 响应 */
export interface WereadChapterResponse {
	data: Record<string, WereadChapterDetail[]>;
}

/** 章节详情 */
export interface WereadChapterDetail {
	chapterUid: number;
	title: string;
	chapterIdx: number;
	level: number;
	isMPChapter?: boolean;
}

/** /web/book/getProgress 响应 */
export interface WereadProgressResponse {
	progress: number;
	readingTime: number;
	startReadingTime: string;
	finishTime: string;
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
}

// ═══════════════════════════════════════════════════════════════
// Cookie / 认证
// ═══════════════════════════════════════════════════════════════

/** 微信读书 Cookie 存储 */
export interface WereadCookie {
	wr_vid: string;
	wr_skey: string;
	wr_name?: string;
	wr_avatar?: string;
	refreshToken?: string;
	expireAt?: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步进度
// ═══════════════════════════════════════════════════════════════

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
