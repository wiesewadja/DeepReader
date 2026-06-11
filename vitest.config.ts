import { defineConfig } from "vitest/config";
import path from "path";

/**
 * 生产代码中部分文件使用 `require('../../assets/xitong.jpg')` 加载静态资源
 * （esbuild 的 dataurl loader 会处理）。测试环境无该 loader，
 * 这个 plugin 在 transform 阶段把这类 require 替换为 stub 字符串。
 */
function stubAssetRequire() {
	return {
		name: "stub-asset-require",
		enforce: "pre" as const,
		transform(code: string, id: string) {
			if (id.includes("node_modules")) return null;
			// 匹配：const X = require('path/to/asset.ext') as string
			return code.replace(
				/require\(\s*(['"])([^'"]*\.(jpg|jpeg|png|gif|svg|webp))\1\s*\)/g,
				'("data:image/png;base64," /* stubbed asset: $2 */)',
			);
		},
	};
}

export default defineConfig({
	plugins: [stubAssetRequire()],
	resolve: {
		alias: [
			{ find: "@", replacement: path.resolve(__dirname, "./src") },
			{ find: "@tests", replacement: path.resolve(__dirname, "./tests") },
			{
				find: "obsidian",
				replacement: path.resolve(__dirname, "./tests/__mocks__/obsidian.ts"),
			},
			// Stub 静态资源（生产环境走 esbuild dataurl loader，测试环境不需要真实文件）
			{
				find: /\.(jpg|jpeg|png|gif|svg|webp)$/,
				replacement: "data:image/png;base64,",
			},
		],
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		include: ["./tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		exclude: [
			"node_modules",
			".worktrees",
			".claude/worktrees",
			// E2E 测试需要真实 API，不在默认测试中运行
			"./tests/e2e/**",
			// 以下测试文件引用了已移除的组件或需要大量重构
			"./tests/unit/**/message.test.ts",
			"./tests/unit/**/sidebar-view.test.ts",
			// 某些测试依赖外部资源
			"./tests/unit/**/search-quality-fixes.test.ts",
			"./tests/unit/**/book-search-v2.test.ts",
		],
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
	},
});
