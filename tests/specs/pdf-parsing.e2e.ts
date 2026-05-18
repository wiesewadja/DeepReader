/**
 * PDF 解析管线 E2E 测试
 *
 * 测试 parsePdf() 的文本提取质量，无需 LLM 调用：
 *   - 页面分割正确性
 *   - 标题检测（MinerU JSON → Markdown heading）
 *   - 段落分隔（空行）
 *   - 中文字符处理
 *   - 大纲提取（Mineru 返回 TreeNode[]）
 *   - 页面工具函数
 */
import { obsidianPage } from 'wdio-obsidian-service';

const PDF_FILENAME = "69fe2a55b93bb0732b1fe33c_The-Founders-Playbook-05062026_v3 (1).pdf";

describe('PDF Parsing — MinerU 文本提取质量验证', function () {
    before(async function () {
        const MINERU_TOKEN = process.env.MINERU_TOKEN;
        if (!MINERU_TOKEN) {
            console.log('[E2E] MINERU_TOKEN not set, skipping MinerU PDF tests');
            this.skip();
        }

        // 配置 MinerU Token
        await browser.executeObsidian(async ({ app }, token: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (plugin) {
                if (!plugin.settings.providers) plugin.settings.providers = {};
                if (!plugin.settings.providers.mineru) plugin.settings.providers.mineru = {};
                plugin.settings.providers.mineru.apiKey = token;
                await plugin.saveSettings();
            }
        }, MINERU_TOKEN);
    });

    // ── Step 1: 基础解析 ──

    it('should parse PDF and return structured result', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await plugin.api.parsePdf(pdfPath);
            return {
                title: info.title,
                totalPages: info.totalPages,
                pageCount: info.pages.length,
                hasOutline: !!info.outline && info.outline.length > 0,
                outlineCount: info.outline?.length || 0,
                firstPageChars: info.pages[0]?.text?.length || 0,
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        expect(result.title).toBeTruthy();
        expect(result.totalPages).toBeGreaterThan(0);
        expect(result.pageCount).toBeGreaterThan(0);
        console.log(`[E2E] PDF: "${result.title}", ${result.pageCount} pages, outline: ${result.outlineCount}`);
    });

    // ── Step 2: 标题检测 ──

    it('should detect headings from MinerU output', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await plugin.api.parsePdf(pdfPath);

            // MinerU produces Markdown headings (# ## ###)
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
        console.log(`[E2E] Headings: ${result.headingLines}/${result.totalLines} lines (${(result.headingRatio * 100).toFixed(1)}%)`);
    });

    // ── Step 3: 段落格式 ──

    it('should have paragraph breaks (empty lines between paragraphs)', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await plugin.api.parsePdf(pdfPath);

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
        expect(result.maxLineLength).toBeLessThan(300);
        console.log(`[E2E] Paragraph breaks: ${result.hasParagraphBreak}, max line: ${result.maxLineLength} chars`);
    });

    // ── Step 4: 中文字符处理 ──

    it('should correctly extract Chinese text without garbled characters', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await plugin.api.parsePdf(pdfPath);

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

    // ── Step 5: 大纲提取（Mineru 返回 TreeNode[]） ──

    it('should extract PDF outline as TreeNode[]', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await plugin.api.parsePdf(pdfPath);

            if (!info.outline || info.outline.length === 0) {
                return { hasOutline: false };
            }

            // Mineru returns TreeNode[] with title, startIndex, nodes
            const flattenNodes = (nodes: any[]): any[] => {
                const result: any[] = [];
                for (const node of nodes) {
                    result.push({ title: node.title, pageIndex: node.startIndex });
                    if (node.nodes?.length) {
                        result.push(...flattenNodes(node.nodes));
                    }
                }
                return result;
            };

            const allNodes = flattenNodes(info.outline);

            return {
                hasOutline: true,
                topLevelCount: info.outline.length,
                totalCount: allNodes.length,
                firstTitle: allNodes[0]?.title || '',
                firstPageIndex: allNodes[0]?.pageIndex || 0,
                sampleItems: allNodes.slice(0, 5),
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        if (result.hasOutline) {
            expect(result.totalCount).toBeGreaterThan(0);
            console.log(`[E2E] Outline: ${result.topLevelCount} top-level, ${result.totalCount} total nodes`);
            console.log(`[E2E] Sample: ${JSON.stringify(result.sampleItems)}`);
        } else {
            console.log('[E2E] No outline in this PDF');
        }
    });

    // ── Step 6: 页面数据验证 ──

    it('should have valid page data with pageNumber, text, and tokenCount', async function () {
        const result = await browser.executeObsidian(async ({ app }, pdfName: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const pdfPath = `${basePath}/${pdfName}`;

            const info = await plugin.api.parsePdf(pdfPath);

            // Helper: getTextOfPages equivalent
            const getTextOfPages = (pages: any[], start: number, end: number, addTags: boolean) => {
                let text = '';
                for (let i = start - 1; i < Math.min(end, pages.length); i++) {
                    const pageText = pages[i]?.text || '';
                    if (addTags) {
                        text += `<physical_index_${i + 1}>\n${pageText}\n</physical_index_${i + 1}>\n`;
                    } else {
                        text += pageText;
                    }
                }
                return text;
            };

            // Helper: getTokenCountForPages equivalent
            const getTokenCountForPages = (pages: any[], start: number, end: number) => {
                let total = 0;
                for (let i = start - 1; i < Math.min(end, pages.length); i++) {
                    total += pages[i]?.tokenCount || 0;
                }
                return total;
            };

            // Helper: getAllText equivalent
            const getAllText = (pages: any[]) => pages.map(p => p.text).join('\n');

            const pages = info.pages;

            // Validate page structure
            const validPages = pages.filter(p =>
                typeof p.pageNumber === 'number' &&
                typeof p.text === 'string' &&
                typeof p.tokenCount === 'number'
            );

            // Test getTextOfPages
            const textWithTags = getTextOfPages(pages, 1, 3, true);
            const hasTags = textWithTags.includes('<physical_index_1>') &&
                           textWithTags.includes('<physical_index_3>');

            const textNoTags = getTextOfPages(pages, 1, 2, false);
            const noTags = !textNoTags.includes('<physical_index_');

            // Test token counts
            const totalTokens = getTokenCountForPages(pages, 1, pages.length);
            const firstPageTokens = getTokenCountForPages(pages, 1, 1);

            // Test getAllText
            const allText = getAllText(pages);

            return {
                totalPages: pages.length,
                validPageCount: validPages.length,
                hasTags,
                noTags,
                totalTokens,
                firstPageTokens,
                allTextLength: allText.length,
                firstPageTextLength: pages[0]?.text?.length || 0,
            };
        }, PDF_FILENAME);

        expect(result.error).toBeUndefined();
        expect(result.totalPages).toBe(result.validPageCount);
        expect(result.hasTags).toBe(true);
        expect(result.noTags).toBe(true);
        expect(result.totalTokens).toBeGreaterThan(0);
        expect(result.firstPageTokens).toBeGreaterThan(0);
        expect(result.firstPageTokens).toBeLessThanOrEqual(result.totalTokens);
        expect(result.allTextLength).toBeGreaterThan(result.firstPageTextLength);
        console.log(`[E2E] Tokens: first page ${result.firstPageTokens}, total ${result.totalTokens}`);
    });
});
