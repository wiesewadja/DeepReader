/**
 * DOM 查询封装
 *
 * 提供对 Obsidian Electron 环境的 DOM 查询能力。
 * 底层走 evalObsidian（通过 CDP Runtime.evaluate）。
 */

import { evalObsidian } from './obsidian-cli.mjs';

/**
 * 计算匹配选择器的元素数量
 * @param {string} selector
 * @returns {Promise<number>}
 */
export async function countBySelector(selector) {
	return evalObsidian(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

/**
 * 列出指定容器（或整个文档）内所有含特定前缀的 className
 * @param {string} [prefix='deeppdf-']
 * @returns {Promise<string[]>}
 */
export async function listPrefixedClasses(prefix = 'deeppdf-') {
	const expr = `(() => {
		const set = new Set();
		document.querySelectorAll('*').forEach(el => {
			el.classList.forEach(c => { if (c.startsWith(${JSON.stringify(prefix)})) set.add(c); });
		});
		return Array.from(set).slice(0, 20);
	})()`;
	return evalObsidian(expr);
}

/**
 * 检查元素是否存在
 */
export async function exists(selector) {
	const count = await countBySelector(selector);
	return count > 0;
}
