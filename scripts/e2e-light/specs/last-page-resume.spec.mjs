/**
 * 轻量 E2E: 上次阅读位置恢复
 *
 * 覆盖：topbar / 库封面 → 继续阅读 的数据契约
 * 1. 激活阅读模式后翻页 → pageMemory + lastReadAt 写入
 * 2. 停用后 → last-pages.json 落盘
 * 3. openMostRecent() 返回正确文件
 * 4. activate(file) 自动恢复页码
 *
 * 锚定:
 * - src/pageindex/last-page-store.ts (v2 数据格式)
 * - src/services/reading-mode-service.ts (recordPage / openMostRecent / onPageChange)
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const LAST_PAGES_PATH = '.obsidian/plugins/deepreader-dev/pageindex/last-pages.json';

export default {
	id: 'last-page-resume',
	name: '上次阅读位置恢复（topbar/库封面 → 继续阅读）',
	feature: 'F-17',
	timeout: 60_000,
	requires: {
		// 至少一个 DeepReader/ 下的 md 文件（章节）
		files: [],
	},

	async run({ log }) {
		const steps = [];
		const pass = (n, d, det) => { steps.push({ name: n, status: 'pass', duration: d, detail: det }); log?.info?.(`  ✓ ${n} (${d}ms)${det ? '  ' + det : ''}`); };
		const fail = (n, d, e) => { steps.push({ name: n, status: 'fail', duration: d, error: e.message }); };
		const skip = (n, d, r) => { steps.push({ name: n, status: 'skip', duration: d, error: r }); };

		// Step 1: plugin loaded
		{
			const t0 = Date.now();
			try {
				const loaded = await evalObsidian('!!app.plugins?.plugins?.["deepreader-dev"]');
				if (!loaded) throw new Error('plugin not loaded');
				pass('plugin loaded', Date.now() - t0);
			} catch (e) {
				fail('plugin loaded', Date.now() - t0, e);
				return { steps };
			}
		}

		// Step 2: 找一个有足够分页的章节文件
		let chapterFilePath = null;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					// 优先用第一个 DeepReader 章节文件
					const files = app.vault.getMarkdownFiles().filter(f =>
						f.path.startsWith('DeepReader/') &&
						!f.path.startsWith('DeepReader/covers/') &&
						!f.path.startsWith('DeepReader/assets/') &&
						/^\\d+/.test(f.basename)
					).sort((a, b) => b.stat.size - a.stat.size);  // 优先用最大的
					return files[0]?.path || null;
				})()`);
				if (!result) {
					skip('查找章节文件', Date.now() - t0, 'DeepReader/ 下无章节文件');
					return { steps };
				}
				chapterFilePath = result;
				pass('查找章节文件', Date.now() - t0, chapterFilePath);
			} catch (e) {
				fail('查找章节文件', Date.now() - t0, e);
				return { steps };
			}
		}

		// Step 3: 读取 last-pages.json（如果存在）以备还原
		let originalLastPages = null;
		{
			const t0 = Date.now();
			try {
				const exists = await evalObsidian(`app.vault.adapter.exists(${JSON.stringify(LAST_PAGES_PATH)})`);
				if (exists) {
					const raw = await evalObsidian(`app.vault.adapter.read(${JSON.stringify(LAST_PAGES_PATH)})`);
					originalLastPages = raw;
				}
				pass('读取原 last-pages.json', Date.now() - t0, exists ? '存在（将还原）' : '不存在（新建）');
			} catch (e) {
				fail('读取原 last-pages.json', Date.now() - t0, e);
			}
		}

		// Step 4: 打开章节 leaf + 显式 activate
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					svc.deactivate();
					const file = app.vault.getAbstractFileByPath(${JSON.stringify(chapterFilePath)});
					if (!file) return { error: 'file not found' };
					// 找现有 markdown leaf 或开新的
					let leaf = app.workspace.getLeavesOfType("markdown").find(l => l.view?.file?.path === ${JSON.stringify(chapterFilePath)});
					if (!leaf) {
						leaf = app.workspace.getLeaf(false);
						await leaf.openFile(file);
					}
					app.workspace.setActiveLeaf(leaf);
					// 等视图稳定
					await new Promise(r => setTimeout(r, 200));
					svc.activate(file);
					return { ok: true, isActive: svc.isActive };
				})()`);
				if (result?.error) throw new Error(result.error);
				if (!result?.isActive) throw new Error('activate 后 isActive=false');
				pass('打开章节 + activate', Date.now() - t0, chapterFilePath);
			} catch (e) {
				fail('打开章节 + activate', Date.now() - t0, e);
				return { steps };
			}
		}

		await new Promise(r => setTimeout(r, 2500));

		// Step 5: 验证 paginator 初始化 + 总页数 >= 2
		let totalPages = 0;
		{
			const t0 = Date.now();
			try {
				const state = await evalObsidian(`JSON.stringify({
					hasPaginator: !!app.plugins.plugins["deepreader-dev"].readingModeService.paginator,
					total: app.plugins.plugins["deepreader-dev"].readingModeService.paginator?.getTotalPages() || 0,
				})`);
				const obj = JSON.parse(state);
				if (!obj.hasPaginator) throw new Error('paginator 未初始化');
				totalPages = obj.total;
				if (totalPages < 2) {
					skip('paginator 初始化', Date.now() - t0, `总页数 ${totalPages} < 2，无法验证翻页`);
					return { steps };
				}
				pass('paginator 初始化', Date.now() - t0, `totalPages=${totalPages}`);
			} catch (e) {
				fail('paginator 初始化', Date.now() - t0, e);
				return { steps };
			}
		}

		// Step 6: 翻到第 2 页 + 验证 pageMemory + lastReadAt
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`app.plugins.plugins["deepreader-dev"].readingModeService.paginator.setCurrentPage(2)`);
				await new Promise(r => setTimeout(r, 400));
				const state = await evalObsidian(`(async () => {
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					await svc.flushSave();
					const page = svc.pageMemory.get(${JSON.stringify(chapterFilePath)});
					const ts = svc.lastReadAt.get(${JSON.stringify(chapterFilePath)});
					return JSON.stringify({ page, tsSet: ts > 0 });
				})()`);
				const obj = JSON.parse(state);
				if (obj.page !== 2) throw new Error(`pageMemory.page=${obj.page}（期望 2）`);
				if (!obj.tsSet) throw new Error(`lastReadAt 未设置或为 0`);
				pass('翻页 → pageMemory + lastReadAt', Date.now() - t0, `page=2, ts>0`);
			} catch (e) {
				fail('翻页 → pageMemory + lastReadAt', Date.now() - t0, e);
			}
		}

		// Step 7: 验证 last-pages.json 落盘
		{
			const t0 = Date.now();
			try {
				const raw = await evalObsidian(`app.vault.adapter.read(${JSON.stringify(LAST_PAGES_PATH)})`);
				const parsed = JSON.parse(raw);
				if (parsed.version !== 2) throw new Error(`version=${parsed.version}（期望 2）`);
				const entry = parsed.entries?.[chapterFilePath];
				if (!entry) throw new Error(`entries[${chapterFilePath}] 不存在`);
				if (entry.page !== 2) throw new Error(`entry.page=${entry.page}（期望 2）`);
				if (typeof entry.lastReadAt !== 'number' || entry.lastReadAt <= 0) throw new Error(`entry.lastReadAt=${entry.lastReadAt}（应为正数）`);
				pass('last-pages.json 落盘', Date.now() - t0, `version=2 page=2 lastReadAt=${entry.lastReadAt}`);
			} catch (e) {
				fail('last-pages.json 落盘', Date.now() - t0, e);
			}
		}

		// Step 8: openMostRecent 找到当前文件
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					// deactivate 一次以确保不是 active
					const wasActive = svc.isActive;
					if (wasActive) svc.deactivate();
					const opened = await svc.openMostRecent();
					return JSON.stringify({ opened, currentFile: svc.getCurrentFile()?.path });
				})()`);
				const obj = JSON.parse(result);
				if (!obj.opened) throw new Error('openMostRecent 返回 false');
				if (obj.currentFile !== chapterFilePath) throw new Error(`currentFile=${obj.currentFile}（期望 ${chapterFilePath}）`);
				pass('openMostRecent 找到最近阅读', Date.now() - t0, `→ ${obj.currentFile}`);
			} catch (e) {
				fail('openMostRecent 找到最近阅读', Date.now() - t0, e);
			}
		}

		await new Promise(r => setTimeout(r, 1500));

		// Step 9: 重新激活 → 恢复 page 2
		{
			const t0 = Date.now();
			try {
				await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.deactivate()');
				await new Promise(r => setTimeout(r, 300));
				const result = await evalObsidian(`(async () => {
					const svc = app.plugins.plugins["deepreader-dev"].readingModeService;
					const file = app.vault.getAbstractFileByPath(${JSON.stringify(chapterFilePath)});
					if (!file) return { error: 'file not found' };
					const leaf = app.workspace.getLeaf(false);
					await leaf.openFile(file);
					app.workspace.setActiveLeaf(leaf);
					svc.activate(file);
					return { ok: true };
				})()`);
				if (result?.error) throw new Error(result.error);
				// 等 paginator 渲染并恢复页码
				await new Promise(r => setTimeout(r, 1800));
				const page = await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.paginator.getCurrentPage()');
				if (page !== 2) throw new Error(`恢复页码=${page}（期望 2）`);
				pass('重新激活 → 恢复页码 2', Date.now() - t0, `currentPage=${page}`);
			} catch (e) {
				fail('重新激活 → 恢复页码 2', Date.now() - t0, e);
			}
		}

		// Step 10: 还原
		{
			const t0 = Date.now();
			try {
				await evalObsidian('app.plugins.plugins["deepreader-dev"].readingModeService.deactivate()');
				await new Promise(r => setTimeout(r, 300));
				if (originalLastPages !== null) {
					await evalObsidian(`app.vault.adapter.write(${JSON.stringify(LAST_PAGES_PATH)}, ${JSON.stringify(originalLastPages)})`);
					pass('还原 last-pages.json', Date.now() - t0);
				} else {
					await evalObsidian(`app.vault.adapter.remove(${JSON.stringify(LAST_PAGES_PATH)})`).catch(() => {});
					pass('清理 last-pages.json', Date.now() - t0, '原本不存在');
				}
			} catch (e) {
				fail('还原 last-pages.json', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};

