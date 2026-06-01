/**
 * EPUB 解析质量 E2E 测试
 * 验证：页面拆分、标题污染、fileType 正确性
 */
import { obsidianPage } from 'wdio-obsidian-service';
import * as fs from 'fs/promises';
import * as path from 'path';

const EPUB_FILENAME = '疯传：让你的产品、思想、行为像病毒一样入侵 (乔纳·伯杰 (Jonah Berger)) (z-library.sk, 1lib.sk, z-lib.sk).epub';

/**
 * Fixture 所在路径。该 EPUB 需手动复制到 test-vault 的 assets 目录
 * （或通过 `npm run deploy:dev` 部署插件后手动拖入）。如果缺货，
 * 整个 describe 块会跳过，避免 CI 误报。
 */
const EPUB_FIXTURE_PATH = `DeepReader/assets/${EPUB_FILENAME}`;

describe('EPUB 解析质量 E2E 测试', function () {
  let vaultPath: string;
  let basePath: string;
  let fixtureAvailable = false;

  before(async function () {
    vaultPath = obsidianPage.getVaultPath();
    basePath = vaultPath;

    fixtureAvailable = await browser.executeObsidian(async ({ app }, p: string) => {
      return await app.vault.adapter.exists(p);
    }, EPUB_FIXTURE_PATH);

    if (!fixtureAvailable) {
      console.warn(`[E2E] ⚠ 跳过 EPUB 解析质量测试：fixture 不存在 (${EPUB_FIXTURE_PATH})。`);
      console.warn('[E2E]   请将测试 EPUB 复制到 test-vault/DeepReader/assets/ 目录后重试。');
    }
  });

  // 动态跳过：fixture 不存在时所有用例自动 pass
  beforeEach(function () {
    if (!fixtureAvailable) {
      this.skip();
    }
  });

  // ══════════════════════════════════════
  // 环境验证
  // ══════════════════════════════════════

  it('should have DeepReader plugin loaded', async function () {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader'];
    });
    expect(loaded).toBe(true);
  });

  it('should have the test EPUB file in vault', async function () {
    // 由动态 beforeEach 跳过处理；这里保留正向断言以便手动启用
    expect(fixtureAvailable).toBe(true);
  });

  // ══════════════════════════════════════
  // 原始解析测试（parseEpub，无需 LLM）
  // ══════════════════════════════════════

  it('parseEpub: should NOT have fragmented ### headings', async function () {
    const chapters = await browser.executeObsidian(async ({ app }, epubPath: string) => {
      const plugin = app.plugins?.plugins?.['deepreader'] as any;
      const bp = (app.vault.adapter as any).getBasePath?.() || '';
      const fullPath = `${bp}/DeepReader/assets/${epubPath}`;
      const info = await plugin.api.parseEpub(fullPath);
      return info.chapters.map((ch: any, i: number) => ({
        index: i,
        title: ch.title,
        headingLines: (ch.content.match(/^### /gm) || []).length,
        totalLines: ch.content.split('\n').filter((l: string) => l.trim()).length,
      }));
    }, EPUB_FILENAME);

    for (const ch of chapters) {
      const ratio = ch.headingLines / Math.max(ch.totalLines, 1);
      console.log(`[E2E] Ch${ch.index}: ${ch.headingLines}/${ch.totalLines} ### (${(ratio * 100).toFixed(0)}%)`);
      expect(ratio).toBeLessThan(0.5);
    }
  });

  // ══════════════════════════════════════
  // 全流程索引测试（indexBook，跳过 LLM）
  // ══════════════════════════════════════

  it('indexBook: delete old export and re-index', async function () {
    this.timeout(300000);

    // 1. Clean old export dir and pageindex data
    await browser.executeObsidian(async ({ app }) => {
      const oldExportDir = 'DeepReader/疯传';
      const adapter = app.vault.adapter as any;
      try {
        const exists = await adapter.exists(oldExportDir);
        if (exists) {
          const entries = await adapter.list(oldExportDir);
          for (const f of entries.files || []) {
            await adapter.remove(f);
          }
          await adapter.rmdir(oldExportDir, true);
        }
      } catch {}
    });

    // Wait a beat for filesystem
    await new Promise(r => setTimeout(r, 500));

    // 2. Run indexBook (no LLM)
    const result = await browser.executeObsidian(async ({ app }, epubPath: string) => {
      const plugin = app.plugins?.plugins?.['deepreader'] as any;
      const s = plugin.settings;
      const bp = (app.vault.adapter as any).getBasePath?.() || '';
      const fullPath = `${bp}/DeepReader/assets/${epubPath}`;

      const res = await plugin.api.indexBook({
        filePath: fullPath,
        fileType: 'epub',
        outputDir: bp,
        model: s.roles?.pageindex?.model || 'mimo-v2.5',
        apiKey: s.providers?.xiaomi?.apiKey,
        baseUrl: s.providers?.xiaomi?.baseUrl,
        addNodeSummary: false,
        addDocDescription: false,
      });

      return {
        bookId: res.bookId,
        title: res.title,
        fileType: res.fileType,
        chaptersCount: res.chaptersCount,
      };
    }, EPUB_FILENAME);

    expect(result).toBeTruthy();
    expect(result.bookId).toBeTruthy();
    expect(result.fileType).toBe('epub');
    expect(result.chaptersCount).toBeGreaterThan(0);
    console.log(`[E2E] indexBook: "${result.title}" → ${result.chaptersCount} chapters`);
  });

  it('exported markdown: page splitting created multiple files (≥ 3 chapters)', async function () {
    const mdInfo = await browser.executeObsidian(async ({ app }) => {
      const exportDir = 'DeepReader/疯传';
      const adapter = app.vault.adapter as any;

      const exists = await adapter.exists(exportDir);
      if (!exists) return { count: 0, maxLength: 0 };

      const entries = await adapter.list(exportDir);
      const mdFiles = (entries.files || []).filter((f: string) => f.endsWith('.md'));

      // Check at least 3 files have substantial content
      let substantialFiles = 0;
      let maxContentLength = 0;
      for (const fp of mdFiles) {
        const content = await adapter.read(fp);
        const bodyStart = content.indexOf('---', 3);
        if (bodyStart >= 0) {
          const body = content.substring(bodyStart + 3).trim();
          if (body.length > 200) substantialFiles++;
          if (body.length > maxContentLength) maxContentLength = body.length;
        }
      }
      return { count: substantialFiles, maxLength: maxContentLength };
    });

    // More than 3 substantial files = page splitting worked (spine had 3 entries)
    expect(mdInfo.count).toBeGreaterThanOrEqual(3);
    expect(mdInfo.maxLength).toBeGreaterThan(5000);
    console.log(`[E2E] ✓ ${mdInfo.count} substantial files (max: ${mdInfo.maxLength}c) — page splitting confirmed`);
  });

  it('exported markdown: no ### heading pollution', async function () {
    this.timeout(30000);

    // Read exported files via vault adapter
    const mdFiles = await browser.executeObsidian(async ({ app }) => {
      const exportDir = 'DeepReader/疯传';
      const adapter = app.vault.adapter as any;

      const exists = await adapter.exists(exportDir);
      if (!exists) return [];

      const entries = await adapter.list(exportDir);
      return (entries.files || [])
        .filter((f: string) => f.endsWith('.md'))
        .sort();
    });

    expect(mdFiles.length).toBeGreaterThan(0);
    console.log(`[E2E] ${mdFiles.length} exported markdown files`);

    let filesWithContent = 0;
    for (const fp of mdFiles) {
      const content = await browser.executeObsidian(async ({ app }, filePath: string) => {
        const adapter = app.vault.adapter as any;
        return await adapter.read(filePath);
      }, fp);

      // Parse body (after frontmatter)
      const bodyStart = content.indexOf('---', 3);
      if (bodyStart === -1) continue;
      const body = content.substring(bodyStart + 3);

      // Count ### lines (should be minimal, from actual HTML h3 tags)
      const lines = body.split('\n');
      const contentLines = lines.filter((l: string) => l.trim() && !l.startsWith('>'));
      const h3Lines = contentLines.filter((l: string) => /^### /.test(l)).length;
      const ratio = h3Lines / Math.max(contentLines.length, 1);

      const fileName = fp.split('/').pop() || fp;
      console.log(`  ${fileName}: ${h3Lines}/${contentLines.length} ### (${(ratio * 100).toFixed(1)}%), ${body.length}c`);

      // Should be well under 25% (actual HTML h3, not artifacts)
      expect(ratio).toBeLessThan(0.25);

      if (body.length > 200) filesWithContent++;
    }

    // At least 2 files with substance
    expect(filesWithContent).toBeGreaterThanOrEqual(2);
  });
});
