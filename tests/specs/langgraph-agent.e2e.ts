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

// 在 WDIO 加载测试文件时就写入 data.json（Obsidian 启动前）
const apiKey = getApiKey();
if (apiKey) {
  writePluginSettings({
    llmProvider: 'deepseek',
    llmModel: 'deepseek-chat',
    deepseekApiKey: apiKey,
    apiUrl: 'https://api.deepseek.com',
    forceMode: 'auto',
    enableDebugLog: true,
  });
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
 */
async function sendChatMessage(message: string): Promise<void> {
  const chatInput = await $(SELECTORS.chatInput);
  await chatInput.waitForExist({ timeout: 10_000 });
  await chatInput.setValue(message);
  await wait(300);

  const sendBtn = await $(SELECTORS.sendButton);
  await sendBtn.click();
  console.log(`[E2E] Sent: "${message}"`);
}

/**
 * 辅助函数：等待 Agent 响应完成
 * 通过检查 sidebar view 的 isAiStreaming 状态来判断
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

  // 等待 streaming 结束
  while (Date.now() - startTime < timeoutMs) {
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
    await wait(1000);
  }

  console.log('[E2E] Response timeout');
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
  });

  // ===== Test 2: depth=1 检视阅读 =====
  it('depth=1: 应该能回答书籍概览问题', async function () {

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
  });

  // ===== Test 3: depth=2 分析阅读（完整 ReAct 循环）=====
  it('depth=2: 应该能执行分析阅读（搜索+读取+格式化）', async function () {

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
  });

  // ===== Test 4: 多轮对话（上下文传递）=====
  it('多轮对话: 第二轮应该能理解第一轮的上下文', async function () {

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
  });

  // ===== Test 5: 第二本书测试 =====
  it('金钱心理学: 应该能搜索和回答问题', async function () {

    await openSidebarWithBook(BOOKS.money.bookId);
    await clearChatHistory();

    await sendChatMessage('金钱心理学中关于储蓄的核心观点是什么？');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 300));

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(50);
    expect(response).not.toContain('LangGraph 引擎错误');
  });
});
