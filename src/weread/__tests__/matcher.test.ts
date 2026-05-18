import { describe, it, expect } from 'vitest';
import { normalizeTitle, normalizeAuthor, matchBooks } from '../sync/matcher';
import type { WereadBookSummary, IndexedBook } from '../sync/matcher';

describe('normalizeTitle', () => {
    it('应移除空格并转小写', () => {
        expect(normalizeTitle('Deep Learning')).toBe('deeplearning');
    });

    it('应移除中文括号内容', () => {
        expect(normalizeTitle('深度学习（中文版）')).toBe('深度学习');
    });

    it('应移除英文括号内容', () => {
        expect(normalizeTitle('Deep Learning (3rd Edition)')).toBe('deeplearning');
    });

    it('应移除中英文标点', () => {
        expect(normalizeTitle('AI：未来，已来！')).toBe('ai未来已来');
    });

    it('应移除【】括号内容', () => {
        expect(normalizeTitle('设计模式【精简版】')).toBe('设计模式');
    });

    it('应处理空字符串', () => {
        expect(normalizeTitle('')).toBe('');
    });
});

describe('normalizeAuthor', () => {
    it('应移除国家前缀 [美]', () => {
        expect(normalizeAuthor('[美] Ian Goodfellow')).toBe('iangoodfellow');
    });

    it('应移除国家前缀 【英】', () => {
        expect(normalizeAuthor('【英】Alan Turing')).toBe('alanturing');
    });

    it('应处理中文作者名', () => {
        expect(normalizeAuthor('李航')).toBe('李航');
    });

    it('应移除空格并转小写', () => {
        expect(normalizeAuthor('Ian Goodfellow')).toBe('iangoodfellow');
    });

    it('应移除中文括号内容', () => {
        expect(normalizeAuthor('周志华（译）')).toBe('周志华');
    });

    it('应处理空字符串', () => {
        expect(normalizeAuthor('')).toBe('');
    });
});

describe('matchBooks', () => {
    const makeWeread = (bookId: string, title: string, author: string): WereadBookSummary => ({ bookId, title, author });
    const makeIndexed = (bookId: string, title: string, author: string): IndexedBook => ({ bookId, title, author });

    it('精确匹配：相同标题 + 相同作者', () => {
        const wereadBooks = [makeWeread('wr1', '深度学习', 'Ian Goodfellow')];
        const indexedBooks = [makeIndexed('dr1', '深度学习', 'Ian Goodfellow')];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            wereadBookId: 'wr1',
            wereadTitle: '深度学习',
            deepReaderBookId: 'dr1',
            deepReaderTitle: '深度学习',
            matched: true,
        });
    });

    it('大小写不敏感匹配', () => {
        const wereadBooks = [makeWeread('wr1', 'deep learning', 'ian goodfellow')];
        const indexedBooks = [makeIndexed('dr1', 'Deep Learning', 'Ian Goodfellow')];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0].matched).toBe(true);
    });

    it('带括号标题匹配："深度学习（中文版）" 匹配 "深度学习"', () => {
        const wereadBooks = [makeWeread('wr1', '深度学习（中文版）', 'Ian Goodfellow')];
        const indexedBooks = [makeIndexed('dr1', '深度学习', 'Ian Goodfellow')];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0].matched).toBe(true);
    });

    it('带前缀作者匹配："[美] Ian Goodfellow" 匹配 "Ian Goodfellow"', () => {
        const wereadBooks = [makeWeread('wr1', 'Deep Learning', '[美] Ian Goodfellow')];
        const indexedBooks = [makeIndexed('dr1', 'Deep Learning', 'Ian Goodfellow')];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0].matched).toBe(true);
    });

    it('不同作者：相同标题，不同作者 → 不匹配', () => {
        const wereadBooks = [makeWeread('wr1', 'Deep Learning', 'Ian Goodfellow')];
        const indexedBooks = [makeIndexed('dr1', 'Deep Learning', '周志华')];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0].matched).toBe(false);
    });

    it('不同标题：不同标题，相同作者 → 不匹配', () => {
        const wereadBooks = [makeWeread('wr1', 'Deep Learning', 'Ian Goodfellow')];
        const indexedBooks = [makeIndexed('dr1', 'Machine Learning', 'Ian Goodfellow')];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0].matched).toBe(false);
    });

    it('缺少作者：标题匹配，一侧作者为空 → 匹配（宽松）', () => {
        const wereadBooks = [makeWeread('wr1', '深度学习', '')];
        const indexedBooks = [makeIndexed('dr1', '深度学习', 'Ian Goodfellow')];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0].matched).toBe(true);
    });

    it('多次匹配：相同标题不同作者 → 选择第一个匹配', () => {
        const wereadBooks = [makeWeread('wr1', '深度学习', 'Ian Goodfellow')];
        const indexedBooks = [
            makeIndexed('dr1', '深度学习', '周志华'),
            makeIndexed('dr2', '深度学习', 'Ian Goodfellow'),
        ];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(1);
        expect(results[0].matched).toBe(true);
        // 宽松匹配下标题匹配 + 任一作者名重合，应选第一个标题匹配且作者有重叠的
        // 这里 dr2 的作者匹配，但 dr1 的标题匹配但作者不匹配
        // 因为只有一个 wereadBook，标题都能匹配但只有 dr2 作者匹配
        expect(results[0].deepReaderBookId).toBe('dr2');
    });

    it('无索引书籍 → 全部不匹配', () => {
        const wereadBooks = [
            makeWeread('wr1', '深度学习', 'Ian Goodfellow'),
            makeWeread('wr2', '机器学习', '周志华'),
        ];
        const indexedBooks: IndexedBook[] = [];

        const results = matchBooks(wereadBooks, indexedBooks);

        expect(results).toHaveLength(2);
        expect(results.every(r => r.matched === false)).toBe(true);
        expect(results[0].deepReaderBookId).toBe('');
        expect(results[0].deepReaderTitle).toBe('');
    });
});
