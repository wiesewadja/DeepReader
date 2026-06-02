/**
 * 索引追踪日志 E2E 测试
 *
 * 从零索引一本新书，验证 .log 追加日志和 .json 兼容摘要正确生成。
 *
 * 策略：
 * - wdio 复制 test-vault 到临时目录（含已有索引数据）
 * - before() 中清除该书的索引数据，确保走完整索引流程
 * - 触发 indexBook()，轮询 .log 文件等待 index_end
 */

import * as fs from 'fs';
import * as path from 'path';
import { obsidianPage } from 'wdio-obsidian-service';

let VAULT_PATH = '';
const TIMEOUT_INDEX = 300_000; // 5 分钟

const TEST_BOOK = {
  id: 'c9ce4d7b',
  title: '优秀的绵羊',
  fileNamePattern: '优秀的绵羊',
};

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 解析 .log 文件，按 type 分类 */
function parseTraceLog(content: string): Record<string, any[]> {
  const events: Record<string, any[]> = {};
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const type = event.type;
      if (!events[type]) events[type] = [];
      events[type].push(event);
    } catch { /* skip */ }
  }
  return events;
}

/** 轮询等待索引完成（检查 .log 文件中出现 index_end 行） */
async function waitForIndex(
  bookId: string,
  maxWaitMs: number = TIMEOUT_INDEX,
): Promise<{ log: string; events: Record<string, any[]>; json: any | null } | null> {
  const startTime = Date.now();
  console.log(`[E2E] Waiting for indexing...`);

  while (Date.now() - startTime < maxWaitMs) {
    const logPath = path.join(
      VAULT_PATH, '.obsidian/plugins/deepreader-dev/pageindex/traces', `${bookId}.log`,
    );
    let logContent: string | null = null;
    try { logContent = await fs.promises.readFile(logPath, 'utf-8'); } catch {}

    if (logContent) {
      const events = parseTraceLog(logContent);
      if (events.index_end?.[0]) {
        console.log(`[E2E] Indexing done in ${Date.now() - startTime}ms`);
        // 读取 .json 兼容摘要
        const jsonPath = path.join(
          VAULT_PATH, '.obsidian/plugins/deepreader-dev/pageindex/traces', `${bookId}.json`,
        );
        let json: any = null;
        try { json = JSON.parse(await fs.promises.readFile(jsonPath, 'utf-8')); } catch {}
        return { log: logContent, events, json };
      }
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > 60000 && !logContent) {
      console.log(`[E2E] No .log file after ${elapsed}ms, giving up`);
      return null;
    }
    if (elapsed % 30000 < 5000) {
      console.log(`[E2E] Still waiting... ${Math.floor(elapsed / 1000)}s`);
    }
    await wait(5000);
  }
  return null;
}

/** 通过 plugin.api.indexBook 触发索引 */
async function triggerIndex(): Promise<{ bookId: string; title: string }> {
  const result = await browser.executeObsidian(
    async ({ app }, pattern: string) => {
      const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
      if (!plugin?.api?.indexBook) {
        return { success: false, error: 'plugin.api.indexBook not available' };
      }

      const vaultPath =
        (app.vault.adapter as any).getBasePath?.() ||
        (app.vault.adapter as any).basePath;

      // 查找 EPUB 文件
      const assetsFolder = app.vault.getAbstractFileByPath('DeepReader/assets');
      let filePath: string | null = null;
      if (assetsFolder && 'children' in assetsFolder) {
        for (const child of (assetsFolder as any).children || []) {
          if (child.name?.includes(pattern) && child.name.endsWith('.epub')) {
            filePath = `${vaultPath}/${child.path}`;
            break;
          }
        }
      }
      if (!filePath) {
        return { success: false, error: `No EPUB matching "${pattern}" in DeepReader/assets` };
      }

      // 从插件设置获取 LLM / embedding 配置
      const settings = plugin.settings;
      const pageindexRole = settings?.roles?.pageindex;
      const embeddingRole = settings?.roles?.embedding;

      let apiKey = '';
      let baseUrl = '';
      if (pageindexRole?.provider) {
        const p = settings?.providers?.[pageindexRole.provider];
        apiKey = p?.apiKey || '';
        baseUrl = p?.baseUrl || '';
      }

      let embeddingOptions: any = undefined;
      if (embeddingRole?.provider) {
        const ep = settings?.providers?.[embeddingRole.provider];
        embeddingOptions = {
          provider: embeddingRole.provider,
          model: embeddingRole.model || 'BAAI/bge-m3',
          apiKey: ep?.apiKey || '',
          baseUrl: ep?.baseUrl || '',
        };
      }

      try {
        const r = await plugin.api.indexBook({
          filePath,
          fileType: 'epub',
          outputDir: vaultPath,
          model: pageindexRole?.model || 'deepseek-chat',
          apiKey,
          baseUrl,
          embedding: embeddingOptions,
          addNodeSummary: settings?.ifAddNodeSummary ?? true,
        });
        return { success: true, bookId: r?.bookId, title: r?.title };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
    TEST_BOOK.fileNamePattern,
  );

  if (!result.success) {
    throw new Error(`[E2E] indexBook failed: ${result.error}`);
  }
  console.log(`[E2E] indexBook returned: bookId=${result.bookId}, title=${result.title}`);
  return { bookId: result.bookId, title: result.title };
}

/** 清除该书的已有索引数据，确保走完整索引流程 */
async function cleanExistingIndex(bookId: string): Promise<void> {
  await browser.executeObsidian(({ app }, _bookId: string) => {
    const vaultPath =
      (app.vault.adapter as any).getBasePath?.() ||
      (app.vault.adapter as any).basePath;
    const { rmSync, existsSync } = require('fs');

    // 删除索引目录
    const indexDir = `${vaultPath}/.obsidian/plugins/deepreader-dev/pageindex/${_bookId}`;
    if (existsSync(indexDir)) {
      rmSync(indexDir, { recursive: true, force: true });
    }

    // 删除 traces
    const tracesDir = `${vaultPath}/.obsidian/plugins/deepreader-dev/pageindex/traces`;
    if (existsSync(tracesDir)) {
      rmSync(tracesDir, { recursive: true, force: true });
    }

    // 删除导出目录（书籍章节 .md 文件）
    const deepReaderDir = `${vaultPath}/DeepReader`;
    try {
      const { readdirSync } = require('fs');
      for (const entry of readdirSync(deepReaderDir)) {
        // 不删除 assets / covers / exports 这些通用目录
        if (['assets', 'covers', 'exports', 'skills', 'pi', 'pi-test'].includes(entry)) continue;
        const entryPath = `${deepReaderDir}/${entry}`;
        const stat = require('fs').statSync(entryPath);
        if (stat.isDirectory()) {
          // 只删除与测试书相关的目录
          const hasChapterFiles = readdirSync(entryPath).some(
            (f: string) => f.endsWith('.md') || f === 'assets'
          );
          if (hasChapterFiles) {
            rmSync(entryPath, { recursive: true, force: true });
          }
        }
      }
    } catch {}

    // 清除 catalog 中该书的条目
    const catalogPath = `${vaultPath}/.obsidian/plugins/deepreader-dev/pageindex/catalog.json`;
    if (existsSync(catalogPath)) {
      const { readFileSync, writeFileSync } = require('fs');
      const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
      if (catalog.books?.[_bookId]) {
        delete catalog.books[_bookId];
        writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
      }
    }
  }, bookId);
  console.log(`[E2E] Cleaned existing index data for ${bookId}`);
}

// ========== 测试用例 ==========

describe('索引追踪日志 E2E', function () {
  this.timeout(600000);

  let bookId = '';
  let indexResult: { log: string; events: Record<string, any[]>; json: any | null } | null = null;

  before(async function () {
    VAULT_PATH = obsidianPage.getVaultPath();
    console.log(`[E2E] Vault: ${VAULT_PATH}`);

    // 验证插件已加载
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader-dev'];
    });
    expect(loaded).toBe(true);

    // 验证书籍文件存在
    const fileExists = await browser.executeObsidian(({ app }, pattern: string) => {
      const folder = app.vault.getAbstractFileByPath('DeepReader/assets');
      if (!folder || !('children' in folder)) return false;
      for (const child of (folder as any).children || []) {
        if (child.name?.includes(pattern) && child.name.endsWith('.epub')) return true;
      }
      return false;
    }, TEST_BOOK.fileNamePattern);
    expect(fileExists).toBe(true);

    // 清除旧索引数据
    await cleanExistingIndex(TEST_BOOK.id);

    // 从零触发索引
    const triggerResult = await triggerIndex();
    bookId = triggerResult.bookId || TEST_BOOK.id;

    // 等待索引完成
    indexResult = await waitForIndex(bookId);
    expect(indexResult).not.toBeNull();
    expect(indexResult!.events.index_end?.[0]?.success).toBe(true);
    console.log(`[E2E] First index completed`);

    // 保存 trace 文件供调试
    const outDir = path.resolve(__dirname, '../../../');
    try {
      await fs.promises.writeFile(
        path.join(outDir, 'trace-output.log'), indexResult!.log, 'utf-8',
      );
      if (indexResult!.json) {
        await fs.promises.writeFile(
          path.join(outDir, 'trace-output.json'),
          JSON.stringify(indexResult!.json, null, 2), 'utf-8',
        );
      }
    } catch {}
  });

  // ===== Test 1: .log + .json 文件结构 =====
  it('应生成 .log 和 .json trace 文件', async function () {
    const { events, json } = indexResult!;

    // .log 包含关键事件
    expect(events.index_start).toBeDefined();
    expect(events.phase_start).toBeDefined();
    expect(events.phase_end).toBeDefined();
    expect(events.index_end).toBeDefined();

    // .json 兼容摘要
    expect(json).not.toBeNull();
    expect(json!.title).toBeTruthy();
    expect(json!.success).toBe(true);
    expect(json!.bookId).toBe(bookId);
    expect(json!.fileType).toBe('epub');
    expect(json!.config.pageindexModel).toBeTruthy();
    expect(json!.phases.length).toBeGreaterThan(0);

    console.log('[E2E] Events:', Object.keys(events).join(', '));
    console.log('[E2E] Phases:', json!.phases.map((p: any) => p.name).join(', '));
  });

  // ===== Test 2: llm_call 行数和结构 =====
  it('llm_call 应 > 2 条且结构完整', async function () {
    const llmCalls = indexResult!.events.llm_call || [];
    console.log(`[E2E] llm_call count: ${llmCalls.length}`);

    expect(llmCalls.length).toBeGreaterThan(2);

    for (const call of llmCalls) {
      expect(call.purpose).toBeTruthy();
      expect(call.model).toBeTruthy();
      expect(call.phase).toBeTruthy();
      expect(call.durationMs).toBeGreaterThanOrEqual(0);
    }

    // 验证 .json 的 llmSummary 总数与 .log 行数一致
    expect(indexResult!.json!.llmSummary.totalCalls).toBe(llmCalls.length);
  });

  // ===== Test 3: embed_call 行存在 =====
  it('embed_call 行应记录 embedding 调用', async function () {
    const embedCalls = indexResult!.events.embed_call || [];
    console.log(`[E2E] embed_call count: ${embedCalls.length}`);

    if (embedCalls.length > 0) {
      for (const call of embedCalls) {
        expect(call.model).toBeTruthy();
        expect(call.durationMs).toBeGreaterThanOrEqual(0);
        expect(call.batchSize).toBeGreaterThan(0);
      }
    } else {
      console.log('[E2E] No embed_call lines (embedding may not be configured)');
    }
  });

  // ===== Test 4: phase durationMs =====
  it('每个 phase 应有正确的 durationMs', async function () {
    for (const phase of indexResult!.json!.phases) {
      expect(phase.startedAt).toBeTruthy();
      if (phase.success) {
        expect(phase.completedAt).toBeTruthy();
        expect(phase.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // ===== Test 5: llmSummary 按 model 聚合 =====
  it('llmSummary 应按 model 正确聚合', async function () {
    const summary = indexResult!.json!.llmSummary;
    expect(summary.byModel).toBeDefined();
    expect(Object.keys(summary.byModel).length).toBeGreaterThan(0);

    let sumCalls = 0;
    let sumInput = 0;
    let sumOutput = 0;
    for (const [model, data] of Object.entries<any>(summary.byModel)) {
      expect(data.calls).toBeGreaterThan(0);
      expect(data.inputTokens).toBeGreaterThanOrEqual(0);
      expect(data.outputTokens).toBeGreaterThanOrEqual(0);
      sumCalls += data.calls;
      sumInput += data.inputTokens;
      sumOutput += data.outputTokens;
    }

    expect(sumCalls).toBe(summary.totalCalls);
    expect(sumInput).toBe(summary.totalInputTokens);
    expect(sumOutput).toBe(summary.totalOutputTokens);
  });

  // ===== Test 6: EPUB 路径决策 =====
  it('EPUB 索引应有 epub_direct 路径决策', async function () {
    const pathDecisions = indexResult!.events.path_decision || [];
    expect(pathDecisions.length).toBeGreaterThan(0);

    const epubDecision = pathDecisions.find((d: any) => d.decision === 'epub_direct');
    expect(epubDecision).toBeDefined();
  });
});
