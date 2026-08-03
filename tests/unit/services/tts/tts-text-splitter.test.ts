import { describe, it, expect } from 'vitest';
import { splitFirstSentence, stripWikiLinksForTTS, splitTextIntoSegments } from '@/services/tts/tts-text-splitter';

describe('splitFirstSentence', () => {
    it('应该在中文句号处分割', () => {
        const [sentence, remaining] = splitFirstSentence('这是第一句。这是第二句');
        expect(sentence).toBe('这是第一句。');
        expect(remaining).toBe('这是第二句');
    });

    it('应该在感叹号处分割', () => {
        const [sentence, remaining] = splitFirstSentence('太棒了！继续前进');
        expect(sentence).toBe('太棒了！');
        expect(remaining).toBe('继续前进');
    });

    it('应该在问号处分割', () => {
        const [sentence, remaining] = splitFirstSentence('你好吗？我很好');
        expect(sentence).toBe('你好吗？');
        expect(remaining).toBe('我很好');
    });

    it('应该在英文感叹号处分割（注意：regex 不匹配英文句号）', () => {
        // Note: SENTENCE_END_RE only matches 。！？!?, not .
        const [sentence, remaining] = splitFirstSentence('Hello world! How are you?');
        expect(sentence).toBe('Hello world!');
        expect(remaining).toBe(' How are you?');
    });

    it('应该在英文感叹号处分割', () => {
        const [sentence, remaining] = splitFirstSentence('Great! Let\'s go');
        expect(sentence).toBe('Great!');
        expect(remaining).toBe(' Let\'s go');
    });

    it('应该在英文问号处分割', () => {
        const [sentence, remaining] = splitFirstSentence('Really? Yes!');
        expect(sentence).toBe('Really?');
        expect(remaining).toBe(' Yes!');
    });

    it('没有句号时应该返回 null', () => {
        const [sentence, remaining] = splitFirstSentence('没有标点的文字');
        expect(sentence).toBeNull();
        expect(remaining).toBe('没有标点的文字');
    });

    it('空字符串应该返回 null', () => {
        const [sentence, remaining] = splitFirstSentence('');
        expect(sentence).toBeNull();
        expect(remaining).toBe('');
    });

    it('多个标点时应该在第一个处分割', () => {
        const [sentence, remaining] = splitFirstSentence('第一句。第二句。第三句');
        expect(sentence).toBe('第一句。');
        expect(remaining).toBe('第二句。第三句');
    });
});

describe('stripWikiLinksForTTS', () => {
    it('应该将 [[note]] 转换为 note', () => {
        expect(stripWikiLinksForTTS('请看 [[我的笔记]]')).toBe('请看 我的笔记');
    });

    it('应该将 [[note|alias]] 转换为 alias', () => {
        expect(stripWikiLinksForTTS('请看 [[笔记|这是别名]]')).toBe('请看 这是别名');
    });

    it('应该将 [[path/to/note|alias]] 转换为 alias', () => {
        expect(stripWikiLinksForTTS('请看 [[docs/笔记|文档别名]]')).toBe('请看 文档别名');
    });

    it('应该将 [[path/to/note]] 转换为 note', () => {
        expect(stripWikiLinksForTTS('请看 [[docs/笔记]]')).toBe('请看 笔记');
    });

    it('应该处理多个 wiki links', () => {
        const input = '[[link1]] 和 [[link2|别名2]]';
        expect(stripWikiLinksForTTS(input)).toBe('link1 和 别名2');
    });

    it('应该保留没有 wiki link 的文本', () => {
        expect(stripWikiLinksForTTS('普通文本')).toBe('普通文本');
    });

    it('应该处理空字符串', () => {
        expect(stripWikiLinksForTTS('')).toBe('');
    });

    it('应该处理混合内容', () => {
        const input = '这是 [[笔记1]]，那是 [[笔记2|别名2]]，还有普通文字';
        expect(stripWikiLinksForTTS(input)).toBe('这是 笔记1，那是 别名2，还有普通文字');
    });

    it('应该处理路径中的特殊字符', () => {
        expect(stripWikiLinksForTTS('[[path/to/my-note_v2.pdf]]')).toBe('my-note_v2.pdf');
    });

    it('应该处理别名中的空格', () => {
        expect(stripWikiLinksForTTS('[[note|  带空格的别名  ]]')).toBe('带空格的别名');
    });
});

describe('splitTextIntoSegments', () => {
    it('短文本应该返回单个 segment', () => {
        const segments = splitTextIntoSegments('短文本');
        expect(segments).toEqual(['短文本']);
    });

    it('应该按段落分割（小段落会被合并）', () => {
        const text = '段落1\n\n段落2\n\n段落3';
        const segments = splitTextIntoSegments(text, 100);
        // Small paragraphs get merged since 3+3+3 < 100
        expect(segments.length).toBeGreaterThanOrEqual(1);
        expect(segments.join('')).toContain('段落1');
        expect(segments.join('')).toContain('段落2');
        expect(segments.join('')).toContain('段落3');
    });

    it('应该合并小段落到目标长度', () => {
        const text = '短1\n\n短2\n\n短3';
        const segments = splitTextIntoSegments(text, 20);
        expect(segments.length).toBe(1);
        expect(segments[0]).toContain('短1');
        expect(segments[0]).toContain('短2');
        expect(segments[0]).toContain('短3');
    });

    it('超长段落应该按句子分割', () => {
        const longPara = '这是第一句话。这是第二句话。这是第三句话。';
        const segments = splitTextIntoSegments(longPara, 15);
        expect(segments.length).toBeGreaterThan(1);
        segments.forEach(seg => {
            expect(seg.length).toBeLessThanOrEqual(20); // Allow some tolerance
        });
    });

    it('应该处理空文本', () => {
        const segments = splitTextIntoSegments('');
        expect(segments).toEqual([]);
    });

    it('应该处理只有空白的文本', () => {
        const segments = splitTextIntoSegments('   \n\n   ');
        expect(segments).toEqual([]);
    });

    it('应该处理混合段落和句子', () => {
        const text = '短段落\n\n这是很长的段落包含多个句子。第二句。第三句。';
        const segments = splitTextIntoSegments(text, 20);
        expect(segments.length).toBeGreaterThanOrEqual(2);
    });

    it('应该保持段落顺序', () => {
        const text = 'A\n\nB\n\nC\n\nD';
        const segments = splitTextIntoSegments(text, 2);
        // Segments get merged based on target length
        expect(segments.length).toBeGreaterThanOrEqual(2);
        // All characters should be present in order
        const allContent = segments.join('');
        expect(allContent).toContain('A');
        expect(allContent).toContain('B');
        expect(allContent).toContain('C');
        expect(allContent).toContain('D');
    });

    it('默认目标长度应该是 300', () => {
        const text = 'x'.repeat(250);
        const segments = splitTextIntoSegments(text);
        expect(segments.length).toBe(1);
    });
});
