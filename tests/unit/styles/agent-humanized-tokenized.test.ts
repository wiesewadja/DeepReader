/**
 * agent-humanized.css token 化（audit P1-6）
 *
 * 目标不变量（防止 token 化回退）：
 *  1. 文件不含任何硬编码 hex 色值
 *  2. 文件不含硬编码 rgba() / rgb()（应走 var(--dr-*) token）
 *  3. .theme-dark 覆写数量极小（理想为 0，由 Obsidian 变量透传）
 *  4. 所有颜色通过 CSS 变量引用
 *  5. 4 个 reading-level token 在文件中至少各被引用 1 次
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const agentHumanized = readFileSync(
    join(process.cwd(), 'src/styles/agent-humanized.css'),
    'utf-8',
);
const variablesCss = readFileSync(
    join(process.cwd(), 'src/styles/variables.css'),
    'utf-8',
);

describe('agent-humanized.css token 化（防止回退）', () => {
    describe('invariant 1 — 无硬编码 hex', () => {
        it('文件不含 #XXX / #XXXXXX 形式色值', () => {
            const hex = agentHumanized.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
            expect(hex).toEqual([]);
        });
    });

    describe('invariant 2 — 无硬编码 rgba/rgb', () => {
        it('文件不含 rgba( 或 rgb( 色值', () => {
            const rgb = agentHumanized.match(/rgba?\s*\(/g) || [];
            expect(rgb).toEqual([]);
        });
    });

    describe('invariant 3 — .theme-dark 覆写被删除', () => {
        it('手工 .theme-dark 覆写 ≤ 1（理想为 0，匹配实际规则块）', () => {
            // 匹配 .theme-dark 后面紧跟选择器（不在注释里）
            const darkOverrides = agentHumanized.match(
                /^[^*\n]*\.theme-dark[\s.]/gm,
            ) || [];
            expect(darkOverrides.length).toBeLessThanOrEqual(1);
        });
    });

    describe('invariant 4 — 颜色走 var() 引用', () => {
        it('含 var(--dr-color-*) 或 var(--background-*) 等变量引用', () => {
            const varRefs = agentHumanized.match(/var\(--[\w-]+/g) || [];
            expect(varRefs.length).toBeGreaterThanOrEqual(4);
        });
    });

    describe('invariant 5 — 4 个 reading-level token 都被使用', () => {
        it('--dr-color-reading-{elementary,inspectional,analytical,syntopical,skill} 各被引用', () => {
            // variables.css 定义了 5 个 reading token（elementary + 4 type）
            const definedTokens =
                variablesCss.match(/--dr-color-reading-[\w-]+/g) || [];
            for (const token of definedTokens) {
                // 简化为短名匹配（去掉 -- 前缀和颜色段，保留类型段）
                const shortName = token.replace('--dr-color-', '');
                expect(agentHumanized).toContain(`var(--dr-color-${shortName})`);
            }
        });
    });
});
