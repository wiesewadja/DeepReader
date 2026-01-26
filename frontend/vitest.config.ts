import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@tests': path.resolve(__dirname, './tests')
        }
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        exclude: ['node_modules'],
        poolOptions: {
            threads: {
                singleThread: true
            }
        }
    },
    define: {
        'obsidian': '{}'
    }
});
