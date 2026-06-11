/**
 * Empty state avatar 用 奚童表情系统（MascotFace），不是 emoji
 * Topbar 隐藏（book name 已在 empty state pill 显示）
 *
 * 目标不变量：
 *  1. Empty state avatar 使用 MascotFace 组件（或其 SVG），不是 emoji
 *  2. Avatar 元素含 .deeppdf-mascot-face 或 SVG 内容
 *  3. Avatar 是空状态时（PDF 模式 / 无 PDF 模式）都展示
 *  4. ReadingTopbar 不再渲染（sidebar-view 不创建）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageList } from '@/components/message-list/message-list';

describe('Empty State — 用 奚童表情 avatar + 隐藏 topbar', () => {
    let list: MessageList;
    let root: HTMLElement;

    afterEach(() => {
        if (list && root) {
            root.remove();
            list.destroy();
        }
    });

    describe('invariant 1 — Avatar 用 MascotFace，不是 emoji', () => {
        it('PDF 模式下 avatar 含 .deeppdf-mascot-face 子元素', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar');
            const mascot = avatar?.querySelector('.deeppdf-mascot-face');
            expect(mascot).toBeTruthy();
        });

        it('avatar 不含 emoji unicode 字符（不是 📚）', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar') as HTMLElement;
            const text = avatar.textContent?.trim() || '';
            const codePoint = text.codePointAt(0) || 0;
            // 正常情况下 text 为空（SVG 渲染），codePoint 为 0
            expect(text.length).toBe(0);
            expect(codePoint).toBe(0);
        });
    });

    describe('invariant 2 — Avatar 是 SVG / MascotFace', () => {
        it('avatar 含 SVG 元素（MascotFace 渲染 SVG）', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar') as HTMLElement;
            const svg = avatar?.querySelector('svg');
            expect(svg).toBeTruthy();
        });
    });

    describe('invariant 3 — 两种模式都有 avatar', () => {
        it('PDF 模式有 avatar', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar');
            expect(avatar).toBeTruthy();
        });

        it('无 PDF 模式也有 avatar', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar');
            expect(avatar).toBeTruthy();
        });
    });
});
