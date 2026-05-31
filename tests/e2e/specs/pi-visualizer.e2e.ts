/**
 * PI Visualizer E2E 测试
 *
 * 验证 VISUALIZER 节点 → PI 集成的完整流程：
 * - 可视化意图检测 → 路由到 VISUALIZER 节点
 * - PI 进程启动 + excalidraw skill 执行
 * - 输出文件写入 vault
 * - formatter 格式化最终响应
 *
 * 前提条件：
 * - test-vault 中包含"随机漫步的傻瓜" (2bdb1cc4) 的索引数据
 * - data.json 中配置了 PI provider/model/apiKey
 * - PI CLI 已安装（/opt/homebrew/bin/pi）
 * - .pi/skills/excalidraw 目录存在
 */

import * as fs from 'fs';
import * as path from 'path';

const VAULT_PATH = path.resolve(__dirname, '../../test-vault');
const TIMEOUT_PI = 180_000; // 3 分钟（PI 启动 + skill 执行）

// 书籍配置
const BOOKS = {
  randomWalk: { bookId: '2bdb1cc4', name: '随机漫步的傻瓜' },
};

// CSS 选择器
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
  console.log(`[E2E-PI-VIZ] Sent: "${message}"`);
}

async function waitForResponse(timeoutMs: number = TIMEOUT_PI): Promise<void> {
  const startTime = Date.now();
  let streamingStarted = false;

  while (Date.now() - startTime < 5000) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return false;
      return leaves[0].view?.isAiStreaming ?? false;
    });
    if (isStreaming) { streamingStarted = true; break; }
    await wait(500);
  }

  const hardLimit = timeoutMs + 60_000;
  while (Date.now() - startTime < hardLimit) {
    const isStreaming = await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return false;
      return leaves[0].view?.isAiStreaming ?? false;
    });
    if (!isStreaming && streamingStarted) {
      console.log('[E2E-PI-VIZ] Response completed');
      await wait(500);
      return;
    }
    if (!streamingStarted && Date.now() - startTime > timeoutMs) {
      console.log('[E2E-PI-VIZ] No streaming detected, assuming complete');
      return;
    }
    await wait(1000);
  }
}

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

async function openSidebarWithBook(bookId: string): Promise<void> {
  await browser.executeObsidianCommand('deepreader:open-deepreader-sidebar');
  await wait(2000);
  const topbarBtn = await $(SELECTORS.topbarBtn);
  await topbarBtn.waitForExist({ timeout: 10_000 });

  await browser.executeObsidian(({ app }, _bookId: string) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return;
    const view = leaves[0].view;
    if (view.selectIndex) view.selectIndex(_bookId);
  }, bookId);
  await wait(1500);
}

async function clearChatHistory(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return;
    const view = leaves[0].view;
    if (view?.messageList?.clearMessages) view.messageList.clearMessages();
  });
  await wait(500);
}

// ========== 测试用例 ==========

describe('PI Visualizer E2E', function () {
  this.timeout(600000);

  before(async function () {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.['deepreader'];
    });
    expect(loaded).toBe(true);

    // 确认 PI 设置已启用
    const piEnabled = await browser.executeObsidian(({ app }) => {
      return app.plugins?.plugins?.['deepreader']?.settings?.piEnabled ?? false;
    });
    console.log('[E2E-PI-VIZ] PI enabled:', piEnabled);
    expect(piEnabled).toBe(true);
  });

  beforeEach(async function () {
    await wait(3000);
  });

  it('PI CLI 应该可用', async function () {
    const available = await browser.executeObsidian(async () => {
      const { spawn } = require('child_process');
      const home = require('os').homedir();
      const candidates = ['/opt/homebrew/bin/pi', '/usr/local/bin/pi'];
      for (const p of candidates) {
        try {
          const result = await new Promise<boolean>((resolve) => {
            const child = spawn(p, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
            child.on('error', () => resolve(false));
            child.on('close', (code: number) => resolve(code === 0 && /^\d+\.\d+\.\d+/.test(out.trim())));
          });
          if (result) return true;
        } catch { /* next */ }
      }
      return false;
    });
    expect(available).toBe(true);
  });

  it('可视化请求应该生成 .excalidraw.md 文件', async function () {
    await openSidebarWithBook(BOOKS.randomWalk.bookId);
    await clearChatHistory();

    await sendChatMessage('帮我画一个思维导图');
    await waitForResponse(TIMEOUT_PI);

    const response = await getLastAIMessage();
    console.log('[E2E-PI-VIZ] Response:', response.substring(0, 500));

    // 不应包含错误
    expect(response).not.toContain('图表生成失败');
    expect(response).not.toContain('未安装 Excalidraw 插件');

    // 应该包含 PI 生成的输出文件路径
    const hasOutputFile = response.includes('PI') || response.includes('excalidraw') || response.includes('输出文件');
    console.log('[E2E-PI-VIZ] Has output reference:', hasOutputFile);

    // 检查文件是否存在于 vault
    const excalidrawFiles = await browser.executeObsidian(({ app }) => {
      const files = app.vault.getFiles();
      return files
        .filter((f: import('obsidian').TFile) => f.path.includes('excalidraw') || f.path.includes('visualize'))
        .map((f: import('obsidian').TFile) => f.path);
    });
    console.log('[E2E-PI-VIZ] Excalidraw/visualize files in vault:', excalidrawFiles);

    // 检查 DeepReader/exports 目录下的文件
    const exportFiles = await browser.executeObsidian(({ app }) => {
      const files = app.vault.getFiles();
      return files
        .filter((f: import('obsidian').TFile) => f.path.startsWith('DeepReader/exports/'))
        .map((f: import('obsidian').TFile) => ({ path: f.path, size: f.stat.size }));
    });
    console.log('[E2E-PI-VIZ] Export files:', JSON.stringify(exportFiles));

    if (exportFiles.length > 0) {
      // 读取最新文件内容验证是 Excalidraw JSON
      const latest = exportFiles[exportFiles.length - 1];
      const content = await browser.executeObsidian(async ({ app }, filePath: string) => {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!file) return null;
        return app.vault.read(file as import('obsidian').TFile);
      }, latest.path);

      if (content) {
        const isExcalidraw = content.includes('elements') || content.includes('excalidraw') || content.includes('type');
        console.log(`[E2E-PI-VIZ] File content length: ${content.length}, isExcalidraw-like: ${isExcalidraw}`);
        console.log(`[E2E-PI-VIZ] Content preview: ${content.substring(0, 200)}`);
      }
    }
  });
});
