/**
 * S-RES: 资源文件完整
 *
 * 触发:  检查 bin/ 目录
 * 断言:  main.js > 100KB, styles.css > 0KB, manifest.json 合法且 id="deepreader"（源 manifest）
 * 失败信息:  缺失文件 + 大小 + 解析错误
 *
 * 注: 源 manifest 的 id 固定为 "deepreader"（与 daily 一致），部署到 dev 时
 *     deploy.js 会按 target.pluginId 改写为 "deepreader-dev"。
 */

import { promises as fs } from 'fs';
import path from 'path';

const MAIN_JS_MIN_BYTES = 100 * 1024;   // 100KB
const STYLES_MIN_BYTES = 0;             // 任意非空
const EXPECTED_PLUGIN_ID = 'deepreader';

export default {
	id: 'S-RES',
	name: '资源文件完整',
	level: 'core',
	feature: null, // 基础设施，无对应 feature
	timeout: 1_000,

	async run({ projectRoot, log }) {
		const binDir = path.join(projectRoot, 'bin');
		const issues = [];

		// 1. main.js
		const mainJsPath = path.join(binDir, 'main.js');
		try {
			const stat = await fs.stat(mainJsPath);
			if (stat.size < MAIN_JS_MIN_BYTES) {
				issues.push(`bin/main.js 太小: ${stat.size}B < ${MAIN_JS_MIN_BYTES}B (可能未完整 build)`);
			}
		} catch (e) {
			issues.push(`bin/main.js 不存在: ${e.message}`);
		}

		// 2. styles.css
		const stylesPath = path.join(binDir, 'styles.css');
		try {
			const stat = await fs.stat(stylesPath);
			if (stat.size <= STYLES_MIN_BYTES) {
				issues.push(`bin/styles.css 为空: ${stat.size}B`);
			}
		} catch (e) {
			issues.push(`bin/styles.css 不存在: ${e.message}`);
		}

		// 3. manifest.json
		const manifestPath = path.join(binDir, 'manifest.json');
		try {
			const content = await fs.readFile(manifestPath, 'utf-8');
			const manifest = JSON.parse(content);
			if (manifest.id !== EXPECTED_PLUGIN_ID) {
				issues.push(`bin/manifest.json id 错误: "${manifest.id}" !== "${EXPECTED_PLUGIN_ID}"`);
			}
		} catch (e) {
			issues.push(`bin/manifest.json 读取/解析失败: ${e.message}`);
		}

		if (issues.length > 0) {
			const err = new Error(issues.join('; '));
			err.context = `项目根: ${projectRoot}, binDir: ${binDir}`;
			throw err;
		}

		log?.info?.('✓ bin/main.js, styles.css, manifest.json 全部就绪');
		return { ok: true };
	},
};
