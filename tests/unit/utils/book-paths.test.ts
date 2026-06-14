import { describe, it, expect } from 'vitest';
import {
	excerptBaseDir,
	bookExcerptDir,
	bookNotePath,
	dailyExcerptPath,
} from '@/utils/book-paths';

describe('book-paths', () => {
	it('excerptBaseDir 返回固定根目录', () => {
		expect(excerptBaseDir()).toBe('书籍摘录');
	});

	it('bookExcerptDir 拼接根目录与 safeName', () => {
		expect(bookExcerptDir('深度学习')).toBe('书籍摘录/深度学习');
	});

	it('bookNotePath 生成 书名/书名.md 形式', () => {
		expect(bookNotePath('深度学习')).toBe('书籍摘录/深度学习/深度学习.md');
	});

	it('dailyExcerptPath 默认用今天日期', () => {
		const fixed = new Date(2026, 5, 14);
		expect(dailyExcerptPath('深度学习', fixed)).toBe('书籍摘录/深度学习/摘录-2026-06-14.md');
	});

	it('dailyExcerptPath 月份和日补零', () => {
		const fixed = new Date(2026, 0, 3);
		expect(dailyExcerptPath('x', fixed)).toBe('书籍摘录/x/摘录-2026-01-03.md');
	});

	it('调用方传 safeName 已 sanitize 过，BookPaths 不重复处理', () => {
		const sanitized = 'a:b'.replace(/[\\/:*?"<>|]/g, '_');
		expect(bookNotePath(sanitized)).toBe('书籍摘录/a_b/a_b.md');
	});
});
