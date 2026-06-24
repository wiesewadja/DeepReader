/**
 * 惰性 Node fs/promises 访问（跨平台兼容层）。
 *
 * 背景：Obsidian 移动端（Capacitor）的 Node polyfill
 *   1. 不识别 `node:` 前缀（仅匹配裸名 'fs'/'path'）
 *   2. `fs/promises` 子路径在移动端 polyfill 不保证可用（社区报告 obsidian-typst #38 等）
 *      —— 本工具通过"移动端永不调用 nodeFs()"规避：搜索走 `app ? vaultRead : nodeFs()` 双轨，移动端 app 存在走 vault
 *   3. 完全没有 child_process
 *
 * 因此任何 `import * as fs from "node:fs/promises"` 都会让依赖它的模块在插件加载阶段
 * （main.js 执行）触发 `require("node:fs/promises")`，导致移动端加载即崩。
 *
 * 本工具把 fs/promises 的 require 延迟到首次调用：
 *   - 加载阶段不触发（模块顶层无 node: import）
 *   - 桌面端：调用时 require 成功（Node 完整支持）
 *   - 移动端：仅在索引/构建路径才会调用——而移动端不索引（PC 同步数据），故永不触发
 *
 * ⚠️ 移动端搜索读取路径不应使用本工具——应走 mobile-fs 的 vaultRead/vaultExists
 *    （Vault adapter，两端可用）。本工具仅供桌面端索引构建 + 移动端不会触达的路径使用。
 */
let _fsPromises: typeof import("fs/promises") | null = null;

export function nodeFs(): typeof import("fs/promises") {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_fsPromises ??= require("fs/promises"));
}
