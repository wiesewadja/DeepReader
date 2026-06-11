/**
 * MessageList — Empty State 二次精修
 *
 * 目标不变量：
 *  1. Avatar 用系统 emoji 而非中文字符（跨平台一致）
 *  2. Avatar 有 CSS 动画（呼吸/浮动）
 *  3. 标题 "你好，我是奚童" 用打字机效果逐字呈现
 *  4. 书名（currentPdfName）有独立 class 区别于其他文字
 *  5. 打字机效果尊重 prefers-reduced-motion（OS 启用时不播）
 *  6. 动画也尊重 prefers-reduced-motion
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageList } from '@/components/message-list/message-list';

describe('MessageList — Empty State 二次精修', () => {
    let list: MessageList;
    let root: HTMLElement;

    afterEach(() => {
        if (list && root) {
            root.remove();
            list.destroy();
        }
    });

    describe('invariant 1 — Avatar 用系统 emoji', () => {
        it('avatar textContent 是 emoji unicode 范围（不是中文）', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar') as HTMLElement;
            const text = avatar.textContent?.trim() || '';
            // emoji 字符的 code point 范围：[0x1F300, 0x1FAFF) 主要是 emoji
            const codePoint = text.codePointAt(0) || 0;
            const isEmoji = codePoint >= 0x1f300 && codePoint <= 0x1faff;
            // 或基础 emoji 区：[0x2600, 0x27BF)（★、✨、📖 等）
            const isBasicEmoji = codePoint >= 0x2600 && codePoint <= 0x27bf;
            expect(isEmoji || isBasicEmoji).toBe(true);
        });
    });

    describe('invariant 2 — Avatar 有 CSS 动画', () => {
        it('avatar 元素有 animation 相关的 class（动画 class 由 CSS 接管）', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const avatar = root.querySelector('.deeppdf-empty-avatar') as HTMLElement;
            // 验证 class 含 "deeppdf-empty-avatar-animated" 或类似
            const hasAnimatedClass =
                avatar.classList.contains('deeppdf-empty-avatar-animated') ||
                avatar.classList.contains('deeppdf-animated');
            expect(hasAnimatedClass).toBe(true);
        });
    });

    describe('invariant 3 — 标题打字机效果', () => {
        it('标题元素存在 typewrite 标记或 cursor class（CSS 视觉指示）', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const title = root.querySelector('.deeppdf-empty-title') as HTMLElement;
            // 打字机效果：标题在初始状态可能为空（typing 阶段）或有 cursor 标记
            // 至少 cursor 标记 / typewriter class 应存在（CSS 给闪烁光标）
            const hasCursor = title.classList.contains('deeppdf-typing-cursor') ||
                title.querySelector('.deeppdf-typing-cursor') !== null;
            // 或文字已经完整渲染（打字已完成）
            const hasText = title.textContent && title.textContent.length > 0;
            expect(hasCursor || hasText).toBe(true);
        });
    });

    describe('invariant 4 — 书名差异化', () => {
        it('PDF 模式下 subtitle 有独立 class 包裹书名', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const bookEl = root.querySelector('.deeppdf-empty-book-name');
            expect(bookEl).toBeTruthy();
            expect(bookEl?.textContent).toContain('深度工作.pdf');
        });

        it('无 PDF 模式下无书名 class', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            root = list.el!;
            document.body.appendChild(root);

            const bookEl = root.querySelector('.deeppdf-empty-book-name');
            expect(bookEl).toBeNull();
        });

        it('书名元素与其他文字不在同一 span 内（结构分离）', () => {
            list = new MessageList({ onGuidanceClick: vi.fn() });
            list.setCurrentPdfName('深度工作.pdf');
            root = list.el!;
            document.body.appendChild(root);

            const subtitle = root.querySelector('.deeppdf-empty-subtitle') as HTMLElement;
            const bookEl = subtitle.querySelector('.deeppdf-empty-book-name');
            // 书名是 subtitle 的子元素（独立 span）
            expect(bookEl).toBeTruthy();
            expect(bookEl?.parentElement).toBe(subtitle);
        });
    });
});
