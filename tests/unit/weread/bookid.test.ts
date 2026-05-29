import { describe, it, expect } from 'vitest';
import { normalizeBookId } from '@/weread/utils/bookid';

describe('normalizeBookId', () => {
	it('应从 bookId 字段提取 ID', () => {
		expect(normalizeBookId({ bookId: '12345' })).toBe('12345');
	});

	it('应从 bookid（小写）字段提取 ID', () => {
		expect(normalizeBookId({ bookid: '67890' })).toBe('67890');
	});

	it('应从 docId 字段提取 ID', () => {
		expect(normalizeBookId({ docId: 'mp_12345' })).toBe('mp_12345');
	});

	it('应从 docid（小写）字段提取 ID', () => {
		expect(normalizeBookId({ docid: 'doc_abc' })).toBe('doc_abc');
	});

	it('字段优先级：bookId > bookid > docId > docid', () => {
		expect(normalizeBookId({ bookId: 'first', bookid: 'second', docId: 'third', docid: 'fourth' }))
			.toBe('first');
		expect(normalizeBookId({ bookid: 'second', docId: 'third', docid: 'fourth' }))
			.toBe('second');
		expect(normalizeBookId({ docId: 'third', docid: 'fourth' }))
			.toBe('third');
	});

	it('所有字段都不存在时返回空字符串', () => {
		expect(normalizeBookId({})).toBe('');
		expect(normalizeBookId({ title: 'test' })).toBe('');
	});
});
