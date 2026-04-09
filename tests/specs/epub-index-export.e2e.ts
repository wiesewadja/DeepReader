import { obsidianPage } from 'wdio-obsidian-service';

const EPUB_FILENAME = '金钱不能买什么：金钱与公正的正面交锋 = What Money Cant Buy The Moral Limits of Markets ([美] 迈克尔 · 桑德尔 (Michael J. Sandel) 著  邓正来 译) (z-library.sk, 1lib.sk, z-lib.sk).epub';

describe('EPUB Index & Export to Obsidian Vault', function () {
    let vaultPath: string;

    before(async function () {
        vaultPath = obsidianPage.getVaultPath();
    });

    // ── Step 1: 基础环境验证 ──

    it('should have DeepReader plugin loaded', async function () {
        const pluginLoaded = await browser.executeObsidian(({ app }) => {
            return !!app.plugins?.plugins?.['deepreader'];
        });
        expect(pluginLoaded).toBe(true);
    });

    it('should have the test EPUB file in vault', async function () {
        const exists = await browser.executeObsidian(async ({ app }, epubPath: string) => {
            return await app.vault.adapter.exists(epubPath);
        }, EPUB_FILENAME);
        expect(exists).toBe(true);
    });

    it('should have plugin API exposed', async function () {
        const hasApi = await browser.executeObsidian(({ app }) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            return !!(plugin?.api?.parseEpub && plugin?.api?.exportToObsidian && plugin?.api?.indexBook);
        });
        expect(hasApi).toBe(true);
    });

    // ── Step 2: EPUB 解析 ──

    it('should parse EPUB and extract book metadata', async function () {
        const bookInfo = await browser.executeObsidian(async ({ app }, epubPath: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fullPath = `${basePath}/${epubPath}`;

            const info = await plugin.api.parseEpub(fullPath);
            return {
                title: info.title,
                author: info.author,
                numChapters: info.numChapters,
                hasCover: !!info.coverImage,
                firstChapterTitle: info.chapters?.[0]?.title,
                lastChapterTitle: info.chapters?.[info.chapters.length - 1]?.title,
            };
        }, EPUB_FILENAME);

        console.log(`[E2E] EPUB: "${bookInfo.title}" by ${bookInfo.author}`);
        console.log(`[E2E] Chapters: ${bookInfo.numChapters}`);

        expect(bookInfo.title).toBeTruthy();
        // Bug fix verification: author should NOT be "[object Object]"
        expect(bookInfo.author).not.toBe('[object Object]');
        expect(typeof bookInfo.author).toBe('string');
        expect(bookInfo.author.length).toBeGreaterThan(0);
        expect(bookInfo.numChapters).toBeGreaterThan(0);
    });

    it('should parse EPUB chapters with content', async function () {
        const chapters = await browser.executeObsidian(async ({ app }, epubPath: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fullPath = `${basePath}/${epubPath}`;

            const info = await plugin.api.parseEpub(fullPath);
            // Return chapters 2-6 (skip potential empty cover page)
            return info.chapters.slice(1, 6).map((ch: any) => ({
                title: ch.title,
                contentLength: ch.content?.length || 0,
                tokenCount: ch.tokenCount,
                hasBlockMap: !!ch.blockMap,
                blocksCount: ch.blocks?.length || 0,
            }));
        }, EPUB_FILENAME);

        console.log('[E2E] Chapter details:', JSON.stringify(chapters, null, 2));

        let nonEmptyCount = 0;
        for (const ch of chapters) {
            if (ch.contentLength > 0) nonEmptyCount++;
            console.log(`[E2E] "${ch.title}": ${ch.contentLength} chars, ${ch.tokenCount} tokens, ${ch.blocksCount} blocks`);
        }
        // Most chapters should have content
        expect(nonEmptyCount).toBeGreaterThan(chapters.length / 2);
    });

    // ── Step 3: 导出为 Obsidian 笔记 ──

    it('should export EPUB to Obsidian vault with markdown files', async function () {
        this.timeout(180000);

        const exportResult = await browser.executeObsidian(async ({ app }, epubPath: string, outputDir: string) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fullPath = `${basePath}/${epubPath}`;

            const result = await plugin.api.exportToObsidian(fullPath, {
                outputDir: outputDir,
                includeIndex: true,
            });

            return {
                mocPath: result.mocPath,
                notesCount: result.notes?.length || 0,
                sampleNotePaths: result.notes?.slice(0, 3).map((n: any) => n.filePath) || [],
            };
        }, EPUB_FILENAME, vaultPath);

        console.log(`[E2E] Export: ${exportResult.notesCount} notes, MOC: ${exportResult.mocPath}`);
        expect(exportResult.notesCount).toBeGreaterThan(0);
    });

    // ── Step 4: 验证导出的文件内容 ──

    it('should verify MOC file with correct author', async function () {
        const mocPath = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            const mocFiles = files.filter((f: any) =>
                f.path.includes('MOC') && !f.path.startsWith('.obsidian')
            );
            return mocFiles.map((f: any) => f.path);
        });

        expect(mocPath.length).toBeGreaterThan(0);

        const mocContent = await obsidianPage.read(mocPath[0]);
        expect(mocContent).toContain('type: epub-moc');
        expect(mocContent).toContain('## 目录');

        // Verify author is NOT "[object Object]"
        expect(mocContent).not.toContain('author: [object Object]');
        expect(mocContent).toMatch(/\*\*作者:\*\* .+/);

        // Should have links to chapters
        expect(mocContent).toMatch(/\[\[.*\]\]/);
        console.log(`[E2E] MOC OK: author is correct`);
    });

    it('should verify chapter notes have correct frontmatter', async function () {
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
                )
                .slice(0, 5);
        });

        expect(chapterFiles.length).toBeGreaterThan(0);

        for (const filePath of chapterFiles) {
            const content = await obsidianPage.read(filePath);
            expect(content.startsWith('---')).toBe(true);

            const frontmatterEnd = content.indexOf('---', 3);
            expect(frontmatterEnd).toBeGreaterThan(0);

            const frontmatter = content.substring(0, frontmatterEnd + 3);
            expect(frontmatter).toContain('title:');
            expect(frontmatter).toContain('type: epub');
            expect(frontmatter).toContain('chapter_index:');

            // author should NOT be [object Object]
            expect(frontmatter).not.toContain('author: [object Object]');

            const body = content.substring(frontmatterEnd + 3).trim();
            expect(body.length).toBeGreaterThan(0);
            console.log(`[E2E] ✓ ${filePath}: ${body.length} chars`);
        }
    });

    it('should have navigation links between chapters', async function () {
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
                )
                .slice(1, 4);
        });

        let foundNavLinks = false;
        for (const filePath of chapterFiles) {
            const content = await obsidianPage.read(filePath);
            if (content.includes('上一章') || content.includes('下一章')) {
                foundNavLinks = true;
                console.log(`[E2E] Nav links in: ${filePath}`);
            }
        }
        expect(foundNavLinks).toBe(true);
    });

    it('should verify tree.json structure', async function () {
        const treeFiles = await browser.executeObsidian(async ({ app }) => {
            const allFiles = app.vault.getFiles();
            return allFiles
                .filter((f: any) => f.path.endsWith('tree.json'))
                .map((f: any) => f.path);
        });

        expect(treeFiles.length).toBeGreaterThan(0);

        const treeContent = await obsidianPage.read(treeFiles[0]);
        const tree = JSON.parse(treeContent);

        expect(tree.title).toBeTruthy();
        expect(tree.type).toBe('epub');
        expect(Array.isArray(tree.structure)).toBe(true);
        expect(tree.structure.length).toBeGreaterThan(0);
        console.log(`[E2E] tree.json: ${tree.title}, ${tree.structure.length} nodes`);
    });

});

