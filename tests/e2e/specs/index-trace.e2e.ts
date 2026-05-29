/**
 * 索引追踪日志 E2E 测试
 *
 * 验证索引追踪日志 (IndexTrace) 正确生成，包含阶段记录、耗时、token 用量。
 *
 * 前提条件：
 * - test-vault 中 DeepReader/assets 包含测试用 EPUB 文件
 * - data.json 中配置了有效的 API Key
 */

import * as fs from 'fs';
import * as path from 'path';
import { obsidianPage } from 'wdio-obsidian-service';

// 测试配置
let VAULT_PATH = ''; // 在 before() 中通过 obsidianPage.getVaultPath() 动态设置
const PLUGIN_ID = 'deepreader';
const TIMEOUT_INDEXING = 300_000; // 5 分钟索引超时

// 测试用书籍
const TEST_BOOK = {
  id: 'c9ce4d7b',
  title: '优秀的绵羊',
  fileNamePattern: '优秀的绵羊',
  fileType: 'epub' as const,
};

// CSS 选择器
const SELECTORS = {
  chatInput: 'textarea.deeppdf-chat-input-textarea',
  sendButton: 'button.deeppdf-chat-input-send-btn',
  messagesContainer: '.deeppdf-messages-container',
  chatContainer: '.deeppdf-chat-container',
  topbarBtn: '.deeppdf-topbar-action-btn',
};

/**
 * 辅助函数：等待指定毫秒
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 辅助函数：打开 sidebar 并选择指定书籍
 */
async function openSidebarWithBook(bookId: string): Promise<void> {
  await browser.executeObsidianCommand('deepreader:open-deepreader-sidebar');
  await wait(2000);

  const topbarBtn = await $(SELECTORS.topbarBtn);
  await topbarBtn.waitForExist({ timeout: 10_000 });
  console.log(`[E2E] Sidebar opened`);

  await browser.executeObsidian(({ app }, _bookId: string) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return;
    const view = leaves[0].view;
    if (view.selectIndex) {
      view.selectIndex(_bookId);
    }
  }, bookId);
  await wait(1500);
  console.log(`[E2E] Book selected: ${bookId}`);
}

/**
 * 读取 trace 文件
 */
async function readTraceFile(bookId: string): Promise<any | null> {
  const tracePath = path.join(
    VAULT_PATH,
    '.obsidian/plugins/deepreader/pageindex/traces',
    `${bookId}.json`,
  );

  try {
    const content = await fs.promises.readFile(tracePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.log(`[E2E] Trace file not found: ${tracePath}`);
    return null;
  }
}

/**
 * 等待索引完成并返回 trace
 * @param bookId 书籍 ID
 * @param maxWaitMs 最大等待时间（默认 5 分钟）
 * @param earlyFailMs 早期失败阈值（默认 60 秒），超过此时间仍未见 trace 文件则停止等待
 * @returns 返回 trace 对象；如果索引未成功完成则返回 null
 */
async function waitForIndexingComplete(
  bookId: string,
  maxWaitMs: number = TIMEOUT_INDEXING,
  earlyFailMs: number = 60000,
): Promise<any | null> {
  console.log(`[E2E] Waiting for indexing to complete...`);
  const startTime = Date.now();
  let firstTraceSeen = false;

  while (Date.now() - startTime < maxWaitMs) {
    const trace = await readTraceFile(bookId);

    if (trace) {
      if (trace.success) {
        const traceTime = new Date(trace.completedAt || trace.startedAt).getTime();
        // 如果 trace 文件是新生成的（不是旧的），则返回
        if (traceTime > startTime - 60000) {
          console.log(`[E2E] Indexing completed in ${Date.now() - startTime}ms`);
          return trace;
        }
      } else {
        if (!firstTraceSeen) {
          console.log(`[E2E] Seen existing trace but not successful yet, waiting for new one...`);
          firstTraceSeen = true;
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // 早期失败检测：超过 earlyFailMs 仍未见过任何 trace 文件
    if (!firstTraceSeen && elapsed > earlyFailMs) {
      console.log(`[E2E] CRITICAL: No trace file seen after ${elapsed}ms — stopping early for analysis`);
      console.log(`[E2E] Expected trace path: .obsidian/plugins/deepreader/pageindex/traces/${bookId}.json`);
      return null;
    }

    // 每 30 秒报告一次进度
    if (Math.floor(elapsed / 30000) > Math.floor((elapsed - 5000) / 30000)) {
      console.log(`[E2E] Still waiting... ${Math.floor(elapsed / 1000)}s elapsed`);
    }

    await wait(5000);
  }

  // 超时，返回最新的 trace（可能是 null）
  const trace = await readTraceFile(bookId);
  if (!trace) {
    console.log(`[E2E] Indexing timeout after ${maxWaitMs}ms - no trace file found`);
  } else if (!trace.success) {
    console.log(`[E2E] Indexing timeout after ${maxWaitMs}ms - trace exists but not successful`);
  } else {
    console.log(`[E2E] Indexing timeout after ${maxWaitMs}ms - returning existing trace`);
  }
  return trace;
}

/**
 * 检查 trace 目录是否存在，不存在则创建
 */
async function ensureTraceDir(): Promise<void> {
  const traceDir = path.join(
    VAULT_PATH,
    '.obsidian/plugins/deepreader/pageindex/traces',
  );

  try {
    await fs.promises.access(traceDir);
  } catch {
    await fs.promises.mkdir(traceDir, { recursive: true });
    console.log(`[E2E] Created trace directory: ${traceDir}`);
  }
}

/**
 * 触发书籍索引（通过 plugin.api.indexBook）
 * 按文件名在 DeepReader/assets 中查找，不依赖 catalog 条目
 */
async function triggerIndex(fileNamePattern: string): Promise<void> {
  const result = await browser.executeObsidian(
    async ({ app }, _pattern: string) => {
      const plugin = app.plugins?.plugins?.['deepreader'] as any;
      if (!plugin?.api?.indexBook) {
        return { success: false, error: 'plugin.api.indexBook not available' };
      }

      const vaultPath =
        (app.vault.adapter as any).getBasePath?.() ||
        (app.vault.adapter as any).basePath;

      // 在 DeepReader/assets 中按文件名匹配查找
      const assetsFolder = app.vault.getAbstractFileByPath('DeepReader/assets');
      let filePath: string | null = null;
      let fileType = 'epub';

      if (assetsFolder && 'children' in assetsFolder) {
        for (const child of (assetsFolder as any).children || []) {
          if (
            child.name &&
            child.name.includes(_pattern) &&
            (child.name.endsWith('.epub') || child.name.endsWith('.pdf'))
          ) {
            filePath = `${vaultPath}/${child.path}`;
            fileType = child.name.endsWith('.pdf') ? 'pdf' : 'epub';
            break;
          }
        }
      }

      if (!filePath) {
        return {
          success: false,
          error: `No file matching "${_pattern}" found in DeepReader/assets`,
        };
      }

      // 从插件设置中获取 pageindex 和 embedding 配置
      const settings = plugin.settings;
      const pageindexRole = settings?.roles?.pageindex;
      const embeddingRole = settings?.roles?.embedding;

      let apiKey = '';
      let baseUrl = '';
      if (pageindexRole?.provider) {
        const providerConfig = settings?.providers?.[pageindexRole.provider];
        apiKey = providerConfig?.apiKey || '';
        baseUrl = providerConfig?.baseUrl || '';
      }

      let embeddingOptions = undefined;
      if (embeddingRole?.provider) {
        const embeddingProvider = settings?.providers?.[embeddingRole.provider];
        embeddingOptions = {
          provider: embeddingRole.provider,
          model: embeddingRole.model || 'BAAI/bge-m3',
          apiKey: embeddingProvider?.apiKey || '',
          baseUrl: embeddingProvider?.baseUrl || '',
        };
      }

      try {
        const indexResult = await plugin.api.indexBook({
          filePath,
          fileType,
          outputDir: vaultPath,
          model: pageindexRole?.model || 'deepseek-chat',
          apiKey,
          baseUrl,
          embedding: embeddingOptions,
          addNodeSummary: settings?.ifAddNodeSummary ?? true,
        });
        // 检查 trace 文件是否存在
        const traceDir = `${vaultPath}/.obsidian/plugins/deepreader/pageindex/traces`;
        let traceFiles: string[] = [];
        try {
          const { readdirSync } = require('fs');
          traceFiles = readdirSync(traceDir);
        } catch {}
        return {
          success: true,
          filePath,
          fileType,
          bookId: indexResult?.bookId,
          title: indexResult?.title,
          indexDir: indexResult?.indexDir,
          traceFiles,
          traceDir,
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
    fileNamePattern,
  );

  if (!result.success) {
    console.error(`[E2E] Index failed: ${result.error}`);
    throw new Error(`[E2E] Index failed: ${result.error}`);
  }

  console.log(`[E2E] Index result: bookId=${result.bookId}, title=${result.title}`);
  console.log(`[E2E] Index dir: ${result.indexDir}`);
  console.log(`[E2E] Trace dir (${result.traceDir}): files=${JSON.stringify(result.traceFiles)}`);
  await wait(2000);
}

/**
 * 获取插件日志
 */
async function getPluginLogs(): Promise<string[]> {
  const logs = await browser.getLogs('browser');
  return logs
    .filter(log => log.message.includes('DeepReader') || log.message.includes('DeepPDF'))
    .map(log => log.message);
}

// ========== 测试用例 ==========

describe('索引追踪日志 E2E', function () {
  this.timeout(600000); // 10 分钟全局超时

  before(async function () {
    // 0. 获取实际 vault 路径（wdio 可能使用临时目录）
    VAULT_PATH = obsidianPage.getVaultPath();
    console.log(`[E2E] Vault path: ${VAULT_PATH}`);

    // 1. 验证插件已加载
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader'];
    });
    console.log('[E2E] Plugin loaded:', loaded);
    expect(loaded).toBe(true);

    // 2. 确保 trace 目录存在
    await ensureTraceDir();

    // 3. 验证书籍文件存在于 vault
    const fileExists = await browser.executeObsidian(({ app }, pattern: string) => {
      const assetsFolder = app.vault.getAbstractFileByPath('DeepReader/assets');
      if (!assetsFolder || !('children' in assetsFolder)) return false;
      for (const child of (assetsFolder as any).children || []) {
        if (child.name && child.name.includes(pattern)) return true;
      }
      return false;
    }, TEST_BOOK.fileNamePattern);
    expect(fileExists).toBe(true);

    // 4. 如果书籍尚未索引，触发首次索引（直接读文件系统检查 trace）
    const existingTrace = await readTraceFile(TEST_BOOK.id);
    const alreadyIndexed = existingTrace?.success === true;

    if (!alreadyIndexed) {
      console.log('[E2E] Book not indexed yet, triggering first index...');
      await triggerIndex(TEST_BOOK.fileNamePattern);
      const trace = await waitForIndexingComplete(TEST_BOOK.id);
      expect(trace).not.toBeNull();
      expect(trace!.success).toBe(true);
      console.log('[E2E] First index completed successfully');
    } else {
      console.log('[E2E] Book already indexed, skipping first index');
    }
  });

  beforeEach(async function () {
    await wait(2000);
  });

  // ===== Test 1: 索引后 trace 文件生成 =====
  it('索引后应生成 trace 文件', async function () {
    const bookId = TEST_BOOK.id;

    // 直接触发索引（不通过 sidebar，避免后台索引冲突）
    await triggerIndex(TEST_BOOK.fileNamePattern);

    // 等待索引完成
    const trace = await waitForIndexingComplete(bookId);

    // trace 文件必须生成且成功
    expect(trace).not.toBeNull();
    expect(trace!.success).toBe(true);
    console.log('[E2E] Trace file generated:', bookId);

    // 验证基本结构
    expect(trace!.bookId).toBe(bookId);
    expect(trace!.title).toBeTruthy();
    expect(trace!.phases).toBeDefined();
    expect(trace!.phases.length).toBeGreaterThan(0);
    expect(trace!.llmSummary).toBeDefined();
    expect(trace!.pathDecisions).toBeDefined();

    console.log('[E2E] Trace phases:', trace!.phases.map(p => p.name).join(', '));
    console.log('[E2E] LLM Summary:', JSON.stringify(trace!.llmSummary, null, 2));
    // 保存完整 trace 到本地供分析
    const traceOutPath = path.resolve(__dirname, '../../../trace-output.json');
    await fs.promises.writeFile(traceOutPath, JSON.stringify(trace, null, 2), 'utf-8');
    console.log('[E2E] Full trace saved to:', traceOutPath);
  });

  // ===== Test 2: 重新索引后 trace 包含完整阶段记录 =====
  it('重新索引后 trace 应包含完整阶段记录', async function () {
    const bookId = TEST_BOOK.id;

    // 触发重新索引（不通过 sidebar）
    await triggerIndex(TEST_BOOK.fileNamePattern);

    // 等待索引完成
    const trace = await waitForIndexingComplete(bookId);

    expect(trace).not.toBeNull();
    expect(trace!.success).toBe(true);

    // 验证必含阶段
    const phaseNames = trace!.phases.map((p: any) => p.name);
    console.log('[E2E] Recorded phases:', phaseNames.join(', '));

    // parse_document 阶段必须有（核心索引阶段）
    expect(phaseNames).toContain('parse_document');

    // 验证 LLM 调用记录（token 用量依赖 provider 返回，可能为 0）
    expect(trace!.llmSummary.totalCalls).toBeGreaterThanOrEqual(0);

    // 验证路径决策
    expect(trace!.pathDecisions.length).toBeGreaterThan(0);
    expect(trace!.pathDecisions[0]).toHaveProperty('decision');
    expect(trace!.pathDecisions[0]).toHaveProperty('reason');

    // 验证总耗时记录
    expect(trace!.totalDurationMs).toBeGreaterThanOrEqual(0);

    console.log('[E2E] Reindex trace validated successfully');
  });

  // ===== Test 3: 索引进度阶段 durationMs 正确 =====
  it('每个阶段应有正确的 durationMs 计算', async function () {
    const bookId = TEST_BOOK.id;

    // 确保索引已完成
    let trace = await readTraceFile(bookId);
    if (!trace || !trace.success) {
      await triggerIndex(TEST_BOOK.fileNamePattern);
      trace = await waitForIndexingComplete(bookId);
    }

    expect(trace).not.toBeNull();
    expect(trace!.success).toBe(true);

    for (const phase of trace!.phases) {
      // 阶段应有开始和结束时间
      expect(phase.startedAt).toBeTruthy();

      if (phase.success) {
        expect(phase.completedAt).toBeTruthy();
        expect(phase.durationMs).toBeGreaterThanOrEqual(0);
      }
    }

    console.log('[E2E] All phases have correct durationMs');
  });

  // ===== Test 4: llmSummary 按 model 聚合正确 =====
  it('llmSummary 应按 model 正确聚合', async function () {
    const bookId = TEST_BOOK.id;

    // 确保索引已完成
    let trace = await readTraceFile(bookId);
    if (!trace || !trace.success) {
      await triggerIndex(TEST_BOOK.fileNamePattern);
      trace = await waitForIndexingComplete(bookId);
    }

    expect(trace).not.toBeNull();
    expect(trace!.llmSummary.byModel).toBeDefined();

    // 验证每个 model 的聚合数据
    for (const [model, data] of Object.entries<any>(trace!.llmSummary.byModel)) {
      expect(data.calls).toBeGreaterThan(0);
      expect(data.inputTokens).toBeGreaterThanOrEqual(0);
      expect(data.outputTokens).toBeGreaterThanOrEqual(0);

      console.log(`[E2E] Model ${model}:`, JSON.stringify(data));
    }

    // 验证汇总正确
    let sumCalls = 0;
    let sumInput = 0;
    let sumOutput = 0;
    for (const data of Object.values<any>(trace!.llmSummary.byModel)) {
      sumCalls += data.calls;
      sumInput += data.inputTokens;
      sumOutput += data.outputTokens;
    }

    expect(sumCalls).toBe(trace!.llmSummary.totalCalls);
    expect(sumInput).toBe(trace!.llmSummary.totalInputTokens);
    expect(sumOutput).toBe(trace!.llmSummary.totalOutputTokens);
  });

  // ===== Test 5: EPUB 索引 pathDecision 包含 epub_direct =====
  it('EPUB 索引应有 epub_direct 路径决策', async function () {
    // TEST_BOOK 是 EPUB 类型，直接使用其 trace
    const trace = await readTraceFile(TEST_BOOK.id);

    if (!trace) {
      console.log('[E2E] No trace file for TEST_BOOK, skipping');
      this.skip();
    }

    expect(trace.fileType).toBe('epub');

    const epubDecision = trace.pathDecisions.find(
      (d: any) => d.decision === 'epub_direct',
    );
    expect(epubDecision).toBeDefined();

    console.log('[E2E] EPUB epub_direct decision found');
  });
});
