/**
 * Sidebar 操作辅助函数
 */

const SELECTORS = {
  topbarBtn: '.deeppdf-topbar-action-btn',
  chatContainer: '.deeppdf-chat-container',
};

const PLUGIN_ID = 'deepreader-dev';

export class SidebarHelper {
  /**
   * 打开 sidebar
   */
  static async open(): Promise<void> {
    await browser.executeObsidianCommand(`${PLUGIN_ID}:open-deepreader-sidebar`);
    await browser.pause(2000);

    const topbarBtn = await $(SELECTORS.topbarBtn);
    await topbarBtn.waitForExist({ timeout: 10_000 });
  }

  /**
   * 检查 sidebar 是否已打开
   */
  static async isOpen(): Promise<boolean> {
    return await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      return leaves.length > 0;
    });
  }

  /**
   * 获取 sidebar view 实例
   */
  static async getView(): Promise<any> {
    return await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return null;
      return leaves[0].view;
    });
  }

  /**
   * 选择书籍索引
   */
  static async selectBook(bookId: string): Promise<void> {
    await browser.executeObsidian(({ app }, _bookId: string) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return;
      const view = leaves[0].view;
      if (view.selectIndex) {
        view.selectIndex(_bookId);
      }
    }, bookId);
    await browser.pause(1500);
  }

  /**
   * 清空聊天历史
   */
  static async clearChatHistory(): Promise<void> {
    await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return;
      const view = leaves[0].view;
      if (view?.messageList?.clearMessages) {
        view.messageList.clearMessages();
      }
    });
    await browser.pause(500);
  }

  /**
   * 打开 sidebar 并选择指定书籍
   */
  static async openWithBook(bookId: string): Promise<void> {
    await this.open();
    await this.selectBook(bookId);
  }

  /**
   * 获取消息列表数据
   */
  static async getMessages(): Promise<any[]> {
    return await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return [];
      const view = leaves[0].view;
      return view?.messageList?.getMessagesData() || [];
    });
  }

  /**
   * 获取最后一条 AI 消息
   */
  static async getLastAIMessage(): Promise<string> {
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
   * 检查是否正在流式响应
   */
  static async isStreaming(): Promise<boolean> {
    return await browser.executeObsidian(({ app }) => {
      const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      if (leaves.length === 0) return false;
      return leaves[0].view?.isAiStreaming ?? false;
    });
  }
}
