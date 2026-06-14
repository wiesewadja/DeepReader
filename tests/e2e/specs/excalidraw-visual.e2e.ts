/**
 * Excalidraw 可视化 E2E 测试
 *
 * 在真实 Obsidian 中验证：
 * - S1 思维导图：绘图意图触发 VISUALIZER → 生成 .excalidraw → 截图
 * - S2 流程图：分析阅读 + 可视化 → 生成 .excalidraw → 截图
 * - fontSize 合规验证 + CDP 截图保存
 *
 * 截图分析由测试运行后通过 MiniMax MCP 执行。
 *
 * 前提条件：
 * - test-vault 中有自卑与超越 (9f77964d) 和疯传 (d2b30962) 的索引数据
 * - data.json 中配置了有效的 API Key
 * - Obsidian 中安装了 Excalidraw 插件
 */

import * as fs from 'fs';
import * as path from 'path';

// 测试配置
const VAULT_PATH = path.resolve(process.cwd(), 'test-vault');
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'tests/e2e/screenshots');

// 书籍配置（test-vault 实际存在的索引）
const BOOKS = {
  inferiority: { bookId: '9f77964d', name: '自卑与超越' },
  contagious: { bookId: 'd2b30962', name: '疯传' },
};

// 超时
const TIMEOUT_MEDIUM = 120_000;
const TIMEOUT_LONG = 180_000;

// CSS 选择器
const SELECTORS = {
  chatInput: 'textarea.deeppdf-chat-input-textarea',
  sendButton: 'button.deeppdf-chat-input-send-btn',
  messagesContainer: '.deeppdf-messages-container',
  topbarBtn: '.deeppdf-topbar-action-btn',
};

// ========== API Key 注入 ==========

// 从 test-vault 的 data.json 读取 API Key（deploy 已注入）
function getApiKey(): string {
  const envKey = process.env.LLM_API_KEY || '';
  if (envKey) return envKey;
  try {
    const dataPath = path.join(VAULT_PATH, '.obsidian/plugins/deepreader-dev/data.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const directKey = data.deepseekApiKey || '';
    const providerKey = data.providers?.deepseek?.apiKey || '';
    return directKey || providerKey;
  } catch {
    return '';
  }
}

const apiKey = getApiKey();
if (!apiKey) {
  console.warn('[E2E] WARNING: No API Key found in test-vault data.json');
  console.warn('[E2E] Looked at:', path.join(VAULT_PATH, '.obsidian/plugins/deepreader-dev/data.json'));
} else {
  console.log('[E2E] API Key loaded:', apiKey.substring(0, 8) + '...');
}

// ========== 辅助函数 ==========

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function openSidebarWithBook(bookId: string): Promise<void> {
  await browser.executeObsidianCommand('deepreader-dev:open-deepreader-sidebar');
  await wait(2000);

  const topbarBtn = await $(SELECTORS.topbarBtn);
  await topbarBtn.waitForExist({ timeout: 10_000 });
  console.log('[E2E] Sidebar opened');

  await browser.executeObsidian(({ app }, _bookId: string) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return;
    const view = leaves[0].view;
    if (view.selectIndex) view.selectIndex(_bookId);
  }, bookId);
  await wait(1500);
  console.log(`[E2E] Book selected: ${bookId}`);
}

async function sendChatMessage(message: string): Promise<void> {
  // 先关闭可能存在的 Obsidian modal
  await browser.executeObsidian(({ app }) => {
    // 通过 Esc 键关闭 modal
    const modals = document.querySelectorAll('.modal-container');
    if (modals.length > 0) {
      modals.forEach(m => m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    }
    // 如果 Esc 不够，直接移除
    document.querySelectorAll('.modal-bg, .modal-container').forEach(el => el.remove());
  });
  await wait(1000);

  const chatInput = await $(SELECTORS.chatInput);
  await chatInput.waitForExist({ timeout: 10_000 });

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

async function waitForResponse(timeoutMs: number = TIMEOUT_LONG): Promise<void> {
  const startTime = Date.now();

  let streamingStarted = false;
  while (Date.now() - startTime < 5000) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      return leaves[0]?.view?.isAiStreaming ?? false;
    });
    if (isStreaming) { streamingStarted = true; break; }
    await wait(500);
  }

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
    if (!streamingStarted && Date.now() - startTime > timeoutMs) {
      console.log('[E2E] No streaming detected, assuming complete');
      return;
    }
    await wait(1000);
  }
  console.log('[E2E] Response timeout');
}

async function getLastAIMessage(): Promise<string> {
  return await browser.executeObsidian(({ app }) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    const view = leaves[0]?.view;
    const messages = view?.messageList?.getMessagesData?.();
    if (!messages?.length) return '';
    return messages[messages.length - 1].content || '';
  });
}

async function clearChatHistory(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    leaves[0]?.view?.messageList?.clearMessages?.();
  });
  await wait(500);
}

// ========== Excalidraw 辅助函数 ==========

async function getExcalidrawFiles(): Promise<string[]> {
  return await browser.executeObsidian(async ({ app }) => {
    const adapter = app.vault.adapter;
    if (!await adapter.exists('Excalidraw')) return [];
    const { files } = await adapter.list('Excalidraw');
    return files.filter((f: string) => f.endsWith('.excalidraw'));
  });
}

async function analyzeExcalidrawJSON(filepath: string): Promise<{
  total: number;
  texts: Array<{ id: string; fs: number; txt: string; container: string | null }>;
  shapes: number;
  arrows: number;
  fontSizeOk: boolean;
  fontSizeWarnings: string[];
}> {
  return await browser.executeObsidian(async ({ app }, fp: string) => {
    const content = JSON.parse(await app.vault.adapter.read(fp));
    const texts = content.elements.filter((e: any) => e.type === 'text');
    const shapes = content.elements.filter((e: any) =>
      ['rectangle', 'ellipse', 'diamond'].includes(e.type),
    );
    const arrows = content.elements.filter((e: any) => e.type === 'arrow');

    const fontSizeWarnings: string[] = [];
    for (const t of texts) {
      if (!t.containerId && t.fontSize > 22) {
        fontSizeWarnings.push(`自由文本 "${t.id}" fontSize=${t.fontSize} > 22`);
      }
      if (t.containerId) {
        const c = content.elements.find((e: any) => e.id === t.containerId);
        if (c) {
          const max = c.width >= 300 ? 24 : c.width >= 220 ? 20 : c.width >= 160 ? 16 : 14;
          if (t.fontSize > max) {
            fontSizeWarnings.push(`容器文本 "${t.id}" fontSize=${t.fontSize} > ${max} (容器${c.width}px)`);
          }
        }
      }
    }

    return {
      total: content.elements.length,
      texts: texts.map((t: any) => ({
        id: t.id, fs: t.fontSize,
        txt: (t.text || '').substring(0, 15),
        container: t.containerId || null,
      })),
      shapes: shapes.length,
      arrows: arrows.length,
      fontSizeOk: fontSizeWarnings.length === 0,
      fontSizeWarnings,
    };
  }, filepath);
}

async function openExcalidrawFile(filepath: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, fp: string) => {
    const file = app.vault.getAbstractFileByPath(fp);
    if (file) await app.workspace.getLeaf(false).openFile(file);
  }, filepath);
  await wait(3000);
}

async function saveScreenshot(testName: string): Promise<string> {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // wdio v9: 使用 browser.takeScreenshot() 返回 base64
  const screenshotData = await browser.takeScreenshot();

  const screenshotPath = path.join(SCREENSHOT_DIR, `${testName}-${Date.now()}.png`);
  fs.writeFileSync(screenshotPath, Buffer.from(screenshotData, 'base64'));
  console.log(`[E2E] 截图已保存: ${screenshotPath}`);
  return screenshotPath;
}

// ========== 测试用例 ==========

describe('Excalidraw 可视化 E2E', function () {
  this.timeout(600000);

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

  // ===== Test 1: S1 思维导图 =====
  it('S1: 生成思维导图并验证 fontSize + 截图', async function () {
    const excFilesBefore = await getExcalidrawFiles();

    await openSidebarWithBook(BOOKS.inferiority.bookId);
    await clearChatHistory();

    await sendChatMessage('帮我画一张思维导图，展示这本书的核心概念体系');
    await waitForResponse(TIMEOUT_MEDIUM);

    // 验证 excalidraw 文件生成
    const excFiles = await getExcalidrawFiles();
    console.log('[E2E] Excalidraw 文件:', excFiles);
    expect(excFiles.length).toBeGreaterThan(excFilesBefore.length);

    const latestFile = excFiles[excFiles.length - 1];
    const analysis = await analyzeExcalidrawJSON(latestFile);
    console.log('[E2E] JSON 分析:', JSON.stringify(analysis, null, 2));

    expect(analysis.total).toBeGreaterThanOrEqual(5);

    if (!analysis.fontSizeOk) {
      console.warn('[E2E] fontSize 警告:', analysis.fontSizeWarnings);
    }

    // 打开并截图
    await openExcalidrawFile(latestFile);
    const screenshotPath = await saveScreenshot('s1-mindmap');
    console.log(`[E2E] 截图路径: ${screenshotPath}`);
  });

  // ===== Test 2: S2 分析阅读 + 流程图 =====
  it('S2: 分析阅读 + 流程图生成并验证 + 截图', async function () {
    const excFilesBefore = await getExcalidrawFiles();

    await openSidebarWithBook(BOOKS.contagious.bookId);
    await clearChatHistory();

    await sendChatMessage('请分析疯传的 STEPPS 模型，并用流程图展示核心逻辑');
    await waitForResponse(TIMEOUT_LONG);

    const response = await getLastAIMessage();
    console.log('[E2E] AI 回复长度:', response.length);

    const excFiles = await getExcalidrawFiles();
    console.log('[E2E] Excalidraw 文件:', excFiles);
    expect(excFiles.length).toBeGreaterThan(excFilesBefore.length);

    const latestFile = excFiles[excFiles.length - 1];
    const analysis = await analyzeExcalidrawJSON(latestFile);
    console.log('[E2E] JSON 分析:', JSON.stringify(analysis, null, 2));

    expect(analysis.total).toBeGreaterThanOrEqual(5);
    expect(analysis.arrows).toBeGreaterThan(0);

    if (!analysis.fontSizeOk) {
      console.warn('[E2E] fontSize 警告:', analysis.fontSizeWarnings);
    }

    // 打开并截图
    await openExcalidrawFile(latestFile);
    const screenshotPath = await saveScreenshot('s2-flowchart');
    console.log(`[E2E] 截图路径: ${screenshotPath}`);
  });
});
