import { describe, it, expect } from 'vitest';
import {
    stripMarkdown,
    stripWikiLinks,
    stripBlockIds,
    compressWhitespace,
    preprocessForTTS,
} from '../../../src/services/tts/tts-text-preprocessor.js';

describe('tts-text-preprocessor', () => {
    describe('stripMarkdown', () => {
        it('去除标题标记', () => {
            expect(stripMarkdown('# 一级标题')).toBe('一级标题');
            expect(stripMarkdown('## 二级标题')).toBe('二级标题');
            expect(stripMarkdown('### 三级标题')).toBe('三级标题');
        });

        it('去除加粗和斜体', () => {
            expect(stripMarkdown('**加粗**')).toBe('加粗');
            expect(stripMarkdown('*斜体*')).toBe('斜体');
            expect(stripMarkdown('***加粗斜体***')).toBe('加粗斜体');
        });

        it('去除链接保留文本', () => {
            expect(stripMarkdown('[链接文本](http://example.com)')).toBe('链接文本');
        });

        it('去除图片保留 alt', () => {
            expect(stripMarkdown('![图片描述](image.png)')).toBe('图片描述');
        });

        it('去除代码块和行内代码', () => {
            expect(stripMarkdown('`code`')).toBe('code');
            expect(stripMarkdown('```\ncode block\n```')).toBe('');
        });

        it('去除引用标记', () => {
            expect(stripMarkdown('> 引用文本')).toBe('引用文本');
        });

        it('去除删除线', () => {
            expect(stripMarkdown('~~删除~~')).toBe('删除');
        });

        it('去除水平线', () => {
            expect(stripMarkdown('---')).toBe('');
            expect(stripMarkdown('***')).toBe('');
        });
    });

    describe('stripWikiLinks', () => {
        it('无别名 wiki-link', () => {
            expect(stripWikiLinks('[[note]]')).toBe('note');
        });

        it('有别名 wiki-link', () => {
            expect(stripWikiLinks('[[note|显示名]]')).toBe('显示名');
        });

        it('路径 wiki-link', () => {
            expect(stripWikiLinks('[[path/to/note|别名]]')).toBe('别名');
        });

        it('路径无别名', () => {
            expect(stripWikiLinks('[[path/to/note]]')).toBe('note');
        });

        it('多个 wiki-link', () => {
            expect(stripWikiLinks('[[a]] 和 [[b|B]]')).toBe('a 和 B');
        });
    });

    describe('stripBlockIds', () => {
        it('去除行尾 block id', () => {
            expect(stripBlockIds('文本 ^block-id')).toBe('文本');
        });

        it('去除无空格 block id', () => {
            expect(stripBlockIds('文本^block-id')).toBe('文本');
        });

        it('保留多行中的 block id', () => {
            expect(stripBlockIds('第一行 ^id1\n第二行 ^id2')).toBe('第一行\n第二行');
        });
    });

    describe('compressWhitespace', () => {
        it('压缩多个空行', () => {
            expect(compressWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
        });

        it('去除行尾空白', () => {
            expect(compressWhitespace('a   \nb   ')).toBe('a\nb');
        });

        it('去除首尾空白', () => {
            expect(compressWhitespace('  text  ')).toBe('text');
        });
    });

    describe('preprocessForTTS', () => {
        it('完整预处理', () => {
            const input = `# 标题

这是 **加粗** 文本，包含 [[wiki-link|别名]] 和 ^block-id

---

更多内容`;
            const result = preprocessForTTS(input);
            expect(result).toContain('标题');
            expect(result).toContain('加粗');
            expect(result).toContain('别名');
            expect(result).not.toContain('#');
            expect(result).not.toContain('**');
            expect(result).not.toContain('[[');
            expect(result).not.toContain('^block-id');
            expect(result).not.toContain('---');
        });
    });
});
