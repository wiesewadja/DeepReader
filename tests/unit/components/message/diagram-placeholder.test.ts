/**
 * AIMessage isDiagramPlaceholder 渲染测试
 *
 * 验证图表占位气泡的渲染行为：
 * - 占位状态显示 loading dots + currentStatus，不渲染 markdown content
 * - update 从占位 → embed 时触发完整重渲染（不更新走 updateContent 轻量路径）
 */

import { describe, it, expect } from 'vitest';
import { AIMessage } from '@/components/message/message';
import type { MessageData } from '@/components/message/types';

function makePlaceholderData(overrides: Partial<MessageData> = {}): MessageData {
  return {
    id: `msg-${Date.now()}-diagram`,
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
    isAgentMessage: true,
    isDiagramPlaceholder: true,
    currentStatus: '让我画张图给你看...',
    ...overrides,
  };
}

describe('AIMessage isDiagramPlaceholder 渲染', () => {
  it('占位状态显示 loading dots，不渲染 markdown content', () => {
    const msg = new AIMessage(makePlaceholderData());
    const el = (msg as unknown as { render(): HTMLElement }).render();

    const contentEl = el.querySelector('.deeppdf-message-content') as HTMLElement;
    expect(contentEl).not.toBeNull();
    expect(contentEl.classList.contains('deeppdf-message-loading')).toBe(true);
    expect(contentEl.querySelector('.deeppdf-loading-dots')).not.toBeNull();
    // content 文本应为空（loading dots 取代）
    expect(contentEl.textContent?.trim()).toBe('');
  });

  it('占位状态显示 currentStatus 文字', () => {
    const msg = new AIMessage(makePlaceholderData({ currentStatus: '让我画张图给你看...' }));
    const el = (msg as unknown as { render(): HTMLElement }).render();

    const statusEl = el.querySelector('.deeppdf-message-status-text') as HTMLElement;
    expect(statusEl).not.toBeNull();
    expect(statusEl.classList.contains('visible')).toBe(true);
    expect(statusEl.textContent).toContain('让我画张图给你看');
  });

  it('占位气泡容器带 deeppdf-message-streaming 类（避免 CSS 隐藏 thinking-bar）', () => {
    // CSS 规则：.deeppdf-message:not(.deeppdf-message-streaming) .deeppdf-mascot-thinking-bar { display: none; }
    // 占位气泡 isStreaming=false，但若不加 streaming 类，thinking-bar 整个被隐藏
    const msg = new AIMessage(makePlaceholderData({ isStreaming: false }));
    const el = (msg as unknown as { render(): HTMLElement }).render();

    expect(el.classList.contains('deeppdf-message-streaming')).toBe(true);
  });

  it('占位 → embed 转变时走完整重渲染（非 updateContent 轻量路径）', () => {
    const msg = new AIMessage(makePlaceholderData());
    const initialEl = (msg as unknown as { render(): HTMLElement }).render();
    (msg as unknown as { el: HTMLElement }).el = initialEl;

    // 模拟 onDiagramReady 替换占位
    const embed = '![[Excalidraw/test.excalidraw]]';
    (msg as unknown as { update: (d: Partial<MessageData>) => void }).update({
      content: embed,
      isDiagramPlaceholder: false,
      currentStatus: undefined,
    });

    // 重渲染后 loading class 应该消失，content 应包含 embed
    const currentEl = (msg as unknown as { el: HTMLElement }).el;
    const contentEl = currentEl.querySelector('.deeppdf-message-content') as HTMLElement;
    expect(contentEl.classList.contains('deeppdf-message-loading')).toBe(false);
    // 不传 app → 走 escapeHtml 渲染，embed 文本应存在
    expect(contentEl.textContent).toContain(embed);
  });

  it('isDiagramPlaceholder=false 的普通消息不显示 loading（即使 content 为空）', () => {
    const msg = new AIMessage(makePlaceholderData({
      isDiagramPlaceholder: false,
      isStreaming: false,
      content: '',
    }));
    const el = (msg as unknown as { render(): HTMLElement }).render();

    const contentEl = el.querySelector('.deeppdf-message-content') as HTMLElement;
    // 非流式 + 非占位 + 空 content → 不应进入 loading 分支
    expect(contentEl.classList.contains('deeppdf-message-loading')).toBe(false);
  });
});
