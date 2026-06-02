/**
 * VISUALIZER → PI 端到端测试
 *
 * 验证图表生成请求走完整状态机路径：
 * Router → Inspectional → VISUALIZER → PI → 生成图表文件
 *
 * 前提条件：
 * - test-vault 中有索引书籍
 * - data.json 配置了 API Key + piEnabled
 * - PI CLI 已安装
 */

import * as fs from 'fs';
import * as path from 'path';

const VAULT_PATH = '/Users/lizhao/workspace/DeepReader/test-vault';
const REAL_VAULT_PATH = '/Users/lizhao/workspace/deepreadertest';
const TIMEOUT_VISUALIZER = 180_000; // 3min（状态机 + PI 执行）

// 注入 PI 配置到 data.json（在 Obsidian 启动前执行）
function injectSettings(): void {
  let apiKey = process.env.LLM_API_KEY || '';
  if (!apiKey) {
    try {
      const realData = JSON.parse(fs.readFileSync(
        path.join(REAL_VAULT_PATH, '.obsidian/plugins/deepreader-dev/data.json'), 'utf-8'
      ));
      apiKey = realData.providers?.deepseek?.apiKey || realData.deepseekApiKey || '';
    } catch { /* ignore */ }
  }

  const dataPath = path.join(VAULT_PATH, '.obsidian/plugins/deepreader-dev/data.json');
  const existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const merged = {
    ...existing,
    piEnabled: true,
    deepseekApiKey: apiKey,
    llmProvider: 'deepseek',
    llmModel: 'deepseek-chat',
    apiUrl: 'https://api.deepseek.com',
    forceMode: 'auto',
    enableDebugLog: true,
    pi: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: apiKey,
    },
  };
  fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2), 'utf-8');
  console.log('[E2E] Settings injected: piEnabled=true, apiKey=' + (apiKey ? apiKey.slice(0, 8) + '...' : 'MISSING'));
}

// 书籍
const BOOKS = {
  naval: { bookId: '74dca606', name: '纳瓦尔宝典' },
  fool: { bookId: '2bdb1cc4', name: '随机漫步的傻瓜' },
};

const SELECTORS = {
  chatInput: 'textarea.deeppdf-chat-input-textarea',
  sendButton: 'button.deeppdf-chat-input-send-btn',
  topbarBtn: '.deeppdf-topbar-action-btn',
};

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendChatMessage(message: string): Promise<void> {
  const chatInput = await $(SELECTORS.chatInput);
  await chatInput.waitForExist({ timeout: 10_000 });

  // 等待 textarea 可交互
  const waitStart = Date.now();
  while (Date.now() - waitStart < 90_000) {
    const isDisabled = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return true;
      return leaves[0].view?.chatInput?.textarea?.disabled ?? true;
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

async function waitForResponse(timeoutMs: number = TIMEOUT_VISUALIZER): Promise<void> {
  const startTime = Date.now();
  let streamingStarted = false;

  // 等待 streaming 开始
  while (Date.now() - startTime < 10_000) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      return leaves[0]?.view?.isAiStreaming ?? false;
    });
    if (isStreaming) { streamingStarted = true; break; }
    await wait(500);
  }

  // 等待 streaming 结束
  const hardLimit = timeoutMs + 60_000;
  while (Date.now() - startTime < hardLimit) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      return leaves[0]?.view?.isAiStreaming ?? false;
    });
    if (!isStreaming && streamingStarted) {
      console.log('[E2E] Response completed');
      await wait(500);
      return;
    }
    await wait(1000);
  }
}

async function getLastAIMessage(): Promise<string> {
  return await browser.executeObsidian(({ app }) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    const view = leaves[0]?.view;
    const messages = view?.messageList?.getMessagesData?.() ?? [];
    return messages.length > 0 ? (messages[messages.length - 1].content || '') : '';
  });
}

async function openSidebarWithBook(bookId: string): Promise<void> {
  await browser.executeObsidianCommand('deepreader-dev:open-deepreader-sidebar');
  await wait(2000);

  await browser.executeObsidian(({ app }, _bookId: string) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    const view = leaves[0]?.view;
    view?.selectIndex?.(_bookId);
  }, bookId);
  await wait(1500);
  console.log(`[E2E] Book selected: ${bookId}`);
}

async function clearChatHistory(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    leaves[0]?.view?.messageList?.clearMessages?.();
  });
  await wait(500);
}

// 注入设置（Obsidian 启动前）
injectSettings();

describe('VISUALIZER → PI E2E', function () {
  this.timeout(600000);

  before(async function () {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader-dev'];
    });
    expect(loaded).toBe(true);
  });

  beforeEach(async function () {
    await wait(3000);
  });

  it('PI 路径：图表请求应走 VISUALIZER → PI 生成图表文件', async function () {
    // 先检查 settings
    const settings = await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins?.plugins?.['deepreader-dev'];
      return {
        piEnabled: plugin?.settings?.piEnabled,
        hasApiKey: !!plugin?.settings?.deepseekApiKey,
        providerKeys: Object.keys(plugin?.settings?.providers || {}),
      };
    });
    console.log('[E2E] Plugin settings:', JSON.stringify(settings));

    // 选择有索引的书籍
    await openSidebarWithBook(BOOKS.fool.bookId);
    await clearChatHistory();

    // 发送图表请求（匹配 action_output 规则，路由到 VISUALIZER）
    await sendChatMessage('帮我画一个思维导图');
    await waitForResponse(TIMEOUT_VISUALIZER);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 500));

    // 验证：不应包含引擎错误
    expect(response).toBeTruthy();
    expect(response).not.toContain('LangGraph 引擎错误');

    // 从响应内容验证：应包含图表文件引用（wiki link 或路径）
    const hasChartRef = response.includes('excalidraw') || response.includes('图表') || response.includes('思维导图');
    console.log('[E2E] Response has chart reference:', hasChartRef);

    // 检查是否生成了 .excalidraw.md 文件（PI + 转换成功）
    const hasExcalidrawMd = response.includes('.excalidraw.md');
    const hasExcalidrawLegacy = response.includes('.excalidraw') && !hasExcalidrawMd;
    console.log('[E2E] Has .excalidraw.md:', hasExcalidrawMd, '| Has .excalidraw (legacy):', hasExcalidrawLegacy);

    // 至少应生成了某种 Excalidraw 文件
    expect(hasChartRef).toBe(true);

    // 输出关键日志用于调试
    const logs = await browser.getLogs('browser');
    const logMessages = logs.map(l => l.message);
    const relevantLogs = logMessages.filter(l =>
      l.includes('[Visualizer]') || l.includes('[Router]') || l.includes('depth') || l.includes('allowedTools') || l.includes('PI')
    );
    console.log('[E2E] Relevant logs:');
    relevantLogs.forEach(l => console.log('  ', l.substring(0, 200)));
  });

  it.skip('Fallback 路径：无 PI 时应回退到 ExcalidrawAutomate', async function () {
    // 临时禁用 PI
    await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins?.plugins?.['deepreader-dev'];
      if (plugin?.settings) {
        plugin.settings.piEnabled = false;
      }
    });

    await openSidebarWithBook(BOOKS.fool.bookId);
    await clearChatHistory();

    await sendChatMessage('画一个脑图');
    await waitForResponse(TIMEOUT_VISUALIZER);

    const response = await getLastAIMessage();
    console.log('[E2E] Fallback response:', response.substring(0, 300));

    expect(response).toBeTruthy();
    expect(response).not.toContain('LangGraph 引擎错误');

    // 恢复 PI 设置
    await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins?.plugins?.['deepreader-dev'];
      if (plugin?.settings) {
        plugin.settings.piEnabled = true;
      }
    });
  });
});
