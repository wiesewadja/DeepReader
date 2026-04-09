/**
 * Langfuse 追踪 E2E 测试
 */

describe('Langfuse Trace', () => {
  it('should send trace to Langfuse when agent responds', async () => {
    // 1. 等待 Obsidian 加载完成
    await browser.pause(2000);

    // 2. 打开 DeepReader sidebar
    await browser.executeObsidian((app) => {
      app.commands.executeCommandById('deepreader:open-deepreader-sidebar');
    });
    await browser.pause(1500);

    // 3. 查找聊天输入框
    const chatInput = await $('.chat-input textarea, .deepreader-chat-input textarea, [class*="chat-input"] textarea');
    await chatInput.waitForExist({ timeout: 10000 });

    // 4. 发送测试消息
    const testMessage = '这本书主要讲了什么？';
    await chatInput.setValue(testMessage);
    await browser.pause(300);

    // 5. 点击发送按钮
    const sendButton = await $('.chat-send-button, .send-button, [class*="send-button"], button[class*="send"]');
    await sendButton.click();

    console.log('[E2E] Message sent, waiting for response...');

    // 6. 等待响应（最多 60 秒）
    await browser.pause(10000);

    // 7. 检查控制台日志
    const logs = await browser.getLogs('browser');
    const langfuseLogs = logs.filter(log => 
      log.message.includes('Langfuse') || log.message.includes('[DeepReader]')
    );

    console.log('[E2E] Langfuse logs:', langfuseLogs.map(l => l.message));

    // 8. 验证 Langfuse 初始化
    const initLog = langfuseLogs.find(log => log.message.includes('Langfuse initialized'));
    console.log('[E2E] Init log found:', !!initLog);

    // 9. 验证 flush 日志
    const flushLog = langfuseLogs.find(log => log.message.includes('Langfuse flushed'));
    console.log('[E2E] Flush log found:', !!flushLog);

    // 10. 输出提示
    console.log('[E2E] Please check Langfuse UI at http://localhost:3066');
    console.log('[E2E] Look for traces with name "cognitive-engine-session"');
  });
});