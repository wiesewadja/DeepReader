import { describe, it, expect } from 'vitest';
import { findFuzzyMatches } from '../sync/text-matcher';

describe('findFuzzyMatches', () => {
	it('应精确匹配原始文本', () => {
		const content = '这是第一段文字，用于测试精确匹配功能。';
		const result = findFuzzyMatches(content, '精确匹配');
		expect(result).toHaveLength(1);
		expect(result[0].matched).toBe('精确匹配');
	});

	it('应跳过 Markdown inline 标记进行匹配', () => {
		const content = '这是**加粗文字**和普通文字的混合内容。';
		const result = findFuzzyMatches(content, '加粗文字和普通文字');
		expect(result).toHaveLength(1);
		expect(result[0].matched).toContain('加粗文字');
	});

	it('应处理全角半角差异', () => {
		const content = 'ＡＢＣ和123的混合内容。';
		const result = findFuzzyMatches(content, 'ABC');
		expect(result).toHaveLength(1);
		expect(result[0].matched).toBe('ＡＢＣ');
	});

	it('应处理空格和标点差异', () => {
		const content = '深度学习是人工智能的子领域。';
		const result = findFuzzyMatches(content, '深度 学习');
		expect(result).toHaveLength(1);
		expect(result[0].matched).toBe('深度学习');
	});

	it('应处理去标点后的匹配并返回正确的 matched 范围', () => {
		const content = '所谓"创新"，就是在已有的基础上进行突破。';
		const result = findFuzzyMatches(content, '所谓创新就是在');
		expect(result).toHaveLength(1);
		// matched 应包含原文中的引号和逗号，覆盖完整范围
		expect(result[0].matched).toBe('所谓"创新"，就是在');
		expect(content.substring(result[0].index, result[0].index + result[0].matched.length))
			.toBe('所谓"创新"，就是在');
	});

	it('标点在匹配范围中间时位置映射应正确', () => {
		const content = '所谓创新，就是在已有的基础上进行突破。';
		const result = findFuzzyMatches(content, '创新就是在');
		expect(result).toHaveLength(1);
		expect(result[0].matched).toBe('创新，就是在');
	});

	it('应返回多个匹配位置', () => {
		const content = '重要的内容说三遍重要的内容重要的内容重要的内容';
		const result = findFuzzyMatches(content, '重要的内容');
		expect(result.length).toBeGreaterThanOrEqual(3);
	});

	it('未匹配时返回空数组', () => {
		const content = '这是一段完全无关的内容。';
		const result = findFuzzyMatches(content, '深度学习');
		expect(result).toEqual([]);
	});

	it('应处理空搜索文本', () => {
		const content = '任意内容';
		const result = findFuzzyMatches(content, '');
		expect(result).toEqual([]);
	});

	it('应处理包含 inline 代码的内容', () => {
		const content = '使用 `console.log` 进行调试输出。';
		const result = findFuzzyMatches(content, 'console.log进行调试');
		expect(result).toHaveLength(1);
	});

	it('最多返回 5 个匹配', () => {
		const content = '测试测试测试测试测试测试测试测试测试测试';
		const result = findFuzzyMatches(content, '测试');
		expect(result.length).toBeLessThanOrEqual(5);
	});

	it('matched 子串应能在原文中精确定位', () => {
		const content = '前缀文字。所谓"创新"，就是突破。后缀文字。';
		const result = findFuzzyMatches(content, '所谓创新就是突破');
		expect(result).toHaveLength(1);
		// 核心：从 content 的 index 位置截取 matched 长度，应完全等于 matched
		expect(content.substring(result[0].index, result[0].index + result[0].matched.length))
			.toBe(result[0].matched);
	});
});
