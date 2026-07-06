/**
 * bookId 规范化 — 处理微信读书 API 返回的字段名变体
 */

interface BookItem {
	bookId?: string;
	bookid?: string;
	docId?: string;
	docid?: string;
}

/**
 * 从可能包含各种 bookId 字段名的对象中提取唯一 ID
 * 优先级：bookId > bookid > docId > docid
 */
export function normalizeBookId(item: BookItem): string {
	return item.bookId || item.bookid || item.docId || item.docid || '';
}
