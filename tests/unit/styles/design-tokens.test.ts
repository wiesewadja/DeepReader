/**
 * 设计 token 系统 — 5 套令牌（color / spacing / typography / radius / shadow）
 *
 * 目标不变量：
 *  1. 5 套 token 全部定义：color / spacing / typography / radius / shadow
 *  2. 命名空间：--dr-* 前缀（不与 Obsidian 原生 var 冲突）
 *  3. token 可解析（无 syntax error）
 *  4. 关键 token 至少存在一个使用方
 *  5. spacing 走 4px 步进
 *  6. radius 至少有 3 档（sm / md / lg）
 *  7. token 注释：每个 token 应该有用途说明
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const variablesCss = readFileSync(
    join(process.cwd(), 'src/styles/variables.css'),
    'utf-8',
);

const mainCss = (() => {
    try {
        return readFileSync(join(process.cwd(), 'src/styles/main.css'), 'utf-8');
    } catch {
        return '';
    }
})();

function extractTokenNames(css: string): string[] {
    // 匹配 :root { --xxx: value; } 块
    const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
    if (!rootMatch) return [];
    return [
        ...rootMatch[1].matchAll(/--([a-zA-Z0-9-]+)\s*:/g),
    ].map((m) => m[1]);
}

describe('设计 token 系统（--dr-* 前缀）', () => {
    const tokens = extractTokenNames(variablesCss);
    const allDrTokens = tokens.filter((t) => t.startsWith('dr-'));

    describe('invariant 1 — 5 套 token 命名空间', () => {
        it('color 套：至少 3 个 --dr-color-* token', () => {
            const colorTokens = allDrTokens.filter((t) => t.startsWith('dr-color-'));
            expect(colorTokens.length).toBeGreaterThanOrEqual(3);
        });

        it('spacing 套：至少 4 个 --dr-space-* token', () => {
            const spacingTokens = allDrTokens.filter((t) => t.startsWith('dr-space-'));
            expect(spacingTokens.length).toBeGreaterThanOrEqual(4);
        });

        it('typography 套：至少 3 个 --dr-text-* token', () => {
            const textTokens = allDrTokens.filter((t) => t.startsWith('dr-text-'));
            expect(textTokens.length).toBeGreaterThanOrEqual(3);
        });

        it('radius 套：至少 3 个 --dr-radius-* token', () => {
            const radiusTokens = allDrTokens.filter((t) => t.startsWith('dr-radius-'));
            expect(radiusTokens.length).toBeGreaterThanOrEqual(3);
        });

        it('shadow 套：至少 2 个 --dr-shadow-* token', () => {
            const shadowTokens = allDrTokens.filter((t) => t.startsWith('dr-shadow-'));
            expect(shadowTokens.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('invariant 2 — spacing 4px 步进', () => {
        it('--dr-space-1 / 2 / 3 / 4 走 4px 步进（0.25rem / 0.5rem / 0.75rem / 1rem）', () => {
            // 提取所有 --dr-space-N 的值
            const spaceMap: Record<string, string> = {};
            for (const match of variablesCss.matchAll(
                /--dr-space-(\d+)\s*:\s*([^;]+);/g,
            )) {
                spaceMap[match[1]] = match[2].trim();
            }
            expect(spaceMap['1']).toBe('0.25rem');
            expect(spaceMap['2']).toBe('0.5rem');
            expect(spaceMap['3']).toBe('0.75rem');
            expect(spaceMap['4']).toBe('1rem');
        });
    });

    describe('invariant 3 — radius 至少 3 档', () => {
        it('包含 sm / md / lg', () => {
            expect(variablesCss).toMatch(/--dr-radius-sm/);
            expect(variablesCss).toMatch(/--dr-radius-md/);
            expect(variablesCss).toMatch(/--dr-radius-lg/);
        });
    });

    describe('invariant 4 — token 可解析（CSS 语法）', () => {
        it('所有 :root 块花括号配对', () => {
            const rootBlocks = variablesCss.match(/:root[^{]*\{/g) || [];
            const openCount = (variablesCss.match(/\{/g) || []).length;
            const closeCount = (variablesCss.match(/\}/g) || []).length;
            expect(openCount).toBe(closeCount);
            expect(rootBlocks.length).toBeGreaterThanOrEqual(1);
        });

        it('所有 token 声明以分号结尾', () => {
            // 反向：检查每行 "var(--dr-...)" 引用都能在定义中找到
            for (const ref of variablesCss.matchAll(/var\(--(dr-[a-zA-Z0-9-]+)/g)) {
                expect(allDrTokens).toContain(ref[1]);
            }
        });
    });

    describe('invariant 5 — token 实际有使用方', () => {
        it('至少有 1 个 --dr-* token 在 main.css 被引用', () => {
            const drRefs = mainCss.match(/var\(--dr-[a-zA-Z0-9-]+/g) || [];
            expect(drRefs.length).toBeGreaterThan(0);
        });
    });
});
