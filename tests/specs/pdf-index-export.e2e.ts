/**
 * PDF Index & Export E2E 测试
 * 完整流程：验证插件 → 索引 PDF → 验证索引文件 → 验证导出 Markdown
 */
import { obsidianPage } from 'wdio-obsidian-service';

const PDF_FILENAME = 'agentic-design-patterns-chinese.pdf';

describe('PDF Index & Export to Obsidian Vault', function () {
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

    it('should have the test PDF file in vault', async function () {
        const exists = await browser.executeObsidian(async ({ app }, pdfPath: string) => {
            return await app.vault.adapter.exists(pdfPath);
        }, PDF_FILENAME);
        expect(exists).toBe(true);
    });

    it('should have plugin API with indexBook', async function () {
        const hasApi = await browser.executeObsidian(({ app }) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            return !!(plugin?.api?.indexBook);
        });
        expect(hasApi).toBe(true);
    });

    // ── Step 2: 完整索引流程（indexBook）──

    it('should start indexing PDF book via indexBook', async function () {
        this.timeout(30000);

        const started = await browser.executeObsidian(
            async ({ app }, pdfPath: string, outputDir: string) => {
                // Fix: pdf.js needs disableWorker set globally in browser context
                (globalThis as any).PDFJS = { disableWorker: true };

                const plugin = app.plugins?.plugins?.['deepreader'] as any;
                const adapter = app.vault.adapter as any;
                const basePath = adapter.getBasePath?.() || '';
                const fullPath = `${basePath}/${pdfPath}`;

                const { indexBook } = plugin.api;

                // 强制推迟执行以防止卡死 WebDriver 导致 Timeout
                setTimeout(() => {
                    indexBook({
                        filePath: fullPath,
                        fileType: 'pdf',
                        outputDir: outputDir,
                        model: 'gpt-4o-mini',
                        apiKey: 'lm-studio',
                        baseUrl: 'http://localhost:1234/v1',
                        onProgress: (progress: any) => {
                            console.log(`[Plugin] Progress: ${progress.percent}% - ${progress.stepLabel}`);
                        },
                    }).then((res: any) => {
                        console.log(`[Plugin] Indexing complete: ${res.bookId}`);
                    }).catch((err: any) => {
                        console.error(`[Plugin] Indexing error:`, err);
                    });
                }, 500);

                return true;
            },
            PDF_FILENAME,
            vaultPath
        );

        expect(started).toBe(true);
    });

    it('should wait for indexing to complete by polling .indexing.json', async function () {
        this.timeout(600000); // Allow up to 10 minutes for slow LLM

        let lastPercent = -1;
        
        await browser.waitUntil(async () => {
            const progress = await browser.executeObsidian(async ({ app }, pdfPath: string) => {
                const crypto = require('crypto');
                const fs = require('fs/promises');
                const adapter = app.vault.adapter as any;
                const basePath = adapter.getBasePath?.() || '';
                const fullPath = `${basePath}/${pdfPath}`;
                
                const bookId = crypto.createHash("sha256").update(fullPath).digest("hex").slice(0, 8);
                const statusFile = `${basePath}/.pageindex/${bookId}/.indexing.json`;
                const metaFile = `${basePath}/.pageindex/${bookId}/book-meta.json`;
                
                try {
                    // If meta file exists, it's fully complete
                    await fs.access(metaFile);
                    return { percent: 100, complete: true, stepLabel: 'Completed' };
                } catch {
                    try {
                        const content = await fs.readFile(statusFile, 'utf-8');
                        const data = JSON.parse(content);
                        return { percent: data.percent, complete: false, stepLabel: data.stepLabel, error: data.error };
                    } catch {
                        return { percent: 0, complete: false, stepLabel: 'Starting' };
                    }
                }
            }, PDF_FILENAME);

            if (progress.error) {
                throw new Error(`Indexing failed: ${progress.error}`);
            }

            if (progress.percent > lastPercent) {
                console.log(`[E2E Polling] Progress: ${progress.percent}% - ${progress.stepLabel}`);
                lastPercent = progress.percent;
            }

            return progress.complete;
        }, {
            timeout: 600000,
            interval: 5000,
            timeoutMsg: 'Indexing did not complete within timeout'
        });
    });

    // ── Step 3: 验证索引文件 ──

    it('should have book-meta.json with correct structure', async function () {
        const bookMeta = await browser.executeObsidian(async ({ app }) => {
            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pageindexDir = `${basePath}/.pageindex`;

            const entries = await fs.readdir(pageindexDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                try {
                    const content = await fs.readFile(`${pageindexDir}/${entry.name}/book-meta.json`, 'utf-8');
                    const meta = JSON.parse(content);
                    if (meta.fileType === 'pdf') {
                        return meta;
                    }
                } catch { /* skip */ }
            }
            return null;
        });

        expect(bookMeta).not.toBeNull();
        expect(bookMeta.bookId).toBeTruthy();
        expect(bookMeta.title).toBeTruthy();
        expect(bookMeta.fileType).toBe('pdf');
        expect(Array.isArray(bookMeta.chapters)).toBe(true);
        expect(bookMeta.chapters.length).toBeGreaterThan(0);

        const chaptersWithSummary = bookMeta.chapters.filter((ch: any) => ch.summary && ch.summary.length > 0);
        console.log(`[E2E] book-meta.json: ${bookMeta.chapters.length} chapters, ${chaptersWithSummary.length} with summary`);
        console.log(`[E2E] Title: "${bookMeta.title}"`);

        // Even with no LLM, it should have chapters
        expect(bookMeta.chapters.length).toBeGreaterThan(0);
    });

    it('should have bm25.json search index', async function () {
        const hasBM25 = await browser.executeObsidian(async ({ app }) => {
            const adapter = app.vault.adapter as any;
            const basePath = adapter.getBasePath?.() || '';
            const fs = require('fs/promises');
            const pageindexDir = `${basePath}/.pageindex`;

            const entries = await fs.readdir(pageindexDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                try {
                    const content = await fs.readFile(`${pageindexDir}/${entry.name}/bm25.json`, 'utf-8');
                    const bm25 = JSON.parse(content);
                    return {
                        found: true,
                        docCount: bm25.docs?.length || 0,
                        avgDL: bm25.avgDL,
                    };
                } catch { /* skip */ }
            }
            return { found: false };
        });

        expect(hasBM25.found).toBe(true);
        expect(hasBM25.docCount).toBeGreaterThan(0);
        console.log(`[E2E] BM25: ${hasBM25.docCount} docs, avgDL=${hasBM25.avgDL}`);
    });

    // ── Step 4: 验证导出的 Markdown 文件 ──

    it('should have exported markdown files in DeepReader directory', async function () {
        const exportedFiles = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            return files
                .filter((f: any) => f.path.startsWith('DeepReader/') && !f.path.includes('covers'))
                .map((f: any) => f.path);
        });

        expect(exportedFiles.length).toBeGreaterThan(0);
        console.log(`[E2E] Exported files: ${exportedFiles.length}`);
    });

    it('should verify PDF chapter notes have correct frontmatter', async function () {
        const chapterFiles = await browser.executeObsidian(async ({ app }) => {
            const files = app.vault.getMarkdownFiles();
            return files
                .filter((f: any) =>
                    f.path.startsWith('DeepReader/') &&
                    !f.path.includes('MOC') &&
                    !f.path.includes('covers') &&
                    !f.path.endsWith('书架.md') &&
                    !f.path.includes('.pageindex') &&
                    !f.path.includes('skills')
                )
                .map((f: any) => f.path)
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
            expect(frontmatter).toContain('type: pdf');
            expect(frontmatter).toContain('node_id:');
        }
    });
});
