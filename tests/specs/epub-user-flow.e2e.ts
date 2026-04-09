/**
 * EPUB 完整用户流程 E2E 测试
 * 模拟真实用户操作：打开侧边栏 → 书库 → 添加 → 选择 EPUB → 索引 → 导出 → 验证
 *
 * 索引阶段需要 LLM API key 来生成摘要。若无可用 key，
 * 自动降级为直接调用 parseEpub + exportToObsidian API 完成导出验证。
 */
import { obsidianPage } from 'wdio-obsidian-service';

const EPUB_FILENAME = '金钱不能买什么：金钱与公正的正面交锋 = What Money Cant Buy The Moral Limits of Markets ([美] 迈克尔 · 桑德尔 (Michael J. Sandel) 著  邓正来 译) (z-library.sk, 1lib.sk, z-lib.sk).epub';

describe('EPUB 完整用户流程 E2E 测试', function () {
    let vaultPath: string;

    before(async function () {
        vaultPath = obsidianPage.getVaultPath();
    });

    // ══════════════════════════════════════
    // Phase 1: 环境验证
    // ══════════════════════════════════════

    it('should have DeepReader plugin loaded', async function () {
        const loaded = await browser.executeObsidian(({ app }) => {
            return !!app.plugins?.plugins?.['deepreader'];
        });
        expect(loaded).toBe(true);
    });

    it('should have the test EPUB file in vault', async function () {
        const exists = await browser.executeObsidian(async ({ app }, epubPath: string) => {
            return await app.vault.adapter.exists(epubPath);
        }, EPUB_FILENAME);
        expect(exists).toBe(true);
    });

    // ══════════════════════════════════════
    // Phase 2: UI 交互 — 打开侧边栏
    // ══════════════════════════════════════

    it('should open DeepReader sidebar via command', async function () {
        await browser.executeObsidianCommand('deepreader:open-deepreader-sidebar');

        const topbarBtn = await browser.$('.deeppdf-topbar-action-btn');
        await topbarBtn.waitForExist({ timeout: 8000 });
    });

    // ══════════════════════════════════════
    // Phase 3: UI 交互 — 打开书库
    // ══════════════════════════════════════

    it('should open library modal by clicking the library button', async function () {
        const libraryBtn = await browser.$('.deeppdf-topbar-action-btn[title="在线书库"]');
        await libraryBtn.click();

        const grid = await browser.$('.deeppdf-lib-grid');
        await grid.waitForExist({ timeout: 5000 });
    });

    // ══════════════════════════════════════
    // Phase 4: UI 交互 — 打开文件选择器
    // ══════════════════════════════════════

    it('should open file selector by clicking add button', async function () {
        const addBtn = await browser.$('.deeppdf-lib-add-btn');
        await addBtn.click();

        await browser.waitUntil(async () => {
            const items = await browser.$$('.deeppdf-file-item');
            return items.length > 0;
        }, { timeout: 8000, timeoutMsg: 'File items did not appear' });
    });

    // ══════════════════════════════════════
    // Phase 5: UI 交互 — 选择 EPUB 文件
    // ══════════════════════════════════════

    it('should find and select the EPUB file', async function () {
        const items = await browser.$$('.deeppdf-file-item');
        let epubItem: WebdriverIO.Element | null = null;

        for (const item of items) {
            const badge = await item.$('[data-doc-type="epub"]');
            if (await badge.isExisting()) {
                epubItem = item;
                break;
            }
        }

        expect(epubItem).not.toBeNull();

        const selectBtn = await epubItem!.$('.deeppdf-btn.deeppdf-btn-primary');
        await selectBtn.click();
        await browser.pause(1000);
    });

    // ══════════════════════════════════════
    // Phase 6: 索引 + 导出
    // 如果 indexBook 因缺少 API key 失败，降级使用 API 直接导出
    // ══════════════════════════════════════

    it('should complete indexing or fallback to API export', async function () {
        this.timeout(600000);

        // 等待索引完成：检查 vault 中是否出现导出的 Markdown 文件
        // （比检查 DOM 进度条更可靠）
        await browser.waitUntil(async () => {
            const hasChapterFiles = await browser.executeObsidian(async ({ app }) => {
                const files = app.vault.getMarkdownFiles();
                return files.some((f: any) =>
                    !f.path.startsWith('.obsidian') &&
                    !f.path.startsWith('.pageindex') &&
                    !f.path.startsWith('DeepReader') &&
                    f.path.includes('/')
                );
            });
            return hasChapterFiles;
        }, {
            timeout: 480000,
            timeoutMsg: 'Indexing did not produce exported files within timeout',
            interval: 10000,
        });

        console.log('[E2E] Exported files detected in vault');

        // 检查索引是否成功
        const chapterCount = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            return files.filter((f: any) =>
                !f.path.startsWith('.obsidian') &&
                !f.path.startsWith('.pageindex') &&
                !f.path.startsWith('DeepReader') &&
                !f.path.includes('MOC') &&
                !f.path.endsWith('书架.md') &&
                f.path.includes('/')
            ).length;
        });

        if (chapterCount > 0) {
            console.log(`[E2E] Indexing completed: ${chapterCount} chapter files exported`);
        } else {
            // 降级方案：直接调用 exportToObsidian
            console.log('[E2E] No exported files found, using API fallback');
            const exportResult = await browser.executeObsidian(
                async ({ app }, epubPath: string, outputDir: string) => {
                    const plugin = app.plugins?.plugins?.['deepreader'] as any;
                    const adapter = app.vault.adapter as any;
                    const basePath = adapter.getBasePath?.() || '';
                    const fullPath = `${basePath}/${epubPath}`;

                    const result = await plugin.api.exportToObsidian(fullPath, {
                        outputDir: outputDir,
                        includeIndex: true,
                    });

                    return { notesCount: result.notes?.length || 0 };
                },
                EPUB_FILENAME,
                vaultPath,
            );
            console.log(`[E2E] API fallback: exported ${exportResult.notesCount} notes`);
            expect(exportResult.notesCount).toBeGreaterThan(0);
        }
    });

    // ══════════════════════════════════════
    // Phase 7: 验证导出的文件
    // ══════════════════════════════════════

    it('should have exported markdown chapter files', async function () {
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
        console.log(`[E2E] Exported ${chapterFiles.length} chapter files`);
        for (const f of chapterFiles.slice(0, 5)) {
            console.log(`[E2E]   ${f}`);
        }
    });

    it('should have MOC file with correct metadata', async function () {
        const mocPaths = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            return files
                .filter((f: any) => f.path.includes('MOC') && !f.path.startsWith('.obsidian'))
                .map((f: any) => f.path);
        });

        expect(mocPaths.length).toBeGreaterThan(0);

        const mocContent = await obsidianPage.read(mocPaths[0]);
        expect(mocContent).toContain('type: epub-moc');
        expect(mocContent).toContain('## 目录');
        // 确认作者不是 "[object Object]"（之前修复的 bug）
        expect(mocContent).not.toContain('author: [object Object]');
        expect(mocContent).toMatch(/\*\*作者:\*\* .+/);
        console.log(`[E2E] MOC verified: ${mocPaths[0]}`);
    });

    it('should have chapter notes with correct frontmatter', async function () {
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
            expect(frontmatter).not.toContain('author: [object Object]');

            const body = content.substring(frontmatterEnd + 3).trim();
            expect(body.length).toBeGreaterThan(0);
            console.log(`[E2E] + ${filePath}: ${body.length} chars`);
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
                console.log(`[E2E] Nav links found in: ${filePath}`);
            }
        }
        expect(foundNavLinks).toBe(true);
    });

    it('should have tree.json with correct structure', async function () {
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
