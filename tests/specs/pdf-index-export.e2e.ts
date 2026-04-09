/**
 * PDF Index & Export E2E 测试
 * 完全模拟用户手动操作：打开书库 → 选择文件 → 等待索引 → 验证结果
 */
import { obsidianPage } from 'wdio-obsidian-service';

// 测试用的 PDF 文件
const PDF_FILENAME = 'agentic-design-patterns-chinese.pdf';

describe('PDF Index & Export — 用户真实操作流程', function () {
    let vaultPath: string;

    before(async function () {
        vaultPath = obsidianPage.getVaultPath();
    });

    // ── Step 1: 基础环境验证 ──

    it('should have DeepReader plugin loaded with sidebar view', async function () {
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

    // ── Step 2: 通过 UI 操作打开书库并选择文件 ──
    // 完全模拟用户点击：侧边栏 → 书库按钮 → + 按钮 → 选择 PDF → 等待完成

    it('should open library modal, select vault PDF, and complete indexing', async function () {
        this.timeout(1200000); // 20 分钟（LLM 摘要需要时间）

        // ── 2a: 通过侧边栏打开书库弹窗（和用户点击按钮一样） ──
        const opened = await browser.executeObsidian(({ app }) => {
            const plugin = app.plugins?.plugins?.['deepreader'] as any;
            if (!plugin) return { error: 'Plugin not loaded' };

            // 获取侧边栏视图实例（和用户点击书库按钮走同一代码路径）
            const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
            if (!leaves || leaves.length === 0) return { error: 'Sidebar view not found' };

            const sidebarView = leaves[0].view as any;
            if (!sidebarView?.openLibraryModal) return { error: 'openLibraryModal not found' };

            // 调用侧边栏的 openLibraryModal —— 和用户点击按钮完全一样
            sidebarView.openLibraryModal();
            return { opened: true };
        });

        expect(opened.error).toBeUndefined();
        expect(opened.opened).toBe(true);

        // ── 2b: 等待书库弹窗出现 ──
        await browser.waitUntil(async () => {
            return await browser.executeObsidian(() => {
                return !!document.querySelector('.deeppdf-library-modal');
            });
        }, { timeout: 5000, timeoutMsg: '书库弹窗未出现' });

        console.log('[E2E] 书库弹窗已打开');

        // ── 2c: 点击 "+" 按钮打开文件选择器 ──
        const clickedAdd = await browser.executeObsidian(() => {
            const btn = document.querySelector('.deeppdf-lib-add-btn') as HTMLElement;
            if (btn) { btn.click(); return true; }
            return false;
        });
        expect(clickedAdd).toBe(true);

        // ── 2d: 等待文件选择器弹窗出现并加载文件列表 ──
        await browser.waitUntil(async () => {
            return await browser.executeObsidian(() => {
                const items = document.querySelectorAll('.deeppdf-file-item');
                return items.length > 0;
            });
        }, { timeout: 5000, timeoutMsg: '文件选择器未加载文件列表' });

        console.log('[E2E] 文件选择器已打开');

        // ── 2e: 在文件列表中找到并点击目标 PDF 文件 ──
        // 这会触发 PDFFileSelectorModal → onSelect → LibraryModal.handleAddDocument 的完整链路
        const selectedFile = await browser.executeObsidian((_args: any, pdfName: string) => {
            const items = document.querySelectorAll('.deeppdf-file-item');
            for (const item of items) {
                const nameEl = item.querySelector('.deeppdf-file-name');
                if (nameEl && nameEl.textContent?.includes(pdfName.replace(/\.pdf$/i, ''))) {
                    (item as HTMLElement).click();
                    return { selected: true, name: nameEl.textContent };
                }
            }
            // 如果没找到精确匹配，列出所有可用文件
            const allNames: string[] = [];
            items.forEach(item => {
                const n = item.querySelector('.deeppdf-file-name');
                if (n) allNames.push(n.textContent || '');
            });
            return { selected: false, available: allNames };
        }, PDF_FILENAME);

        if (!selectedFile.selected) {
            console.log('[E2E] 可用文件:', JSON.stringify((selectedFile as any).available));
        }
        expect(selectedFile.selected).toBe(true);
        console.log(`[E2E] 已选择文件: ${(selectedFile as any).name}`);

        // ── 2f: 等待索引完成（轮询进度） ──
        let lastPercent = -1;

        await browser.waitUntil(async () => {
            const progress = await browser.executeObsidian(async ({ app }, pdfPath: string, baseDir: string) => {
                const crypto = require('crypto');
                const fs = require('fs/promises');
                const adapter = app.vault.adapter as any;
                const basePath = adapter.getBasePath?.() || baseDir;
                const fullPath = `${basePath}/${pdfPath}`;

                const bookId = crypto.createHash("sha256").update(fullPath).digest("hex").slice(0, 8);
                const metaFile = `${basePath}/.pageindex/${bookId}/book-meta.json`;
                const statusFile = `${basePath}/.pageindex/${bookId}/.indexing.json`;

                // 检查 book-meta.json 是否存在（索引完成的标志）
                try {
                    await fs.access(metaFile);
                    return { percent: 100, complete: true, stepLabel: 'Completed' };
                } catch {
                    // 还在索引中，读取进度
                    try {
                        const content = await fs.readFile(statusFile, 'utf-8');
                        const data = JSON.parse(content);
                        return { percent: data.percent || 0, complete: false, stepLabel: data.stepLabel, error: data.error };
                    } catch {
                        return { percent: 0, complete: false, stepLabel: 'Starting' };
                    }
                }
            }, PDF_FILENAME, vaultPath);

            if (progress.error) {
                throw new Error(`索引失败: ${progress.error}`);
            }

            if (progress.percent !== lastPercent) {
                console.log(`[E2E] 进度: ${progress.percent}% - ${progress.stepLabel}`);
                lastPercent = progress.percent;
            }

            return progress.complete;
        }, {
            timeout: 1200000,
            interval: 5000,
            timeoutMsg: '索引未在超时时间内完成'
        });

        console.log('[E2E] 索引完成！');
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
                        corpusSize: bm25.corpusSize || 0,
                        avgDL: bm25.avgDL,
                    };
                } catch { /* skip */ }
            }
            return { found: false };
        });

        expect(hasBM25.found).toBe(true);
        console.log(`[E2E] BM25: ${JSON.stringify(hasBM25)}`);
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
                    !f.path.includes('skills') &&
                    !f.path.endsWith('MEMORY.md')
                )
                .map((f: any) => f.path)
                .slice(0, 5);
        });

        expect(chapterFiles.length).toBeGreaterThan(0);
        console.log(`[E2E] Chapter files to verify: ${JSON.stringify(chapterFiles)}`);

        for (const filePath of chapterFiles) {
            // 使用 vault.adapter.read 读取原始文件内容（包含 frontmatter）
            const content = await browser.executeObsidian(async ({ app }, fp: string) => {
                return await app.vault.adapter.read(fp);
            }, filePath);

            console.log(`[E2E] File "${filePath}" starts with: ${JSON.stringify(content.substring(0, 200))}`);

            expect(content.startsWith('---')).toBe(true);

            const frontmatterEnd = content.indexOf('---', 3);
            expect(frontmatterEnd).toBeGreaterThan(0);

            const frontmatter = content.substring(0, frontmatterEnd + 3);
            expect(frontmatter).toContain('title:');
            expect(frontmatter).toContain('type: pdf');
        }
    });
});
