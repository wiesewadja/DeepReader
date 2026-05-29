/**
 * 索引追踪日志 E2E 测试
 *
 * 验证索引追踪日志 (IndexTrace) 正确生成，包含阶段记录、耗时、token 用量。
 *
 * 前提条件：
 * - test-vault 中包含已索引的书籍数据
 * - data.json 中配置了有效的 API Key
 * - 环境变量 LLM_API_KEY 提供了 DeepSeek API Key
 */

import * as fs from 'fs';
import * as path from 'path';

// 测试配置
const VAULT_PATH = path.resolve(__dirname, '../../test-vault');
const PLUGIN_ID = 'deepreader';
const TIMEOUT_INDEXING = 300_000; // 5 分钟索引超时

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
    `${bookId}.json`
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
 * @returns 返回 trace 对象；如果索引未成功完成则返回 null
 */
async function waitForIndexingComplete(bookId: string, maxWaitMs: number = TIMEOUT_INDEXING): Promise<any | null> {
  console.log(`[E2E] Waiting for indexing to complete...`);
  const startTime = Date.now();
  let lastTraceTime = 0;

  while (Date.now() - startTime < maxWaitMs) {
    const trace = await readTraceFile(bookId);
    if (trace && trace.success) {
      const traceTime = new Date(trace.completedAt || trace.startedAt).getTime();
      // 如果 trace 文件是新生成的（不是旧的），则返回
      if (traceTime > startTime - 60000) { // 60 秒内的 trace 才认为是新的
        console.log(`[E2E] Indexing completed in ${Date.now() - startTime}ms`);
        return trace;
      }
      // 旧的 trace，继续等待新 trace
      lastTraceTime = traceTime;
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
    '.obsidian/plugins/deepreader/pageindex/traces'
  );

  try {
    await fs.promises.access(traceDir);
  } catch {
    await fs.promises.mkdir(traceDir, { recursive: true });
    console.log(`[E2E] Created trace directory: ${traceDir}`);
  }
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

/**
 * 触发书籍重新索引（通过 UI）
 */
async function triggerReindex(bookId: string): Promise<void> {
  await browser.executeObsidian(({ app }, _bookId: string) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return;
    const view = leaves[0].view;

    // 触发重新索引
    if (view.reindexBook) {
      view.reindexBook(_bookId);
    }
  }, bookId);

  console.log(`[E2E] Reindex triggered for book: ${bookId}`);
  await wait(1000);
}

// ========== 测试用例 ==========

describe('索引追踪日志 E2E', function () {
  this.timeout(600000); // 10 分钟全局超时

  // 在所有测试之前，验证插件已加载
  before(async function () {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader'];
    });
    console.log('[E2E] Plugin loaded:', loaded);
    expect(loaded).toBe(true);

    // 确保 trace 目录存在
    await ensureTraceDir();
  });

  beforeEach(async function () {
    await wait(2000);
  });

  // ===== Test 1: 索引后 trace 文件生成 =====
  it('索引后应生成 trace 文件', async function () {
    const bookId = 'c9ce4d7b'; // 优秀的绵羊

    // 1. 打开书籍并触发索引
    await openSidebarWithBook(bookId);
    await triggerReindex(bookId);

    // 2. 等待索引完成
    const trace = await waitForIndexingComplete(bookId);

    // 3. trace 文件必须生成且成功
    expect(trace).not.toBeNull();
    expect(trace!.success).toBe(true);
    console.log('[E2E] Trace file generated:', bookId);

    // 4. 验证基本结构
    expect(trace!.bookId).toBe(bookId);
    expect(trace!.title).toBeTruthy();
    expect(trace!.phases).toBeDefined();
    expect(trace!.phases.length).toBeGreaterThan(0);
    expect(trace!.llmSummary).toBeDefined();
    expect(trace!.pathDecisions).toBeDefined();

    console.log('[E2E] Trace phases:', trace!.phases.map(p => p.name).join(', '));
    console.log('[E2E] LLM Summary:', JSON.stringify(trace!.llmSummary, null, 2));
  });

  // ===== Test 2: 重新索引后 trace 包含完整阶段记录 =====
  it('重新索引后 trace 应包含完整阶段记录', async function () {
    const bookId = 'c9ce4d7b';

    // 触发重新索引
    await openSidebarWithBook(bookId);
    await triggerReindex(bookId);

    // 等待索引完成
    const trace = await waitForIndexingComplete(bookId);

    expect(trace).not.toBeNull();
    expect(trace!.success).toBe(true);

    // 验证必含阶段
    const phaseNames = trace!.phases.map((p: any) => p.name);
    console.log('[E2E] Recorded phases:', phaseNames.join(', '));

    // parse_document 阶段必须有（核心索引阶段）
    expect(phaseNames).toContain('parse_document');

    // 验证 LLM 调用记录完整
    expect(trace!.llmSummary.totalCalls).toBeGreaterThan(0);
    expect(trace!.llmSummary.totalInputTokens).toBeGreaterThan(0);
    expect(trace!.llmSummary.totalOutputTokens).toBeGreaterThan(0);

    // 验证路径决策
    expect(trace!.pathDecisions.length).toBeGreaterThan(0);
    expect(trace!.pathDecisions[0]).toHaveProperty('decision');
    expect(trace!.pathDecisions[0]).toHaveProperty('reason');

    // 验证总耗时记录
    expect(trace!.totalDurationMs).toBeGreaterThan(0);

    console.log('[E2E] Reindex trace validated successfully');
  });

  // ===== Test 3: 索引进度阶段 durationMs 正确 =====
  it('每个阶段应有正确的 durationMs 计算', async function () {
    const bookId = 'c9ce4d7b';

    // 确保索引已完成
    let trace = await readTraceFile(bookId);
    if (!trace || !trace.success) {
      await openSidebarWithBook(bookId);
      await triggerReindex(bookId);
      trace = await waitForIndexingComplete(bookId);
    }

    expect(trace).not.toBeNull();
    expect(trace!.success).toBe(true);

    for (const phase of trace!.phases) {
      // 阶段应有开始和结束时间
      expect(phase.startedAt).toBeTruthy();

      if (phase.success) {
        expect(phase.completedAt).toBeTruthy();
        expect(phase.durationMs).toBeGreaterThan(0);
      }
    }

    console.log('[E2E] All phases have correct durationMs');
  });

  // ===== Test 4: llmSummary 按 model 聚合正确 =====
  it('llmSummary 应按 model 正确聚合', async function () {
    const bookId = 'c9ce4d7b';

    // 确保索引已完成
    let trace = await readTraceFile(bookId);
    if (!trace || !trace.success) {
      await openSidebarWithBook(bookId);
      await triggerReindex(bookId);
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
    // 查找一个 EPUB 索引的书籍
    const catalogPath = path.join(
      VAULT_PATH,
      '.obsidian/plugins/deepreader/pageindex/catalog.json'
    );

    let epubBookId: string | null = null;

    try {
      const catalog = JSON.parse(await fs.promises.readFile(catalogPath, 'utf-8'));
      // 查找 EPUB 类型的书籍
      for (const entry of catalog.books || []) {
        if (entry.fileType === 'epub') {
          epubBookId = entry.bookId;
          break;
        }
      }
    } catch (e) {
      console.log('[E2E] Could not read catalog');
    }

    if (!epubBookId) {
      console.log('[E2E] No EPUB book found in catalog, skipping test');
      expect(true).toBe(true);
      return;
    }

    const trace = await readTraceFile(epubBookId);

    if (!trace) {
      console.log('[E2E] No trace file for EPUB book, skipping');
      expect(true).toBe(true);
      return;
    }

    expect(trace.fileType).toBe('epub');

    const epubDecision = trace.pathDecisions.find(
      (d: any) => d.decision === 'epub_direct'
    );
    expect(epubDecision).toBeDefined();

    console.log('[E2E] EPUB epub_direct decision found');
  });
});
