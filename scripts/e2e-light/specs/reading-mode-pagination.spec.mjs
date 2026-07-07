/**
 * 轻量 E2E: 阅读模式分页
 *
 * 对比: tests/e2e/specs/reading-mode-pagination.e2e.ts (622 行 WDIO)
 * 验证来源: test-vault/DeepReader/HISTORY.md (18 行, 唯一可用的 md)
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { countBySelector } from '../../smoke/lib/dom-query.mjs';
import { createStepRecorder } from '../steps.mjs';

export default {
	id: 'reading-mode-pagination',
	name: '阅读模式分页',
	feature: 'F-17',
	timeout: 60_000,
	requires: {
		files: ['DeepReader/HISTORY.md'],
		minLines: { 'DeepReader/HISTORY.md': 100 },
	},

	async run({ log }) {
		const { steps, pass, fail } = createStepRecorder();

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

		// ===== activate reading mode（显式锁定 paginated 风格）=====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					svc.setStyle("paginated");
					svc.deactivate();
					const leaf = app.workspace.getLeavesOfType("markdown")[0];
					app.workspace.setActiveLeaf(leaf);
					const file = leaf?.view?.file;
					if (file) svc.activate(file);
					return { isActive: svc.isActive, file: file?.path, style: svc.getStyle() };
				})()`);
				if (!result?.isActive) throw new Error(`reading mode not activated (result=${JSON.stringify(result)})`);
				if (result?.style !== 'paginated') throw new Error(`reading mode 风格非 paginated (style=${result?.style})`);
				pass('activate reading mode', Date.now() - t0, `file=${result.file} style=${result.style}`);
			} catch (e) {
				fail('activate reading mode', Date.now() - t0, e);
				return { steps, live: true };
			}
		}

		// 等待阅读模式内容渲染（替换固定 1200ms 盲等；initPaginator 守卫依赖 .markdown-preview-content 出现）
		{
		let rendered = false;
		log?.warn?.('  等待阅读模式内容渲染…');
		for (let i = 0; i < 24; i++) {
				rendered = await evalObsidian(`(() => {
					const c = document.querySelector(".markdown-preview-content");
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					return (!!(c && c.querySelector("p,li,h1,h2,h3,h4"))) || !!svc.paginator;
				})()`);
				if (rendered) break;
				if (i % 6 === 5) log?.warn?.(`    渲染等待中… (${(i + 1) * 0.5}s)`);
				await new Promise(r => setTimeout(r, 500));
			}
			if (!rendered) {
				log?.warn?.('内容未在 12s 内渲染（可能 e2e 激活路径未触发渲染，属环境/配置限制）');
			}
		}

		// ===== paginator initialized =====
		{
			const t0 = Date.now();
			try {
				const state = await evalObsidian(`JSON.stringify({
					hasPaginator: !!app.plugins.plugins["deepreader-dev"].readingModeService.paginator,
					style: app.plugins.plugins["deepreader-dev"].readingModeService.getStyle(),
				})`);
				const obj = JSON.parse(state);
				if (!obj.hasPaginator) throw new Error('paginator not initialized');
				pass('paginator initialized', Date.now() - t0, `style=${obj.style}`);
			} catch (e) {
				fail('paginator initialized', Date.now() - t0, e);
			}
		}

		// ===== .deeppdf-page-controls visible =====
		{
			const t0 = Date.now();
			try {
				const count = await countBySelector('.deeppdf-page-controls');
				if (count === 0) throw new Error('.deeppdf-page-controls not found in DOM');
				pass('.deeppdf-page-controls visible', Date.now() - t0, `count=${count}`);
			} catch (e) {
				fail('.deeppdf-page-controls visible', Date.now() - t0, e);
			}
		}

		// ===== pagination buttons =====
		{
			const t0 = Date.now();
			try {
				const left = await countBySelector('.deeppdf-page-btn.left');
				const right = await countBySelector('.deeppdf-page-btn.right');
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
				if (total < 2) throw new Error(`总页数 < 2 (total=${total})，无法验证翻页`);
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
