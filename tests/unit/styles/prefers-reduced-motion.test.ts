/**
 * prefers-reduced-motion 全局支持（WCAG 2.3.3）
 *
 * 目标不变量：
 *  1. main.css 包含 @media (prefers-reduced-motion: reduce) 块
 *  2. 该块内有 animation: none 规则（禁用所有动画）
 *  3. 该块覆盖 main.css 中所有 @keyframes 定义的动画
 *  4. transition 也被禁用（不仅 animation）
 *  5. 至少覆盖 main.css 的 5+ 个动画 class
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mainCss = readFileSync(join(process.cwd(), 'src/styles/main.css'), 'utf-8');

function extractReducedMotionBlock(css: string): string | null {
    const match = css.match(
        /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    return match ? match[1] : null;
}

function extractKeyframeNames(css: string): string[] {
    return [
        ...css.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g),
    ].map((m) => m[1]);
}

describe('prefers-reduced-motion 全局支持（WCAG 2.3.3）', () => {
    const block = extractReducedMotionBlock(mainCss);
    const keyframes = extractKeyframeNames(mainCss);

    describe('invariant 1 — @media 块存在', () => {
        it('main.css 包含 @media (prefers-reduced-motion: reduce)', () => {
            expect(block).not.toBeNull();
        });
    });

    describe('invariant 2 — animation: none 规则', () => {
        it('reduce 块内含 animation: none', () => {
            expect(block).toMatch(/animation\s*:\s*none/);
        });
    });

    describe('invariant 3 — 覆盖所有 @keyframes 动画', () => {
        it(`main.css 至少 5 个 @keyframes, reduce 块应禁用它们`, () => {
            expect(keyframes.length).toBeGreaterThanOrEqual(5);
            // 优先检查是否有 * 选择器统配（含 ::before / ::after）
            const universalRule = block!.match(/^\s*\*[^{]*\{/m);
            expect(universalRule).not.toBeNull();
        });
    });

    describe('invariant 4 — transition 也被禁用', () => {
        it('reduce 块内有 transition 处理（none 或 transition-duration 0.01ms）', () => {
            // 两种实现都接受：
            //   transition: none — 立即切断
            //   transition-duration: 0.01ms — 几乎即时但更平滑
            const hasNone = block!.match(/transition\s*:\s*none/);
            const hasDuration = block!.match(/transition-duration\s*:\s*0\.01ms/);
            expect(hasNone || hasDuration).not.toBeNull();
        });
    });

    describe('invariant 5 — 覆盖具体 class', () => {
        it('至少显式禁用 5 个具体的动画 class', () => {
            // 数 reduce 块内的选择器（每行一个 .classname 规则）
            const classRules = block!.match(/\.deeppdf-[\w-]+/g) || [];
            const uniqueClasses = new Set(classRules);
            expect(uniqueClasses.size).toBeGreaterThanOrEqual(5);
        });
    });
});
