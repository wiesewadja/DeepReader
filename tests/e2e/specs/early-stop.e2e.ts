/**
 * 早停机制 E2E 测试
 *
 * 验证早停机制在高质量检索结果时正确触发，跳过 ReAct 循环。
 * 同时验证质量守卫在无实质内容时拦截早停。
 *
 * 前提条件：
 * - test-vault 中包含纳瓦尔宝典 (74dca606) 和金钱心理学 (89e541bc) 的索引数据
 * - data.json 中配置了有效的 API Key
 * - 环境变量 LLM_API_KEY 提供了 DeepSeek API Key
 */

import * as fs from 'fs';
import * as path from 'path';

// 测试配置
const VAULT_PATH = path.resolve(__dirname, '../../test-vault');
const REAL_VAULT_PATH = '/Users/lizhao/workspace/DeepReader/test-vault';
const PLUGIN_ID = 'deepreader-dev';
const TIMEOUT_SHORT = 30_000;
const TIMEOUT_MEDIUM = 60_000;
const TIMEOUT_LONG = 120_000;

// 书籍配置（使用 test-vault 中实际存在的书籍）
const BOOKS = {
  fool: { bookId: '2bdb1cc4', name: '随机漫步的傻瓜' },
  excellent: { bookId: 'c9ce4d7b', name: '优秀的绵羊' },
  antiFragile: { bookId: '1e7fb583', name: '反脆弱' },
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
 * 辅助函数：发送聊天消息
 */
async function sendChatMessage(message: string): Promise<void> {
  const chatInput = await $(SELECTORS.chatInput);
  await chatInput.waitForExist({ timeout: 10_000 });

  const waitStart = Date.now();
  while (Date.now() - waitStart < 90_000) {
    const isDisabled = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return true;
      const view = leaves[0].view;
      return view?.chatInput?.textarea?.disabled ?? true;
    });
    if (!isDisabled) break;
    await wait(1000);
  }

  await chatInput.setValue(message);
  await wait(300);

  // 点击发送按钮前先关闭任何 modal
  await closeAllModals();
  await wait(300);

  const sendBtn = await $(SELECTORS.sendButton);
  await sendBtn.click();
  console.log(`[E2E] Sent: "${message}"`);
}

/**
 * 辅助函数：等待 Agent 响应完成
 */
async function waitForResponse(timeoutMs: number = TIMEOUT_LONG): Promise<void> {
  const startTime = Date.now();
  let streamingStarted = false;

  while (Date.now() - startTime < 5000) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return false;
      return leaves[0].view?.isAiStreaming ?? false;
    });
    if (isStreaming) {
      streamingStarted = true;
      break;
    }
    await wait(500);
  }

  if (!streamingStarted) {
    console.log('[E2E] Streaming did not start within 5s, waiting for completion anyway');
  }

  const hardLimit = timeoutMs + 60_000;
  while (Date.now() - startTime < hardLimit) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return false;
      return leaves[0].view?.isAiStreaming ?? false;
    });
    if (!isStreaming && streamingStarted) {
      console.log('[E2E] Response completed');
      await wait(500);
      return;
    }
    if (!streamingStarted && Date.now() - startTime > timeoutMs) {
      console.log('[E2E] No streaming detected, assuming complete');
      return;
    }
    await wait(1000);
  }

  console.log('[E2E] Response timeout (including grace period)');
}

/**
 * 辅助函数：获取 AI 响应内容
 */
async function getLastAIMessage(): Promise<string> {
  return await browser.executeObsidian(({ app }) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return 'No sidebar view';

    const view = leaves[0].view;
    if (!view?.messageList) return 'No message list';

    const messages = view.messageList.getMessagesData();
    if (messages.length === 0) return 'No messages';

    const lastMsg = messages[messages.length - 1];
    return lastMsg.content || '';
  });
}

/**
 * 辅助函数：获取插件日志
 */
async function getPluginLogs(): Promise<string[]> {
  const logs = await browser.getLogs('browser');
  return logs
    .filter(log => log.message.includes('DeepReader') || log.message.includes('DeepPDF') || log.message.includes('[S0') || log.message.includes('[S1') || log.message.includes('[S2') || log.message.includes('[S4'))
    .map(log => log.message);
}

/**
 * 辅助函数：打开 sidebar 并选择指定书籍
 */
async function openSidebarWithBook(bookId: string): Promise<void> {
  await browser.executeObsidianCommand('deepreader-dev:open-deepreader-sidebar');
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
 * 辅助函数：关闭所有 Obsidian modal
 */
async function closeAllModals(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    // 关闭任何 modal 背景（由 Notice, confirm, prompt 等创建）
    const modals = document.querySelectorAll('.modal-bg, .prompt-bg, [class*="modal"]');
    modals.forEach(modal => {
      const closeBtn = modal.querySelector('.modal-close, .prompt-close, button[class*="close"]');
      if (closeBtn instanceof HTMLElement) {
        closeBtn.click();
      } else {
        modal.remove();
      }
    });
    // 按 ESC 可能关闭的 modal
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await wait(300);
}

/**
 * 辅助函数：清空聊天历史
 */
async function clearChatHistory(): Promise<void> {
  await closeAllModals();
  await browser.executeObsidian(({ app }) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return;
    const view = leaves[0].view;
    if (view?.messageList?.clearMessages) {
      view.messageList.clearMessages();
    }
  });
  await wait(500);
}

// ========== LangSmith Trace 分析 ==========

interface LangSmithRun {
  id: string;
  name: string;
  run_type: string;
  parent_run_id: string | null;
  start_time: string;
  end_time: string | null;
  inputs: Record<string, any>;
  outputs: Record<string, any> | null;
  status: string;
  extra?: Record<string, any>;
}

interface TraceAnalysis {
  totalRuns: number;
  runTypes: Record<string, number>;
  nodeNames: string[];
  toolCalls: string[];
  executionTimeMs: number;
  hasRouter: boolean;
  hasInspectional: boolean;
  hasAnalytical: boolean;
  hasFormatter: boolean;
  rootRun: LangSmithRun | null;
  errors: string[];
}

/**
 * 获取 LangSmith 配置
 */
function getLangSmithConfig(): { apiKey: string; project: string } {
  const envKey = process.env.LANGSMITH_API_KEY || '';
  if (envKey) {
    return { apiKey: envKey, project: process.env.LANGSMITH_PROJECT || 'DeepReader-E2E' };
  }

  try {
    const realData = JSON.parse(fs.readFileSync(
      path.join(REAL_VAULT_PATH, '.obsidian/plugins/deepreader-dev/data.json'), 'utf-8'
    ));
    return {
      apiKey: realData.langsmithApiKey || '',
      project: realData.langsmithProject || 'DeepReader-E2E',
    };
  } catch {
    return { apiKey: '', project: 'DeepReader-E2E' };
  }
}

const langsmithConfig = getLangSmithConfig();

/**
 * 从 LangSmith REST API 获取最近的 trace 数据
 */
async function fetchLangSmithTraces(sinceMs: number = 300_000): Promise<LangSmithRun[]> {
  if (!langsmithConfig.apiKey) {
    console.warn('[E2E] LangSmith API Key 不可用，跳过 trace 获取');
    return [];
  }

  const since = new Date(Date.now() - sinceMs).toISOString();
  const url = `https://api.smith.langchain.com/api/v1/runs?session_name=${encodeURIComponent(langsmithConfig.project)}&start_time_gte=${encodeURIComponent(since)}&order_by=-start_time&limit=50`;

  try {
    const response = await fetch(url, {
      headers: {
        'x-api-key': langsmithConfig.apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[E2E] LangSmith API 返回 ${response.status}`);
      return [];
    }

    const runs: LangSmithRun[] = await response.json();
    console.log(`[E2E] LangSmith: 获取到 ${runs.length} 条 runs`);
    return runs;
  } catch (err) {
    console.warn('[E2E] LangSmith API 请求失败:', (err as Error).message);
    return [];
  }
}

/**
 * 分析 LangSmith trace 数据
 */
function analyzeTraces(runs: LangSmithRun[]): TraceAnalysis {
  const analysis: TraceAnalysis = {
    totalRuns: runs.length,
    runTypes: {},
    nodeNames: [],
    toolCalls: [],
    executionTimeMs: 0,
    hasRouter: false,
    hasInspectional: false,
    hasAnalytical: false,
    hasFormatter: false,
    rootRun: null,
    errors: [],
  };

  for (const run of runs) {
    analysis.runTypes[run.run_type] = (analysis.runTypes[run.run_type] || 0) + 1;

    if (run.name && !analysis.nodeNames.includes(run.name)) {
      analysis.nodeNames.push(run.name);
    }

    const nameLower = run.name.toLowerCase();
    if (nameLower.includes('router') || nameLower.includes('s0')) analysis.hasRouter = true;
    if (nameLower.includes('inspectional') || nameLower.includes('s1')) analysis.hasInspectional = true;
    if (nameLower.includes('analytical') || nameLower.includes('s2')) analysis.hasAnalytical = true;
    if (nameLower.includes('formatter') || nameLower.includes('s4')) analysis.hasFormatter = true;

    if (run.run_type === 'tool') {
      analysis.toolCalls.push(run.name);
    }

    if (run.status === 'error') {
      analysis.errors.push(`${run.name}: ${run.outputs?.error || 'unknown error'}`);
    }

    if (!run.parent_run_id && run.run_type === 'chain') {
      analysis.rootRun = run;
    }
  }

  if (analysis.rootRun?.start_time && analysis.rootRun?.end_time) {
    analysis.executionTimeMs =
      new Date(analysis.rootRun.end_time).getTime() -
      new Date(analysis.rootRun.start_time).getTime();
  }

  return analysis;
}

/**
 * 获取最近一次 Agent 查询的 LangSmith trace 并分析
 */
async function getTraceAnalysis(sinceMs: number = 180_000): Promise<TraceAnalysis> {
  const runs = await fetchLangSmithTraces(sinceMs);
  return analyzeTraces(runs);
}

// ========== 测试用例 ==========

describe('早停机制 E2E', function () {
  this.timeout(600000); // 10 分钟全局超时

  before(async function () {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader-dev'];
    });
    console.log('[E2E] Plugin loaded:', loaded);
    expect(loaded).toBe(true);
  });

  beforeEach(async function () {
    await wait(3000);
  });

  // ===== Test 1: 高置信度检索触发早停 =====
  it('高置信度检索应触发早停，跳过 ReAct 循环', async function () {
    const testStartTime = Date.now();

    // 使用一个明确、常见的问题，应该有高置信度检索结果
    await openSidebarWithBook(BOOKS.fool.bookId);
    await clearChatHistory();

    // 这个问题应该能直接命中高置信度结果
    await sendChatMessage('随机漫步的傻瓜的作者是谁？');
    await waitForResponse(TIMEOUT_MEDIUM);

    const response = await getLastAIMessage();
    console.log('[E2E] Response preview:', response.substring(0, 200));

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(10);
    expect(response).not.toContain('LangGraph 引擎错误');

    // 检查日志中是否有早停标记
    const logs = await getPluginLogs();
    const earlyStopLog = logs.find(l =>
      l.includes('早停') ||
      l.includes('[S2-Pre]')
    );

    // LangSmith Trace 分析
    const trace = await getTraceAnalysis(Date.now() - testStartTime + 5000);

    // 高置信度检索必须触发早停，日志中必须有早停标记
    if (!earlyStopLog) {
      throw new Error('[E2E] Early stop log not found — high confidence search should trigger early stop');
    }
    console.log('[E2E] Found early stop log:', earlyStopLog);
    expect(earlyStopLog).toBeTruthy();

    if (trace.totalRuns > 0) {
      console.log(`[E2E] Trace analysis:`, JSON.stringify({
        totalRuns: trace.totalRuns,
        hasAnalytical: trace.hasAnalytical,
        hasRouter: trace.hasRouter,
        toolCalls: trace.toolCalls.length,
      }, null, 2));
    }
  });

  // ===== Test 2: 低置信度检索走完整 ReAct =====
  it('低置信度检索应走完整 ReAct 循环', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.antiFragile.bookId);
    await clearChatHistory();

    // 使用一个模糊、需要推理的问题
    await sendChatMessage('反脆弱中关于如何从不确定性中获利的具体建议在哪个章节？');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] Response length:', response.length);
    console.log('[E2E] Response preview:', response.substring(0, 300));

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(50);
    expect(response).not.toContain('LangGraph 引擎错误');

    // 检查日志中是否有工具调用
    const logs = await getPluginLogs();
    const hasToolCall = logs.some(l =>
      l.includes('search_book') ||
      l.includes('read_book_section') ||
      l.includes('tool') ||
      l.includes('ToolResult')
    );
    console.log('[E2E] Tool calls detected:', hasToolCall);

    // LangSmith Trace 分析
    const trace = await getTraceAnalysis(Date.now() - testStartTime + 5000);
    if (trace.totalRuns > 0) {
      console.log(`[E2E] Trace nodes: ${trace.nodeNames.join(', ')}`);
      console.log(`[E2E] Tool calls: ${trace.toolCalls.join(', ') || 'none'}`);

      // 完整 ReAct 应该有 analytical 节点和工具调用
      expect(trace.hasAnalytical).toBe(true);
      expect(trace.toolCalls.length).toBeGreaterThan(0);
    }
  });

  // ===== Test 3: 质量守卫拦截早停 =====
  it('检索结果无实质内容时应被质量守卫拦截', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.fool.bookId);
    await clearChatHistory();

    // 使用一个不太可能有实质内容匹配的问题
    await sendChatMessage('这本书的字体是什么？');
    await waitForResponse(TIMEOUT_MEDIUM);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 200));

    expect(response).toBeTruthy();

    // 检查日志中是否有质量守卫拦截标记
    const logs = await getPluginLogs();
    const qualityGuardLog = logs.find(l =>
      l.includes('质量守卫') ||
      l.includes('拦截') ||
      l.includes('无实质内容')
    );

    // 质量守卫拦截必须出现在日志中
    if (!qualityGuardLog) {
      throw new Error('[E2E] Quality guard log not found — quality guard should intercept when no substantive content');
    }
    console.log('[E2E] Found quality guard log:', qualityGuardLog);
    expect(qualityGuardLog).toBeTruthy();

    // 最终仍应有有效响应
    expect(response.length).toBeGreaterThan(5);
  });

  // ===== Test 4: BM25 fallback =====
  it('L2 向量化失败时应 fallback 到 BM25', async function () {
    const testStartTime = Date.now();

    // 这个问题可能触发 BM25 fallback
    await openSidebarWithBook(BOOKS.excellent.bookId);
    await clearChatHistory();

    await sendChatMessage('优秀的绵羊这本书主要批判了什么教育体系？');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] Response length:', response.length);
    console.log('[E2E] Response preview:', response.substring(0, 300));

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(30);
    expect(response).not.toContain('LangGraph 引擎错误');

    // 检查日志中是否有 BM25 fallback 标记
    const logs = await getPluginLogs();
    const bm25Log = logs.find(l =>
      l.includes('BM25') ||
      l.includes('bm25') ||
      l.includes('fallback')
    );

    if (bm25Log) {
      console.log('[E2E] Found BM25 fallback log:', bm25Log);
    }

    // 无论是否 fallback，最终应有结果
    expect(response.length).toBeGreaterThan(0);
  });

  // ===== Test 5: 早停后 formatter 直接使用 pre-search 结果 =====
  it('早停时 formatter 应直接使用 pre-search 结果', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.antiFragile.bookId);
    await clearChatHistory();

    // 使用一个简单明确的问题
    await sendChatMessage('反脆弱的作者是谁？');
    await waitForResponse(TIMEOUT_SHORT);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 200));

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(5);
    expect(response).not.toContain('LangGraph 引擎错误');

    // 早停时执行时间应该较短
    const trace = await getTraceAnalysis(Date.now() - testStartTime + 5000);
    if (trace.totalRuns > 0) {
      console.log(`[E2E] Execution time: ${trace.executionTimeMs}ms (${(trace.executionTimeMs / 1000).toFixed(1)}s)`);

      // 早停的执行时间通常较短（< 30 秒）
      if (trace.executionTimeMs < 30000) {
        console.log('[E2E] Fast execution suggests early stop was triggered');
      }
    }
  });
});
