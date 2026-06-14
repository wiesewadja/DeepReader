/**
 * 轻量 E2E: 文本选择 → 引用卡片 UX 测试
 *
 * 迁移自 tests/e2e-cdp/specs/selection-quote.mjs
 * 验证：打开章节 → 激活阅读模式 → 选中文本 → 验证选择工具栏 →
 *       点击引用 → 验证侧边栏 quote card
 */

import { evalObsidian, waitForSelector } from '../../smoke/lib/obsidian-cli.mjs';

const PLUGIN_ID = 'deepreader-dev';
const BOOK_ID = 'ee090e29';
const CHAPTER_FILE = 'DeepReader/AI极简经济学/04 - 第1章 导言.md';

export default {
	id: 'selection-quote',
	name: '文本选择引用卡片流',
	feature: 'F-17',
	timeout: 30_000,
	requires: {
		files: [CHAPTER_FILE],
	},

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// 检查插件和索引
		{
			const t0 = Date.now();
			try {
				const loaded = await evalObsidian(`!!app.plugins?.plugins?.["${PLUGIN_ID}"]`);
				if (!loaded) throw new Error('插件未加载');

				const indexExists = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return adapter.exists('.obsidian/plugins/${PLUGIN_ID}/pageindex/${BOOK_ID}/book-meta.json');
				})()`);
				if (!indexExists) throw new Error(`${BOOK_ID} 未索引`);

				const fileExists = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return adapter.exists('${CHAPTER_FILE}');
				})()`);
				if (!fileExists) throw new Error(`章节文件不存在: ${CHAPTER_FILE}`);

				pass('基线检查', Date.now() - t0, `索引OK, 章节存在`);
			} catch (e) {
				fail('基线检查', Date.now() - t0, e);
				return { steps };
			}
		}

		// 打开章节并激活阅读模式
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`(async () => {
					const file = app.vault.getAbstractFileByPath('${CHAPTER_FILE}');
					if (!file) throw new Error('文件不存在: ${CHAPTER_FILE}');
					const leaf = app.workspace.getUnpinnedLeaf();
					await leaf.openFile(file);
				})()`);
				await new Promise(r => setTimeout(r, 1000));

				const result = await evalObsidian(`(() => {
					const file = app.vault.getAbstractFileByPath('${CHAPTER_FILE}');
					const svc = app.plugins.plugins['${PLUGIN_ID}']?.readingModeService;
					if (!file) return { ok: false, error: 'file not found' };
					if (!svc) return { ok: false, error: 'readingModeService not found' };
					svc.activate(file);
					return { ok: true, active: svc.isActive };
				})()`);
				if (!result?.ok) throw new Error(result?.error || '激活失败');
				await new Promise(r => setTimeout(r, 1000));
				pass('打开章节并激活阅读模式', Date.now() - t0);
			} catch (e) {
				fail('打开章节并激活阅读模式', Date.now() - t0, e);
				return { steps };
			}
		}

		// 程序化选中文本
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const view = document.querySelector('.markdown-preview-view');
					if (!view) return { ok: false, reason: 'no .markdown-preview-view' };
					const p = view.querySelector('p');
					if (!p || !p.textContent.trim()) return { ok: false, reason: 'no paragraph with text' };

					const range = document.createRange();
					range.selectNodeContents(p);
					const sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);

					const rect = p.getBoundingClientRect();
					const evt = new MouseEvent('mouseup', {
						clientX: rect.left + rect.width / 2,
						clientY: rect.top + rect.height / 2,
						bubbles: true,
					});
					p.dispatchEvent(evt);

					return { ok: true, text: p.textContent.substring(0, 50) };
				})()`);
				if (!result?.ok) throw new Error(result?.reason || '选中文本失败');
				pass('程序化选中文本', Date.now() - t0, `选中: "${result.text}..."`);
			} catch (e) {
				fail('程序化选中文本', Date.now() - t0, e);
			}
		}

		// 选择工具栏出现
		{
			const t0 = Date.now();
			try {
				await waitForSelector('.deeppdf-selection-toolbar.visible', 5000);
				pass('选择工具栏出现', Date.now() - t0);
			} catch (e) {
				fail('选择工具栏出现', Date.now() - t0, e);
			}
		}

		// 引用按钮存在
		{
			const t0 = Date.now();
			try {
				const count = await evalObsidian(`document.querySelectorAll('.deeppdf-toolbar-btn[data-action="quote"]').length`);
				if (count === 0) throw new Error('quote 按钮未找到');
				pass('引用按钮存在', Date.now() - t0, `${count} 个 quote 按钮`);
			} catch (e) {
				fail('引用按钮存在', Date.now() - t0, e);
			}
		}

		// 点击引用按钮
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`document.querySelector('.deeppdf-toolbar-btn[data-action="quote"]')?.click()`);
				pass('点击引用按钮', Date.now() - t0);
			} catch (e) {
				fail('点击引用按钮', Date.now() - t0, e);
			}
		}

		// 侧边栏出现引用卡片
		{
			const t0 = Date.now();
			try {
				await waitForSelector('.deeppdf-quote-card', 5000);
				const count = await evalObsidian(`document.querySelectorAll('.deeppdf-quote-card').length`);
				pass('侧边栏出现引用卡片', Date.now() - t0, `${count} 张引用卡片`);
			} catch (e) {
				fail('侧边栏出现引用卡片', Date.now() - t0, e);
			}
		}

		// 引用文本非空
		{
			const t0 = Date.now();
			try {
				const text = await evalObsidian(`document.querySelector('.deeppdf-quote-text')?.textContent?.trim() || ''`);
				if (!text || text.length === 0) throw new Error('引用文本为空');
				pass('引用文本非空', Date.now() - t0, `引用长度: ${text.length} 字符`);
			} catch (e) {
				fail('引用文本非空', Date.now() - t0, e);
			}
		}

		// 清理：停用阅读模式
		{
			await evalObsidian(`(() => {
				const svc = app.plugins.plugins['${PLUGIN_ID}']?.readingModeService;
				if (svc) svc.deactivate();
			})()`);
		}

		return { steps };
	},
};
