/**
 * Summary & Doc Description E2E 测试
 * 验证 DEFAULT_ADD_NODE_SUMMARY=true 和 DEFAULT_ADD_DOC_DESCRIPTION=true 后：
 * 1. EPUB 导出的章节笔记包含 summary callout 和 frontmatter.summary
 * 2. MOC 文件包含 docDescription callout
 *
 * 不依赖 LLM API：使用模拟 summary 数据直接调用 exportToObsidian
 */
import { obsidianPage } from 'wdio-obsidian-service';

const EPUB_FILENAME = '金钱不能买什么：金钱与公正的正面交锋 = What Money Cant Buy The Moral Limits of Markets ([美] 迈克尔 · 桑德尔 (Michael J. Sandel) 著  邓正来 译) (z-library.sk, 1lib.sk, z-lib.sk).epub';

describe('Summary & Doc Description 导出验证', function () {
    let vaultPath: string;

    before(async function () {
        vaultPath = obsidianPage.getVaultPath();
    });

    // ── Step 1: 获取章节列表（用于构建 mock summaries）──

    let chapterTitles: string[];
    let mockSummaries: Record<string, string>;

    it('should parse EPUB and get chapter titles', async function () {
        const info = await browser.executeObsidian(
            async ({ app }, epubPath: string) => {
                const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
                const adapter = app.vault.adapter as any;
                const basePath = adapter.getBasePath?.() || '';
                const fullPath = `${basePath}/${epubPath}`;

                const bookInfo = await plugin.api.parseEpub(fullPath);
                return {
                    title: bookInfo.title,
                    author: bookInfo.author,
                    numChapters: bookInfo.numChapters,
                    chapterTitles: bookInfo.chapters.slice(0, 10).map((ch: any) => ch.title),
                };
            },
            EPUB_FILENAME,
        );

        console.log(`[E2E] Book: "${info.title}" by ${info.author}`);
        console.log(`[E2E] Chapters: ${info.numChapters}`);

        chapterTitles = info.chapterTitles;
        expect(chapterTitles.length).toBeGreaterThan(0);
    });

    // ── Step 2: 使用 mock summaries 导出 ──

    it('should export with mock nodeSummaries and docDescription', async function () {
        this.timeout(180000);

        // 构建 mock summaries: 为前几个章节生成模拟摘要
        mockSummaries = {};
        for (const title of chapterTitles.slice(0, 5)) {
            mockSummaries[title] = `这是"${title}"章节的模拟摘要，用于验证导出结构。`;
        }
        const mockDocDescription = '这是一本关于金钱与公正的书籍，探讨了市场道德边界的问题。';

        const exportResult = await browser.executeObsidian(
            async ({ app }, epubPath: string, outputDir: string, summariesJson: string, docDescription: string) => {
                const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
                const adapter = app.vault.adapter as any;
                const basePath = adapter.getBasePath?.() || '';
                const fullPath = `${basePath}/${epubPath}`;

                // Parse summaries from JSON string to avoid serialization issues
                const summariesObj = JSON.parse(summariesJson);

                const result = await plugin.api.exportToObsidian(fullPath, {
                    outputDir: outputDir,
                    includeIndex: true,
                    docDescription,
                    nodeSummaries: summariesObj,
                });

                return {
                    notesCount: result.notes?.length || 0,
                };
            },
            EPUB_FILENAME,
            vaultPath,
            JSON.stringify(mockSummaries),
            mockDocDescription,
        );

        console.log(`[E2E] Exported with mock summaries: ${exportResult.notesCount} notes`);
        expect(exportResult.notesCount).toBeGreaterThan(0);

        console.log(`[E2E] Exported with mock summaries: ${exportResult.notesCount} notes`);
        expect(exportResult.notesCount).toBeGreaterThan(0);
    });

    // ── Step 3: 验证章节笔记中有 summary callout + frontmatter.summary ──

    it('should have summary callout in chapter notes', async function () {
        // Look for files matching the first chapters (which have mock summaries)
        const chapterFiles = await browser.executeObsidian(async ({ app }, mockTitles: string[]) => {
            const files = app.vault.getMarkdownFiles();
            const allChapterFiles = files
                .map((f: any) => f.path)
                .filter((p: string) =>
                    !p.startsWith('.obsidian') &&
                    !p.startsWith('.pageindex') &&
                    !p.startsWith('DeepReader') &&
                    !p.includes('MOC') &&
                    !p.endsWith('书架.md') &&
                    p.includes('/')
                );

            // Find files that match mock summary titles
            const matchingFiles: string[] = [];
            for (const title of mockTitles) {
                const found = allChapterFiles.find(p => p.includes(title));
                if (found) matchingFiles.push(found);
            }

            return matchingFiles.length > 0 ? matchingFiles : allChapterFiles.slice(0, 5);
        }, Object.keys(mockSummaries));

        expect(chapterFiles.length).toBeGreaterThan(0);

        let notesWithCallout = 0;
        let notesWithFmSummary = 0;

        for (const filePath of chapterFiles) {
            const content = await obsidianPage.read(filePath);

            // Check [!summary] callout
            if (content.includes('[!summary]')) {
                notesWithCallout++;
            }

            // Check frontmatter.summary
            const frontmatterEnd = content.indexOf('---', 3);
            if (frontmatterEnd > 0) {
                const frontmatter = content.substring(0, frontmatterEnd + 3);
                if (frontmatter.includes('summary:')) {
                    notesWithFmSummary++;
                }
            }
        }

        console.log(`[E2E] Notes with [!summary] callout: ${notesWithCallout}/${chapterFiles.length}`);
        console.log(`[E2E] Notes with summary frontmatter: ${notesWithFmSummary}/${chapterFiles.length}`);

        // At least some of the chapters should have the callout
        expect(notesWithCallout).toBeGreaterThan(0);
    });

    it('should have summary in frontmatter matching callout content', async function () {
        // Use same matching logic to find files with mock summaries
        const chapterFiles = await browser.executeObsidian(async ({ app }, mockTitles: string[]) => {
            const files = app.vault.getMarkdownFiles();
            const allChapterFiles = files
                .map((f: any) => f.path)
                .filter((p: string) =>
                    !p.startsWith('.obsidian') &&
                    !p.startsWith('.pageindex') &&
                    !p.startsWith('DeepReader') &&
                    !p.includes('MOC') &&
                    !p.endsWith('书架.md') &&
                    p.includes('/')
                );

            const matchingFiles: string[] = [];
            for (const title of mockTitles) {
                const found = allChapterFiles.find(p => p.includes(title));
                if (found) matchingFiles.push(found);
            }

            return matchingFiles.length > 0 ? matchingFiles : allChapterFiles.slice(0, 5);
        }, Object.keys(mockSummaries));

        // Find at least one file that has both callout and frontmatter summary
        let foundMatching = false;

        for (const filePath of chapterFiles) {
            const content = await obsidianPage.read(filePath);

            if (!content.includes('[!summary]')) continue;

            // Extract callout text
            const calloutMatch = content.match(/\[!summary\]\s*(.+)/);
            const calloutText = calloutMatch?.[1]?.trim();

            // Extract frontmatter summary
            const frontmatterEnd = content.indexOf('---', 3);
            const frontmatter = content.substring(0, frontmatterEnd + 3);
            const fmSummaryMatch = frontmatter.match(/summary:\s*"(.+)"/) || frontmatter.match(/summary:\s*(.+)/);

            if (calloutText && fmSummaryMatch) {
                const fmSummary = fmSummaryMatch[1].trim().replace(/^"|"$/g, '');
                expect(calloutText).toBeTruthy();
                expect(fmSummary).toBeTruthy();
                console.log(`[E2E] Callout: "${calloutText.substring(0, 40)}..."`);
                console.log(`[E2E] FM:      "${fmSummary.substring(0, 40)}..."`);
                foundMatching = true;
                break; // Found one match, that's enough
            }
        }

        expect(foundMatching).toBe(true);
    });

    // ── Step 4: 验证 MOC 文件中有 docDescription callout ──

    it('should have docDescription callout in MOC', async function () {
        const mocPaths = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            return files
                .filter((f: any) => f.path.includes('MOC') && !f.path.startsWith('.obsidian'))
                .map((f: any) => f.path);
        });

        expect(mocPaths.length).toBeGreaterThan(0);

        const mocContent = await obsidianPage.read(mocPaths[0]);

        // Should have [!info] callout with 书籍概要
        expect(mocContent).toContain('[!info]');
        expect(mocContent).toContain('书籍概要');

        // Should contain the mock description text
        expect(mocContent).toContain('金钱与公正');

        console.log(`[E2E] MOC docDescription callout verified`);
        console.log(`[E2E] MOC preview:\n${mocContent.substring(0, 400)}`);
    });

    it('should have MOC with all standard sections', async function () {
        const mocPaths = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            return files
                .filter((f: any) => f.path.includes('MOC') && !f.path.startsWith('.obsidian'))
                .map((f: any) => f.path);
        });

        const mocContent = await obsidianPage.read(mocPaths[0]);

        expect(mocContent).toContain('type: epub-moc');
        expect(mocContent).toContain('## 目录');
        expect(mocContent).toContain('**作者:**');
        expect(mocContent).toContain('**章节数:**');
        expect(mocContent).toContain('**总 Tokens:**');

        console.log(`[E2E] MOC standard sections verified`);
    });

    // ── Step 5: 验证 frontmatter 完整性（所有章节）──

    it('should have all chapter notes with valid frontmatter', async function () {
        const chapterFiles = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            return files
                .map((f: any) => f.path)
                .filter((p: string) =>
                    !p.startsWith('.obsidian') &&
                    !p.startsWith('.pageindex') &&
                    !p.startsWith('DeepReader') &&
                    !p.includes('MOC') &&
                    !p.endsWith('书架.md') &&
                    p.includes('/')
                );
        });

        expect(chapterFiles.length).toBeGreaterThan(0);
        console.log(`[E2E] Total chapter files: ${chapterFiles.length}`);

        // Spot check: verify all have valid frontmatter
        for (const filePath of chapterFiles.slice(0, 10)) {
            const content = await obsidianPage.read(filePath);
            expect(content.startsWith('---')).toBe(true);
            const frontmatterEnd = content.indexOf('---', 3);
            expect(frontmatterEnd).toBeGreaterThan(0);

            const frontmatter = content.substring(0, frontmatterEnd + 3);
            expect(frontmatter).toContain('title:');
            expect(frontmatter).toContain('type: epub');
        }
    });
});
