/**
 * 轻量 E2E: 阅读模式分页
 *
 * 验证: 打开章节文件 → 激活阅读模式 → paginator 初始化 → 翻页功能
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { createStepRecorder } from '../steps.mjs';

export default {
	id: 'reading-mode-pagination',
	name: '阅读模式分页',
	feature: 'F-17',
	timeout: 60_000,
	requires: {
		files: ['DeepReader/AI极简经济学/04 - 第1章 导言.md'],
	},

	async run({ log }) {
		const { steps, pass, fail } = createStepRecorder();
		const CHAPTER_FILE = 'DeepReader/AI极简经济学/04 - 第1章 导言.md';

		// ===== Setup: plugin loaded =====
		{
			const t0 = Date.now();
			try {
				const loaded = await evalObsidian('!!app.plugins?.plugins?.["deepreader-dev"]');
				if (!loaded) throw new Error('plugin not loaded');
				pass('plugin loaded', Date.now() - t0);
			} catch (e) {
				fail('plugin loaded', Date.now() - t0, e);
				return { steps, live: true };
			}
		}

		// ===== 清理并打开文件 =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`(async () => {
					// 1. 关闭阅读模式
					const svc = app.plugins.plugins["deepreader-dev"]?.readingModeService;
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
					await new Promise(r => setTimeout(r, 1000));
				})()`);
				pass('清理并打开文件', Date.now() - t0, CHAPTER_FILE);
			} catch (e) {
				fail('清理并打开文件', Date.now() - t0, e);
				return { steps, live: true };
			}
		}

		// ===== 检查 leaf 宽度 =====
		{
			const t0 = Date.now();
			try {
				const state = await evalObsidian(`(() => {
					const leaves = app.workspace.getLeavesOfType('markdown');
					const leaf = leaves[0];
					return {
						leafCount: leaves.length,
						leafWidth: leaf?.view?.containerEl?.offsetWidth || 0,
						filePath: leaf?.view?.file?.path || 'none'
					};
				})()`);
				if (state.leafWidth === 0) throw new Error(`leaf 宽度为 0 (count=${state.leafCount})`);
				pass('leaf 宽度正常', Date.now() - t0, `width=${state.leafWidth}`);
			} catch (e) {
				fail('leaf 宽度正常', Date.now() - t0, e);
				return { steps, live: true };
			}
		}

		// ===== activate reading mode =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const file = app.vault.getAbstractFileByPath('${CHAPTER_FILE}');
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					svc.setStyle("paginated");
					svc.activate(file);
					return { isActive: svc.isActive, style: svc.getStyle() };
				})()`);
				if (!result?.isActive) throw new Error('reading mode not activated');
				pass('activate reading mode', Date.now() - t0, `style=${result.style}`);
			} catch (e) {
				fail('activate reading mode', Date.now() - t0, e);
				return { steps, live: true };
			}
		}

		// ===== 等待 paginator 初始化 =====
		{
			const t0 = Date.now();
			let ready = false;
			log?.warn?.('  等待 paginator 初始化…');
			for (let i = 0; i < 60; i++) {
				const state = await evalObsidian(`(() => {
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					const paginator = svc.paginator;
					const totalPages = paginator?.getTotalPages?.() ?? 0;
					return { hasPaginator: !!paginator, totalPages };
				})()`);
				
				if (state.hasPaginator && state.totalPages > 1) {
					ready = true;
					break;
				}
				
				if (i % 10 === 9) log?.warn?.(`    等待中… (${(i + 1) * 0.5}s) totalPages=${state.totalPages}`);
				await new Promise(r => setTimeout(r, 500));
			}
			if (ready) {
				const totalPages = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.getTotalPages()');
				pass('paginator initialized', Date.now() - t0, `totalPages=${totalPages}`);
			} else {
				fail('paginator initialized', Date.now() - t0, new Error('paginator 未初始化或只有 1 页'));
				return { steps, live: true };
			}
		}

		// ===== .deeppdf-page-controls visible =====
		{
			const t0 = Date.now();
			try {
				const count = await evalObsidian(`document.querySelectorAll('.deeppdf-page-controls').length`);
				if (count === 0) throw new Error('.deeppdf-page-controls not found');
				pass('.deeppdf-page-controls visible', Date.now() - t0, `count=${count}`);
			} catch (e) {
				fail('.deeppdf-page-controls visible', Date.now() - t0, e);
			}
		}

		// ===== pagination buttons =====
		{
			const t0 = Date.now();
			try {
				const left = await evalObsidian(`document.querySelectorAll('.deeppdf-page-btn.left').length`);
				const right = await evalObsidian(`document.querySelectorAll('.deeppdf-page-btn.right').length`);
				if (left === 0 || right === 0) throw new Error(`left=${left}, right=${right}`);
				pass('pagination buttons (left/right)', Date.now() - t0, `left=${left}, right=${right}`);
			} catch (e) {
				fail('pagination buttons (left/right)', Date.now() - t0, e);
			}
		}

		// ===== navigate to next page =====
		{
			const t0 = Date.now();
			try {
				const total = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.getTotalPages()');
				if (total < 2) throw new Error(`总页数 < 2 (total=${total})`);
				const before = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.getCurrentPage()');
				await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.setCurrentPage(2)');
				await new Promise(r => setTimeout(r, 300));
				const after = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.getCurrentPage()');
				if (after !== 2) throw new Error(`setCurrentPage(2) failed: before=${before} after=${after}`);
				pass('navigate to next page', Date.now() - t0, `${before} -> ${after} (totalPages=${total})`);
			} catch (e) {
				fail('navigate to next page', Date.now() - t0, e);
			}
		}

		// ===== navigate to previous page =====
		{
			const t0 = Date.now();
			try {
				const before = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.getCurrentPage()');
				await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.setCurrentPage(1)');
				await new Promise(r => setTimeout(r, 300));
				const after = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.getCurrentPage()');
				if (after !== 1) throw new Error(`setCurrentPage(1) failed: before=${before} after=${after}`);
				pass('navigate to previous page', Date.now() - t0, `${before} -> ${after}`);
			} catch (e) {
				fail('navigate to previous page', Date.now() - t0, e);
			}
		}

		// ===== deactivate reading mode =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.deactivate()');
				await new Promise(r => setTimeout(r, 500));
				const isActive = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.isActive');
				if (isActive) throw new Error('deactivate did not work');
				pass('deactivate reading mode', Date.now() - t0);
			} catch (e) {
				fail('deactivate reading mode', Date.now() - t0, e);
			}
		}

		return { steps, live: true };
	},
};
