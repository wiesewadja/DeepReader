/**
 * MessageList — loading / error / 重试 三态
 *
 * 目标不变量：
 *  1. setLoading(true) 渲染 skeleton loading 状态
 *  2. setLoading(false) 移除 skeleton
 *  3. setError(msg) 渲染错误 banner + retry button
 *  4. 点击 retry 调用 onRetry 回调
 *  5. clearError() 移除错误 banner
 *  6. loading 状态时 messagesContainer 有 aria-busy=true
 *  7. error 状态有 role=alert
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageList } from '@/components/message-list/message-list';

describe('MessageList — loading / error / 重试 三态', () => {
    let list: MessageList;
    let mockOnRetry: ReturnType<typeof vi.fn>;
    let root: HTMLElement;

    beforeEach(() => {
        mockOnRetry = vi.fn();
        list = new MessageList({ onRetry: mockOnRetry });
        root = list.el!;
        document.body.appendChild(root);
    });

    afterEach(() => {
        root.remove();
        list.destroy();
    });

    function getMessagesContainer(): HTMLElement {
        return root.querySelector('.deeppdf-messages-container') as HTMLElement;
    }

    describe('invariant 1 — setLoading(true) 显示 skeleton', () => {
        it('setLoading(true) 在 messagesContainer 添加 skeleton 元素', () => {
            (list as any).setLoading(true);
            const skeletons = root.querySelectorAll('.deeppdf-skeleton-message');
            expect(skeletons.length).toBeGreaterThan(0);
        });

        it('setLoading(true) 隐藏 empty state', () => {
            (list as any).setLoading(true);
            const empty = root.querySelector('.deeppdf-empty-state') as HTMLElement;
            expect(empty.classList.contains('deeppdf-hidden')).toBe(true);
        });
    });

    describe('invariant 2 — setLoading(false) 移除 skeleton', () => {
        it('setLoading(false) 移除所有 skeleton 元素', () => {
            (list as any).setLoading(true);
            (list as any).setLoading(false);
            const skeletons = root.querySelectorAll('.deeppdf-skeleton-message');
            expect(skeletons.length).toBe(0);
        });
    });

    describe('invariant 3 — setError(msg) 显示错误 banner + retry', () => {
        it('setError(msg) 在 messagesContainer 添加 role=alert 元素', () => {
            (list as any).setError('网络连接失败');
            const alerts = root.querySelectorAll('[role="alert"]');
            expect(alerts.length).toBeGreaterThan(0);
        });

        it('错误信息显示用户可读文本', () => {
            (list as any).setError('无法连接到服务器');
            const alert = root.querySelector('[role="alert"]') as HTMLElement;
            expect(alert.textContent).toContain('无法连接到服务器');
        });

        it('错误状态显示 retry button', () => {
            (list as any).setError('错误');
            const retryBtn = root.querySelector(
                '.deeppdf-message-list-retry-btn',
            ) as HTTMLButtonElement;
            expect(retryBtn).toBeTruthy();
        });
    });

    describe('invariant 4 — 点击 retry 调用 onRetry', () => {
        it('click retry 按钮调用 onRetry 回调', () => {
            (list as any).setError('错误');
            const retryBtn = root.querySelector(
                '.deeppdf-message-list-retry-btn',
            ) as HTMLButtonElement;
            retryBtn.click();
            expect(mockOnRetry).toHaveBeenCalled();
        });
    });

    describe('invariant 5 — clearError 移除错误 banner', () => {
        it('clearError 移除 role=alert 元素', () => {
            (list as any).setError('错误');
            expect(root.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0);
            (list as any).clearError();
            expect(root.querySelectorAll('[role="alert"]').length).toBe(0);
        });
    });

    describe('invariant 6 — loading 状态 aria-busy', () => {
        it('setLoading(true) 在 messagesContainer 挂 aria-busy=true', () => {
            (list as any).setLoading(true);
            expect(getMessagesContainer().getAttribute('aria-busy')).toBe('true');
        });

        it('setLoading(false) 清 aria-busy', () => {
            (list as any).setLoading(true);
            (list as any).setLoading(false);
            expect(getMessagesContainer().getAttribute('aria-busy')).toBe('false');
        });
    });
});
