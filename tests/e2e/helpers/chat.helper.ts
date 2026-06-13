/**
 * 聊天操作辅助函数
 */

import { SidebarHelper } from './sidebar.helper';

const SELECTORS = {
  chatInput: 'textarea.deeppdf-chat-input-textarea',
  sendButton: 'button.deeppdf-chat-input-send-btn',
};

const DEFAULT_TIMEOUT = 120_000;

export class ChatHelper {
  /**
   * 发送聊天消息
   * 等待 textarea 变为可用（非 disabled）再输入
   */
  static async sendMessage(message: string): Promise<void> {
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
      await new Promise(r => setTimeout(r, 1000));
    }

    await chatInput.setValue(message);
    await new Promise(r => setTimeout(r, 300));

    const sendBtn = await $(SELECTORS.sendButton);
    await sendBtn.click();
    console.log(`[E2E] Sent: "${message}"`);
  }

  /**
   * 等待 Agent 响应完成
   * 通过检查 sidebar view 的 isAiStreaming 状态来判断
   */
  static async waitForResponse(timeoutMs: number = DEFAULT_TIMEOUT): Promise<void> {
    const startTime = Date.now();

    // 等待 streaming 开始（最多 5 秒）
    let streamingStarted = false;
    while (Date.now() - startTime < 5000) {
      const isStreaming = await SidebarHelper.isStreaming();
      if (isStreaming) {
        streamingStarted = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!streamingStarted) {
      console.log('[E2E] Streaming did not start within 5s, waiting for completion anyway');
    }

    // 等待 streaming 结束
    const hardLimit = timeoutMs + 60_000;
    while (Date.now() - startTime < hardLimit) {
      const isStreaming = await SidebarHelper.isStreaming();
      if (!isStreaming && streamingStarted) {
        console.log('[E2E] Response completed');
        await new Promise(r => setTimeout(r, 500));
        return;
      }
      if (!streamingStarted && Date.now() - startTime > timeoutMs) {
        console.log('[E2E] No streaming detected, assuming complete');
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('[E2E] Response timeout (including grace period)');
  }

  /**
   * 发送消息并等待响应
   */
  static async sendAndWait(message: string, timeoutMs: number = DEFAULT_TIMEOUT): Promise<string> {
    await this.sendMessage(message);
    await this.waitForResponse(timeoutMs);
    return await SidebarHelper.getLastAIMessage();
  }

  /**
   * 轮询等待响应（轻量 E2E 风格）
   * 适用于 scripts/e2e-light 的 evalObsidian 模式
   */
  static async pollForResponse(timeoutMs: number = DEFAULT_TIMEOUT, pollInterval: number = 3000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = await browser.executeObsidian(({ app }) => {
          const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
          if (leaves.length === 0) return { streaming: false, msgCount: 0 };
          const view = leaves[0].view;
          const streaming = view.isAiStreaming;
          const msgs = view.messageList?.getMessagesData() || [];
          const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
          return {
            streaming,
            msgCount: msgs.length,
            lastContent: lastMsg?.content?.slice(0, 100) || '',
            lastRole: lastMsg?.role || '',
          };
        });
        if (!state.streaming && state.msgCount > 0 && state.lastRole === 'assistant') {
          return state.lastContent;
        }
      } catch { /* ignore poll errors */ }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    return null;
  }
}
