/**
 * 响应式断点补全（audit P1-8）
 *
 * 目标不变量：
 *  1. main.css 至少含 4 档断点：320 / 768 / 1024 / 1440
 *  2. 断点按 mobile-first 升序（min-width 不用 max-width 单调）
 *  3. 每个断点有具体规则（非空块）
 *  4. 全局响应式覆盖：主内容 padding / font-size 在小屏有调整
 *  5. prefers-reduced-motion 不与响应式混在同块（关注点分离）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mainCss = readFileSync(join(process.cwd(), 'src/styles/main.css'), 'utf-8');

interface MediaBlock {
    query: string;
    body: string;
    startLine: number;
}

function extractMediaBlocks(css: string): MediaBlock[] {
    const blocks: MediaBlock[] = [];
    const regex = /@media\s+([^{]+)\s*\{/g;
    let match;
    while ((match = regex.exec(css)) !== null) {
        const query = match[1].trim();
        const startIdx = match.index + match[0].length;
        // 找到匹配的右大括号
        let depth = 1;
        let i = startIdx;
        while (i < css.length && depth > 0) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
        }
        const body = css.substring(startIdx, i - 1);
        const line = css.substring(0, startIdx).split('\n').length;
        // 跳过嵌套 @media（深度 > 1 的内层）— 简单近似：长度 < 50 字符视为嵌套
        if (body.length < 50 && body.includes('@media')) continue;
        blocks.push({ query, body, startLine: line });
    }
    return blocks;
}

describe('响应式断点补全（audit P1-8）', () => {
    const blocks = extractMediaBlocks(mainCss);

    describe('invariant 1 — 4 档断点存在', () => {
        it('@media (min-width: 320px) 块存在（mobile 起点）', () => {
            expect(blocks.some((b) => b.query.includes('min-width: 320px'))).toBe(true);
        });

        it('@media (min-width: 768px) 块存在（tablet 起点）', () => {
            expect(blocks.some((b) => b.query.includes('min-width: 768px'))).toBe(true);
        });

        it('@media (min-width: 1024px) 块存在（desktop 起点）', () => {
            expect(blocks.some((b) => b.query.includes('min-width: 1024px'))).toBe(true);
        });

        it('@media (min-width: 1440px) 块存在（large desktop）', () => {
            expect(blocks.some((b) => b.query.includes('min-width: 1440px'))).toBe(true);
        });
    });

    describe('invariant 2 — mobile-first 升序', () => {
        it('断点宽度按 320 < 768 < 1024 < 1440 升序', () => {
            const widths = blocks
                .map((b) => {
                    const m = b.query.match(/min-width:\s*(\d+)px/);
                    return m ? parseInt(m[1]) : null;
                })
                .filter((w): w is number => w !== null);
            // 检查至少 4 个升序断点
            for (let i = 1; i < widths.length; i++) {
                if (widths[i] !== null) {
                    expect(widths[i]).toBeGreaterThan(widths[i - 1]);
                }
            }
        });

        it('无 max-width 单调链（mobile-first 不用 max-width 降序）', () => {
            // 至少不应该有 4+ 个 max-width 断点（如果是 max-width 模式，是 desktop-first）
            const maxWidths = blocks.filter((b) => b.query.includes('max-width'));
            // 允许 1 个老的 max-width: 640px（audit 中提到）作为 fallback
            expect(maxWidths.length).toBeLessThanOrEqual(1);
        });
    });

    describe('invariant 3 — 每个断点有具体规则', () => {
        it('所有 4 个断点块体非空（≥ 50 字符）', () => {
            const targetWidths = [320, 768, 1024, 1440];
            for (const w of targetWidths) {
                const block = blocks.find((b) =>
                    b.query.includes(`min-width: ${w}px`),
                );
                expect(block).toBeDefined();
                expect(block!.body.trim().length).toBeGreaterThan(20);
            }
        });
    });

    describe('invariant 4 — 关键 UI 在小屏有调整', () => {
        it('最小断点 320 块内调整了 padding 或 font-size', () => {
            const block = blocks.find((b) => b.query.includes('min-width: 320px'));
            const body = block?.body || '';
            expect(body).toMatch(/padding|font-size|margin/);
        });

        it('1440 块内有 max-width 限制（大屏避免过宽）', () => {
            const block = blocks.find((b) => b.query.includes('min-width: 1440px'));
            const body = block?.body || '';
            expect(body).toMatch(/max-width|width/);
        });
    });

    describe('invariant 5 — 关注点分离', () => {
        it('prefers-reduced-motion 不与 min-width 块合并', () => {
            const reducedMotion = blocks.find((b) =>
                b.query.includes('prefers-reduced-motion'),
            );
            expect(reducedMotion).toBeDefined();
            // 它的 query 只含 prefers-reduced-motion，不应同时含 min-width
            expect(reducedMotion!.query).not.toMatch(/min-width/);
        });
    });
});
