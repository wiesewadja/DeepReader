/**
 * QuoteManager 单元测试
 *
 * PR 1 升级后行为：
 * - 卡片显示完整文本（> 60 字可展开）
 * - 章节路径可见
 * - 跳转按钮（仅当 blockId 存在）
 * - 全部清除按钮（≥2 条时显示）
 * - 只读模式：恢复的引用禁用移除/清除
 * - flashQuoteCard() 触发黄色闪烁
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuoteManager } from '@/views/sidebar/quote-manager';
import type { QuoteItem, QuoteMetadata } from '@/components/chat-input/chat-input';

// Mock DOM
function createContainer(): HTMLElement {
    const div = document.createElement('div');
    document.body.appendChild(div);
    return div;
}

describe('QuoteManager (PR 1)', () => {
    let container: HTMLElement;
    let host: any;
    let manager: QuoteManager;

    beforeEach(() => {
        container = createContainer();
        host = {
            chatInput: { textarea: document.createElement('textarea'), focus: vi.fn() },
            updateMessageListPadding: vi.fn(),
            jumpToQuote: vi.fn().mockReturnValue(true),
        };
        manager = new QuoteManager(host);
        manager.setContainer(container);
    });

    describe('卡片渲染', () => {
        it('应显示完整引用文本（> 60 字时不截断到 20 字）', () => {
            const longText = '这是一段超过 60 个字符的长引用文本，应该完整显示而不是被截断到 20 字符。'.repeat(2);
            const meta: QuoteMetadata = { text: longText, source: '测试书' };
            manager.handleQuoteSelection(meta);

            const card = container.querySelector('.deeppdf-quote-card')!;
            const textEl = card.querySelector('.deeppdf-quote-text')!;
            // 旧 bug：substring(0, 20) + '...' → 长度 23
            // 新行为：textContent 保留完整长度
            expect(textEl.textContent!.length).toBe(longText.length);
        });

        it('应显示章节路径（headingPath 优先于 source）', () => {
            const meta: QuoteMetadata = {
                text: '引用文本',
                source: '书名',
                heading: '1.2 节',
                headingPath: ['第一章', '1.1 节', '1.2 节'],
            };
            manager.handleQuoteSelection(meta);

            const source = container.querySelector('.deeppdf-quote-source')!;
            expect(source.textContent).toContain('1.2 节');
            expect(source.textContent).toContain('1.1 节');
        });

        it('应始终渲染删除按钮（不论 blockId 是否存在）', () => {
            const meta1: QuoteMetadata = { text: '引用', blockId: 'ch1-p3' };
            manager.handleQuoteSelection(meta1);
            expect(container.querySelector('.deeppdf-quote-remove-btn')).not.toBeNull();

            const meta2: QuoteMetadata = { text: 'no blockId' };
            manager.handleQuoteSelection(meta2);
            expect(container.querySelectorAll('.deeppdf-quote-remove-btn').length).toBe(2);
        });

        it('不应再渲染跳转/展开按钮（极简风 v3）', () => {
            const longText = '长'.repeat(70);
            manager.handleQuoteSelection({ text: longText, blockId: 'b1' });
            expect(container.querySelector('.deeppdf-quote-jump-btn')).toBeNull();
            expect(container.querySelector('.deeppdf-quote-expand-btn')).toBeNull();
        });

        it('删除按钮应为 absolute 定位（通过 class 验证）', () => {
            // jsdom 不加载外部 CSS，getComputedStyle 返回空串
            // 改为验证：1) 按钮存在；2) 按钮在卡片 DOM 树中（结构存在）
            manager.handleQuoteSelection({ text: 'x' });
            const card = container.querySelector('.deeppdf-quote-card')!;
            const removeBtn = card.querySelector('.deeppdf-quote-remove-btn');
            expect(removeBtn).toBeTruthy();
            // 按钮应该是卡片的直接子元素（CSS 绝对定位需要 parent=relative）
            expect(removeBtn?.parentElement).toBe(card);
        });
    });

    describe('删除按钮交互', () => {
        it('点击删除按钮应移除该卡片', () => {
            const meta: QuoteMetadata = { text: 'ref', blockId: 'b1' };
            manager.handleQuoteSelection(meta);
            const removeBtn = container.querySelector('.deeppdf-quote-remove-btn') as HTMLButtonElement;
            removeBtn.click();
            expect(manager.getQuotes()).toEqual([]);
            expect(container.querySelectorAll('.deeppdf-quote-card').length).toBe(0);
        });
    });

    describe('引用高亮同步调用', () => {
        it('添加引用时应调用 host.addCitedHighlight(quote)', () => {
            const addCited = vi.fn();
            host.addCitedHighlight = addCited;
            // 重建 manager 使其获取新 host
            const fresh = new (manager.constructor as any)(host);
            fresh.setContainer(container);
            fresh.handleQuoteSelection({ text: 'x', blockId: 'b1' });
            expect(addCited).toHaveBeenCalledTimes(1);
            expect(addCited.mock.calls[0][0].blockId).toBe('b1');
        });

        it('移除单条时应调用 host.removeCitedHighlight(quote)', () => {
            const removeCited = vi.fn();
            host.removeCitedHighlight = removeCited;
            const fresh = new (manager.constructor as any)(host);
            fresh.setContainer(container);
            fresh.handleQuoteSelection({ text: 'x', blockId: 'b1' });
            const removeBtn = container.querySelector('.deeppdf-quote-remove-btn') as HTMLButtonElement;
            removeBtn.click();
            expect(removeCited).toHaveBeenCalledTimes(1);
        });

        it('clearQuotes 应调用 host.clearCitedHighlights()', () => {
            const clearCited = vi.fn();
            host.clearCitedHighlights = clearCited;
            const fresh = new (manager.constructor as any)(host);
            fresh.setContainer(container);
            fresh.handleQuoteSelection({ text: 'x' });
            fresh.handleQuoteSelection({ text: 'y' });
            fresh.clearQuotes();
            expect(clearCited).toHaveBeenCalledTimes(1);
        });
    });

    describe('只读模式（恢复的引用）', () => {
        it('应隐藏移除按钮', () => {
            manager.setReadonly(true);
            manager.restoreQuotes([{ id: 'q1', text: 'restored' }]);
            expect(container.querySelector('.deeppdf-quote-remove-btn')).toBeNull();
        });

        it('应隐藏全部清除按钮', () => {
            manager.setReadonly(true);
            manager.restoreQuotes([
                { id: 'q1', text: 'a' },
                { id: 'q2', text: 'b' },
            ]);
            expect(container.querySelector('.deeppdf-quote-clear-all-btn')).toBeNull();
        });

        it('应显示恢复徽标', () => {
            manager.setReadonly(true);
            manager.restoreQuotes([{ id: 'q1', text: 'restored' }]);
            expect(container.querySelector('.deeppdf-quote-restored-badge')).not.toBeNull();
        });

        it('clearQuotes() 在只读模式下应无效', () => {
            manager.setReadonly(true);
            manager.restoreQuotes([{ id: 'q1', text: 'a' }]);
            manager.clearQuotes();
            expect(manager.getQuotes().length).toBe(1);
        });

        it('removeQuote() 在只读模式下应无效', () => {
            manager.setReadonly(true);
            manager.restoreQuotes([{ id: 'q1', text: 'a' }]);
            manager.removeQuote('q1');
            expect(manager.getQuotes().length).toBe(1);
        });
    });

    describe('flashQuoteCard', () => {
        it('应在找到卡片时滚动并添加 .deeppdf-quote-flash 类', () => {
            // jsdom 中没有 scrollIntoView，先 stub
            HTMLElement.prototype.scrollIntoView = function() {};
            const meta: QuoteMetadata = { text: 'ref' };
            manager.handleQuoteSelection(meta);
            const quote = manager.getQuotes()[0];
            const result = manager.flashQuoteCard(quote.id);
            expect(result).toBe(true);
            const card = container.querySelector('.deeppdf-quote-card')!;
            expect(card.classList.contains('deeppdf-quote-flash')).toBe(true);
        });

        it('应在找不到卡片时返回 false', () => {
            const result = manager.flashQuoteCard('nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('findQuote', () => {
        it('应返回对应 id 的引用', () => {
            manager.handleQuoteSelection({ text: 'a' });
            manager.handleQuoteSelection({ text: 'b' });
            const quotes = manager.getQuotes();
            const found = manager.findQuote(quotes[0].id);
            expect(found?.text).toBe('a');
        });

        it('应返回 undefined 当 id 不存在', () => {
            manager.handleQuoteSelection({ text: 'a' });
            expect(manager.findQuote('nope')).toBeUndefined();
        });
    });

    describe('getQuotes', () => {
        it('应返回副本（外部修改不影响内部）', () => {
            manager.handleQuoteSelection({ text: 'x' });
            const arr = manager.getQuotes();
            arr.pop();
            expect(manager.getQuotes().length).toBe(1);
        });
    });

    describe('setContainer 接线（回归测试）', () => {
        it('setContainer(null) 时 handleQuoteSelection 应不崩溃（也不渲染）', () => {
            manager.setContainer(null);
            // 静默失败，不抛错
            expect(() => manager.handleQuoteSelection({ text: 'a' })).not.toThrow();
            expect(container.querySelectorAll('.deeppdf-quote-card').length).toBe(0);
        });

        it('setContainer(element) 后 handleQuoteSelection 应渲染到该元素', () => {
            const otherContainer = document.createElement('div');
            document.body.appendChild(otherContainer);
            manager.setContainer(otherContainer);
            manager.handleQuoteSelection({ text: 'a' });
            expect(otherContainer.querySelectorAll('.deeppdf-quote-card').length).toBe(1);
            expect(container.querySelectorAll('.deeppdf-quote-card').length).toBe(0);
        });
    });
});
