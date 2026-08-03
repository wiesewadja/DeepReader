/**
 * 轻量 E2E: 文本选择 → 引用卡片 UX 测试
 *
 * 迁移自 tests/e2e-cdp/specs/selection-quote.mjs
 * 验证：打开章节 → 激活阅读模式 → 选中文本 → 验证选择工具栏 →
 *       点击引用 → 验证侧边栏 quote card
 */

import { evalObsidian, waitForSelector } from '../../smoke/lib/obsidian-cli.mjs';
import { createStepRecorder } from '../steps.mjs';

const PLUGIN_ID = 'deepreader-dev';
const BOOK_ID = 'ee090e29';
const CHAPTER_FILE = 'DeepReader/AI极简经济学/04 - 第1章 导言.md';

export default {
	id: 'selection-quote',
	name: '文本选择引用卡片流',
	feature: 'F-17',
	timeout: 60_000,
	requires: {
		files: [CHAPTER_FILE],
	},

	async run({ log }) {
		const { steps, pass, fail } = createStepRecorder();

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
				return { steps, live: true };
			}
		}

		// 打开章节并激活阅读模式
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`(async () => {
					// 1. 关闭阅读模式
					const svc = app.plugins.plugins['${PLUGIN_ID}']?.readingModeService;
					if (svc && svc.isActive) svc.deactivate();
					
					// 2. 关闭所有 markdown leaves
					const oldLeaves = app.workspace.getLeavesOfType('markdown');
					for (let i = 0; i < oldLeaves.length; i++) {
						app.workspace.detachLeavesOfType('markdown');
					}
					await new Promise(r => setTimeout(r, 500));
					
					// 3. 打开章节文件到新 leaf
					const file = app.vault.getAbstractFileByPath('${CHAPTER_FILE}');
					if (!file) throw new Error('文件不存在');
					const leaf = app.workspace.getLeaf(true);
					await leaf.openFile(file);
					await new Promise(r => setTimeout(r, 500));
					
					// 4. 确保切换到预览模式
					const view = leaf.view;
					if (view && view.getMode() !== 'preview') {
						view.setState({ ...view.getState(), mode: 'preview' }, { history: false });
						await new Promise(r => setTimeout(r, 500));
					}
				})()`);
				await new Promise(r => setTimeout(r, 500));

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
				return { steps, live: true };
			}
		}

		// 等待阅读模式内容渲染
		{
			const t0 = Date.now();
			let ready = false;
			log?.warn?.('  等待阅读模式内容渲染…');
			for (let i = 0; i < 40; i++) {
				ready = await evalObsidian(`(() => {
					// 查找任何包含文本的段落元素（包括 callout 内的）
					const paragraphs = document.querySelectorAll('p');
					for (let j = 0; j < paragraphs.length; j++) {
						const p = paragraphs[j];
						if (p.textContent && p.textContent.trim().length > 20) {
							return true;
						}
					}
					return false;
				})()`);
				if (ready) break;
				if (i % 10 === 9) log?.warn?.(`    渲染等待中… (${(i + 1) * 0.5}s)`);
				await new Promise(r => setTimeout(r, 500));
			}
			if (ready) {
				pass('等待内容渲染', Date.now() - t0);
			} else {
				fail('等待内容渲染', Date.now() - t0, new Error('20s 内未渲染出文本段落'));
			}
		}

		// 清理已有的 quote 卡片
		{
			const t0 = Date.now();
			try {
				const count = await evalObsidian(`(() => {
					const quotes = document.querySelectorAll('.deeppdf-quote-card');
					quotes.forEach(q => q.remove());
					return quotes.length;
				})()`);
				pass('清理 quote 卡片', Date.now() - t0, `移除 ${count} 张`);
			} catch (e) {
				pass('清理 quote 卡片', Date.now() - t0, '无卡片');
			}
		}

		// 程序化选中文本
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					// 查找任何包含文本的段落元素
					const paragraphs = document.querySelectorAll('p');
					let targetP = null;
					for (let j = 0; j < paragraphs.length; j++) {
						const p = paragraphs[j];
						if (p.textContent && p.textContent.trim().length > 20) {
							targetP = p;
							break;
						}
					}
					if (!targetP) return { ok: false, reason: 'no paragraph with text' };

					// 找到第一个文本节点
					const textNode = Array.from(targetP.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
					if (!textNode) return { ok: false, reason: 'no text node' };

					// 使用 modify 扩展选区
					const sel = window.getSelection();
					sel.removeAllRanges();
					
					// 创建空范围放在文本开头
					const range = document.createRange();
					range.setStart(textNode, 0);
					range.collapse(true);
					sel.addRange(range);
					
					// 扩展选区 50 个字符
					for (let i = 0; i < 50; i++) {
						sel.modify('extend', 'forward', 'character');
					}

					// 触发 mouseup 事件
					const selRange = sel.getRangeAt(0);
					const rect = selRange.getBoundingClientRect();
					const evt = new MouseEvent('mouseup', {
						clientX: rect.left + rect.width / 2,
						clientY: rect.top + rect.height / 2,
						bubbles: true,
					});
					targetP.dispatchEvent(evt);

					return { ok: true, text: sel.toString().substring(0, 50) };
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

		return { steps, live: true };
	},
};
