import { describe, it, expect } from 'vitest';
import { findTextInMarkdown, stripMarkdownWithMap } from '@/utils/markdown-utils';

describe('findTextInMarkdown', () => {
	it('应精确匹配纯文本', () => {
		const result = findTextInMarkdown('普通文本内容', '文本');
		expect(result).not.toBeNull();
		expect(result!.matched).toBe('文本');
		expect(result!.index).toBe(2);
	});

	it('应跳过加粗标记匹配', () => {
		const result = findTextInMarkdown('这是**加粗**文字', '加粗文字');
		expect(result).not.toBeNull();
		expect(result!.matched).toContain('加粗');
	});

	it('应跳过行内代码标记匹配', () => {
		const result = findTextInMarkdown('使用`code`块', 'code块');
		expect(result).not.toBeNull();
		expect(result!.matched).toContain('code');
	});

	it('应跳过 wiki link 标记匹配', () => {
		const result = findTextInMarkdown('参考[[链接]]内容', '链接内容');
		expect(result).not.toBeNull();
		expect(result!.matched).toContain('链接');
	});

	it('不匹配时应返回 null', () => {
		const result = findTextInMarkdown('完全不相关', '目标');
		expect(result).toBeNull();
	});

	it('应返回首次出现的位置', () => {
		const result = findTextInMarkdown('abcabc', 'bc');
		expect(result).not.toBeNull();
		expect(result!.index).toBe(1);
	});
});

describe('stripMarkdownWithMap', () => {
	it('纯文本应保持不变', () => {
		const { plain } = stripMarkdownWithMap('普通文本');
		expect(plain).toBe('普通文本');
	});

	it('应剥离加粗标记', () => {
		const { plain } = stripMarkdownWithMap('**加粗**');
		expect(plain).toBe('加粗');
	});

	it('应剥离斜体标记', () => {
		const { plain } = stripMarkdownWithMap('*斜体*');
		expect(plain).toBe('斜体');
	});

	it('应剥离行内代码', () => {
		const { plain } = stripMarkdownWithMap('`code`');
		expect(plain).toBe('code');
	});

	it('映射应正确反映原始位置', () => {
		const { plain, map } = stripMarkdownWithMap('A**B**C');
		expect(plain).toBe('ABC');
		expect(map).toEqual([0, 3, 6]); // A at 0, B at 3 (after **), C at 6 (after **)
	});

	it('空字符串应返回空', () => {
		const { plain, map } = stripMarkdownWithMap('');
		expect(plain).toBe('');
		expect(map).toEqual([]);
	});
});
