import { describe, it, expect } from 'vitest';
import { parseWereadHighlights, isAlreadyMarked } from '@/weread/sync/highlight-importer';

describe('parseWereadHighlights', () => {
	it('应解析单个黄色高亮', () => {
		const md = `> [!quote]+ 🟡 高亮
> 这是被高亮的文本`;
		const result = parseWereadHighlights(md);
		expect(result).toHaveLength(1);
		expect(result[0].markText).toBe('这是被高亮的文本');
		expect(result[0].colorStyle).toBe(0);
	});

	it('应解析带行内批注的高亮', () => {
		const md = `> [!quote]+ 🟡 高亮
> 高亮文本
> 💬 我的想法`;
		const result = parseWereadHighlights(md);
		expect(result).toHaveLength(1);
		expect(result[0].markText).toBe('高亮文本');
	});

	it('应解析不同颜色的高亮', () => {
		const colors = [
			{ emoji: '🟡', expected: 0 },
			{ emoji: '🔴', expected: 1 },
			{ emoji: '🟠', expected: 2 },
			{ emoji: '🟢', expected: 3 },
			{ emoji: '🔵', expected: 4 },
			{ emoji: '🩷', expected: 5 },
		];
		for (const { emoji, expected } of colors) {
			const md = `> [!quote]+ ${emoji} 高亮\n> 文本`;
			const result = parseWereadHighlights(md);
			expect(result[0].colorStyle).toBe(expected);
		}
	});

	it('应解析多个相邻高亮', () => {
		const md = `> [!quote]+ 🟡 高亮
> 第一段

> [!quote]+ 🔴 高亮
> 第二段`;
		const result = parseWereadHighlights(md);
		expect(result).toHaveLength(2);
		expect(result[0].markText).toBe('第一段');
		expect(result[0].colorStyle).toBe(0);
		expect(result[1].markText).toBe('第二段');
		expect(result[1].colorStyle).toBe(1);
	});

	it('应跳过想法和书评 callout', () => {
		const md = `> [!note]+ 💬 想法
> 我的想法`;
		const result = parseWereadHighlights(md);
		expect(result).toHaveLength(0);
	});

	it('无高亮 callout 时返回空数组', () => {
		const md = '# 标题\n\n正文内容';
		expect(parseWereadHighlights(md)).toEqual([]);
	});

	it('应处理多行 markText', () => {
		const md = `> [!quote]+ 🟡 高亮
> 第一行
> 第二行`;
		const result = parseWereadHighlights(md);
		expect(result).toHaveLength(1);
		expect(result[0].markText).toBe('第一行 第二行');
	});

	it('应处理文件末尾无空行的高亮', () => {
		const md = `> [!quote]+ 🟡 高亮
> 最后一行`;
		const result = parseWereadHighlights(md);
		expect(result).toHaveLength(1);
		expect(result[0].markText).toBe('最后一行');
	});
});

describe('isAlreadyMarked', () => {
	it('文本已被 mark 标签包裹时应返回 true', () => {
		const content = '前置文字 <mark style="background: rgba(255, 235, 59, 0.5)">高亮文本</mark> 后续文字';
		expect(isAlreadyMarked(content, '高亮文本')).toBe(true);
	});

	it('文本存在但未被包裹时应返回 false', () => {
		const content = '这是普通的高亮文本没有标记';
		expect(isAlreadyMarked(content, '高亮文本')).toBe(false);
	});

	it('文本不存在时应返回 false', () => {
		const content = '完全不相关的文字';
		expect(isAlreadyMarked(content, '高亮文本')).toBe(false);
	});

	it('同一文本出现多次时，任一已被标记即返回 true', () => {
		const content = '普通创新 <mark style="background: ...">创新</mark> 又一个创新';
		expect(isAlreadyMarked(content, '创新')).toBe(true);
	});

	it('同一文本多次出现，一个已标记一个未标记时应返回 true', () => {
		const content = '创新精神很重要。' + '<mark style="background: ...">创新</mark>' + '也需要勇气。';
		expect(isAlreadyMarked(content, '创新')).toBe(true);
	});
});
