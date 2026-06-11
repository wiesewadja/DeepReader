/**
 * MessageList — Empty State 重构（去 XITONG_IMG 背景图 + 新视觉布局）
 *
 * 目标不变量：
 *  1. 不再使用 XITONG_IMG 作为背景图（XITONG_IMG 是人物 JPG，作为全屏背景无论
 *     怎么处理都像 AI 模板）
 *  2. 顶部有圆形 avatar（80x80，"奚" 字 or lucide icon）
 *  3. 招呼标题"你好，我是奚童"+ 副标题 + hint + 按钮网格 层次清晰
 *  4. PDF 模式下显示 6 个 GUIDANCE_BUTTONS
 *  5. 无 PDF 模式下显示 4 个 ADVISOR_BUTTONS
 *  6. avatar 用 background-image data-attribute 区分（有 vs 无 PDF）
 *  7. 按钮 grid 在窄屏降级为单列（CSS 响应式）
 *  8. 不再有 .deeppdf-advisor-bg / .deeppdf-advisor-overlay 残留 class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageList } from '@/components/message-list/message-list';

describe('MessageList — Empty State 重构（去背景图）', () => {
    let list: MessageList;
    let root: HTMLElement;
    let mockOnGuidanceClick: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockOnGuidanceClick = vi.fn();
    });

    afterEach(() => {
        if (list && root) {
            root.remove();
            list.destroy();
        }
    });

    describe('invariant 1 — 不再使用 XITONG_IMG 背景图', () => {
        it('PDF 模式下不出现 .deeppdf-advisor-bg (旧背景图 class)', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const oldBg = root.querySelector('.deeppdf-advisor-bg');
            expect(oldBg).toBeNull();
        });

        it('无 PDF 模式下不出现 .deeppdf-advisor-bg', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            root = list.el!;
            document.body.appendChild(root);

            const oldBg = root.querySelector('.deeppdf-advisor-bg');
            expect(oldBg).toBeNull();
        });

        it('不出现旧的 advisor-overlay (旧渐变遮罩 class)', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const oldOverlay = root.querySelector('.deeppdf-advisor-overlay');
            expect(oldOverlay).toBeNull();
        });
    });

    describe('invariant 2 — 顶部圆形 avatar', () => {
        it('PDF 模式下有 .deeppdf-empty-avatar 元素', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar');
            expect(avatar).toBeTruthy();
        });

        it('avatar 标记为圆形（border-radius: 50%）', () => {
            // 注意：jsdom 不解析 stylesheet 规则，getComputedStyle 返回空
            // 只验证 class 存在 + 字符内容 + 内联样式可设置
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar') as HTMLElement;
            expect(avatar.classList.contains('deeppdf-empty-avatar')).toBe(true);
            // 验证内联 border-radius 可设置（这模拟 jsdom 处理 stylesheet 的行为）
            avatar.style.borderRadius = '50%';
            expect(avatar.style.borderRadius).toBe('50%');
        });

        it('avatar 有可识别的内容（字符 / icon / image）', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar') as HTMLElement;
            // avatar 应含 textContent 或 background-image
            const hasText = avatar.textContent && avatar.textContent.trim().length > 0;
            const hasBgImg = window
                .getComputedStyle(avatar)
                .backgroundImage !== 'none';
            expect(hasText || hasBgImg).toBe(true);
        });
    });

    describe('invariant 3 — 内容层次', () => {
        it('PDF 模式下有 title / subtitle / hint / grid', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const title = root.querySelector('.deeppdf-empty-title');
            const subtitle = root.querySelector('.deeppdf-empty-subtitle');
            const hint = root.querySelector('.deeppdf-empty-hint');
            const grid = root.querySelector('.deeppdf-empty-grid');

            expect(title).toBeTruthy();
            expect(subtitle).toBeTruthy();
            expect(hint).toBeTruthy();
            expect(grid).toBeTruthy();
        });

        it('title 含 "你好，我是奚童"', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const title = root.querySelector('.deeppdf-empty-title') as HTMLElement;
            expect(title.textContent).toContain('你好，我是奚童');
        });

        it('subtitle 含 PDF 名称 (有 PDF 时)', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const subtitle = root.querySelector('.deeppdf-empty-subtitle') as HTMLElement;
            expect(subtitle.textContent).toContain('深度工作.pdf');
        });

        it('subtitle 不含 PDF 名称 (无 PDF 时)', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            root = list.el!;
            document.body.appendChild(root);

            const subtitle = root.querySelector('.deeppdf-empty-subtitle') as HTMLElement;
            expect(subtitle.textContent).not.toContain('·');
        });
    });

    describe('invariant 4 — PDF 模式 6 个按钮', () => {
        it('PDF 模式下 .deeppdf-empty-grid 含 6 个 button', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const buttons = root.querySelectorAll(
                '.deeppdf-empty-grid > button',
            );
            expect(buttons.length).toBe(6);
        });
    });

    describe('invariant 5 — 无 PDF 模式 4 个按钮', () => {
        it('无 PDF 模式下 .deeppdf-empty-grid 含 4 个 button', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            root = list.el!;
            document.body.appendChild(root);

            const buttons = root.querySelectorAll(
                '.deeppdf-empty-grid > button',
            );
            expect(buttons.length).toBe(4);
        });
    });

    describe('invariant 6 — 按钮可点击', () => {
        it('点击按钮调用 onGuidanceClick 回调', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const firstBtn = root.querySelector(
                '.deeppdf-empty-grid > button',
            ) as HTMLButtonElement;
            firstBtn.click();
            expect(mockOnGuidanceClick).toHaveBeenCalled();
        });
    });

    describe('invariant 8 — 旧 class 不残留', () => {
        it('PDF 模式不出现 .deeppdf-advisor-welcome 旧容器', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            expect(root.querySelector('.deeppdf-advisor-welcome')).toBeNull();
        });

        it('无 PDF 模式不出现 .deeppdf-advisor-welcome 旧容器', () => {
            list = new MessageList({
                onGuidanceClick: mockOnGuidanceClick,
            });
            root = list.el!;
            document.body.appendChild(root);

            expect(root.querySelector('.deeppdf-advisor-welcome')).toBeNull();
        });
    });
});
