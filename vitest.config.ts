import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@tests': path.resolve(__dirname, './tests'),
            'obsidian': path.resolve(__dirname, './tests/__mocks__/obsidian.ts')
        }
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        exclude: [
            'node_modules',
            '.worktrees',
            '.claude/worktrees',
            // 以下测试文件引用了已移除的组件或需要大量重构
            'tests/components/message.test.ts',
            'tests/views/sidebar-view.test.ts',
            'src/api/__tests__/server-manager.test.ts',
            // E2E 测试需要真实 API，不在默认测试中运行
            'src/services/__tests__/profile-builder-embedding.e2e.test.ts',
        ],
        poolOptions: {
            threads: {
                singleThread: true
            }
        }
    }
});
