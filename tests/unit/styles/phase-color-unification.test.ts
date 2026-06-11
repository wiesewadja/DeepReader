/**
 * Phase 配色统一（消解 AI 审美 + WCAG 1.4.1）
 *
 * 目标不变量：
 *  1. agent-humanized.css 4 个 reading-level 不再硬编码 hex 色
 *  2. 暗色主题覆写由 Obsidian 变量驱动（不手工 .theme-dark 重复定义）
 *  3. main.css 6 个 phase 进度条使用语义 token / opacity 梯度（不再 6 个不相关色相）
 *  4. 4 个 reading-level 至少有图标前缀（WCAG 1.4.1：颜色不单独传达信息）
 *  5. 6 个 phase 不再用 linear-gradient（AI 审美）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const agentHumanized = readFileSync(
    join(process.cwd(), 'src/styles/agent-humanized.css'),
    'utf-8',
);
const mainCss = readFileSync(join(process.cwd(), 'src/styles/main.css'), 'utf-8');
const variablesCss = readFileSync(
    join(process.cwd(), 'src/styles/variables.css'),
    'utf-8',
);

describe('Phase 配色统一（去 AI 审美 + WCAG 1.4.1）', () => {
    describe('invariant 1 — reading-level 不再硬编码 hex', () => {
        it('agent-humanized.css 4 个 reading-level 规则不含 hex 色', () => {
            // 4 个 reading-level-* 规则块
            const blocks =
                agentHumanized.match(/\.reading-level-\w+\s*\{[^}]+\}/g) || [];
            expect(blocks.length).toBeGreaterThanOrEqual(4);
            for (const block of blocks) {
                expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}/);
            }
        });
    });

    describe('invariant 2 — 暗色主题覆写由变量驱动', () => {
        it('agent-humanized.css 不再手工定义 .theme-dark .reading-level-*', () => {
            // 不再 hardcode 8 个 .theme-dark 覆写（每个 level 各亮/暗两套）
            const darkOverrides =
                agentHumanized.match(/\.theme-dark\s+\.reading-level-\w+/g) || [];
            // 允许少量 .theme-dark 覆写，但硬编码 hex 的不允许
            // 严格模式：完全删除
            expect(darkOverrides.length).toBe(0);
        });
    });

    describe('invariant 3 — 6 个 phase 进度条统一色相', () => {
        it('main.css 6 个 phase 进度条使用 --interactive-accent 或 --dr-color-* 变量（不硬编码 hex）', () => {
            const phaseRules = mainCss.match(
                /\.deeppdf-phase-\w+\s+\.deeppdf-task-progress-fill\s*\{([^}]+)\}/g,
            ) || [];
            expect(phaseRules.length).toBe(6);
            for (const rule of phaseRules) {
                expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
            }
        });

        it('不再使用 linear-gradient（6 个不相关色相的渐变）', () => {
            const phaseRules = mainCss.match(
                /\.deeppdf-phase-\w+\s+\.deeppdf-task-progress-fill\s*\{([^}]+)\}/g,
            ) || [];
            for (const rule of phaseRules) {
                expect(rule).not.toMatch(/linear-gradient/);
            }
        });
    });

    describe('invariant 4 — reading-level 至少 4 个图标前缀（WCAG 1.4.1）', () => {
        it('4 个 reading-level 规则块内 ::before / ::after 含图标字符（emoji 或 unicode）', () => {
            // 寻找 ::before 内容含字符的 4 个 reading-level 规则
            const iconRules =
                agentHumanized.match(
                    /\.reading-level-\w+::?before\s*\{[^}]*content\s*:\s*["'][^"']+["']/g,
                ) || [];
            expect(iconRules.length).toBeGreaterThanOrEqual(4);
        });
    });

    describe('invariant 5 — variables.css 定义 reading-level 颜色 token', () => {
        it('variables.css 至少定义 4 个 --dr-color-reading-* token', () => {
            const readingTokens = variablesCss.match(/--dr-color-reading-\w+/g) || [];
            expect(readingTokens.length).toBeGreaterThanOrEqual(4);
        });
    });
});
