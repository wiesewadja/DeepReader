import { describe, it, expect } from 'vitest';
import { parseCallouts } from '@/utils/callout-parser';

describe('parseCallouts', () => {
	it('应提取微信读书高亮 callout', () => {
		const md = `# 第一章

一些正文内容。

> [!quote]+ 🟡 高亮
> 这是被高亮的文本
> 💬 这是我写的批注`;

		const result = parseCallouts(md);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('这是被高亮的文本 💬 这是我写的批注');
	});

	it('应提取微信读书想法 callout', () => {
		const md = `> [!note]+ 💬 想法
> 这本书写得真不错
> 📌 原来引用的是这段话`;

		const result = parseCallouts(md);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('这本书写得真不错 📌 原来引用的是这段话');
	});

	it('应提取 DeepReader 原生高亮 callout', () => {
		const md = `> [!warning]+ 🟡 高亮
> 重要的一段话，需要反复阅读。
>
> ---
> 📍 来源: [[chapter1#^abc123|第一章]]
> 📄 页码: 第 42 页`;

		const result = parseCallouts(md);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('重要的一段话，需要反复阅读。');
	});

	it('应提取 DeepReader AI 摘录 callout', () => {
		const md = `> [!tip]+ 核心观点
> 这是 AI 生成的摘录内容
>
> ---
> 📍 来源: [[chapter2#^def456|第二章]]`;

		const result = parseCallouts(md);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('这是 AI 生成的摘录内容');
	});

	it('应处理多个相邻 callout', () => {
		const md = `> [!quote]+ 🟡 高亮
> 第一段高亮

> [!note]+ 💬 想法
> 我的想法

> [!quote]+ 🔴 高亮
> 第二段高亮`;

		const result = parseCallouts(md);
		expect(result).toHaveLength(3);
		expect(result[0]).toBe('第一段高亮');
		expect(result[1]).toBe('我的想法');
		expect(result[2]).toBe('第二段高亮');
	});

	it('应处理文件末尾无空行的 callout', () => {
		const md = `> [!quote]+ 🟡 高亮
> 最后一行高亮`;
		const result = parseCallouts(md);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('最后一行高亮');
	});

	it('应跳过 [!summary] 类非标注 callout 的元数据', () => {
		const md = `> [!summary] 书籍简介
> 这是一本关于深度学习的书。`;
		const result = parseCallouts(md);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('这是一本关于深度学习的书。');
	});

	it('无 callout 时返回空数组', () => {
		const md = `# 标题\n\n普通正文，没有任何 callout。`;
		expect(parseCallouts(md)).toEqual([]);
	});

	it('应跳过空 callout（只有标题行）', () => {
		const md = `> [!quote]+ 🟡 高亮\n\n后续内容`;
		expect(parseCallouts(md)).toEqual([]);
	});

	it('应处理多行文本的 callout', () => {
		const md = `> [!quote]+ 🟡 高亮
> 第一行
> 第二行
> 第三行`;
		const result = parseCallouts(md);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('第一行 第二行 第三行');
	});
});
