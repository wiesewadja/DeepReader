/**
 * 轻量 E2E: 阅读模式分页
 *
 * 对比: tests/e2e/specs/reading-mode-pagination.e2e.ts (622 行 WDIO)
 * 验证来源: test-vault/DeepReader/HISTORY.md (18 行, 唯一可用的 md)
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { countBySelector } from '../../smoke/lib/dom-query.mjs';

export default {
	id: 'reading-mode-pagination',
	name: '阅读模式分页',
	feature: 'F-17',
	timeout: 60_000,

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// ===== Setup: plugin loaded =====
		{
			const t0 = Date.now();
			try {
				const loaded = await evalObsidian('!!app.plugins?.plugins?.["deepreader"]');
				if (!loaded) throw new Error('plugin not loaded');
				pass('plugin loaded', Date.now() - t0);
			} catch (e) {
				fail('plugin loaded', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== activate reading mode =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const svc = app.plugins.plugins["deepreader"].readingModeService;
					svc.deactivate();
					const leaf = app.workspace.getLeavesOfType("markdown")[0];
					app.workspace.setActiveLeaf(leaf);
					const file = leaf?.view?.file;
					if (file) svc.activate(file);
					return { isActive: svc.isActive, file: file?.path };
				})()`);
				if (!result?.isActive) throw new Error(`reading mode not activated (result=${JSON.stringify(result)})`);
				pass('activate reading mode', Date.now() - t0, `file=${result.file}`);
			} catch (e) {
				fail('activate reading mode', Date.now() - t0, e);
				return { steps };
			}
		}

		// 等 paginator 渲染
		await new Promise(r => setTimeout(r, 1200));

		// ===== paginator initialized =====
		{
			const t0 = Date.now();
			try {
				const state = await evalObsidian(`JSON.stringify({
					hasPaginator: !!app.plugins.plugins["deepreader"].readingModeService.paginator,
					style: app.plugins.plugins["deepreader"].readingModeService.style,
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
				const total = await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.paginator.getTotalPages()');
				if (total < 2) throw new Error(`总页数 < 2 (total=${total})，无法验证翻页`);
				const before = await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.paginator.getCurrentPage()');
				await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.paginator.setCurrentPage(2)');
				await new Promise(r => setTimeout(r, 300));
				const after = await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.paginator.getCurrentPage()');
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
				const before = await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.paginator.getCurrentPage()');
				await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.paginator.setCurrentPage(1)');
				await new Promise(r => setTimeout(r, 300));
				const after = await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.paginator.getCurrentPage()');
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
				await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.deactivate()');
				await new Promise(r => setTimeout(r, 500));
				const isActive = await evalObsidian('app.plugins.plugins["deepreader"].readingModeService.isActive');
				if (isActive) throw new Error('deactivate did not work');
				pass('deactivate reading mode', Date.now() - t0);
			} catch (e) {
				fail('deactivate reading mode', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
