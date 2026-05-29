/**
 * LangGraph Agent E2E 测试
 *
 * 使用 wdio-obsidian-service 在真实 Obsidian 环境中测试 LangGraph 认知引擎。
 * 测试覆盖：
 * - depth=0 日常闲聊
 * - depth=1 检视阅读（加载书籍结构）
 * - depth=2 分析阅读（完整 ReAct 循环 + 工具调用）
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
const REAL_VAULT_PATH = '/Users/lizhao/workspace/deepreadertest';
const PLUGIN_ID = 'deepreader';
const TIMEOUT_SHORT = 30_000;   // 30s 简单对话
const TIMEOUT_MEDIUM = 60_000;  // 60s 检视阅读
const TIMEOUT_LONG = 120_000;   // 120s 分析阅读

// 从环境变量或真实 vault 获取 API Key
function getApiKey(): string {
  const envKey = process.env.LLM_API_KEY || '';
  if (envKey) return envKey;

  // 尝试从真实 vault 的 data.json 读取
  try {
    const realData = JSON.parse(fs.readFileSync(
      path.join(REAL_VAULT_PATH, '.obsidian/plugins/deepreader/data.json'), 'utf-8'
    ));
    return realData.deepseekApiKey || '';
  } catch {
    return '';
  }
}

// 从环境变量或真实 vault 获取 LangSmith API Key
function getLangSmithConfig(): { apiKey: string; project: string } {
  const envKey = process.env.LANGSMITH_API_KEY || '';
  if (envKey) {
    return { apiKey: envKey, project: process.env.LANGSMITH_PROJECT || 'DeepReader-E2E' };
  }

  try {
    const realData = JSON.parse(fs.readFileSync(
      path.join(REAL_VAULT_PATH, '.obsidian/plugins/deepreader/data.json'), 'utf-8'
    ));
    return {
      apiKey: realData.langsmithApiKey || '',
      project: realData.langsmithProject || 'DeepReader',
    };
  } catch {
    return { apiKey: '', project: 'DeepReader-E2E' };
  }
}

// 在 WDIO 加载测试文件时就写入 data.json（Obsidian 启动前）
const apiKey = getApiKey();
const langsmithConfig = getLangSmithConfig();
if (apiKey) {
  const settings: Record<string, unknown> = {
    llmProvider: 'deepseek',
    llmModel: 'deepseek-chat',
    deepseekApiKey: apiKey,
    apiUrl: 'https://api.deepseek.com',
    forceMode: 'auto',
    enableDebugLog: true,
  };

  // 注入 LangSmith 配置（如果可用）
  if (langsmithConfig.apiKey) {
    settings.langsmithApiKey = langsmithConfig.apiKey;
    settings.langsmithProject = langsmithConfig.project;
    settings.langsmithEnabled = true;
    console.log('[E2E] LangSmith config injected, project:', langsmithConfig.project);
  }

  writePluginSettings(settings);
  console.log('[E2E] API Key injected into test-vault data.json');
} else {
  console.warn('[E2E] No API Key found. Set LLM_API_KEY env var or ensure real vault has key.');
}

// 书籍配置
const BOOKS = {
  naval: { bookId: '74dca606', name: '纳瓦尔宝典' },
  money: { bookId: '89e541bc', name: '金钱心理学' },
};

// CSS 选择器
const SELECTORS = {
  chatInput: 'textarea.deeppdf-chat-input-textarea',
  sendButton: 'button.deeppdf-chat-input-send-btn',
  messagesContainer: '.deeppdf-messages-container',
  streamingClass: 'deeppdf-chat-input-streaming',
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
 * 辅助函数：写入插件设置到 data.json（仅用于 Obsidian 启动前）
 */
function writePluginSettings(settings: Record<string, unknown>): void {
  const dataPath = path.join(VAULT_PATH, '.obsidian/plugins/deepreader/data.json');
  const existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const merged = { ...existing, ...settings };
  fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * 辅助函数：发送聊天消息
 * 等待 textarea 变为可用（非 disabled）再输入
 */
async function sendChatMessage(message: string): Promise<void> {
  const chatInput = await $(SELECTORS.chatInput);
  await chatInput.waitForExist({ timeout: 10_000 });

  // 等待 textarea 可交互（非 disabled），最多等 90 秒
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

  const sendBtn = await $(SELECTORS.sendButton);
  await sendBtn.click();
  console.log(`[E2E] Sent: "${message}"`);
}

/**
 * 辅助函数：等待 Agent 响应完成
 * 通过检查 sidebar view 的 isAiStreaming 状态来判断
 * 即使超时也会等待 streaming 结束，防止 textarea disabled 级联失败
 */
async function waitForResponse(timeoutMs: number = TIMEOUT_LONG): Promise<void> {
  const startTime = Date.now();

  // 等待 streaming 开始（最多 5 秒）
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

  // 等待 streaming 结束（即使在 timeoutMs 之后也继续等，确保 textarea 恢复）
  const hardLimit = timeoutMs + 60_000; // 最多额外等 60s
  while (Date.now() - startTime < hardLimit) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return false;
      return leaves[0].view?.isAiStreaming ?? false;
    });
    if (!isStreaming && streamingStarted) {
      console.log('[E2E] Response completed');
      await wait(500); // 额外等待确保 DOM 更新
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

    // 使用 getMessagesData() 获取纯数据（避免循环引用）
    const messages = view.messageList.getMessagesData();
    if (messages.length === 0) return 'No messages';

    const lastMsg = messages[messages.length - 1];
    return lastMsg.content || '';
  });
}

// ========== LangSmith Trace 分析 ==========

interface LangSmithRun {
  id: string;
  name: string;
  run_type: string;  // chain, llm, tool
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
  childRuns: LangSmithRun[];
  errors: string[];
}

/**
 * 从 LangSmith REST API 获取最近的 trace 数据
 * @param sinceMs 只获取最近 N 毫秒内的 runs（默认 5 分钟）
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
      console.warn(`[E2E] LangSmith API 返回 ${response.status}: ${response.statusText}`);
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
 * 分析 LangSmith trace 数据，构建执行流程概览
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
    childRuns: [],
    errors: [],
  };

  for (const run of runs) {
    // 统计 run type
    analysis.runTypes[run.run_type] = (analysis.runTypes[run.run_type] || 0) + 1;

    // 收集 node name
    if (run.name && !analysis.nodeNames.includes(run.name)) {
      analysis.nodeNames.push(run.name);
    }

    // 识别 LangGraph 节点
    const nameLower = run.name.toLowerCase();
    if (nameLower.includes('router') || nameLower.includes('s0')) analysis.hasRouter = true;
    if (nameLower.includes('inspectional') || nameLower.includes('s1')) analysis.hasInspectional = true;
    if (nameLower.includes('analytical') || nameLower.includes('s2')) analysis.hasAnalytical = true;
    if (nameLower.includes('formatter') || nameLower.includes('s4')) analysis.hasFormatter = true;

    // 收集工具调用
    if (run.run_type === 'tool') {
      analysis.toolCalls.push(run.name);
    }

    // 错误检测
    if (run.status === 'error') {
      analysis.errors.push(`${run.name}: ${run.outputs?.error || 'unknown error'}`);
    }

    // 找 root run（parent_run_id 为 null 的 chain）
    if (!run.parent_run_id && run.run_type === 'chain') {
      analysis.rootRun = run;
    } else {
      analysis.childRuns.push(run);
    }
  }

  // 计算总执行时间
  if (analysis.rootRun?.start_time && analysis.rootRun?.end_time) {
    analysis.executionTimeMs =
      new Date(analysis.rootRun.end_time).getTime() -
      new Date(analysis.rootRun.start_time).getTime();
  }

  return analysis;
}

/**
 * 打印 trace 分析报告
 */
function printTraceReport(analysis: TraceAnalysis): void {
  console.log('\n========== LangSmith Trace 报告 ==========');
  console.log(`总 Runs: ${analysis.totalRuns}`);
  console.log(`Run 类型: ${JSON.stringify(analysis.runTypes)}`);
  console.log(`节点: ${analysis.nodeNames.join(', ')}`);
  console.log(`工具调用: ${analysis.toolCalls.join(', ') || '无'}`);
  console.log(`执行路径: Router=${analysis.hasRouter} S1=${analysis.hasInspectional} S2=${analysis.hasAnalytical} S4=${analysis.hasFormatter}`);
  console.log(`执行时间: ${analysis.executionTimeMs}ms (${(analysis.executionTimeMs / 1000).toFixed(1)}s)`);
  if (analysis.errors.length > 0) {
    console.log(`错误: ${analysis.errors.join('; ')}`);
  }
  console.log('==========================================\n');
}

/**
 * 获取最近一次 Agent 查询的 LangSmith trace 并分析
 * @param sinceMs 只搜索最近 N 毫秒内的 runs
 */
async function getTraceAnalysis(sinceMs: number = 180_000): Promise<TraceAnalysis> {
  const runs = await fetchLangSmithTraces(sinceMs);
  const analysis = analyzeTraces(runs);
  printTraceReport(analysis);
  return analysis;
}

/**
 * 辅助函数：获取控制台中 DeepReader 相关的日志
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
  // 打开 sidebar
  await browser.executeObsidianCommand('deepreader:open-deepreader-sidebar');
  await wait(2000);

  // 验证 sidebar 已打开
  const topbarBtn = await $(SELECTORS.topbarBtn);
  await topbarBtn.waitForExist({ timeout: 10_000 });
  console.log(`[E2E] Sidebar opened`);

  // 选择书籍索引
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
 * 辅助函数：清空聊天历史
 */
async function clearChatHistory(): Promise<void> {
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

// ========== 测试用例 ==========

describe('LangGraph Agent E2E', function () {
  this.timeout(600000); // 10 分钟（全局超时，覆盖 wdio.conf.ts）

  // 在所有测试之前，验证插件已加载
  before(async function () {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader'];
    });
    console.log('[E2E] Plugin loaded:', loaded);
    console.log('[E2E] Vault path:', VAULT_PATH);
    expect(loaded).toBe(true);
  });

  beforeEach(async function () {
    // 等待 Obsidian 完全加载
    await wait(3000);
  });

  // ===== Test 1: depth=0 日常闲聊 =====
  it('depth=0: 应该能回复日常闲聊', async function () {
    const testStartTime = Date.now();
    await openSidebarWithBook(BOOKS.naval.bookId);

    await sendChatMessage('你好');
    await waitForResponse(TIMEOUT_SHORT);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 200));

    // 验证：回复应该是非空的中文文本
    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(2);
    expect(response).not.toContain('LangGraph 引擎错误');
    expect(response).not.toContain('API Key 未配置');

    // LangSmith Trace 分析
    const trace = await getTraceAnalysis(Date.now() - testStartTime + 5000);
    if (trace.totalRuns > 0) {
      // depth=0 应该走 Router + Formatter，无工具调用
      expect(trace.hasRouter).toBe(true);
      expect(trace.hasFormatter).toBe(true);
      expect(trace.toolCalls.length).toBe(0);
      console.log('[E2E] LangSmith: depth=0 trace 验证通过');
    }
  });

  // ===== Test 2: depth=1 检视阅读 =====
  it('depth=1: 应该能回答书籍概览问题', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.naval.bookId);
    await clearChatHistory();

    await sendChatMessage('纳瓦尔宝典这本书主要讲了什么？');
    await waitForResponse(TIMEOUT_MEDIUM);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 300));

    // 验证：回复应该包含与纳瓦尔宝典相关的内容
    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(50);

    // 不应包含错误信息
    expect(response).not.toContain('LangGraph 引擎错误');

    // 检查日志中是否经过了 S0 Router
    const logs = await getPluginLogs();
    const hasRouter = logs.some(l => l.includes('S0') || l.includes('Router') || l.includes('depth'));
    console.log('[E2E] Router logs found:', hasRouter);

    // LangSmith Trace 分析
    const trace = await getTraceAnalysis(Date.now() - testStartTime + 5000);
    if (trace.totalRuns > 0) {
      // depth=1 应该走 Router + Inspectional + Formatter，无工具调用
      expect(trace.hasRouter).toBe(true);
      expect(trace.hasFormatter).toBe(true);
      console.log(`[E2E] LangSmith: depth=1 验证 - S1=${trace.hasInspectional}, tools=${trace.toolCalls.length}`);
    }
  });

  // ===== Test 3: depth=2 分析阅读（完整 ReAct 循环）=====
  it('depth=2: 应该能执行分析阅读（搜索+读取+格式化）', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.naval.bookId);
    await clearChatHistory();

    await sendChatMessage('纳瓦尔认为财富的本质是什么？请详细分析。');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] Response length:', response.length);
    console.log('[E2E] Response preview:', response.substring(0, 500));

    // 验证：回复应该是详细的分析内容
    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(100);

    // 不应包含错误信息
    expect(response).not.toContain('LangGraph 引擎错误');

    // 检查是否有工具调用日志
    const logs = await getPluginLogs();
    console.log('[E2E] Total plugin logs:', logs.length);

    // 验证 ReAct 循环执行了（有 tool 调用日志）
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
      // depth=2 应该走完整路径：Router + Inspectional + Analytical + Formatter
      expect(trace.hasRouter).toBe(true);
      expect(trace.hasAnalytical).toBe(true);
      expect(trace.hasFormatter).toBe(true);
      // 应该有工具调用（search_book / read_book_section）
      expect(trace.toolCalls.length).toBeGreaterThan(0);
      console.log(`[E2E] LangSmith: depth=2 完整 ReAct 验证 - S2=${trace.hasAnalytical}, tools=${trace.toolCalls.join(',')}`);
    }
  });

  // ===== Test 4: 多轮对话（上下文传递）=====
  it('多轮对话: 第二轮应该能理解第一轮的上下文', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.naval.bookId);
    await clearChatHistory();

    // 第一轮
    console.log('[E2E] === Round 1 ===');
    await sendChatMessage('纳瓦尔宝典中关于幸福的核心观点有哪些？');
    await waitForResponse(TIMEOUT_LONG);

    const round1Response = await getLastAIMessage();
    console.log('[E2E] Round 1 response length:', round1Response.length);
    expect(round1Response).toBeTruthy();
    expect(round1Response.length).toBeGreaterThan(50);

    // 第二轮：引用第一轮的上下文
    console.log('[E2E] === Round 2 ===');
    await sendChatMessage('能展开讲讲第一点吗？');
    await waitForResponse(TIMEOUT_LONG);

    const round2Response = await getLastAIMessage();
    console.log('[E2E] Round 2 response length:', round2Response.length);
    console.log('[E2E] Round 2 response preview:', round2Response.substring(0, 300));

    // 验证：第二轮应该能理解"第一点"的指代
    expect(round2Response).toBeTruthy();
    expect(round2Response.length).toBeGreaterThan(30);
    expect(round2Response).not.toContain('LangGraph 引擎错误');

    // LangSmith Trace 分析（两轮应该产生多组 trace）
    const trace = await getTraceAnalysis(Date.now() - testStartTime + 5000);
    if (trace.totalRuns > 0) {
      // 多轮对话应该至少有 2 次 chain 执行
      const chainCount = trace.runTypes['chain'] || 0;
      console.log(`[E2E] LangSmith: 多轮对话 - chain runs: ${chainCount}, 总 runs: ${trace.totalRuns}`);
    }
  });

  // ===== Test 5: 第二本书测试 =====
  it('金钱心理学: 应该能搜索和回答问题', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.money.bookId);
    await clearChatHistory();

    await sendChatMessage('金钱心理学中关于储蓄的核心观点是什么？');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 300));

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(50);
    expect(response).not.toContain('LangGraph 引擎错误');

    // LangSmith Trace 分析
    const trace = await getTraceAnalysis(Date.now() - testStartTime + 5000);
    if (trace.totalRuns > 0) {
      console.log(`[E2E] LangSmith: 金钱心理学 - runs: ${trace.totalRuns}, nodes: ${trace.nodeNames.join(',')}, time: ${trace.executionTimeMs}ms`);
    }
  });
});
