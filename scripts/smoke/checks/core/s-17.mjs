/**
 * S-17: 阅读模式入口
 *
 * 锚定: F-17 分页阅读 + 章节导航
 * 触发:  evalObsidian 调 readingModeService.activate(file)，等渲染
 * 断言:  .deeppdf-reading-mode / .deeppdf-paginated / .deeppdf-page-controls 至少存在
 * 失败信息:  当前含 deeppdf-page- 前缀的 className
 *
 * 真实选择器 (2026-06-01 实证):
 *   - .deeppdf-reading-mode   (containerEl 标记)
 *   - .deeppdf-paginated      (分页样式)
 *   - .deeppdf-page-controls  (页码控制条)
 *   - .deeppdf-page-chapter   (章节名)
 *   - .deeppdf-page-num       (页码数字)
 *   - .deeppdf-page-book-label (书名标签)
 *
 * activate() 内部依赖:
 *   - app.workspace.getLeavesOfType("markdown")[0].view.file  (需要 markdown leaf 存在)
 *   - activate 后 200ms 触发 paginator 初始化 (waitForRenderAndInitPaginator)
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';
import { countBySelector, listPrefixedClasses } from '../../lib/dom-query.mjs';

const SELECTORS = [
	'.deeppdf-reading-mode',
	'.deeppdf-paginated',
	'.deeppdf-page-controls',
];

export default {
	id: 'S-17',
	name: '阅读模式入口',
	level: 'core',
	feature: 'F-17',
	timeout: 10_000,

	async run({ log }) {
		// 1. 检查 vault 是否有 markdown 文件
		const fileCount = await evalObsidian('app.vault.getMarkdownFiles().length');
		if (fileCount === 0) {
			const err = new Error('vault 无 markdown 文件，activate() 无输入');
			err.skip = true;
			throw err;
		}

		// 2. 强制 deactivate 旧状态（避免 previous isActive 短路）
		// 3. 激活 active leaf
		// 4. activate(file)
		log?.info?.('正在激活阅读模式...');
		await evalObsidian(`
			(() => {
				const svc = app.plugins.plugins['deepreader'].readingModeService;
				svc.deactivate();
				const leaf = app.workspace.getLeavesOfType('markdown')[0];
				if (leaf) app.workspace.setActiveLeaf(leaf);
				const file = leaf?.view?.file;
				if (file) svc.activate(file);
				return svc.isActive;
			})()
		`);

		// 5. 等 paginator 渲染 (activate 后 200ms 触发，再 ~300ms DOM 渲染)
		await new Promise(r => setTimeout(r, 1200));

		// 6. 验证阅读模式元素
		const counts = await Promise.all(SELECTORS.map(s => countBySelector(s)));
		const total = counts.reduce((a, b) => a + b, 0);

		if (total === 0) {
			const classes = await listPrefixedClasses('deeppdf-page-');
			const err = new Error(`阅读元素未出现 (counts=${counts.join(',')})`);
			err.context = `当前含 deeppdf-page- 前缀的 className:\n  ${classes.join('\n  ') || '(无)'}`;
			throw err;
		}

		const detail = SELECTORS.map((s, i) => `${s}=${counts[i]}`).join(' ');
		log?.info?.(`✓ ${detail}`);
		return { ok: true, counts: Object.fromEntries(SELECTORS.map((s, i) => [s, counts[i]])) };
	},
};
