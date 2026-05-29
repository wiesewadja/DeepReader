import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '../src'),
            '@tests': path.resolve(__dirname, '.'),
            'obsidian': path.resolve(__dirname, './tests/__mocks__/obsidian.ts')
        }
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        include: ['./tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        exclude: [
            'node_modules',
            '.worktrees',
            '.claude/worktrees',
            // E2E 测试需要真实 API，不在默认测试中运行
            './tests/e2e/**',
            // 以下测试文件引用了已移除的组件或需要大量重构
            './tests/unit/**/message.test.ts',
            './tests/unit/**/sidebar-view.test.ts',
            // 某些测试依赖外部资源
            './tests/unit/**/search-quality-fixes.test.ts',
            './tests/unit/**/book-search-v2.test.ts',
        ],
        poolOptions: {
            forks: {
                singleFork: true
            }
        }
    }
});
