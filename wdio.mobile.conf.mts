import * as path from "path";

/**
 * WebdriverIO Mobile 配置 — 真实 Android Obsidian（Capacitor，无 Node）
 *
 * 用于在 Android Virtual Device 上测试 DeepReader 插件加载。
 * 与桌面 wdio.conf.ts 的区别：跑真实 Android Obsidian（Capacitor 无 Node 核心模块），
 * 能复现移动端 require('fs'/'path'/'crypto' 等) 崩溃——桌面 Electron 测不出。
 *
 * 前置：
 *   1. Android Studio + AVD `obsidian_test`（AVD Manager 建一台，如 Pixel 7 + API 34）
 *   2. npm install --save-dev appium appium-uiautomator2-driver @wdio/appium-service
 *
 * 运行：npx wdio run ./wdio.mobile.conf.mts
 */
export const config: WebdriverIO.Config = {
	runner: 'local',
	framework: 'mocha',
	specs: ['./tests/mobile/**/*.e2e.ts'],

	// Android 测试不能并行
	maxInstances: 1,

	capabilities: [{
		browserName: "obsidian",
		browserVersion: "latest",
		platformName: 'Android',
		'appium:automationName': 'UiAutomator2',
		'appium:avd': "obsidian_test",
		// 加速：不每次重置 AVD
		'appium:noReset': true,
		'wdio:obsidianOptions': {
			// 加载当前目录（worktree）的插件 —— 修复版 bin
			plugins: ["."],
			// 用主仓库的 test-vault（worktree 没有，test-vault 在主仓库 gitignored）
			vault: "/Users/lizhao/workspace/DeepReader/test-vault",
		},
	}],

	services: [
		"obsidian",
		["appium", {
			args: { allowInsecure: "*:chromedriver_autodownload,*:adb_shell" },
		}],
	],
	reporters: ['spec'],

	cacheDir: path.resolve(".obsidian-cache"),
	mochaOpts: {
		ui: 'bdd',
		// Android AVD 启动慢，给足超时
		timeout: 180000,
	},
	logLevel: "info",
};
