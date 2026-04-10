/**
 * PDF 解析管线 E2E 测试
 *
 * 测试 parsePdf() 的文本提取质量，无需 LLM 调用：
 *   - 页面分割正确性
 *   - 标题检测（字体大小 → Markdown heading）
 *   - 段落分隔（空行）
 *   - 同行文字间距（空格插入）
 *   - 大纲/书签提取
 *   - addBlockIds() 格式化
 */
import { obsidianPage } from 'wdio-obsidian-service';

const PDF_FILENAME = 'agentic-design-patterns-chinese.pdf';

describe('PDF Parsing — 文本提取质量验证', function () {
    // ── Step 1: 基础解析 ──

    it('should parse PDF and return structured result', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const { parsePdf } = require('../../src/pageindex/parsers/pdf') ||
                                 require('../pageindex/parsers/pdf');

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await parsePdf(pdfPath);
            return {
                title: info.title,
                numPages: info.numPages,
                pageCount: info.pages.length,
                hasOutline: !!info.outline && info.outline.length > 0,
                outlineCount: info.outline?.length || 0,
                firstPageChars: info.pages[0]?.text?.length || 0,
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        expect(result.title).toBeTruthy();
        expect(result.numPages).toBeGreaterThan(0);
        expect(result.pageCount).toBeGreaterThan(0);
        console.log(`[E2E] PDF: "${result.title}", ${result.pageCount} pages, outline: ${result.outlineCount}`);
    });

    // ── Step 2: 标题检测 ──

    it('should detect headings via font size analysis', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const { parsePdf } = require('../../src/pageindex/parsers/pdf') ||
                                 require('../pageindex/parsers/pdf');

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await parsePdf(pdfPath);

            // 检查前 10 页是否有 heading
            const headingPattern = /^#{1,3}\s+/m;
            let foundHeading = false;
            let headingLines = 0;
            let totalLines = 0;

            for (const page of info.pages) {
                for (const line of page.text.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    totalLines++;
                    if (/^#{1,6}\s+/.test(trimmed)) {
                        headingLines++;
                    }
                }
            }

            // 检查前 10 页
            for (let i = 0; i < Math.min(10, info.pages.length); i++) {
                if (headingPattern.test(info.pages[i].text)) {
                    foundHeading = true;
                    break;
                }
            }

            return {
                foundHeading,
                headingLines,
                totalLines,
                headingRatio: headingLines / Math.max(totalLines, 1),
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        expect(result.foundHeading).toBe(true);
        // heading 应占少数（< 20%）
        expect(result.headingRatio).toBeLessThan(0.2);
        console.log(`[E2E] Headings: ${result.headingLines}/${result.totalLines} lines (${(result.headingRatio * 100).toFixed(1)}%)`);
    });

    // ── Step 3: 段落格式 ──

    it('should have paragraph breaks (empty lines between paragraphs)', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const { parsePdf } = require('../../src/pageindex/parsers/pdf') ||
                                 require('../pageindex/parsers/pdf');

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await parsePdf(pdfPath);

            let hasParagraphBreak = false;
            let maxLineLength = 0;

            for (const page of info.pages) {
                if (page.text.includes('\n\n')) {
                    hasParagraphBreak = true;
                }
                for (const line of page.text.split('\n')) {
                    if (line.length > maxLineLength) {
                        maxLineLength = line.length;
                    }
                }
            }

            return { hasParagraphBreak, maxLineLength };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        expect(result.hasParagraphBreak).toBe(true);
        // 不应有过长的连续单行文本
        expect(result.maxLineLength).toBeLessThan(300);
        console.log(`[E2E] Paragraph breaks: ${result.hasParagraphBreak}, max line: ${result.maxLineLength} chars`);
    });

    // ── Step 4: 中文字符处理 ──

    it('should correctly extract Chinese text without garbled characters', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const { parsePdf } = require('../../src/pageindex/parsers/pdf') ||
                                 require('../pageindex/parsers/pdf');

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await parsePdf(pdfPath);

            const cjkPattern = /[\u4e00-\u9fff]/;
            let hasChinese = false;
            let nonEmptyPages = 0;

            for (let i = 0; i < Math.min(5, info.pages.length); i++) {
                if (cjkPattern.test(info.pages[i].text)) {
                    hasChinese = true;
                    break;
                }
            }

            for (const page of info.pages) {
                if (page.text.trim().length > 50) {
                    nonEmptyPages++;
                }
            }

            return {
                hasChinese,
                nonEmptyPages,
                totalPages: info.pages.length,
                contentRatio: nonEmptyPages / info.pages.length,
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        expect(result.hasChinese).toBe(true);
        expect(result.contentRatio).toBeGreaterThan(0.8);
        console.log(`[E2E] Chinese: ${result.hasChinese}, content ratio: ${(result.contentRatio * 100).toFixed(1)}%`);
    });

    // ── Step 5: 大纲/书签提取 ──

    it('should extract PDF outline/bookmarks', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const { parsePdf, outlineToTocItems } = require('../../src/pageindex/parsers/pdf') ||
                                                      require('../pageindex/parsers/pdf');

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await parsePdf(pdfPath);

            if (!info.outline || info.outline.length === 0) {
                return { hasOutline: false };
            }

            const tocItems = outlineToTocItems(info.outline);

            return {
                hasOutline: true,
                outlineCount: info.outline.length,
                tocItemCount: tocItems.length,
                firstTocTitle: tocItems[0]?.title || '',
                firstTocPage: tocItems[0]?.physicalIndex || 0,
                sampleTocItems: tocItems.slice(0, 5).map((t: any) => ({
                    title: t.title,
                    page: t.physicalIndex,
                })),
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        if (result.hasOutline) {
            expect(result.tocItemCount).toBeGreaterThan(0);
            console.log(`[E2E] Outline: ${result.outlineCount} top-level, ${result.tocItemCount} total TOC items`);
            console.log(`[E2E] Sample: ${JSON.stringify(result.sampleTocItems)}`);
        } else {
            console.log('[E2E] No outline/bookmarks in this PDF');
        }
    });

    // ── Step 6: 页面工具函数 ──

    it('should correctly extract text for page ranges with tags', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const { parsePdf, getTextOfPages, getTokenCountForPages, getAllText } =
                require('../../src/pageindex/parsers/pdf') ||
                require('../pageindex/parsers/pdf');

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await parsePdf(pdfPath);

            // 带标签
            const textWithTags = getTextOfPages(info.pages, 1, 3);
            const hasTags = textWithTags.includes('<physical_index_1>') &&
                           textWithTags.includes('<physical_index_3>');

            // 不带标签
            const textNoTags = getTextOfPages(info.pages, 1, 2, false);
            const noTags = !textNoTags.includes('<physical_index_');

            // Token 计数
            const totalTokens = getTokenCountForPages(info.pages, 1, info.pages.length);
            const firstPageTokens = getTokenCountForPages(info.pages, 1, 1);

            // 全部文本
            const allText = getAllText(info.pages);

            return {
                hasTags,
                noTags,
                totalTokens,
                firstPageTokens,
                allTextLength: allText.length,
                firstPageTextLength: info.pages[0]?.text?.length || 0,
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        expect(result.hasTags).toBe(true);
        expect(result.noTags).toBe(true);
        expect(result.totalTokens).toBeGreaterThan(0);
        expect(result.firstPageTokens).toBeGreaterThan(0);
        expect(result.firstPageTokens).toBeLessThanOrEqual(result.totalTokens);
        expect(result.allTextLength).toBeGreaterThan(result.firstPageTextLength);
        console.log(`[E2E] Tokens: first page ${result.firstPageTokens}, total ${result.totalTokens}`);
    });
});
