/**
 * 全局键盘焦点指示（:focus-visible）
 *
 * 目标不变量（WCAG 2.4.7 Focus Visible）：
 *  1. 全局 :focus-visible 规则定义在 main.css（不是仅 input/select）
 *  2. 使用 outline 关键字（不是 border/box-shadow 替代方案）
 *  3. 颜色使用 --dr-color-border-focus token（统一设计）
 *  4. icon-button 类的 :focus-visible outline-offset 更大（4px）
 *  5. 不影响普通 div（仅可聚焦元素触发）
 *  6. 不使用 !important（避免破坏主题）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mainCss = readFileSync(join(process.cwd(), 'src/styles/main.css'), 'utf-8');

describe(':focus-visible 全局键盘焦点指示（WCAG 2.4.7）', () => {
    describe('invariant 1 — 全局 :focus-visible 规则存在', () => {
        it('main.css 包含至少 1 个 :focus-visible 规则', () => {
            const focusVisibleRules = mainCss.match(/:focus-visible/g) || [];
            expect(focusVisibleRules.length).toBeGreaterThanOrEqual(1);
        });

        it('全局规则匹配所有可聚焦元素（非仅 input/select）', () => {
            // 寻找裸 :focus-visible（无类名前缀）
            const globalRule = mainCss.match(/^\s*:focus-visible\s*\{/m);
            expect(globalRule).not.toBeNull();
        });
    });

    describe('invariant 2 — 使用 outline 关键字', () => {
        it('全局 :focus-visible 规则中含 outline 属性', () => {
            const blockMatch = mainCss.match(
                /:focus-visible\s*\{([^}]*)\}/,
            );
            expect(blockMatch).not.toBeNull();
            const block = blockMatch![1];
            expect(block).toMatch(/outline\s*:/);
        });

        it('outline 宽度 ≥ 2px（WCAG 2.4.7 最低建议）', () => {
            const blockMatch = mainCss.match(/:focus-visible\s*\{([^}]*)\}/);
            const block = blockMatch![1];
            const outlineMatch = block.match(/outline\s*:\s*(\d+)px/);
            expect(outlineMatch).not.toBeNull();
            expect(parseInt(outlineMatch![1])).toBeGreaterThanOrEqual(2);
        });
    });

    describe('invariant 3 — 使用 token 颜色', () => {
        it('outline 颜色使用 --dr-color-border-focus', () => {
            const blockMatch = mainCss.match(/:focus-visible\s*\{([^}]*)\}/);
            const block = blockMatch![1];
            expect(block).toMatch(/var\(--dr-color-border-focus\)/);
        });
    });

    describe('invariant 4 — icon-button 有更大的 outline-offset', () => {
        it('button.deeppdf-icon-button:focus-visible 规则存在', () => {
            expect(mainCss).toMatch(
                /button\.deeppdf-icon-button:focus-visible\s*\{/,
            );
        });

        it('icon-button 的 outline-offset ≥ 4px', () => {
            const blockMatch = mainCss.match(
                /button\.deeppdf-icon-button:focus-visible\s*\{([^}]*)\}/,
            );
            expect(blockMatch).not.toBeNull();
            const block = blockMatch![1];
            const offsetMatch = block.match(/outline-offset\s*:\s*(\d+)px/);
            expect(offsetMatch).not.toBeNull();
            expect(parseInt(offsetMatch![1])).toBeGreaterThanOrEqual(4);
        });
    });

    describe('invariant 5 — 不影响普通 div', () => {
        it('全局规则不针对 div（避免视觉噪音）', () => {
            // 规则主体不能是裸 div（无理由让 div 显示焦点环）
            expect(mainCss).not.toMatch(/^\s*div\s*\{[^}]*outline\s*:/m);
        });
    });

    describe('invariant 6 — 不使用 !important', () => {
        it('全局 :focus-visible 规则块内无 !important', () => {
            const blockMatch = mainCss.match(/:focus-visible\s*\{([^}]*)\}/);
            const block = blockMatch![1];
            expect(block).not.toMatch(/!important/);
        });
    });
});
