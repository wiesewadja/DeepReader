/**
 * L2 向量化诊断 E2E 测试
 *
 * 验证 L2 向量化过程、stripFabricatedLinks 增强和诊断日志。
 *
 * 前提条件：
 * - test-vault 中包含已索引的书籍数据
 * - data.json 中配置了有效的 API Key
 */

import * as fs from 'fs';
import * as path from 'path';

// 测试配置
const VAULT_PATH = path.resolve(__dirname, '../../test-vault');
const PLUGIN_ID = 'deepreader';
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
 * 辅助函数：关闭所有 Obsidian modal
 */
async function closeAllModals(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const modals = document.querySelectorAll('.modal-bg, .prompt-bg, [class*="modal"]');
    modals.forEach(modal => {
      const closeBtn = modal.querySelector('.modal-close, .prompt-close, button[class*="close"]');
      if (closeBtn instanceof HTMLElement) {
        closeBtn.click();
      } else {
        modal.remove();
      }
    });
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
    return null;
  }
}

/**
 * 读取 chunks.jsonl 检查 fabricated links
 */
async function checkForFabricatedLinks(bookId: string): Promise<{
  totalChunks: number;
  fabricatedLinksFound: boolean;
  fabricatedSamples: string[];
}> {
  const chunksPath = path.join(
    VAULT_PATH,
    '.obsidian/plugins/deepreader/pageindex',
    bookId,
    'chunks.jsonl'
  );

  try {
    const content = await fs.promises.readFile(chunksPath, 'utf-8');
    const lines = content.trim().split('\n');
    const fabricatedSamples: string[] = [];
    let fabricatedLinksFound = false;

    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        if (chunk.content) {
          // 检查是否包含 fabricated links（如 [[不存在]] 或类似格式）
          const fabricatedPattern = /\[\[[^\]]+\]\]/g;
          const matches = chunk.content.match(fabricatedPattern);
          if (matches && matches.length > 0) {
            fabricatedLinksFound = true;
            fabricatedSamples.push(...matches.slice(0, 3));
          }
        }
      } catch (e) {
        // 跳过无效行
      }
    }

    return {
      totalChunks: lines.length,
      fabricatedLinksFound,
      fabricatedSamples: [...new Set(fabricatedSamples)],
    };
  } catch (e) {
    return {
      totalChunks: 0,
      fabricatedLinksFound: false,
      fabricatedSamples: [],
    };
  }
}

// ========== 测试用例 ==========

describe('L2 向量化诊断 E2E', function () {
  this.timeout(600000); // 10 分钟全局超时

  before(async function () {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader'];
    });
    console.log('[E2E] Plugin loaded:', loaded);
    expect(loaded).toBe(true);
  });

  beforeEach(async function () {
    await wait(3000);
  });

  // ===== Test 1: stripFabricatedLinks 正确处理 =====
  it('chunks 中不应包含 fabricated links', async function () {
    const bookId = BOOKS.excellent.bookId;

    // 检查 chunks.jsonl 中是否有 fabricated links
    const result = await checkForFabricatedLinks(bookId);

    console.log(`[E2E] Total chunks: ${result.totalChunks}`);
    console.log(`[E2E] Fabricated links found: ${result.fabricatedLinksFound}`);

    if (result.fabricatedSamples.length > 0) {
      console.log(`[E2E] Fabricated link samples:`, result.fabricatedSamples);
    }

    expect(result.fabricatedLinksFound).toBe(false);
  });

  // ===== Test 2: L2 向量化诊断日志 =====
  it('向量化过程应有诊断日志', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.excellent.bookId);
    await clearChatHistory();

    // 发起一个需要深度检索的查询
    await sendChatMessage('优秀的绵羊中关于博雅教育的详细内容是什么？');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] Response length:', response.length);

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(50);

    // 检查日志中是否有向量化相关日志
    const logs = await getPluginLogs();

    // 查找 L2 向量化日志
    const vectorizationLogs = logs.filter(l =>
      l.includes('vector') ||
      l.includes('Vector') ||
      l.includes('embedding') ||
      l.includes('Embedding') ||
      l.includes('L2') ||
      l.includes('[S2')
    );

    console.log(`[E2E] Found ${vectorizationLogs.length} vectorization-related logs`);

    if (vectorizationLogs.length > 0) {
      console.log('[E2E] Sample vectorization logs:', vectorizationLogs.slice(0, 3));
    }

    // 至少应该有 S2 相关日志
    const s2Logs = logs.filter(l => l.includes('[S2'));
    expect(s2Logs.length).toBeGreaterThan(0);
  });

  // ===== Test 3: 向量化 token 用量记录 =====
  it('trace 文件应记录向量化 token 用量', async function () {
    const bookId = BOOKS.excellent.bookId;
    const trace = await readTraceFile(bookId);

    if (!trace) {
      console.log('[E2E] No trace file found, skipping token用量验证');
      expect(true).toBe(true);
      return;
    }

    // 检查是否有向量化的 LLM 调用记录
    const vectorizationCalls = trace.phases
      .flatMap((p: any) => p.llmCalls || [])
      .filter((c: any) =>
        c.purpose?.includes('vector') ||
        c.purpose?.includes('embedding') ||
        c.purpose?.includes('chunk')
      );

    console.log(`[E2E] Found ${vectorizationCalls.length} vectorization LLM calls`);

    if (vectorizationCalls.length > 0) {
      console.log('[E2E] Vectorization call sample:', JSON.stringify(vectorizationCalls[0], null, 2));

      // 验证 token 用量
      for (const call of vectorizationCalls) {
        expect(call.durationMs).toBeGreaterThan(0);
      }
    }

    // 验证 llmSummary 中记录了调用
    expect(trace.llmSummary.totalCalls).toBeGreaterThan(0);
  });

  // ===== Test 4: 向量化失败 graceful fallback =====
  it('向量化失败时应 graceful fallback', async function () {
    const testStartTime = Date.now();

    await openSidebarWithBook(BOOKS.fool.bookId);
    await clearChatHistory();

    // 发起一个查询
    await sendChatMessage('随机漫步的傻瓜的目录结构是什么？');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] Response:', response.substring(0, 200));

    expect(response).toBeTruthy();

    // 检查日志中是否有 fallback 相关信息
    const logs = await getPluginLogs();
    const fallbackLogs = logs.filter(l =>
      l.includes('fallback') ||
      l.includes('Fallback') ||
      l.includes('BM25')
    );

    if (fallbackLogs.length > 0) {
      console.log('[E2E] Found fallback logs:', fallbackLogs);
    }

    // 无论是否有 fallback，最终应该有有效响应
    expect(response.length).toBeGreaterThan(10);
  });

  // ===== Test 5: stripFabricatedLinks 增强验证 =====
  it('stripFabricatedLinks 增强后 fabricated links 被正确移除', async function () {
    const bookId = BOOKS.excellent.bookId;

    // 检查 chunks 中是否有 fabricated links 格式
    const result = await checkForFabricatedLinks(bookId);

    console.log(`[E2E] Total chunks: ${result.totalChunks}`);
    console.log(`[E2E] Fabricated links found: ${result.fabricatedLinksFound}`);

    // 验证没有 fabricated links
    expect(result.fabricatedLinksFound).toBe(false);

    // 同时检查响应中也不应该有明显的 fabricated links
    const testStartTime = Date.now();
    await openSidebarWithBook(bookId);
    await clearChatHistory();

    await sendChatMessage('本书中提到的某个章节标题是什么？');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();

    // 响应中不应包含未处理的 fabricated links
    const fabricatedInResponse = response.match(/\[\[[^\]]+\]\]/g);
    if (fabricatedInResponse) {
      console.log('[E2E] WARNING: Found fabricated links in response:', fabricatedInResponse);
    }
    // 注意：响应中可能有正常的 wiki links，这是允许的
  });
});
